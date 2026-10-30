const $ = id => document.getElementById(id);
const buttons = ['heat', 'stop', 'restart', 'normal'];
const name = id => `PH-${String(id).padStart(3, '0')}`;
const format = value => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value);
const statuses = { online: 'Opérationnel', alert: 'Alerte active', watch: 'En observation', stale: 'Mesures périmées', offline: 'Hors ligne' };
let state; let busy = false; let connected = false; let selected = 9;
function feedback(message, error = false) { $('feedback').textContent = message; $('feedback').classList.toggle('error', error); }
function render() {
  if (!state) return;
  const device = state.devices.find(d => d.id === selected);
  if (!device) return;
  const restarting = device.status === 'restarting';
  buttons.forEach(id => { $(id).disabled = busy || !connected || restarting || (id === 'restart' && !device.canRestart); });
  $('emission').textContent = restarting ? 'Redémarrage en cours…' : device.status === 'offline' ? 'Coupée' : 'Active';
  $('setpoint').textContent = device.hot ? '~ 85 °C / surchauffe' : '~ 43 °C / nominale';
  $('destination').textContent = `127.0.0.1:${state.config.udpPort}`;
  $('heat').textContent = device.hot ? 'Refroidir l’appareil' : 'Déclencher une surchauffe';
  $('stop').textContent = device.status === 'offline' ? 'Reprendre l’émission' : 'Couper l’émission';
  $('restart').textContent = restarting ? 'Redémarrage en cours…' : device.canRestart ? 'Redémarrer' : 'Attendre 1 s de télémétrie';
  $('hub-link').href = state.config.hubUrl;
  const available = connected && state.hub.connected;
  $('connection').textContent = !connected ? 'Contrôleur déconnecté · commandes désactivées · reconnexion automatique' : state.hub.connected ? 'Contrôleur connecté · hub joignable · les effets sont observés en direct' : 'Émetteur actif · hub indisponible · démarrer npm run hub pour observer les effets';
  $('connection').classList.toggle('error', !available);
  const observed = available ? state.hub.snapshot?.devices.find(d => d.id === selected) : undefined;
  $('observed-id').textContent = name(selected);
  $('observed-status').textContent = observed ? statuses[observed.status] : available ? 'En attente' : 'Indisponible';
  $('observed-status').className = observed?.status ?? 'stale';
  $('observed-note').textContent = observed ? `Dernière synthèse : ${new Date(state.hub.snapshot.at).toLocaleTimeString('fr-FR')}` : 'Aucune confirmation actuelle du hub.';
  const temperature = observed?.metrics.find(m => m.id === 1);
  $('temperature').textContent = temperature?.value == null ? '—' : `${format(temperature.value / 100)} °C${temperature.stale ? ' · périmée' : ''}`;
  $('age').textContent = observed ? observed.ageMs < 1000 ? `${Math.round(observed.ageMs)} ms` : `${format(observed.ageMs / 1000)} s` : '—';
  $('restarts').textContent = observed?.restarts ?? '—';
  $('fleet').textContent = available ? `${state.hub.snapshot.totals.online} / ${state.hub.snapshot.totals.devices}` : '—';
  const alerts = observed?.alerts.map(a => a.active ? `${a.label} · ACTIVE` : `${a.label} · ${format(a.elapsedMs / 1000)} / ${format(a.durationMs / 1000)} s`) ?? [];
  $('alerts').replaceChildren(...(alerts.length ? alerts : [observed ? 'Aucune alerte en cours.' : 'État non disponible.']).map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  $('actions').replaceChildren(...(state.actions.length ? state.actions.map(a => `${new Date(a.at).toLocaleTimeString('fr-FR')} · ${name(a.deviceId)} · ${a.label}`) : ['Aucune action pour le moment.']).map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  $('traffic').textContent = `${state.config.devices} appareils × ${state.config.hz} Hz · ${format(state.counters.sent)} trames envoyées · ${state.counters.sendErrors} erreurs d’envoi`;
}
async function poll() {
  try {
    const response = await fetch('/api/state', { signal: AbortSignal.timeout(3000) }); if (!response.ok) throw new Error();
    state = await response.json(); connected = true;
    if ($('device').disabled) {
      if (!state.devices.some(d => d.id === selected)) selected = state.devices[0].id;
      $('device').replaceChildren(...state.devices.map(d => { const option = document.createElement('option'); option.value = String(d.id); option.textContent = name(d.id); return option; }));
      $('device').value = String(selected); $('device').disabled = false;
    }
  } catch { connected = false; }
  if (state) render(); else $('connection').textContent = 'Contrôleur indisponible · nouvelle tentative automatique';
  setTimeout(poll, 500);
}
async function act(action) {
  if (!state || busy || !connected) return;
  const id = selected; busy = true; render();
  try {
    const response = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: id, action }), signal: AbortSignal.timeout(3000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Commande refusée');
    state = result.state; feedback(result.message);
  } catch (e) { feedback(e.message || 'Commande non confirmée : vérifier l’état avant de réessayer.', true); }
  finally { busy = false; render(); }
}
$('device').addEventListener('change', e => { selected = Number(e.target.value); render(); });
$('heat').addEventListener('click', () => act(state.devices.find(d => d.id === selected).hot ? 'cool' : 'heat'));
$('stop').addEventListener('click', () => act(state.devices.find(d => d.id === selected).status === 'offline' ? 'resume' : 'stop'));
$('restart').addEventListener('click', () => act('restart'));
$('normal').addEventListener('click', () => act('normal'));
void poll();
