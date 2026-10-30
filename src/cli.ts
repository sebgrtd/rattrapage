import { parseArgs } from 'node:util';
import { emitKeypressEvents, type Key } from 'node:readline';
import { initialState, displayed, visibleDevices, filters, renderDashboard } from './terminal/dashboard.js';
import { historyResponse, hubUrl, readJson, snapshotResponse } from './terminal/client.js';

async function main() {
  const { values } = parseArgs({ options: { url: { type: 'string', default: 'http://127.0.0.1:3000' }, once: { type: 'boolean' }, 'no-color': { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('PulseHub Terminal\n  npm run cli\n  npm.cmd run cli -- --url http://127.0.0.1:3000\n  npm.cmd run cli -- --once [--no-color]\n\n↑↓ sélectionner · / chercher · f filtrer · espace pause · h historique\n[ ] parcourir l’historique · ? aide · q quitter\nLe hub doit déjà être lancé. Sans TTY, produit un instantané texte puis quitte.'); return;
  }
  const endpoint = hubUrl(values.url!); const state = initialState(endpoint);
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== 'dumb' && !values.once);
  const color = !values['no-color'] && process.env.NO_COLOR === undefined && Boolean(process.stdout.isTTY);
  if (!interactive) {
    state.latest = snapshotResponse(await readJson(endpoint, '/api/state')); state.connected = true; state.message = '';
    state.rates = [state.latest.ratePerSecond];
    const screen = renderDashboard(state, 120, 38);
    console.log(color ? screen.ansi() : screen.plain()); return;
  }
  let stopped = false; let timer: NodeJS.Timeout | undefined; let historyLoading = false; let savedQuery = '';
  const abort = new AbortController(); const previousRaw = process.stdin.isRaw;
  const dimensions = () => ({ width: Math.max(1, Math.min(180, (process.stdout.columns || 120) - 1)), height: Math.max(1, Math.min(65, (process.stdout.rows || 40) - 1)) });
  const draw = () => {
    if (stopped || process.stdout.writableNeedDrain) return;
    const { width, height } = dimensions();
    const screen = renderDashboard(state, width, height);
    process.stdout.write('\x1b[H' + (color ? screen.ansi() : screen.plain().replaceAll('\n', '\r\n')));
  };
  const cleanup = () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer); abort.abort();
    process.stdin.off('keypress', onKey); process.stdin.setRawMode(previousRaw); process.stdin.pause();
    process.stdout.off('resize', resize); process.off('SIGINT', stop); process.off('SIGTERM', stop);
    process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');
  };
  const stop = () => cleanup();
  const fail = (error: unknown) => { cleanup(); console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; };
  const poll = async () => {
    try {
      const latest = snapshotResponse(await readJson(endpoint, '/api/state', abort.signal));
      if (!state.connected) state.message = '';
      state.latest = latest; state.connected = true;
      if (state.mode === 'live') { state.rates.push(latest.ratePerSecond); state.rates = state.rates.slice(-120); }
    } catch {
      if (stopped) return;
      state.connected = false; state.message = 'Connexion perdue · nouvel essai automatique';
    }
    if (stopped) return;
    draw(); timer = setTimeout(() => { void poll().catch(fail); }, 500);
  };
  const loadHistory = async () => {
    if (historyLoading) return;
    historyLoading = true; state.message = 'Chargement de l’historique…'; draw();
    try {
      const entries = historyResponse(await readJson(endpoint, '/api/history', abort.signal));
      if (stopped) return;
      if (!entries.length) { state.message = 'Aucun instantané enregistré pour le moment.'; return; }
      state.history = entries; state.historyIndex = entries.length - 1; state.mode = 'history'; state.message = ''; state.selection = 0;
    } catch { if (!stopped) state.message = 'Historique indisponible · r pour réessayer'; }
    finally { historyLoading = false; draw(); }
  };
  function onKey(text: string | undefined, key: Key) {
    if (key.ctrl && key.name === 'c') { stop(); return; }
    if (state.editing) {
      if (key.name === 'escape') { state.query = savedQuery; state.editing = false; }
      else if (key.name === 'return') state.editing = false;
      else if (key.name === 'backspace') state.query = state.query.slice(0, -1);
      else if (text && !key.ctrl && !key.meta && /^[a-zA-Z0-9-]+$/.test(text)) state.query = (state.query + text).slice(0, 24);
      state.selection = 0; draw(); return;
    }
    if (text === 'q') { stop(); return; }
    if (text === '?') state.help = !state.help;
    else if (state.help) { if (key.name === 'escape') state.help = false; }
    else if (text === '/') { savedQuery = state.query; state.query = ''; state.editing = true; state.selection = 0; }
    else if (key.name === 'escape') { state.query = ''; state.selection = 0; }
    else if (text === 'f') { state.filter = filters[(filters.indexOf(state.filter) + 1) % filters.length]!; state.selection = 0; }
    else if (text === ' ') {
      if (state.mode === 'pause') state.mode = 'live';
      else if (state.mode === 'live' && state.latest) { state.frozen = state.latest; state.mode = 'pause'; }
    } else if (text === 'h') { if (state.mode === 'history') { state.mode = 'live'; state.selection = 0; } else void loadHistory().catch(fail); }
    else if (text === 'r') void loadHistory().catch(fail);
    else if (state.mode === 'history' && (text === '[' || key.name === 'left')) state.historyIndex = Math.max(0, state.historyIndex - 1);
    else if (state.mode === 'history' && (text === ']' || key.name === 'right')) state.historyIndex = Math.min(state.history.length - 1, state.historyIndex + 1);
    else {
      const count = visibleDevices(state).length; const page = Math.max(1, dimensions().height - 25);
      if (key.name === 'up' || text === 'k') state.selection--;
      if (key.name === 'down' || text === 'j') state.selection++;
      if (key.name === 'pageup' || text === 'p') state.selection -= page;
      if (key.name === 'pagedown' || text === 'n') state.selection += page;
      if (key.name === 'home') state.selection = 0;
      if (key.name === 'end') state.selection = count - 1;
    }
    state.selection = Math.max(0, Math.min(state.selection, (displayed(state) ? visibleDevices(state).length : 0) - 1)); draw();
  }
  const resize = () => { process.stdout.write('\x1b[2J'); draw(); };
  emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  process.stdin.on('keypress', onKey); process.stdout.on('resize', resize);
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J'); draw();
  void poll().catch(fail);
}
main().catch((error: unknown) => { console.error(`PulseHub CLI : ${error instanceof Error ? error.message : String(error)}. Vérifier que npm run hub est lancé.`); process.exitCode = 1; });
