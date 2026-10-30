import type { Snapshot } from '../fleet.js';
import type { HistoryEntry } from '../history.js';
import { Screen, type Tone } from './screen.js';

export type LiveSnapshot = Snapshot & { at: string; service?: { transportErrors: number; history: { written: number; error: string }; historyEnabled: boolean } };
export const filters = ['all', 'attention', 'offline', 'online'] as const;
export type Filter = typeof filters[number];
const filterLabels = { all: 'Tous', attention: 'À surveiller', offline: 'Hors ligne', online: 'Opérationnels' };
const statuses: Record<string, { label: string; tone: Tone }> = {
  online: { label: 'En ligne', tone: 'green' }, alert: { label: 'ALERTE', tone: 'amber' },
  offline: { label: 'Hors ligne', tone: 'red' }, stale: { label: 'Périmé', tone: 'muted' }, watch: { label: 'Observation', tone: 'amber' },
};
export interface DashboardState {
  latest?: LiveSnapshot; frozen?: LiveSnapshot; history: HistoryEntry[]; historyIndex: number;
  mode: 'live' | 'pause' | 'history'; connected: boolean; message: string;
  rates: number[]; filter: Filter; query: string; editing: boolean; selection: number; help: boolean; endpoint: string;
}
export function initialState(endpoint: string): DashboardState {
  return { history: [], historyIndex: 0, mode: 'live', connected: false, message: 'Connexion au hub…', rates: [], filter: 'all', query: '', editing: false, selection: 0, help: false, endpoint };
}
export function displayed(state: DashboardState): Snapshot | undefined {
  return state.mode === 'history' ? state.history[state.historyIndex]?.snapshot : state.mode === 'pause' ? state.frozen : state.latest;
}
export function visibleDevices(state: DashboardState): Snapshot['devices'] {
  const query = state.query.toLowerCase().trim();
  return (displayed(state)?.devices ?? []).filter(d => name(d.id).toLowerCase().includes(query) &&
    (state.filter === 'all' || (state.filter === 'attention' ? ['alert', 'watch', 'stale'].includes(d.status) : d.status === state.filter)));
}
const number = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n);
const name = (id: number) => `PH-${String(id).padStart(3, '0')}`;
const age = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${number(ms / 1000)} s`;
const metric = (id: number, value: number | null) => value === null ? '—' : number(value / (id === 1 ? 100 : 1000)) + (id === 1 ? ' °C' : id === 2 ? ' V' : ' A');
const pad = (value: string, width: number) => value.slice(0, width).padEnd(width);
export function renderDashboard(state: DashboardState, width: number, height: number): Screen {
  const screen = new Screen(width, height);
  if (width < 72 || height < 28) {
    screen.text(2, 1, 'PULSEHUB / TERMINAL', 'lime', true);
    screen.text(2, 3, 'Agrandir le terminal : 73 colonnes × 29 lignes minimum.', 'amber');
    screen.text(2, 5, 'q quitter  |  --once pour un instantané texte', 'muted'); return screen;
  }
  const snapshot = displayed(state);
  const time = state.mode === 'history' ? state.history[state.historyIndex]?.at : state.mode === 'pause' ? state.frozen?.at : state.latest?.at;
  const mode = state.mode === 'history' ? `HISTORIQUE ${state.historyIndex + 1}/${state.history.length}` : state.mode === 'pause' ? 'PAUSE / DONNÉES FIGÉES' : state.connected ? 'EN DIRECT' : 'HUB DÉCONNECTÉ';
  screen.text(2, 1, 'p h  /  P U L S E H U B', 'lime', true);
  screen.text(Math.max(29, width - 36), 1, mode, state.mode === 'live' && state.connected ? 'green' : 'amber', true);
  screen.text(2, 2, `RÉGIE TERMINAL  ·  ${state.endpoint}`, 'muted', false, width - 24);
  screen.text(width - 18, 2, time ? new Date(time).toLocaleTimeString('fr-FR') : '--:--:--', 'muted');
  const totals = snapshot?.totals;
  const cards: [string, number, Tone][] = [ ['DÉTECTÉS', totals?.devices ?? 0, 'text'], ['OPÉRATIONNELS', totals?.online ?? 0, 'green'],
    ['À SURVEILLER', (totals?.alert ?? 0) + (totals?.watch ?? 0) + (totals?.stale ?? 0), 'amber'], ['HORS LIGNE', totals?.offline ?? 0, 'red'] ];
  const cardWidth = Math.floor((width - 5) / 4);
  cards.forEach(([label, value, tone], i) => {
    const x = 1 + i * (cardWidth + 1); screen.box(x, 4, cardWidth, 4, label); screen.text(x + 3, 6, String(value), tone, true);
  });
  const chartWidth = Math.floor((width - 3) * 0.59);
  screen.box(1, 8, chartWidth, 6, 'RÉCEPTION');
  screen.text(3, 9, `${number(snapshot?.ratePerSecond ?? 0)} trames/s`, 'lime', true);
  const rates = state.mode === 'history' ? state.history.slice(0, state.historyIndex + 1).map(e => e.snapshot.ratePerSecond) : state.rates;
  const history = rates.slice(-(chartWidth - 5)); const max = Math.max(1, ...history);
  screen.text(3, 10, history.map(v => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(7 * v / max))]).join(''), 'lime');
  screen.text(3, 11, `Invalides ${number(snapshot?.invalidPercent ?? 0)} % · pertes ${number(snapshot?.lossPercent ?? 0)} %`, 'muted', false, chartWidth - 4);
  screen.text(3, 12, `${number(snapshot?.counters.received ?? 0)} reçues · ${number(snapshot?.counters.lost ?? 0)} trous`, 'muted', false, chartWidth - 4);
  const alertX = chartWidth + 2; const alertWidth = width - alertX - 1;
  screen.box(alertX, 8, alertWidth, 6, 'POINTS D’ATTENTION');
  const attention = (snapshot?.devices ?? []).filter(d => d.status !== 'online').sort((a, b) => Number(b.status === 'offline') - Number(a.status === 'offline'));
  attention.slice(0, 3).forEach((d, i) => {
    const status = statuses[d.status]!;
    screen.text(alertX + 2, 9 + i, `${name(d.id)}  ${d.alerts.find(a => a.active)?.label ?? status.label}`, status.tone, false, alertWidth - 4);
  });
  screen.text(alertX + 2, 12, attention.length ? `${attention.length} appareil(s) · f pour filtrer` : snapshot ? 'Aucun point d’attention' : 'En attente de télémétrie', 'muted', false, alertWidth - 4);
  const tableHeight = height - 22; const capacity = tableHeight - 3;
  const devices = visibleDevices(state); const selected = Math.min(Math.max(0, state.selection), Math.max(0, devices.length - 1));
  const first = Math.floor(selected / capacity) * capacity;
  screen.box(1, 14, width - 2, tableHeight, `FLOTTE / ${devices.length} · ${filterLabels[state.filter]}${state.query ? ` · /${state.query}` : ''}`);
  const wide = width >= 110;
  const columns = wide ? [3, 15, 31, 44, 56, 68, 83, width - 12] : [3, 13, 27, 39, 49, width - 13];
  const headings = wide ? ['APPAREIL', 'ÉTAT', 'TEMP.', 'TENSION', 'COURANT', 'MOY. TEMP.*', 'SIGNAL', 'PERTES'] : ['APPAREIL', 'ÉTAT', 'TEMP.', 'TENSION', 'COURANT', 'SIGNAL'];
  headings.forEach((h, i) => screen.text(columns[i]!, 15, h, 'muted'));
  devices.slice(first, first + capacity).forEach((d, row) => {
    const y = 16 + row; const status = statuses[d.status]!;
    if (first + row === selected) { screen.fill(2, y, width - 4, 1, 'selected'); screen.text(2, y, '›', 'lime'); }
    const values = d.metrics.map(m => metric(m.id, m.value) + (m.stale && m.value !== null ? '~' : ''));
    const average = d.aggregates?.find(a => a.metricId === 1 && a.operation === 'mean');
    const texts = [name(d.id), status.label, ...values, ...(wide ? [average && !average.stale && d.status !== 'offline' ? metric(1, average.value) : '—', age(d.ageMs), number(d.lost)] : [age(d.ageMs)])];
    texts.forEach((v, i) => screen.text(columns[i]!, y, v, i === 1 ? status.tone : d.status === 'offline' ? 'muted' : 'text', i === 0, (columns[i + 1] ?? width - 2) - columns[i]! - 1));
  });
  if (!devices.length) screen.text(4, 17, snapshot ? 'Aucun appareil ne correspond à la recherche.' : 'Démarrer le hub : npm run hub', 'muted');
  const detailY = height - 8; const device = devices[selected];
  screen.box(1, detailY, width - 2, 5, device ? `DÉTAIL / ${name(device.id)} · ${selected + 1}/${devices.length}` : 'DÉTAIL');
  if (device) {
    screen.text(3, detailY + 1, `Séq. ${device.seq}   Uptime ${age(device.uptimeMs)}   Redémarrages ${device.restarts ?? 0}   Pertes ${number(device.lost)}`, 'text', false, width - 6);
    const aggregates = (device.aggregates ?? []).map(a => `${a.label}: ${a.stale || device.status === 'offline' ? '—' : metric(a.metricId, a.value)} (${a.samples} éch.)`);
    screen.text(3, detailY + 2, aggregates.join('  ·  ') || 'Aucune agrégation configurée.', 'lime', false, width - 6);
    screen.text(3, detailY + 3, device.alerts.map(a => `${a.label} ${a.active ? 'ACTIVE' : 'en observation'}`).join(' · ') || `${statuses[device.status]!.label} · ${number(device.accepted)} trames acceptées · ~ = mesure périmée`, 'muted', false, width - 6);
  }
  const service = state.latest?.service;
  const footer = !state.connected ? `${state.message} · dernières données conservées` : state.message ||
    `${snapshot?.counters.restarts ?? 0} reboot(s) · ${snapshot?.counters.filtered ?? 0} filtrée(s) · doublons ${number(snapshot?.counters.duplicates ?? 0)} / retards ${number(snapshot?.counters.late ?? 0)}${state.mode === 'live' ? ` · disque ${service?.historyEnabled ? service.history.error ? 'ERREUR' : 'OK' : 'désactivé'}` : ''}`;
  screen.text(2, height - 3, footer, state.connected ? 'muted' : 'red', false, width - 4);
  screen.fill(0, height - 2, width, 1, 'selected');
  const shortcuts = width >= 100 ? '↑↓ naviguer  / chercher  f filtre  espace pause  h historique  ? aide  q quitter' : '↑↓ choix  / chercher  f filtre  espace pause  h hist.  ? aide  q';
  screen.text(2, height - 2, state.editing ? `RECHERCHE /${state.query}█   Entrée valider · Échap annuler` : shortcuts, 'lime', false, width - 4);
  if (state.help) {
    const w = Math.min(76, width - 4); const x = Math.floor((width - w) / 2); const y = 6;
    screen.box(x, y, w, 17, 'RACCOURCIS');
    const help = [ ['↑ / ↓ · j / k', 'Sélectionner un appareil'], ['PgUp / PgDn · n / p', 'Changer de page'], ['Début / Fin', 'Premier / dernier appareil'], ['/', 'Rechercher un identifiant ; Entrée valide'], ['Échap', 'Annuler la saisie / effacer la recherche'], ['f', 'Tous → à surveiller → hors ligne → en ligne'], ['Espace', 'Figer / reprendre l’affichage live'], ['h', 'Ouvrir l’historique / revenir au direct'], ['[ / ] · ← / →', 'Instantané précédent / suivant'], ['r', 'Recharger l’historique'], ['? · q · Ctrl+C', 'Aide / quitter (le hub continue)'], ['', '* Première moyenne de température configurée.'], ['', 'La fenêtre exacte est indiquée dans le détail.'], ['', 'Les compteurs sont ceux du hub, sans recalcul.'] ];
    help.forEach(([key, description], i) => screen.text(x + 2, y + 2 + i, pad(key!, 22) + description, i > 10 ? 'muted' : 'text', false, w - 4));
  }
  return screen;
}
