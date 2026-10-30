import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { InteractiveSimulation, type DemoAction } from './simulation.js';
import { readJson, snapshotResponse } from '../terminal/client.js';
import type { LiveSnapshot } from '../terminal/dashboard.js';

export interface DemoConfig { udpPort: number; hubPort: number; controlPort: number; devices: number; hz: number }
const labels: Record<DemoAction, string> = { heat: 'Surchauffe activée', cool: 'Température normale', stop: 'Émission coupée', resume: 'Émission rétablie', restart: 'Redémarrage demandé', normal: 'Appareil rétabli au nominal' };
export async function startInteractiveDemo(config: DemoConfig) {
  const simulation = new InteractiveSimulation(config.devices);
  const hubUrl = `http://127.0.0.1:${config.hubPort}`;
  const files = new Map<string, { body: Buffer; type: string }>();
  for (const [path, name, type] of [
    ['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css'],
    ['/ui.js', '../ui.js', 'text/javascript'], ['/ui.css', '../ui.css', 'text/css'], ['/favicon.svg', '../favicon.svg', 'image/svg+xml'],
  ]) {
    files.set(path!, { body: await readFile(new URL(`../../public/demo/${name}`, import.meta.url)), type: type! });
  }
  const udp = createSocket('udp4');
  const counters = { sent: 0, sendErrors: 0, skippedTicks: 0 };
  const actions: { at: string; deviceId: number; label: string }[] = [];
  let lastHub: LiveSnapshot | undefined; let hubConnected = false; let pending = 0; let closed = false;
  let tickTimer: NodeJS.Timeout | undefined; let pollTimer: NodeJS.Timeout | undefined;
  const abort = new AbortController();
  let pollTask: Promise<void> = Promise.resolve();
  const snapshot = () => ({ config: { ...config, hubUrl }, devices: simulation.snapshot(), counters: { ...counters },
    hub: { connected: hubConnected, snapshot: lastHub }, actions: [...actions] });
  const server = createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const host = req.headers.host ?? '';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    if (!allowedHosts.includes(host)) { res.writeHead(403).end('Hôte refusé'); return; }
    const path = new URL(req.url ?? '/', `http://${host}`).pathname;
    const json = (status: number, value: unknown) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(value));
    if (req.method === 'GET' && path === '/api/state') { json(200, snapshot()); return; }
    if (req.method === 'POST' && path === '/api/action') {
      if (req.headers.origin && req.headers.origin !== `http://${host}`) { json(403, { error: 'Origine refusée' }); return; }
      if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') { json(415, { error: 'JSON attendu' }); return; }
      void (async () => {
        let body = ''; let bytes = 0;
        for await (const chunk of req) {
          bytes += Buffer.byteLength(chunk as Buffer);
          if (bytes > 1024) { json(413, { error: 'Commande trop volumineuse' }); return; }
          body += String(chunk);
        }
        let input: { deviceId?: unknown; action?: unknown };
        try { input = JSON.parse(body) as typeof input; } catch { json(400, { error: 'JSON invalide' }); return; }
        if (!input || !Number.isInteger(input.deviceId) || typeof input.action !== 'string' || !Object.hasOwn(labels, input.action)) {
          json(400, { error: 'deviceId entier et action valide attendus' }); return;
        }
        const action = input.action as DemoAction; const id = input.deviceId as number;
        try { simulation.act(id, action); } catch (e) { json(409, { error: (e as Error).message }); return; }
        actions.unshift({ at: new Date().toISOString(), deviceId: id, label: labels[action] });
        actions.splice(12); json(200, { message: `${labels[action]} pour PH-${String(id).padStart(3, '0')}. La confirmation vient du hub.`, state: snapshot() });
      })().catch(() => { if (!res.headersSent) json(400, { error: 'Commande interrompue' }); });
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405, { Allow: path === '/api/action' ? 'POST' : 'GET' }).end(); return; }
    const file = files.get(path);
    if (file) res.writeHead(200, { 'Content-Type': file.type + '; charset=utf-8' }).end(file.body);
    else res.writeHead(404).end('Introuvable');
  });
  const bound = once(udp, 'listening'); udp.bind(0, '127.0.0.1'); await bound;
  udp.on('error', () => { counters.sendErrors++; });
  const ready = once(server, 'listening'); server.listen(config.controlPort, '127.0.0.1');
  try { await ready; } catch (e) { udp.close(); throw e; }
  const start = performance.now(); const interval = 1000 / config.hz; let tickIndex = 0;
  const tick = () => {
    if (closed) return;
    if (pending === 0) for (const data of simulation.frames()) {
      pending++; udp.send(data, config.udpPort, '127.0.0.1', error => { pending--; if (error) counters.sendErrors++; else counters.sent++; });
    } else counters.skippedTicks++;
    tickIndex = Math.max(tickIndex + 1, Math.floor((performance.now() - start) / interval) + 1);
    tickTimer = setTimeout(tick, Math.max(0, start + tickIndex * interval - performance.now()));
  };
  const poll = async () => {
    try { lastHub = snapshotResponse(await readJson(hubUrl, '/api/state', abort.signal)); hubConnected = true; }
    catch { hubConnected = false; }
    if (!closed) pollTimer = setTimeout(() => { pollTask = poll(); }, 500);
  };
  tick(); pollTask = poll();
  let closing: Promise<void> | undefined;
  return { server, snapshot, close: () => {
    closing ??= (async () => {
      closed = true; clearTimeout(tickTimer); clearTimeout(pollTimer); abort.abort();
      const httpClosed = new Promise<void>(resolve => server.close(() => resolve())); server.closeAllConnections();
      const udpClosed = new Promise<void>(resolve => udp.close(() => resolve()));
      await Promise.all([httpClosed, udpClosed, pollTask]);
    })(); return closing;
  } };
}
