const $ = id => document.getElementById(id);
const format = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const labels = { online: 'Opérationnel', alert: 'Alerte', watch: 'Observation', stale: 'Mesures périmées', offline: 'Hors ligne' };
let current;
let latest;
let historical = false;
let entries = [];
let rates = [];
const set = (id, value) => { $(id).textContent = value; };
const element = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
const age = ms => ms < 1000 ? `${Math.round(ms)} ms` : `${format.format(ms / 1000)} s`;
const name = id => `PH-${String(id).padStart(3, '0')}`;
const processingSummary = element('p', '0 redémarrage · 0 trame filtrée · 0 trame en confirmation', 'footnote');
processingSummary.id = 'processing-summary';
$('quality').after(processingSummary);

function drawChart(value) {
  rates.push(value); if (rates.length > 60) rates.shift();
  const scale = Math.max(1, ...rates) * 1.15;
  const points = rates.map((rate, i) => `${i * 800 / Math.max(1, rates.length - 1)},${105 - rate / scale * 100}`);
  const path = 'M' + points.join(' L');
  $('chart-line').setAttribute('d', path);
  $('chart-fill').setAttribute('d', path + ' L800,110 L0,110 Z');
}
function renderTable() {
  if (!current) return;
  const query = $('search').value.trim().toLowerCase();
  const filter = $('status-filter').value;
  const devices = current.devices.filter(d => (name(d.id).toLowerCase().includes(query) || String(d.id).includes(query)) && (filter === 'all' || (filter === 'attention' ? ['alert', 'watch', 'stale'].includes(d.status) : d.status === filter)));
  const fragment = document.createDocumentFragment();
  for (const d of devices) {
    const tr = element('tr');
    const identity = element('td', name(d.id));
    if (d.restarts) identity.append(element('small', `↻ ${d.restarts} redémarrage${d.restarts > 1 ? 's' : ''}`, 'metric-secondary'));
    tr.append(identity);
    const state = element('td'); state.append(element('span', labels[d.status], `status ${d.status}`)); tr.append(state);
    for (const m of d.metrics) {
      const unit = m.id === 1 ? ' °C' : m.id === 2 ? ' V' : ' A';
      const td = element('td', m.value === null ? '—' : format.format(m.value / (m.id === 1 ? 100 : 1000)) + unit,
        m.stale || d.status === 'offline' ? 'stale-value' : '');
      td.dataset.tooltip = m.ageMs === null ? 'Aucune mesure reçue' : `Âge de la mesure : ${age(m.ageMs)}${m.stale ? ' (périmée)' : ''}`;
      for (const a of (d.aggregates ?? []).filter(a => a.metricId === m.id)) {
        const value = a.stale || d.status === 'offline' ? '—' : format.format(a.value / (m.id === 1 ? 100 : 1000)) + unit;
        const summary = element('small', `${a.label} : ${value}`, 'metric-secondary');
        summary.dataset.tooltip = `${a.samples} échantillons ; fenêtre ${a.windowMs / 1000} s`;
        td.append(summary);
      }
      tr.append(td);
    }
    tr.append(element('td', age(d.ageMs), 'muted'), element('td', format.format(d.lost), d.lost ? 'hot-value' : 'muted'));
    fragment.append(tr);
  }
  $('devices').replaceChildren(fragment);
  window.PulseUI?.refreshTooltip();
  $('empty-fleet').hidden = devices.length > 0;
  if (!devices.length) {
    if (current.devices.length) $('empty-fleet').replaceChildren(element('strong', 'Aucun appareil ne correspond au filtre.'));
    else $('empty-fleet').replaceChildren(element('span', '⌁'), element('strong', 'Aucun appareil connecté'), element('p', 'Démarrez npm run simulator dans un second terminal.'));
  }
  set('visible-count', `${devices.length} appareil${devices.length > 1 ? 's' : ''} affiché${devices.length > 1 ? 's' : ''}`);
}
function renderAlerts(s) {
  const priority = { offline: 0, alert: 1, stale: 2, watch: 3 };
  const attention = s.devices.filter(d => d.status !== 'online').sort((a, b) => priority[a.status] - priority[b.status] || a.id - b.id);
  set('alert-count', attention.length);
  const fragment = document.createDocumentFragment();
  if (!attention.length) {
    const empty = element('div', undefined, 'empty-alert');
    empty.append(element('span', '◎', 'radar'), element('strong', s.devices.length ? 'Tous les signaux sont au vert.' : 'Le calme avant le live.'), element('p', s.devices.length ? 'Aucune anomalie active sur la flotte.' : 'Les alertes et pertes de signal apparaîtront ici.'));
    fragment.append(empty);
  }
  for (const d of attention.slice(0, 20)) {
    const item = element('div', undefined, `alert-item ${d.status}`);
    const detail = element('div');
    const message = d.status === 'offline' ? 'Aucune trame récente acceptée' : d.status === 'stale' ? 'Une ou plusieurs mesures ne sont plus actualisées' : d.alerts.map(a => `${a.label}${a.active ? '' : ` (${format.format(a.elapsedMs / 1000)} / ${a.durationMs / 1000} s)`}`).join(' · ');
    detail.append(element('strong', `${name(d.id)} · ${labels[d.status]}`), element('p', message));
    item.append(element('span', d.status === 'offline' ? '⊘' : '△', 'alert-symbol'), detail, element('span', age(d.ageMs)));
    fragment.append(item);
  }
  if (attention.length > 20) fragment.append(element('p', `+ ${attention.length - 20} autres appareils : utilisez le filtre de la flotte.`, 'small'));
  $('alerts').replaceChildren(fragment);
}
function render(s, chart = true) {
  current = s;
  set('total', s.totals.devices); set('online', s.totals.online); set('offline', s.totals.offline);
  set('attention', s.totals.alert + s.totals.watch + s.totals.stale);
  set('attention-detail', `${s.totals.alert} alerte · ${s.totals.watch} en observation · ${s.totals.stale} périmé`);
  set('rate', format.format(s.ratePerSecond));
  for (const key of ['received', 'invalid', 'lost']) set(key, format.format(s.counters[key]));
  set('discarded', `${format.format(s.counters.duplicates)} / ${format.format(s.counters.late)}`);
  set('quality', `Invalides ${format.format(s.invalidPercent)} % · pertes estimées ${format.format(s.lossPercent)} % · compteurs cumulés depuis le démarrage`);
  processingSummary.textContent = `${format.format(s.counters.restarts ?? 0)} redémarrage(s) · ${format.format(s.counters.filtered ?? 0)} trame(s) filtrée(s) · ${format.format(s.counters.restartPending ?? 0)} trame(s) écartée(s) en confirmation`;
  set('fleet-count', '/ ' + s.totals.devices);
  const degraded = s.counters.invalid + s.counters.lost + s.counters.capacityRejected > 0;
  set('reception-state', !s.counters.received ? 'AUCUN SIGNAL' : !s.ratePerSecond ? 'FLUX ARRÊTÉ' : degraded ? 'DÉFAUTS OBSERVÉS' : 'RÉCEPTION SAINE');
  $('reception-state').classList.toggle('degraded', degraded);
  set('description', historical ? 'Lecture d’un instantané enregistré. Revenez au direct pour suivre la flotte.' : s.totals.devices ? `${s.totals.devices} appareils détectés. La télémétrie de votre installation, en un regard.` : 'En attente du premier signal. Lancez le simulateur pour connecter la flotte.');
  const service = s.service;
  const issues = [];
  if (s.counters.capacityRejected) issues.push(`${s.counters.capacityRejected} trames écartées : capacité d’appareils atteinte.`);
  if (service?.transportErrors) issues.push(`${service.transportErrors} erreurs de transport.`);
  if (service?.history.error) issues.push(`Historique : ${service.history.error}`);
  $('warning').hidden = issues.length === 0; set('warning', issues.join(' '));
  if (service) set('storage', service.historyEnabled ? `Historique local · ${service.history.written} instantanés écrits · ${service.history.skipped} ignorés` : 'Historique désactivé');
  set('clock', new Date(s.at || Date.now()).toLocaleTimeString('fr-FR'));
  if (chart) drawChart(s.ratePerSecond);
  renderTable(); renderAlerts(s);
}
$('search').addEventListener('input', renderTable);
$('status-filter').addEventListener('change', renderTable);
$('history-button').addEventListener('click', async () => {
  $('history-panel').hidden = false;
  set('history-message', 'Chargement…');
  try {
    const response = await fetch('/api/history'); if (!response.ok) throw new Error();
    entries = await response.json();
    $('history-select').replaceChildren(element('option', 'Choisir un instantané…'));
    $('history-select').firstChild.value = '';
    entries.forEach((entry, i) => { const option = element('option', new Date(entry.at).toLocaleString('fr-FR')); option.value = String(i); $('history-select').append(option); });
    set('history-message', entries.length ? `${entries.length} instantanés disponibles` : 'Aucun instantané enregistré pour le moment.');
  } catch { set('history-message', 'Impossible de charger l’historique.'); }
});
$('history-select').addEventListener('change', event => {
  if (event.target.value === '') return;
  const entry = entries[Number(event.target.value)]; if (!entry) return;
  historical = true; rates = []; render({ ...entry.snapshot, at: entry.at });
  set('chart-caption', 'Débit enregistré dans cet instantané');
  set('connection', 'Lecture historique');
});
$('live-button').addEventListener('click', () => {
  historical = false; rates = []; $('history-panel').hidden = true;
  set('chart-caption', 'Derniers échantillons du navigateur');
  set('connection', events.readyState === EventSource.OPEN ? 'En direct' : 'Reconnexion…');
  if (latest) render(latest);
});
const events = new EventSource('/events');
events.onopen = () => { $('connection-dot').classList.add('connected'); if (!historical) set('connection', 'En direct'); };
events.onerror = () => { $('connection-dot').classList.remove('connected'); if (!historical) set('connection', 'Déconnecté · données figées'); };
events.onmessage = event => { latest = JSON.parse(event.data); if (!historical) render(latest); };
