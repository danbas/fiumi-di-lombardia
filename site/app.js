(function () {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const MONTHS = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  const MON3 = MONTHS.map((m) => m.slice(0, 3));
  const CLS = {
    lo2: 'Magra severa', lo1: 'Sotto la norma', ok: 'Nella norma', hi1: 'Sopra la norma', hi2: 'Molto alto',
    stale: 'Dati fermi', nd: 'Nessun dato',
  };
  const CLS_DESC = {
    lo2: 'sotto il 5° percentile del periodo', lo1: 'tra il 5° e il 25° percentile', ok: 'tra il 25° e il 75° percentile',
    hi1: 'tra il 75° e il 95° percentile', hi2: 'oltre il 95° percentile', stale: 'nessuna misura nelle ultime 48 ore', nd: 'storia troppo breve per un confronto',
  };
  const ORDER = ['lo2', 'lo1', 'ok', 'hi1', 'hi2', 'stale', 'nd'];
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDMY = (s) => { const [y, m, d] = s.split('-'); return `${+d} ${MON3[+m - 1]} ${y}`; };
  const fmtTs = (ts) => { const [d, t] = ts.split('T'); return `${fmtDMY(d)}, ${t.slice(0, 5)}`; };
  const fmtCm = (v) => v == null ? '—' : (v > 0 ? '+' : '') + v + ' cm';
  const fmtM = (v) => v == null ? '—' : (v / 100).toFixed(2).replace('.', ',') + ' m';
  const doy = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5); };
  const isLeap = (y) => (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
  const dayLabel = (i, y) => { const d = new Date(Date.UTC(y || 2024, 0, 1 + i)); return d.getUTCDate() + ' ' + MON3[d.getUTCMonth()]; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let INDEX = null;
  const cache = {};
  const state = { sel: null, osm: false, links: true, filter: null, year: null, compare: new Set(), recentSpan: 7, day: null };
  const TODAY = new Date().toISOString().slice(0, 10);
  let HIST = null;   // storia compatta per la navigazione per data (caricata alla prima data scelta)
  const decoded = {};
  async function loadHistory() {
    if (HIST) return HIST;
    const h = await loadJSON('data/history.json');
    const b64 = (str) => Uint8Array.from(atob(str), (ch) => ch.charCodeAt(0));
    HIST = { start: h.start, days: h.days, pct: {}, mean: {} };
    for (const sid of Object.keys(h.pct)) { HIST.pct[sid] = b64(h.pct[sid]); HIST.mean[sid] = new Int16Array(b64(h.mean[sid]).buffer); }
    return HIST;
  }
  const dayIdx = (day) => Math.round((Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) - Date.UTC(+HIST.start.slice(0, 4), 0, 1)) / 864e5);
  // stato di una stazione "oggi" (dall'indice) o alla data scelta (dalla storia compatta)
  function statusOf(sid) {
    const s = st(sid);
    if (!state.day) return { value: s.value, pct: s.pct, cls: s.cls, trend: s.trend, spark: s.spark, ts: s.ts, live: true };
    const k = dayIdx(state.day), P = HIST.pct[sid], M = HIST.mean[sid];
    if (!P || k < 0 || k >= HIST.days) return { value: null, pct: null, cls: 'nd', trend: null, spark: null, ts: null };
    const mean = (i) => (i < 0 || i >= HIST.days || M[i] === -32768 ? null : M[i]);
    const pct = P[k] === 255 ? null : P[k];
    const value = mean(k);
    const prev = mean(k - 1);
    return { value, pct, cls: value == null ? 'nd' : pctClass(pct), trend: value != null && prev != null ? value - prev : null,
      spark: Array.from({ length: 28 }, (_, i) => mean(k - 6 + Math.floor(i / 4))), ts: state.day, live: false };
  }
  const trendLabel = (o) => o.live ? trendTxt(o.trend) : (o.trend == null ? '' : Math.abs(o.trend) < 3 ? '→ stabile' : o.trend > 0 ? `↗ +${o.trend} cm rispetto al giorno prima` : `↘ ${o.trend} cm rispetto al giorno prima`);
  async function setDay(day) {
    if (day && day >= TODAY) day = null;
    if (day && day < INDEX.first_year + '-01-01') day = INDEX.first_year + '-01-01';
    state.day = day;
    if (day) await loadHistory();
    $('#gday').value = day || TODAY; $('#gtoday').hidden = !day;
    renderToday(); renderBodies(); renderMarkers(); renderDetail();
  }
  try { const s = JSON.parse(localStorage.getItem('fiumi-lomb') || 'null'); if (s) { state.osm = !!s.osm; state.links = s.links !== false; } } catch (e) { /* ignore */ }
  const persist = () => { try { localStorage.setItem('fiumi-lomb', JSON.stringify({ osm: state.osm, links: state.links })); } catch (e) { /* ignore */ } };

  async function loadJSON(path) {
    if (!cache[path]) cache[path] = fetch(path).then((r) => { if (!r.ok) throw new Error(path + ': ' + r.status); return r.json(); });
    return cache[path];
  }
  const st = (sid) => INDEX.stations[sid];
  const bodyOf = (sid) => { const s = st(sid); return (s.kind === 'river' ? INDEX.rivers : INDEX.lakes).find((b) => b.id === s.body); };
  const bodyById = (kind, id) => (kind === 'river' ? INDEX.rivers : INDEX.lakes).find((b) => b.id === id);
  const stationIds = () => Object.keys(INDEX.stations);

  // percentile approssimato di un valore dati i 5 percentili climatologici del giorno
  function approxPct(v, c) {
    if (v == null || c == null || c.p5 == null) return null;
    const xs = [c.p5, c.p25, c.p50, c.p75, c.p95], ps = [5, 25, 50, 75, 95];
    if (v <= xs[0]) return Math.max(0, 5 - (xs[0] - v) / Math.max(1, xs[1] - xs[0]) * 10);
    if (v >= xs[4]) return Math.min(100, 95 + (v - xs[4]) / Math.max(1, xs[4] - xs[3]) * 10);
    for (let i = 0; i < 4; i++) if (v <= xs[i + 1]) return ps[i] + (ps[i + 1] - ps[i]) * (v - xs[i]) / Math.max(1e-9, xs[i + 1] - xs[i]);
    return 50;
  }
  const pctClass = (p) => p == null ? 'nd' : p < 5 ? 'lo2' : p < 25 ? 'lo1' : p <= 75 ? 'ok' : p <= 95 ? 'hi1' : 'hi2';
  const trendTxt = (t) => t == null ? '' : Math.abs(t) < 3 ? '→ stabile' : t > 0 ? `↗ +${t} cm in 6 h` : `↘ ${t} cm in 6 h`;
  const lagTxt = (l) => l.median === 0 ? '< 1 h' : `~${l.median} h`;

  // ---------- header / riepilogo ----------
  function renderToday() {
    const n = {}; ORDER.forEach((c) => (n[c] = 0));
    stationIds().forEach((sid) => n[statusOf(sid).cls]++);
    const gen = INDEX.data_generated ? fmtTs(INDEX.data_generated.replace('Z', '')) + ' UTC' : '—';
    $('#today').innerHTML = `<div><div class="k">Stazioni</div><div class="v">${stationIds().length}</div></div>
      <div><div class="k">In magra (sotto il 25°)</div><div class="v" style="color:var(--lo2)">${n.lo2 + n.lo1}</div></div>
      <div><div class="k">Alte (sopra il 75°)</div><div class="v" style="color:var(--hi1)">${n.hi1 + n.hi2}</div></div>
      <div><div class="k">${state.day ? 'Giorno mostrato' : 'Dati aggiornati'}</div><div class="v" style="font-size:14px">${state.day ? fmtDMY(state.day) : gen}</div></div>`;
    $('#sum-when').textContent = state.day ? 'medie del ' + fmtDMY(state.day) : 'ultime misure';
    $('#h-sum').textContent = state.day ? 'Lombardia il ' + fmtDMY(state.day) : 'Oggi in Lombardia';
    $('#summary').innerHTML = ORDER.map((c) => `<button class="c-${c}" data-cls="${c}" aria-pressed="${state.filter === c}"><span class="n">${n[c]}</span><span class="l">${CLS[c]}</span></button>`).join('');
    $('#summary').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      state.filter = state.filter === b.dataset.cls ? null : b.dataset.cls; renderToday(); renderBodies(); renderMarkers();
    }));
    $('#legend').innerHTML = ORDER.map((c) => `<span class="c-${c}"><i class="dot"></i>${CLS[c]}</span>`).join('');
  }

  // ---------- elenco fiumi / laghi (linea metro) ----------
  function renderBodies() {
    const groups = new Map();
    INDEX.rivers.forEach((r) => { const g = r.group || 'Altri corsi d\'acqua'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push({ ...r, kind: 'river' }); });
    groups.set('Laghi', INDEX.lakes.map((l) => ({ ...l, kind: 'lake' })));
    let html = '';
    for (const [g, list] of groups) {
      html += `<div class="grp">${esc(g)}</div>`;
      for (const b of list) {
        const cur = state.sel && state.sel.kind === b.kind && state.sel.id === b.id;
        const match = !state.filter || b.stations.some((sid) => statusOf(sid).cls === state.filter);
        const line = b.stations.map((sid, i) => { const o = statusOf(sid); return `${i ? '<b></b>' : ''}<i class="c-${o.cls}" data-tip="${esc(st(sid).name)} · ${fmtCm(o.value)} · ${CLS[o.cls]}"></i>`; }).join('');
        html += `<button class="body${match ? '' : ' dim'}" data-kind="${b.kind}" data-id="${b.id}" aria-current="${cur}">
          <span class="nm">${esc(b.name)}</span><span class="cnt">${b.stations.length} ${b.stations.length === 1 ? 'staz.' : 'staz.'}</span><span class="line">${line}</span></button>`;
      }
    }
    $('#bodies').innerHTML = html;
    $('#bodies').querySelectorAll('.body').forEach((el) => el.addEventListener('click', () => go(el.dataset.kind, el.dataset.id)));
  }

  // ---------- mappa ----------
  let map, tiles, markers = {}, lines = [], provLayer, halo = null, label = null, lastFocus = null;
  function initMap() {
    map = L.map('map', { zoomSnap: 0.5, attributionControl: true, scrollWheelZoom: false });
    // la rotella zooma solo dopo un clic sulla mappa (e finché il mouse resta sopra): così lo scroll della pagina non
    // viene catturato da chi vuole soltanto passare oltre; + / − e doppio clic funzionano sempre
    const mapEl = $('#map');
    mapEl.addEventListener('click', () => { map.scrollWheelZoom.enable(); mapEl.classList.add('wheel'); });
    mapEl.addEventListener('mouseleave', () => { map.scrollWheelZoom.disable(); mapEl.classList.remove('wheel'); });
    map.on('focus', () => map.scrollWheelZoom.enable());
    map.attributionControl.setPrefix('');
    map.attributionControl.addAttribution('Confini: ISTAT · Dati: ARPA Lombardia');
    tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
    fetch('province_lombardia.geojson').then((r) => r.json()).then((gj) => {
      provLayer = L.geoJSON(gj, { style: () => ({ color: css('--map-line'), weight: 1, fillColor: css('--map-fill'), fillOpacity: state.osm ? 0 : 1 }) }).addTo(map);
      provLayer.bringToBack();
      gj.features.forEach((f) => {
        const b = L.geoJSON(f).getBounds().getCenter();
        L.marker(b, { icon: L.divIcon({ className: 'prov-label', html: f.properties.acr, iconSize: [30, 14] }), interactive: false, keyboard: false }).addTo(map);
      });
    });
    map.fitBounds([[44.65, 8.45], [46.65, 11.45]]);
    $('#osm').checked = state.osm; $('#links').checked = state.links;
    applyOsm();
    $('#osm').addEventListener('change', (e) => { state.osm = e.target.checked; persist(); applyOsm(); });
    $('#links').addEventListener('change', (e) => { state.links = e.target.checked; persist(); renderLines(); });
    renderLines();
    renderMarkers();
  }
  function applyOsm() {
    if (state.osm) { tiles.addTo(map); tiles.bringToBack(); } else map.removeLayer(tiles);
    if (provLayer) provLayer.setStyle({ fillOpacity: state.osm ? 0 : 1 });
  }
  function renderLines() {
    lines.forEach((l) => map.removeLayer(l)); lines = [];
    if (!state.links) return;
    INDEX.rivers.forEach((r) => {
      if (r.stations.length < 2) return;
      const sel = state.sel && ((state.sel.kind === 'river' && state.sel.id === r.id) || (state.sel.kind === 'station' && st(state.sel.id).body === r.id));
      const pts = r.stations.map((sid) => [st(sid).lat, st(sid).lng]);
      lines.push(L.polyline(pts, { color: css('--accent'), weight: sel ? 3 : 1.5, opacity: sel ? .8 : .35, dashArray: '4 6', interactive: false }).addTo(map));
    });
  }
  function renderMarkers() {
    stationIds().forEach((sid) => {
      const s = st(sid), o = statusOf(sid);
      const selected = state.sel && ((state.sel.kind === 'station' && state.sel.id === sid) || (state.sel.kind !== 'station' && state.sel.id === s.body));
      const dim = state.filter && o.cls !== state.filter;
      const opt = { radius: selected ? 9 : (s.kind === 'lake' ? 7 : 6), color: selected ? css('--ink') : css('--surface'), weight: selected ? 2 : 1.5,
        fillColor: css('--' + o.cls), fillOpacity: dim ? .25 : .95, opacity: dim ? .3 : 1 };
      if (!markers[sid]) {
        const m = L.circleMarker([s.lat, s.lng], opt).addTo(map);
        m.bindTooltip(() => { const q = statusOf(sid); return `<b>${esc(s.name)}</b>${esc(bodyOf(sid).name)}<br><span class="v">${fmtCm(q.value)}</span> · ${CLS[q.cls]}${state.day ? ' · media del giorno' : ''}`; }, { className: 'st', direction: 'top', offset: [0, -6] });
        m.on('click', () => go('station', sid));
        markers[sid] = m;
      } else markers[sid].setStyle(opt);
      if (selected) markers[sid].bringToFront();
    });
    focusSelection();
  }
  // anello ed etichetta fissa sulla stazione selezionata, e mappa centrata sulla selezione
  function focusSelection() {
    if (halo) { map.removeLayer(halo); halo = null; }
    if (label) { map.removeLayer(label); label = null; }
    if (!state.sel) { lastFocus = null; return; }
    if (state.sel.kind === 'station') {
      const s = st(state.sel.id);
      halo = L.circleMarker([s.lat, s.lng], { radius: 18, color: css('--' + statusOf(state.sel.id).cls), weight: 3, opacity: .9, fill: false, interactive: false, className: 'halo' }).addTo(map);
      label = L.tooltip({ permanent: true, direction: 'top', offset: [0, -14], className: 'st pin', interactive: false }).setLatLng([s.lat, s.lng]).setContent(esc(s.name)).addTo(map);
      const key = 'station:' + state.sel.id;
      if (key !== lastFocus) map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 10), { duration: .8 });
      lastFocus = key;
    } else {
      const b = bodyById(state.sel.kind, state.sel.id);
      const key = state.sel.kind + ':' + state.sel.id;
      if (key !== lastFocus && b.stations.length) {
        const bounds = L.latLngBounds(b.stations.map((sid) => [st(sid).lat, st(sid).lng]));
        map.flyToBounds(bounds.pad(0.4), { maxZoom: 11, duration: .8 });
      }
      lastFocus = key;
    }
  }

  // ---------- routing ----------
  function go(kind, id) { location.hash = kind === 'river' ? `#/fiume/${id}` : kind === 'lake' ? `#/lago/${id}` : `#/stazione/${id}`; }
  function route() {
    const m = location.hash.match(/^#\/(fiume|lago|stazione)\/([\w-]+)/);
    state.sel = null;
    if (m) {
      const kind = m[1] === 'fiume' ? 'river' : m[1] === 'lago' ? 'lake' : 'station';
      if ((kind === 'station' && st(m[2])) || (kind !== 'station' && bodyById(kind, m[2]))) state.sel = { kind, id: m[2] };
    }
    renderBodies(); renderMarkers(); renderLines(); renderDetail();
  }

  // ---------- dettaglio ----------
  let charts = [];
  function clearCharts() { charts.forEach((c) => c.destroy()); charts = []; }
  async function renderDetail() {
    const el = $('#detail');
    clearCharts();
    if (!state.sel) { el.innerHTML = '<div class="pb"><div class="empty">Scegli un fiume, un lago o una stazione dall\'elenco o dalla mappa.</div></div>'; return; }
    el.innerHTML = '<div class="pb"><div class="empty">Carico i dati…</div></div>';
    try {
      if (state.sel.kind === 'station') await renderStation(el, state.sel.id);
      else await renderBody(el, state.sel.kind, state.sel.id);
    } catch (e) {
      el.innerHTML = `<div class="pb"><div class="empty">Impossibile caricare i dati (${esc(e.message)}).</div></div>`;
    }
    if (window.innerWidth < 960) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // --- fiume / lago ---
  async function renderBody(el, kind, id) {
    const b = bodyById(kind, id);
    const data = await loadJSON(`data/${kind === 'river' ? 'rivers' : 'lakes'}/${id}.json`);
    const allYears = [...new Set(b.stations.flatMap((sid) => st(sid).years || []))].sort((x, y) => y - x);
    const stops = b.stations.map((sid, i) => {
      const s = st(sid), o = statusOf(sid);
      const lagKey = i ? `${b.stations[i - 1]}-${sid}` : null;
      const lag = lagKey && INDEX.lags[lagKey];
      let lagHtml = '';
      if (i) {
        if (lag && lag.median != null) lagHtml = `<div class="lag" title="Ritardo del picco tra ${esc(st(b.stations[i - 1]).name)} e ${esc(s.name)} in ${lag.n} piene"><b>${lagTxt(lag)}</b><i>${lag.q1}–${lag.q3} h · ${lag.n} piene</i></div>`;
        else if (lag && lag.skip === 'lake') lagHtml = `<div class="lag nolag" title="Tra le due stazioni c'è un lago: la piena non si propaga direttamente"><b>lago</b><i>nessun ritardo</i></div>`;
        else lagHtml = `<div class="lag nolag" title="${lag ? `Nelle ${lag.events} piene analizzate l'onda non si riconosce abbastanza chiaramente in entrambe le stazioni` : 'Piene non ancora analizzate'}"><b>–</b><i>ritardo n.d.</i></div>`;
      }
      return `${lagHtml}<button class="stop c-${o.cls}" data-sid="${sid}" aria-current="${false}">
        <span class="nd"></span><span class="nm">${esc(s.name)}${s.verify ? ' <span class="verify" title="Assegnazione al corso d\'acqua da verificare">?</span>' : ''}</span>
        <span class="vv">${fmtCm(o.value)}</span><canvas class="sp" width="90" height="22" aria-hidden="true"></canvas></button>`;
    }).join('');
    const reg = b.regulated_by ? ` · regolato da ${esc(b.regulated_by)}` : '';
    el.innerHTML = `<div class="pb">
      <div class="dh"><span class="crumb">${kind === 'river' ? 'Fiume' : 'Lago'} · ${esc(b.group || '')}${reg}</span></div>
      <div class="dh"><h2>${esc(b.name)}</h2><span class="hint" style="margin:0">${b.stations.length} ${b.stations.length === 1 ? 'stazione' : 'stazioni'}${kind === 'river' ? ', da monte a valle' : ''}</span></div>
      <div class="stops">${stops}</div>
      <p class="hint">Colore = stato ${state.day ? 'del ' + fmtDMY(state.day) : 'di oggi'} rispetto al periodo dell'anno; la piccola curva sono i 7 giorni precedenti. Tra due stazioni, il tempo mediano impiegato dal picco di una piena a passare da una all'altra (statistica sulle piene passate, non una previsione). Clicca una stazione per la scheda.</p>
      <div class="sub"><h3>Profilo ${state.day ? 'del ' + fmtDMY(state.day) : 'di oggi'}</h3><span class="hint" style="margin:0">percentile del livello ${state.day ? 'medio del giorno' : 'attuale'}, stazione per stazione</span></div>
      <div class="chartbox short"><canvas id="ch-profile"></canvas></div>
      <div class="sub"><h3>Profilo in una data</h3>
        <span class="chips"><input type="date" id="pdate" min="${INDEX.first_year}-01-01" max="${new Date().toISOString().slice(0, 10)}"><span class="hint" style="margin:0">stesso giorno del</span><select id="pcmp" aria-label="Anno di confronto"><option value="">nessun confronto</option>${allYears.map((y) => `<option value="${y}">${y}</option>`).join('')}</select></span></div>
      <div class="chartbox short"><canvas id="ch-pdate"></canvas></div>
      <p class="hint">Media giornaliera della data scelta, tradotta nel percentile del periodo (stima dai percentili 5-25-50-75-95). Utile per confrontare, ad esempio, l'estate 2022 con quella corrente lungo tutto il fiume.</p>
    </div>`;
    el.querySelectorAll('.stop').forEach((btn) => {
      btn.addEventListener('click', () => go('station', btn.dataset.sid));
      drawSpark(btn.querySelector('canvas'), statusOf(btn.dataset.sid));
    });
    // profilo di oggi
    const labels = b.stations.map((sid) => st(sid).name.replace(/\s+(SS|SP|v\.|via|c\.so|ponte).*$/i, ''));
    charts.push(new Chart($('#ch-profile'), {
      type: 'bar',
      data: { labels, datasets: [{ data: b.stations.map((sid) => statusOf(sid).pct), backgroundColor: b.stations.map((sid) => css('--' + statusOf(sid).cls)), borderRadius: 4, maxBarThickness: 48 }] },
      options: barOpts((ctx) => `${fmtCm(statusOf(b.stations[ctx.dataIndex]).value)} · ${ctx.raw == null ? 'n.d.' : ctx.raw.toFixed(0) + '° percentile'}`),
    }));
    // profilo in una data
    const pd = $('#pdate'), pc = $('#pcmp');
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    pd.value = state.day || yesterday;
    // confronto predefinito: l'anno precedente se ha dati, altrimenti il più recente che ne ha
    const py = +yesterday.slice(0, 4) - 1; pc.value = allYears.includes(py) ? py : (allYears.find((y) => y < py) || '');
    const drawDate = () => {
      const day = pd.value; if (!day) return;
      const series = (d) => b.stations.map((sid) => {
        const sd = data.stations[sid]; if (!sd) return null;
        const y = +d.slice(0, 4), i = doy(d), yr = sd.years[y];
        const v = yr && yr.a[i]; if (v == null) return null;
        return approxPct(v, { p5: sd.clim.p5[i], p25: sd.clim.p25[i], p50: sd.clim.p50[i], p75: sd.clim.p75[i], p95: sd.clim.p95[i] });
      });
      const ds = [{ label: fmtDMY(day), data: series(day), backgroundColor: series(day).map((p) => css('--' + pctClass(p))), borderRadius: 4, maxBarThickness: 40 }];
      if (pc.value) { const prev = pc.value + day.slice(4); ds.push({ label: fmtDMY(prev), data: series(prev), backgroundColor: css('--line-strong'), borderRadius: 4, maxBarThickness: 40 }); }
      const old = charts.find((c) => c.canvas.id === 'ch-pdate'); if (old) { charts.splice(charts.indexOf(old), 1); old.destroy(); }
      charts.push(new Chart($('#ch-pdate'), { type: 'bar', data: { labels, datasets: ds }, options: barOpts((ctx) => `${ctx.dataset.label}: ${ctx.raw == null ? 'n.d.' : ctx.raw.toFixed(0) + '° percentile'}`, ds.length > 1) }));
    };
    pd.addEventListener('change', drawDate); pc.addEventListener('change', drawDate); drawDate();
  }
  function barOpts(tip, legend) {
    return { responsive: true, maintainAspectRatio: false, animation: false,
      scales: { x: { grid: { display: false }, ticks: { color: css('--ink-2'), autoSkip: false, maxRotation: 45, font: { size: 11 } } },
        y: { min: 0, max: 100, ticks: { stepSize: 25, color: css('--muted'), callback: (v) => v + '°' }, grid: { color: css('--line') } } },
      plugins: { legend: { display: !!legend, labels: { color: css('--ink-2'), boxWidth: 12 } }, tooltip: { callbacks: { label: tip } } } };
  }
  function drawSpark(cv, s) {
    const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const v = (s.spark || []).filter((x) => x != null); if (v.length < 2) return;
    const lo = Math.min(...v), hi = Math.max(...v), rng = Math.max(hi - lo, 4);
    ctx.strokeStyle = css('--' + s.cls); ctx.lineWidth = 1.5; ctx.beginPath();
    let first = true;
    s.spark.forEach((x, i) => { if (x == null) { first = true; return; } const px = i / (s.spark.length - 1) * (w - 2) + 1, py = h - 2 - (x - lo) / rng * (h - 4); first ? ctx.moveTo(px, py) : ctx.lineTo(px, py); first = false; });
    ctx.stroke();
  }

  // --- stazione ---
  async function renderStation(el, sid) {
    const s = st(sid), b = bodyOf(sid);
    const [data, recent] = await Promise.all([loadJSON(`data/${s.kind === 'river' ? 'rivers' : 'lakes'}/${s.body}.json`), loadJSON('data/recent.json')]);
    const sd = data.stations[sid] || { years: {}, clim: {} };
    const years = (s.years || []).slice().sort((a, b2) => b2 - a);
    if (!state.year || !years.includes(state.year)) state.year = years[0] || null;
    const o = statusOf(sid);
    const dIdx = state.day ? doy(state.day) : null;
    const c = state.day ? (sd.clim.p5 ? Object.fromEntries(Object.entries(sd.clim).map(([k, v]) => [k, v[dIdx]])) : null) : s.clim_today;
    const kindLbl = s.kind === 'river' ? 'Fiume' : 'Lago';
    const val = o.value;
    const tsTxt = state.day ? fmtDMY(state.day) + ' (media giornaliera)' : (s.ts ? fmtTs(s.ts) + ' (ora solare, fine dell\'intervallo di misura)' : '—');
    if (state.day) state.year = +state.day.slice(0, 4);
    const pos = b.stations.map(String).indexOf(String(sid));
    const prev = pos > 0 ? b.stations[pos - 1] : null, next = pos < b.stations.length - 1 ? b.stations[pos + 1] : null;
    const lagIn = prev && INDEX.lags[`${prev}-${sid}`], lagOut = next && INDEX.lags[`${sid}-${next}`];
    const gauge = c && c.p5 != null ? gaugeHtml(c, val, o.cls) : '';
    const srcYears = Object.entries(s.src || {}).sort();
    const validated = srcYears.filter(([, k]) => k === 'validated').map(([y]) => y), current = srcYears.filter(([, k]) => k === 'current').map(([y]) => y);
    el.innerHTML = `<div class="pb">
      <div class="dh"><span class="crumb"><a href="#/${s.kind === 'river' ? 'fiume' : 'lago'}/${b.id}">${kindLbl} ${esc(b.name)}</a> · ${s.kind === 'river' ? `stazione ${pos + 1} di ${b.stations.length} da monte` : 'punto di misura'} · prov. ${esc(s.prov)}${s.alt != null ? ` · ${s.alt} m s.l.m.` : ''}</span></div>
      <div class="dh"><h2>${esc(s.name)}</h2>${s.note ? `<span class="hint" style="margin:0">${esc(s.note)}</span>` : ''}${s.verify ? '<span class="badge warn" title="L\'assegnazione di questa stazione al corso d\'acqua è stata fatta a tavolino e non è ancora stata verificata">fiume da verificare</span>' : ''}</div>
      <div class="now c-${o.cls}">
        <div class="big">${val == null ? '—' : (val > 0 ? '+' : '') + val}<small>cm</small></div>
        <div class="desc"><span><b class="badge c-${o.cls}">${CLS[o.cls]}</b> ${o.pct != null ? `· ${+o.pct >= 99.5 ? 'oltre il 99°' : +o.pct < 0.5 ? 'sotto il 1°' : (+o.pct).toFixed(0) + '°'} percentile del periodo` : `· ${CLS_DESC[o.cls]}`}</span>
          <span class="trend">${trendLabel(o)}</span><span>${state.day ? 'Giorno' : 'Ultima misura'}: ${tsTxt}</span></div>
      </div>
      ${gauge}
      ${(lagIn && lagIn.median != null) || (lagOut && lagOut.median != null) ? `<div class="stats">${lagIn && lagIn.median != null ? `<div><div class="k">Piena in arrivo da ${esc(st(prev).name)}</div><div class="v">${lagTxt(lagIn)} (${lagIn.q1}–${lagIn.q3} h, ${lagIn.n} piene)</div></div>` : ''}${lagOut && lagOut.median != null ? `<div><div class="k">Piena verso ${esc(st(next).name)}</div><div class="v">${lagTxt(lagOut)} (${lagOut.q1}–${lagOut.q3} h, ${lagOut.n} piene)</div></div>` : ''}</div>` : ''}

      ${state.day ? '' : `<div class="sub"><h3>Ultime settimane</h3><div class="seg" id="rspan"><button data-d="7" aria-pressed="${state.recentSpan === 7}">7 giorni</button><button data-d="14" aria-pressed="${state.recentSpan === 14}">14 giorni</button><button data-d="35" aria-pressed="${state.recentSpan === 35}">Tutto</button></div></div>
      <div class="chartbox short"><canvas id="ch-recent"></canvas></div>
      <p class="hint">Media oraria delle misure a 10 minuti del flusso in tempo reale ARPA (dati provvisori).</p>`}

      <div class="sub"><h3>Un anno sulla sua storia</h3><div class="chips"><select id="ysel" aria-label="Anno">${years.map((y) => `<option value="${y}"${y === state.year ? ' selected' : ''}>${y}</option>`).join('')}</select><span class="hint" style="margin:0">confronta con:</span><span class="chips" id="ycmp">${years.map((y) => `<button class="chip" data-y="${y}" aria-pressed="${state.compare.has(y)}">${y}</button>`).join('')}</span></div></div>
      <div class="stats" id="ystats"></div>
      <div class="chartbox tall"><canvas id="ch-year"></canvas></div>
      <p class="hint">Linea scura: media giornaliera dell'anno scelto. Fascia chiara: tra il 5° e il 95° percentile di tutti gli anni nello stesso periodo (±15 giorni); fascia più scura: tra il 25° e il 75°; tratteggio: mediana. Un anno che corre sotto la fascia chiara è una magra eccezionale.</p>

      <div class="sub"><h3>Record dal ${s.first || INDEX.first_year}</h3></div>
      <div class="records">
        <div><span class="eyebrow">Massimi giornalieri</span><ol>${s.rec_hi.map(([d, v]) => `<li${d.slice(0, 4) === String(new Date().getFullYear()) ? ' class="cur"' : ''}>${fmtDMY(d)}<span class="v">${fmtCm(v)}</span></li>`).join('')}</ol></div>
        <div><span class="eyebrow">Minimi giornalieri</span><ol>${s.rec_lo.map(([d, v]) => `<li${d.slice(0, 4) === String(new Date().getFullYear()) ? ' class="cur"' : ''}>${fmtDMY(d)}<span class="v">${fmtCm(v)}</span></li>`).join('')}</ol></div>
      </div>
      <p class="prov">Serie: ${validated.length ? `<span class="val">validate ARPA</span> ${validated[0]}–${validated[validated.length - 1]}` : ''}${current.length ? `${validated.length ? ' · ' : ''}<span class="cur">provvisorie</span> (flusso in tempo reale, accumulate dal sito) ${current.join(', ')}` : ''}. Livelli in cm rispetto allo zero idrometrico della stazione.</p>
    </div>`;
    // recente
    const drawRecent = () => {
      if (state.day) return;
      const r = recent.hourly[sid];
      const old = charts.find((ch) => ch.canvas.id === 'ch-recent'); if (old) { charts.splice(charts.indexOf(old), 1); old.destroy(); }
      if (!r) { $('#ch-recent').parentElement.innerHTML = '<div class="empty">Nessuna misura recente.</div>'; return; }
      const n = state.recentSpan * 24, v = r.v.slice(-n);
      const t0 = new Date(r.start + ':00:00Z'); t0.setUTCHours(t0.getUTCHours() + Math.max(0, r.v.length - n));
      const labels = v.map((_, i) => { const d = new Date(t0.getTime() + i * 36e5); return `${d.getUTCDate()} ${MON3[d.getUTCMonth()]} ${pad(d.getUTCHours())}:00`; });
      charts.push(new Chart($('#ch-recent'), { type: 'line', data: { labels, datasets: [{ data: v, borderColor: css('--' + (s.cls === 'stale' || s.cls === 'nd' ? 'accent' : s.cls)), borderWidth: 1.5, pointRadius: 0, spanGaps: false, tension: .2 }] },
        options: lineOpts({ ticks: { maxTicksLimit: 8 } }, (ctx) => fmtCm(ctx.raw)) }));
    };
    if (!state.day) $('#rspan').querySelectorAll('button').forEach((bt) => bt.addEventListener('click', () => { state.recentSpan = +bt.dataset.d; $('#rspan').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === bt)); drawRecent(); }));
    drawRecent();
    // anno
    const drawYear = () => {
      const y = state.year; if (!y) return;
      const n = isLeap(y) ? 366 : 365, labels = Array.from({ length: n }, (_, i) => dayLabel(i, y));
      const cl = sd.clim, yr = sd.years[y] || { a: [] };
      const band = (k) => (cl[k] || []).slice(0, n);
      const ds = [
        { label: '5°–95°', data: band('p5'), fill: '+1', backgroundColor: css('--band-outer'), borderWidth: 0, pointRadius: 0, order: 9 },
        { data: band('p95'), borderWidth: 0, pointRadius: 0, order: 9 },
        { label: '25°–75°', data: band('p25'), fill: '+1', backgroundColor: css('--band-inner'), borderWidth: 0, pointRadius: 0, order: 8 },
        { data: band('p75'), borderWidth: 0, pointRadius: 0, order: 8 },
        { label: 'mediana', data: band('p50'), borderColor: css('--accent'), borderDash: [4, 4], borderWidth: 1, pointRadius: 0, order: 7 },
        { label: String(y), data: yr.a.slice(0, n), borderColor: css('--ink'), borderWidth: 1.8, pointRadius: 0, spanGaps: 3, order: 1 },
      ];
      if (state.day && +state.day.slice(0, 4) === y) {
        const i = doy(state.day), pt = Array(n).fill(null); pt[i] = yr.a[i];
        ds.push({ label: fmtDMY(state.day), data: pt, pointRadius: 6, pointBackgroundColor: css('--' + statusOf(sid).cls), pointBorderColor: css('--surface'), pointBorderWidth: 2, showLine: false, order: 0 });
      }
      const palette = ['--lo2', '--hi2', '--lo1', '--hi1', '--ok'];
      [...state.compare].filter((cy) => cy !== y && sd.years[cy]).forEach((cy, i) => ds.push({ label: String(cy), data: sd.years[cy].a.slice(0, n), borderColor: css(palette[i % palette.length]), borderWidth: 1.2, pointRadius: 0, spanGaps: 3, order: 2 }));
      const old = charts.find((ch) => ch.canvas.id === 'ch-year'); if (old) { charts.splice(charts.indexOf(old), 1); old.destroy(); }
      charts.push(new Chart($('#ch-year'), { type: 'line', data: { labels, datasets: ds },
        options: lineOpts({ ticks: { maxTicksLimit: 12, callback: (v, i) => (i % 30 === 0 ? MON3[Math.floor(i / 30.5)] || '' : null) } }, (ctx) => `${ctx.dataset.label || ''}: ${fmtCm(ctx.raw)}`, true) }));
      const vals = yr.a.filter((v) => v != null);
      const below = yr.a.filter((v, i) => v != null && cl.p5 && cl.p5[i] != null && v < cl.p5[i]).length;
      const above = yr.a.filter((v, i) => v != null && cl.p95 && cl.p95[i] != null && v > cl.p95[i]).length;
      $('#ystats').innerHTML = vals.length ? `<div><div class="k">Giorni con dati</div><div class="v">${vals.length}</div></div><div><div class="k">Media</div><div class="v">${fmtCm(Math.round(vals.reduce((a, v) => a + v, 0) / vals.length))}</div></div><div><div class="k">Min · max</div><div class="v">${fmtCm(Math.round(Math.min(...vals)))} · ${fmtCm(Math.round(Math.max(...vals)))}</div></div><div><div class="k">Giorni sotto il 5°</div><div class="v" style="color:var(--lo2)">${below}</div></div><div><div class="k">Giorni sopra il 95°</div><div class="v" style="color:var(--hi2)">${above}</div></div>` : '<span class="hint" style="margin:0">Nessun dato per quest\'anno.</span>';
    };
    $('#ysel').addEventListener('change', (e) => { state.year = +e.target.value; drawYear(); });
    $('#ycmp').querySelectorAll('.chip').forEach((ch) => ch.addEventListener('click', () => { const y = +ch.dataset.y; state.compare.has(y) ? state.compare.delete(y) : state.compare.add(y); ch.setAttribute('aria-pressed', state.compare.has(y)); drawYear(); }));
    drawYear();
  }
  function gaugeHtml(c, val, cls) {
    const lo = Math.min(c.p5, val ?? c.p5), hi = Math.max(c.p95, val ?? c.p95), span = Math.max(1, hi - lo);
    const x = (v) => ((v - lo) / span * 100).toFixed(1) + '%';
    const ticks = [['p5', '5°', 'b first'], ['p25', '25°', 't'], ['p50', 'mediana', 'b'], ['p75', '75°', 't'], ['p95', '95°', 'b last']].map(([k, l, side]) => `<div class="tick ${side}" style="left:${x(c[k])}" title="${l} percentile: ${fmtCm(c[k])}"><span>${l} ${fmtCm(c[k])}</span></div>`).join('');
    return `<div class="gauge c-${cls}"><div class="bar"></div>${ticks}${val != null ? `<div class="pin" style="left:${x(val)}" title="oggi ${fmtCm(val)}"></div>` : ''}</div><p class="gauge-hint">Il livello ${state.day ? 'del giorno' : 'di oggi'} (barra scura) sulla distribuzione dei livelli di questo periodo dell'anno negli anni passati.</p>`;
  }
  function lineOpts(xExtra, tip, legend) {
    return { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false }, ticks: { color: css('--muted'), maxRotation: 0, autoSkip: true, ...(xExtra.ticks || {}) } },
        y: { ticks: { color: css('--muted'), callback: (v) => v + ' cm' }, grid: { color: css('--line') } } },
      plugins: { legend: { display: !!legend, labels: { color: css('--ink-2'), boxWidth: 12, filter: (i) => !!i.text } }, tooltip: { callbacks: { label: tip }, filter: (i) => i.dataset.label } } };
  }

  // ---------- avvio ----------
  async function init() {
    INDEX = await loadJSON('data/index.json');
    renderToday(); renderBodies(); initMap();
    const tg = $('#bodies-toggle');
    tg.addEventListener('click', () => { const open = $('#rivers-panel').classList.toggle('open'); tg.setAttribute('aria-expanded', open); tg.textContent = open ? 'Nascondi l\'elenco' : 'Mostra l\'elenco'; });
    $('#gday').max = TODAY; $('#gday').min = INDEX.first_year + '-01-01'; $('#gday').value = TODAY;
    $('#gday').addEventListener('change', (e) => setDay(e.target.value));
    $('#gtoday').addEventListener('click', () => setDay(null));
    $('#gprev').addEventListener('click', () => { const d = new Date((state.day || TODAY) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); setDay(d.toISOString().slice(0, 10)); });
    $('#gnext').addEventListener('click', () => { if (!state.day) return; const d = new Date(state.day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); setDay(d.toISOString().slice(0, 10)); });
    $('#gym1').addEventListener('click', () => { const d = state.day || TODAY; setDay((+d.slice(0, 4) - 1) + d.slice(4)); });
    window.addEventListener('hashchange', route);
    route();
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { renderMarkers(); renderLines(); if (provLayer) provLayer.setStyle({ color: css('--map-line'), fillColor: css('--map-fill') }); renderDetail(); });
  }
  init().catch((e) => { $('#detail').innerHTML = `<div class="pb"><div class="empty">Dati non disponibili (${esc(e.message)}). Se stai aprendo il file in locale, servi la cartella con un piccolo server web.</div></div>`; });
})();
