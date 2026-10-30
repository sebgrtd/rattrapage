import { createSocket } from 'node:dgram';
import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import type { Config } from './config.js';
import { Fleet } from './fleet.js';
import { History } from './history.js';

export async function startHub(config: Config) {
  const fleet = new Fleet(config);
  const history = new History(config.historyFile, config.historyMaxBytes);
  const clients = new Set<ServerResponse>();
  const udp = createSocket('udp4');
  let transportErrors = 0;
  let slowClients = 0;
  const snapshot = () => ({ ...fleet.snapshot(), at: new Date().toISOString(),
    service: { transportErrors, slowClients, clients: clients.size, history: { ...history.status }, historyEnabled: Boolean(config.historyFile) } });
  const files = new Map<string, { body: Buffer; type: string }>();
  for (const [path, file, type] of [['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css']]) {
    files.set(path!, { body: await readFile(new URL(`../public/${file}`, import.meta.url)), type: type! });
  }
  const http = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }).end(); return; }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(snapshot())); return;
    }
    if (path === '/api/history') {
      void history.read().then(entries => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(entries));
      }).catch(() => { res.writeHead(500).end('Historique indisponible'); });
      return;
    }
    if (path === '/events') {
      if (clients.size >= config.maxClients) { res.writeHead(503).end('Trop de clients'); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      clients.add(res);
      res.write(`retry: 1000\ndata: ${JSON.stringify(snapshot())}\n\n`);
      res.on('close', () => clients.delete(res));
      res.on('error', () => { clients.delete(res); res.destroy(); });
      return;
    }
    const file = files.get(path);
    if (file) res.writeHead(200, { 'Content-Type': file.type + '; charset=utf-8' }).end(file.body);
    else res.writeHead(404).end('Introuvable');
  });
  udp.on('message', data => fleet.receive(data));
  // Runtime socket errors are surfaced in the dashboard; startup errors reject.
  udp.on('error', () => { transportErrors++; });
  http.on('error', () => { transportErrors++; });
  const udpReady = once(udp, 'listening');
  udp.bind(config.udpPort, config.udpHost);
  try { await udpReady; } catch (error) { try { udp.close(); } catch { /* not bound */ } throw error; }
  const httpReady = once(http, 'listening');
  http.listen(config.httpPort, config.httpHost);
  try { await httpReady; } catch (error) { udp.close(); throw error; }
  const refresh = setInterval(() => {
    if (!clients.size) return;
    const event = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const client of clients) {
      // Disconnect a slow reader instead of accumulating an unbounded buffer.
      if (!client.write(event)) { slowClients++; clients.delete(client); client.destroy(); }
    }
  }, config.refreshMs);
  const persist = setInterval(() => history.record(fleet.snapshot()), config.historyIntervalMs);
  let closing: Promise<void> | undefined;
  return { fleet, snapshot, udp, http, close: () => {
    closing ??= (async () => {
      clearInterval(refresh); clearInterval(persist);
      for (const client of clients) client.end();
      clients.clear();
      const udpClosed = new Promise<void>(resolve => udp.close(() => resolve()));
      const httpClosed = new Promise<void>(resolve => http.close(() => resolve()));
      http.closeAllConnections();
      await history.flush(); history.record(fleet.snapshot()); await history.flush();
      await Promise.all([udpClosed, httpClosed]);
    })();
    return closing;
  } };
}
