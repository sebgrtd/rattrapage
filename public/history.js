/* Calendar and time navigation. The API resolves to a real, explicitly dated record. */
window.PulseHistory = {
  init({ onSelect, onEmpty, onLive }) {
    const $ = id => document.getElementById(id);
    const pad = n => String(n).padStart(2, '0');
    const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const dateText = date => `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    const stamp = time => new Date(time).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const preciseStamp = time => new Date(time).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, timeZoneName: 'shortOffset' });
    const number = value => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(value);
    let times = [], days = new Set(), interval = 5000, selected = Date.now(), exact = null;
    let month = new Date(); month.setDate(1);
    let controller, generation = 0, visible = false;
    const inputs = ['history-date', 'history-hour', 'history-minute', 'history-second'].map($);
    function cancel() { generation++; controller?.abort(); }
    function status(title, detail = '', state = '') {
      $('history-message').textContent = title; $('history-detail').textContent = detail;
      $('history-result').dataset.state = state;
    }
    function neighbors(previous, next) {
      for (const [id, time, label] of [['history-previous', previous, '← Relevé précédent'], ['history-next', next, 'Relevé suivant →']]) {
        $(id).hidden = !time; $(id).textContent = time ? `${label} · ${stamp(time)}` : '';
        $(id).onclick = () => { setInstant(Date.parse(time)); void lookup(); };
      }
    }
    function calendar(focusDate) {
      $('calendar-month').textContent = month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      const fragment = document.createDocumentFragment();
      const offset = (month.getDay() + 6) % 7;
      for (let i = 0; i < offset; i++) fragment.append(document.createElement('span'));
      const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      for (let day = 1; day <= count; day++) {
        const date = new Date(month.getFullYear(), month.getMonth(), day), key = dateKey(date);
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'calendar-day' + (days.has(key) ? ' has-data' : ''); button.textContent = day;
        button.dataset.date = key; button.setAttribute('aria-pressed', String(key === dateKey(new Date(selected))));
        button.setAttribute('aria-label', `${date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${days.has(key) ? 'enregistrements disponibles' : 'aucun enregistrement'}`);
        if (key === dateKey(new Date())) button.setAttribute('aria-current', 'date');
        button.onclick = () => {
          $('history-date').value = dateText(date); dirty(); readInstant(); calendar(key);
        };
        // Arrow keys move between days, including across month boundaries.
        button.onkeydown = event => {
          const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
          if (!delta) return;
          event.preventDefault(); date.setDate(date.getDate() + delta);
          month = new Date(date.getFullYear(), date.getMonth(), 1); calendar(dateKey(date));
        };
        fragment.append(button);
      }
      $('calendar-days').replaceChildren(fragment);
      if (focusDate) $('calendar-days').querySelector(`[data-date="${focusDate}"]`)?.focus();
    }
    function setInstant(time) {
      selected = time; exact = time; const d = new Date(time);
      inputs.forEach(input => input.removeAttribute('aria-invalid'));
      $('history-date').value = dateText(d); $('history-hour').value = pad(d.getHours());
      $('history-minute').value = pad(d.getMinutes()); $('history-second').value = pad(d.getSeconds());
      month = new Date(d.getFullYear(), d.getMonth(), 1);
      $('history-range').value = String(time);
      $('history-cursor').textContent = stamp(time); calendar();
    }
    function readInstant() {
      const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec($('history-date').value.trim());
      const clock = inputs.slice(1).map(input => /^\d{1,2}$/.test(input.value) ? Number(input.value) : NaN);
      const validClock = clock.every((v, i) => Number.isInteger(v) && v >= 0 && v <= (i ? 59 : 23));
      const d = parts ? new Date(Number(parts[3]), Number(parts[2]) - 1, Number(parts[1]), ...clock) : new Date(NaN);
      const validDate = parts && d.getFullYear() === Number(parts[3]) && d.getMonth() === Number(parts[2]) - 1 && d.getDate() === Number(parts[1]);
      const validTime = validClock && d.getHours() === clock[0] && d.getMinutes() === clock[1] && d.getSeconds() === clock[2];
      inputs.forEach((input, i) => input.setAttribute('aria-invalid', String(!(i ? validTime : validDate))));
      if (!validDate || !validTime) return null; // Also refuses a nonexistent local time during a DST jump.
      selected = exact ?? d.getTime();
      $('history-cursor').textContent = stamp(selected); $('history-range').value = String(selected);
      return selected;
    }
    function dirty() {
      cancel(); exact = null; neighbors(null, null);
      status('Instant à consulter', 'Validez avec « Voir les mesures » pour afficher les données de cet instant.');
      onEmpty('Instant à consulter', 'Validez la date et l’heure choisies pour afficher les mesures.');
    }
    async function get(path, signal) {
      const response = await fetch(path, { signal }); if (!response.ok) throw new Error('Historique indisponible');
      return response.json();
    }
    async function loadIndex(signal) {
      const index = await get('/api/history/index', signal);
      if (!visible || signal.aborted) return false;
      interval = index.intervalMs; times = index.timestamps.map(Date.parse);
      days = new Set(times.map(time => dateKey(new Date(time))));
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      $('history-timezone').textContent = `Heure locale · ${zone} · enregistrement toutes les ${number(interval / 1000)} s · recherche à ±${number(interval / 2000)} s.`;
      const first = times[0], last = times.at(-1), span = last - first;
      $('history-first').textContent = times.length ? stamp(first) : 'Aucun enregistrement';
      $('history-last').textContent = times.length ? stamp(last) : '—';
      $('history-range').disabled = times.length < 2;
      $('history-range').min = String(first ?? 0); $('history-range').max = String(last ?? 1);
      $('history-range').step = '1000';
      for (const id of ['history-latest', 'history-minute-ago', 'history-five-ago']) $(id).disabled = !times.length;
      // Merge adjacent coverage intervals so a pause remains visibly empty on the track.
      const bands = [];
      for (const time of times) {
        const start = Math.max(first, time - interval / 2), end = Math.min(last, time + interval / 2);
        if (bands.length && start <= bands.at(-1)[1]) bands.at(-1)[1] = Math.max(end, bands.at(-1)[1]);
        else bands.push([start, end]);
      }
      const fragment = document.createDocumentFragment();
      for (const [start, end] of bands) {
        const band = document.createElement('span');
        band.style.left = `${span ? (start - first) / span * 100 : 0}%`;
        band.style.width = `${span ? (end - start) / span * 100 : 100}%`; fragment.append(band);
      }
      $('history-track').replaceChildren(fragment); calendar();
      $('history-help').textContent = !index.enabled ? 'L’enregistrement est désactivé dans la configuration du hub.' : times.length ? `${times.length} instantanés conservés. Les zones orange de la frise indiquent les données disponibles.` : 'Aucun enregistrement pour le moment. Actualisez après quelques secondes.';
      return true;
    }
    async function lookup() {
      cancel(); const token = generation; controller = new AbortController();
      const time = readInstant();
      if (time === null) {
        status('Date ou heure invalide', 'Utilisez JJ/MM/AAAA et une heure locale existante de 00:00:00 à 23:59:59.', 'error');
        onEmpty('Date ou heure invalide', 'Corrigez les champs avant de rechercher des mesures.');
        inputs.find(input => input.getAttribute('aria-invalid') === 'true')?.focus(); return;
      }
      neighbors(null, null); status('Recherche des mesures…', `Instant demandé : ${preciseStamp(time)}`);
      onEmpty('Recherche en cours…', 'Lecture des enregistrements conservés.');
      try {
        const result = await get(`/api/history?at=${encodeURIComponent(new Date(time).toISOString())}`, controller.signal);
        if (generation !== token || !visible) return;
        neighbors(result.previousAt, result.nextAt);
        if (!result.entry) {
          status('Aucune mesure disponible à cet instant', `${preciseStamp(time)} · aucun instantané à ±${number(result.toleranceMs / 1000)} s. Aucun résultat n’est interpolé.`, 'empty');
          onEmpty('Aucune mesure à cet instant', 'Essayez les relevés voisins ou un jour marqué d’un point orange.'); return;
        }
        const entry = result.entry;
        const count = entry.snapshot.devices.filter(device => device.metrics.some(metric => metric.value !== null)).length;
        const offset = result.deltaMs === 0 ? 'correspondance exacte' : `${number(Math.abs(result.deltaMs) / 1000)} s ${result.deltaMs < 0 ? 'avant' : 'après'} l’instant demandé`;
        status(count ? `Mesures retrouvées · ${count} appareil${count > 1 ? 's' : ''}` : 'Instantané retrouvé, sans mesure', `Enregistré le ${preciseStamp(entry.at)} · ${offset}. L’âge des mesures est celui enregistré dans cet instantané.`, 'found');
        onSelect(entry);
      } catch (error) {
        if (error.name === 'AbortError' || generation !== token) return;
        status('Impossible de lire l’historique', 'Vérifiez que le hub fonctionne, puis réessayez.', 'error');
        onEmpty('Historique indisponible', 'Aucune ancienne valeur n’est affichée à la place du résultat.');
      }
    }
    async function refresh(useLatest = false) {
      cancel(); controller = new AbortController(); const token = generation, signal = controller.signal;
      status('Actualisation de l’historique…');
      try {
        if (!await loadIndex(signal) || token !== generation) return;
        if (useLatest) setInstant(times.at(-1) ?? Date.now());
        await lookup();
      } catch (error) {
        if (error.name === 'AbortError' || token !== generation) return;
        status('Impossible de charger l’historique', 'Vérifiez que le hub fonctionne, puis cliquez sur Actualiser.', 'error');
        onEmpty('Historique indisponible', 'La consultation reprendra dès que le hub sera disponible.');
      }
    }
    $('history-button').onclick = () => {
      visible = true; $('history-panel').hidden = false;
      $('history-button').setAttribute('aria-expanded', 'true');
      onEmpty('Chargement de l’historique…', 'Les mesures enregistrées apparaîtront ici.');
      void refresh(true); $('history-date').focus();
    };
    $('history-button').setAttribute('aria-controls', 'history-panel'); $('history-button').setAttribute('aria-expanded', 'false');
    $('live-button').onclick = () => {
      visible = false; cancel(); $('history-panel').hidden = true;
      $('history-button').setAttribute('aria-expanded', 'false'); onLive(); $('history-button').focus();
    };
    $('history-form').onsubmit = event => { event.preventDefault(); void lookup(); };
    inputs.forEach(input => input.addEventListener('input', dirty));
    $('history-date').addEventListener('change', () => { if (readInstant() !== null) { month = new Date(new Date(selected).getFullYear(), new Date(selected).getMonth(), 1); calendar(); } });
    for (const [id, delta] of [['month-before', -1], ['month-after', 1]]) $(id).onclick = () => { month.setMonth(month.getMonth() + delta); calendar(); };
    $('history-latest').onclick = () => void refresh(true);
    for (const [id, delta] of [['history-minute-ago', 60000], ['history-five-ago', 300000]]) $(id).onclick = () => { setInstant(Date.now() - delta); void lookup(); };
    $('history-refresh').onclick = () => void refresh();
    $('history-range').oninput = () => { dirty(); setInstant(Number($('history-range').value)); };
    $('history-range').onchange = () => void lookup();
    setInstant(Date.now());
  }
};
