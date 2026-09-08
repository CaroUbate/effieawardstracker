/* Marcador Effie 2026 — Bavaria / DraftLine */

const CACHE_KEY = 'effie2026_cache_v1';
const LOCAL_ENTRIES_KEY = 'effie2026_local_entries_v2';

let CONFIG = null;
let SEED = [];
let SYNCED_ROWS = [];   // rows coming from the published sheet/CSV
let LOCAL_ROWS = [];    // rows added on this device (always applied instantly)
let lastSync = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function norm(s) {
  return (s || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function agencyLabel(raw) {
  if (!raw) return '';
  const key = raw.trim();
  const known = CONFIG.aliasAgencias && CONFIG.aliasAgencias[key];
  if (known) return known;
  return canonicalLabel(dynamicAgenciaLabels, canonicalAgenciaIndex, key);
}

function isBavariaBrand(marca) {
  const n = norm(marca);
  return CONFIG.marcasBavaria.some(m => norm(m) === n);
}

/* ---------- Unify how people type brands/agencies (case, tildes, spacing) ----------
   Known names (from config) always win with their proper casing. Anything
   typed that isn't in config gets remembered the first time it's seen, so
   "POKER" and "Poker" collapse into one bucket instead of two. */
let canonicalMarcaIndex = new Map();
let canonicalAgenciaIndex = new Map();
const dynamicMarcaLabels = new Map();
const dynamicAgenciaLabels = new Map();

function buildCanonicalIndexes() {
  canonicalMarcaIndex = new Map();
  (CONFIG.listaMarcas || []).forEach(name => canonicalMarcaIndex.set(norm(name), name));
  (CONFIG.marcasBavaria || []).forEach(name => {
    if (!canonicalMarcaIndex.has(norm(name))) canonicalMarcaIndex.set(norm(name), name);
  });

  canonicalAgenciaIndex = new Map();
  Object.entries(CONFIG.aliasAgencias || {}).forEach(([k, v]) => {
    canonicalAgenciaIndex.set(norm(k), v);
    canonicalAgenciaIndex.set(norm(v), v);
  });
  (CONFIG.listaAgencias || []).forEach(name => {
    if (!canonicalAgenciaIndex.has(norm(name))) canonicalAgenciaIndex.set(norm(name), name);
  });
}

function canonicalLabel(dynamicMap, configIndex, raw) {
  const key = norm(raw);
  if (!key) return '';
  if (configIndex.has(key)) return configIndex.get(key);
  if (dynamicMap.has(key)) return dynamicMap.get(key);
  const label = raw.trim();
  dynamicMap.set(key, label);
  return label;
}

function canonicalMarca(raw) {
  return canonicalLabel(dynamicMarcaLabels, canonicalMarcaIndex, raw);
}

// Some sub-brands are folded into their parent for "Marca del Año" and for
// search/click-through, so "Aguila" and "Aguila Light" count as one line.
function marcaGroupLabel(raw) {
  const canon = canonicalMarca(raw);
  const fused = CONFIG.fusionMarcas && CONFIG.fusionMarcas[canon];
  return fused || canon;
}

function advertiserBucket(entry) {
  if (isBavariaBrand(entry.marca)) return 'Bavaria';
  if (entry.anunciante) return canonicalAnunciante(entry.anunciante);
  return canonicalMarca(entry.marca);
}

const canonicalAnuncianteIndex = new Map();
const dynamicAnuncianteLabels = new Map();
function canonicalAnunciante(raw) {
  // An "anunciante" can list several brands joined by " / " (co-sponsored cases) — use the first as the label.
  const first = (raw || '').split('/')[0].trim();
  return canonicalLabel(dynamicAnuncianteLabels, canonicalAnuncianteIndex, first);
}

/* ---------- CSV parsing (simple, handles quoted commas) ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => norm(h));
  return rows.slice(1).filter(r => r.some(c => c && c.trim())).map(r => {
    const obj = {};
    headers.forEach((h, idx) => obj[h] = (r[idx] || '').trim());
    return obj;
  });
}

function mapCsvRowToEntry(row, idx) {
  const get = (...keys) => {
    for (const k of keys) {
      for (const rk of Object.keys(row)) {
        if (rk.includes(k)) return row[rk];
      }
    }
    return '';
  };
  const marca = get('marca');
  const campana = get('campana');
  const categoria = get('categoria');
  const agenciaLider = get('agencia lider', 'agencia responsable', 'agencia');
  const agenciaContrib = get('contribuyente', 'agencias contribuyentes');
  const metalRaw = get('metal');
  const timestamp = get('marca temporal', 'timestamp', 'fecha');
  const autor = get('nombre', 'quien', 'submitted');

  let metal = 'Finalista';
  const m = norm(metalRaw);
  if (m.includes('gran')) metal = 'Gran Effie';
  else if (m.includes('oro')) metal = 'Oro';
  else if (m.includes('plata')) metal = 'Plata';
  else if (m.includes('bronce')) metal = 'Bronce';
  else if (m.includes('final') || m.includes('shortlist')) metal = 'Finalista';

  return {
    id: 'csv-' + idx,
    campana: campana || '(sin nombre)',
    marca: marca || '',
    categoria: categoria || '',
    agencia_lider: agenciaLider || '',
    agencias_contribuyentes: agenciaContrib || '',
    agencias_lider_lista: agenciaLider ? agenciaLider.split('/').map(s => s.trim()).filter(Boolean) : [],
    agencias_contrib_lista: agenciaContrib ? agenciaContrib.split('/').map(s => s.trim()).filter(Boolean) : [],
    metal,
    autor,
    timestamp: timestamp || null,
    source: 'sync'
  };
}

/* ---------- Merge: sync/local rows update matching seed entries, or append new ---------- */
function buildDataset() {
  const seedCopy = SEED.map(e => ({ ...e, source: 'seed' }));

  // Merge synced (shared) and local (this device) rows in actual chronological
  // order, so whichever submission really happened last is the one that
  // sticks — not just "local always wins" or "sync always wins".
  const incoming = [...SYNCED_ROWS, ...LOCAL_ROWS].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });

  incoming.forEach(row => {
    let match = seedCopy.find(e =>
      norm(e.marca) === norm(row.marca) &&
      norm(e.campana) === norm(row.campana) &&
      norm(e.categoria) === norm(row.categoria)
    );
    if (!match) {
      match = seedCopy.find(e =>
        norm(e.campana) === norm(row.campana) &&
        norm(e.categoria) === norm(row.categoria)
      );
    }
    if (match) {
      match.metal = row.metal;
      match.source = row.source;
      match.timestamp = row.timestamp || match.timestamp;
      match.autor = row.autor || match.autor;
      if (row.agencia_lider) {
        match.agencia_lider = row.agencia_lider;
        match.agencias_lider_lista = row.agencias_lider_lista;
      }
      if (row.agencias_contribuyentes) {
        match.agencias_contribuyentes = row.agencias_contribuyentes;
        match.agencias_contrib_lista = row.agencias_contrib_lista;
      }
    } else {
      seedCopy.push({ ...row, id: row.id || ('extra-' + norm(row.marca) + '|' + norm(row.campana)) });
    }
  });
  return seedCopy;
}

/* ---------- Scoring ---------- */
function pointsFor(metal, factor) {
  const base = CONFIG.puntos[metal] || 0;
  return Math.round(base * factor);
}

function computeAll(entries) {
  const anunciantes = {};   // bucket -> points
  const marcas = {};        // marca -> points  (Bavaria brands only)
  const agencias = {};      // label -> points
  const counts = { Finalista: 0, Bronce: 0, Plata: 0, Oro: 0, 'Gran Effie': 0 };  // Bavaria only

  entries.forEach(e => {
    const pts = pointsFor(e.metal, 1);
    const bavaria = isBavariaBrand(e.marca);
    if (bavaria) counts[e.metal] = (counts[e.metal] || 0) + 1;

    const bucket = advertiserBucket(e);
    anunciantes[bucket] = (anunciantes[bucket] || 0) + pts;

    if (bavaria) {
      marcas[marcaGroupLabel(e.marca)] = (marcas[marcaGroupLabel(e.marca)] || 0) + pts;
    }

    (e.agencias_lider_lista || []).forEach(a => {
      const label = agencyLabel(a);
      agencias[label] = (agencias[label] || 0) + pointsFor(e.metal, 1);
    });
    (e.agencias_contrib_lista || []).forEach(a => {
      const label = agencyLabel(a);
      agencias[label] = (agencias[label] || 0) + pointsFor(e.metal, 0.5);
    });
  });

  return { anunciantes, marcas, agencias, counts };
}

function countsFor(entries) {
  const counts = { Finalista: 0, Bronce: 0, Plata: 0, Oro: 0, 'Gran Effie': 0 };
  entries.forEach(e => { counts[e.metal] = (counts[e.metal] || 0) + 1; });
  return counts;
}

/* ---------- Rendering: shared bits ---------- */
function renderStatus(offline) {
  const dot = $('#statusDot');
  const label = $('#statusLabel');
  dot.classList.toggle('off', offline);
  const when = lastSync ? new Date(lastSync).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '—';
  label.textContent = offline
    ? `Sin conexión · último dato ${when}`
    : `Conectado · actualizado ${when}`;
}

function renderMedalStrip(prefix, counts) {
  $(`#${prefix}Finalista`).textContent = counts.Finalista || 0;
  $(`#${prefix}Bronce`).textContent = counts.Bronce || 0;
  $(`#${prefix}Plata`).textContent = counts.Plata || 0;
  $(`#${prefix}Oro`).textContent = counts.Oro || 0;
}

function renderRace(container, dataObj, opts) {
  opts = opts || {};
  const entries = Object.entries(dataObj).sort((a, b) => b[1] - a[1]).slice(0, opts.limit || 6);
  container.innerHTML = '';
  if (!entries.length) {
    container.innerHTML = '<p class="race-empty">Aún no hay metales cargados.</p>';
    return;
  }
  const max = Math.max(1, ...entries.map(e => e[1]));
  entries.forEach(([name, val]) => {
    const isUs = opts.highlight && opts.highlight === name;
    const row = document.createElement('div');
    row.className = 'race-row ' + (isUs ? 'us' : 'other');
    row.innerHTML = `
      <div class="name">${name}</div>
      <div class="race-bar"><i style="width:${(val / max) * 100}%"></i></div>
      <div class="val">${val}</div>`;
    if (opts.onClick) {
      row.addEventListener('click', () => opts.onClick(name));
    }
    container.appendChild(row);
  });
}

function metalChipClass(metal) {
  return metal === 'Gran Effie' ? 'GranEffie' : metal;
}

/* ---------- Search: marca, anunciante o agencia ---------- */
function findMatches(query) {
  const dataset = buildDataset();
  const q = norm(query);
  if (!q) return { entries: [], label: '', type: null };

  // 1) anunciante (catches "Bavaria" as the whole group, "Netflix", etc.)
  let entries = dataset.filter(e => norm(advertiserBucket(e)) === q);
  if (entries.length) return { entries, label: advertiserBucket(entries[0]), type: 'Anunciante' };

  // 2) marca puntual (ej. "Poker", "Bon Yurt") — incluye sub-líneas fusionadas (Aguila Light -> Aguila)
  entries = dataset.filter(e => norm(marcaGroupLabel(e.marca)) === q || norm(e.marca) === q);
  if (entries.length) return { entries, label: marcaGroupLabel(entries[0].marca), type: 'Marca' };

  // 3) agencia, líder o contribuyente
  entries = dataset.filter(e =>
    (e.agencias_lider_lista || []).some(a => norm(agencyLabel(a)) === q) ||
    (e.agencias_contrib_lista || []).some(a => norm(agencyLabel(a)) === q)
  );
  if (entries.length) return { entries, label: agencyLabel(query), type: 'Agencia' };

  return { entries: [], label: query, type: null };
}

/* ---------- Gran Effie highlight ---------- */
function renderGrandEffie(dataset) {
  const block = $('#grandEffieBlock');
  const list = $('#grandEffieList');
  const winners = dataset.filter(e => e.metal === 'Gran Effie');
  if (!winners.length) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  list.innerHTML = '';
  winners.forEach(e => {
    const div = document.createElement('div');
    div.className = 'grand-effie-item';
    div.innerHTML = `
      <div class="campana">${e.campana}</div>
      <div class="meta">${advertiserBucket(e)} · ${e.marca} · ${e.categoria}</div>`;
    list.appendChild(div);
  });
}

/* ---------- Home ---------- */
function renderHome() {
  const dataset = buildDataset();
  const totals = computeAll(dataset);

  renderMedalStrip('cnt', totals.counts);
  renderGrandEffie(dataset);
  renderRace($('#raceAnunciante'), totals.anunciantes, { highlight: 'Bavaria' });
  renderRace($('#raceAgencia'), totals.agencias, { highlight: CONFIG.agenciaPropia });
  renderRace($('#raceMarca'), totals.marcas, {
    onClick: (marca) => showEntity(marca)
  });

  // datalist for search: marcas + anunciantes + agencias, all in one list
  const names = new Set();
  dataset.forEach(e => {
    names.add(canonicalMarca(e.marca));
    names.add(advertiserBucket(e));
    (e.agencias_lider_lista || []).forEach(a => names.add(agencyLabel(a)));
    (e.agencias_contrib_lista || []).forEach(a => names.add(agencyLabel(a)));
  });
  const dl = $('#marcasList');
  dl.innerHTML = '';
  Array.from(names).filter(Boolean).sort().forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    dl.appendChild(opt);
  });
}

/* ---------- Deep dive: marca, anunciante o agencia ---------- */
function showEntity(query) {
  const { entries, label, type } = findMatches(query);
  if (!entries.length) return;

  $('#marcaName').textContent = type ? `${label} · ${type}` : label;
  renderMedalStrip('mCnt', countsFor(entries));

  const grandEffieWins = entries.filter(e => e.metal === 'Gran Effie');
  const badge = $('#marcaGrandEffieBadge');
  if (grandEffieWins.length) {
    badge.hidden = false;
    badge.textContent = grandEffieWins.length === 1
      ? `🏆 Ganó el Gran Effie: ${grandEffieWins[0].campana}`
      : `🏆 Ganó ${grandEffieWins.length} Gran Effie`;
  } else {
    badge.hidden = true;
  }

  const rank = { 'Gran Effie': 5, 'Oro': 4, 'Plata': 3, 'Bronce': 2, 'Finalista': 1 };
  const sorted = entries.slice().sort((a, b) => (rank[b.metal] || 0) - (rank[a.metal] || 0));

  const list = $('#marcaIdeasList');
  list.innerHTML = '';
  sorted.forEach(e => {
    const div = document.createElement('div');
    div.className = 'idea-row';
    const chip = document.createElement('div');
    chip.className = 'metal-chip ' + metalChipClass(e.metal);
    chip.textContent = e.metal === 'Gran Effie' ? 'GRAN\nEFFIE' : e.metal;
    div.appendChild(chip);
    const body = document.createElement('div');
    body.className = 'body';
    const agencia = (e.agencias_lider_lista || []).map(agencyLabel).join(' / ') || '—';
    body.innerHTML = `
      <div class="campana">${e.campana}</div>
      <div class="meta"><b>${e.categoria}</b> · ${agencia}</div>`;
    div.appendChild(body);
    const pts = document.createElement('div');
    pts.className = 'pts';
    pts.textContent = pointsFor(e.metal, 1) + ' pts';
    div.appendChild(pts);
    list.appendChild(div);
  });

  showView('view-marca');
}

/* ---------- View router ---------- */
function showView(id) {
  $$('.view').forEach(v => v.hidden = (v.id !== id));
  window.scrollTo(0, 0);
}

/* ---------- Form ---------- */
function initFormOptions() {
  const marcaSel = $('#ff_marca');
  const marcas = Array.from(new Set(SEED.map(e => e.marca))).sort((a, b) => a.localeCompare(b, 'es'));
  marcas.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    marcaSel.appendChild(opt);
  });
  const otraMarcaOpt = document.createElement('option');
  otraMarcaOpt.value = '__otra__'; otraMarcaOpt.textContent = 'Otra marca…';
  marcaSel.appendChild(otraMarcaOpt);

  const metalSel = $('#ff_metal');
  metalSel.innerHTML = '';
  CONFIG.metales.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m + ' (' + CONFIG.puntos[m] + ' pts)';
    metalSel.appendChild(opt);
  });

  $('#ff_marca').addEventListener('change', onMarcaChange);
  $('#ff_campana').addEventListener('change', onCampanaChange);
  $('#ff_categoria').addEventListener('change', onCategoriaChange);
  $('#ff_marcaOtra').addEventListener('input', checkDuplicate);
  $('#ff_campanaOtra').addEventListener('input', checkDuplicate);
}

function getMarcaValue() {
  const sel = $('#ff_marca').value;
  return sel === '__otra__' ? $('#ff_marcaOtra').value.trim() : sel;
}
function getCampanaValue() {
  const sel = $('#ff_campana').value;
  return sel === '__otra__' ? $('#ff_campanaOtra').value.trim() : sel;
}

function resetCategoriaToFull() {
  const catSel = $('#ff_categoria');
  catSel.innerHTML = '<option value="">Selecciona la respuesta</option>';
  CONFIG.categoriasOficiales.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    catSel.appendChild(opt);
  });
  catSel.disabled = false;
}

function resetCategoriaEmpty() {
  const catSel = $('#ff_categoria');
  catSel.innerHTML = '<option value="">Primero elige la campaña</option>';
  catSel.disabled = true;
}

function clearAgencia() {
  $('#ff_agenciaLider').value = '';
  $('#ff_agenciaContrib').value = '';
}

function autofillAgencia(marca, campana, categoria) {
  const match = SEED.find(e => e.marca === marca && e.campana === campana && e.categoria === categoria);
  if (match) {
    $('#ff_agenciaLider').value = match.agencia_lider || '';
    $('#ff_agenciaContrib').value = match.agencias_contribuyentes || '';
  }
}

function onMarcaChange() {
  const val = $('#ff_marca').value;
  const campanaSel = $('#ff_campana');

  $('#ff_marcaOtraWrap').hidden = val !== '__otra__';
  clearAgencia();

  if (val === '__otra__') {
    campanaSel.innerHTML = '<option value="">— escribe abajo —</option>';
    campanaSel.disabled = true;
    $('#ff_campanaOtraWrap').hidden = false;
    resetCategoriaToFull();
    checkDuplicate();
    return;
  }
  $('#ff_campanaOtraWrap').hidden = true;

  if (!val) {
    campanaSel.innerHTML = '<option value="">Primero elige la marca</option>';
    campanaSel.disabled = true;
    resetCategoriaEmpty();
    checkDuplicate();
    return;
  }

  const campanas = Array.from(new Set(SEED.filter(e => e.marca === val).map(e => e.campana)));
  campanaSel.innerHTML = '<option value="">Selecciona la respuesta</option>';
  campanas.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    campanaSel.appendChild(opt);
  });
  const otraOpt = document.createElement('option');
  otraOpt.value = '__otra__'; otraOpt.textContent = 'Otra campaña…';
  campanaSel.appendChild(otraOpt);
  campanaSel.disabled = false;

  resetCategoriaEmpty();
  checkDuplicate();
}

function onCampanaChange() {
  const marcaVal = getMarcaValue();
  const campanaVal = $('#ff_campana').value;
  const catSel = $('#ff_categoria');

  $('#ff_campanaOtraWrap').hidden = campanaVal !== '__otra__';
  clearAgencia();

  if (campanaVal === '__otra__' || !campanaVal) {
    resetCategoriaToFull();
    checkDuplicate();
    return;
  }

  const cats = Array.from(new Set(
    SEED.filter(e => e.marca === marcaVal && e.campana === campanaVal).map(e => e.categoria)
  ));
  catSel.innerHTML = cats.length > 1 ? '<option value="">Selecciona la respuesta</option>' : '';
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    catSel.appendChild(opt);
  });
  catSel.disabled = false;

  if (cats.length === 1) {
    catSel.value = cats[0];
    autofillAgencia(marcaVal, campanaVal, cats[0]);
  }
  checkDuplicate();
}

function onCategoriaChange() {
  const marcaVal = getMarcaValue();
  const campanaVal = getCampanaValue();
  const catVal = $('#ff_categoria').value;
  if (marcaVal && campanaVal && catVal) autofillAgencia(marcaVal, campanaVal, catVal);
  checkDuplicate();
}

function checkDuplicate() {
  const marca = getMarcaValue();
  const campana = getCampanaValue();
  const categoria = $('#ff_categoria').value;
  const hint = $('#dupHint');
  if (!marca || !campana) { hint.textContent = ''; return; }

  const dataset = buildDataset();
  const match = categoria
    ? dataset.find(e => norm(e.marca) === norm(marca) && norm(e.campana) === norm(campana) && norm(e.categoria) === norm(categoria))
    : dataset.find(e => norm(e.marca) === norm(marca) && norm(e.campana) === norm(campana));
  if (!match) { hint.textContent = ''; return; }

  hint.textContent = match.metal === 'Finalista'
    ? `Ya está precargada en la categoría "${match.categoria}" — todavía sin metal.`
    : `Ya está registrada con metal: ${match.metal} (categoría "${match.categoria}"). Si envías, lo actualiza.`;
}

async function submitForm() {
  const marca = getMarcaValue();
  const campana = getCampanaValue();
  const categoria = $('#ff_categoria').value;
  const agenciaLider = $('#ff_agenciaLider').value.trim();
  const agenciaContrib = $('#ff_agenciaContrib').value.trim();
  const metal = $('#ff_metal').value;
  const autor = $('#ff_autor').value.trim();
  const status = $('#formStatus');

  if (!marca || !campana) {
    status.textContent = 'Completa al menos marca y campaña.';
    return;
  }

  const entry = {
    id: 'local-' + Date.now(),
    marca, campana, categoria,
    agencia_lider: agenciaLider,
    agencias_contribuyentes: agenciaContrib,
    agencias_lider_lista: agenciaLider ? agenciaLider.split('/').map(s => s.trim()).filter(Boolean) : [],
    agencias_contrib_lista: agenciaContrib ? agenciaContrib.split('/').map(s => s.trim()).filter(Boolean) : [],
    metal,
    autor,
    timestamp: new Date().toISOString(),
    source: 'local'
  };

  LOCAL_ROWS.push(entry);
  localStorage.setItem(LOCAL_ENTRIES_KEY, JSON.stringify(LOCAL_ROWS));
  renderHome();

  // Try to relay it to the shared sheet in the background, if configured.
  const envio = CONFIG.envioDirecto;
  if (envio && envio.activo && envio.formActionUrl && !envio.formActionUrl.startsWith('PEGA_AQUI')) {
    try {
      const body = new URLSearchParams();
      body.set(envio.entryIds.marca, marca);
      body.set(envio.entryIds.campana, campana);
      body.set(envio.entryIds.categoria, categoria);
      body.set(envio.entryIds.agenciaLider, agenciaLider);
      body.set(envio.entryIds.agenciaContribuyente, agenciaContrib);
      body.set(envio.entryIds.metal, metal);
      if (envio.entryIds.autor) body.set(envio.entryIds.autor, autor);
      await fetch(envio.formActionUrl, { method: 'POST', mode: 'no-cors', body });
      status.textContent = 'Guardado — ya se está sincronizando con el equipo.';
    } catch (err) {
      status.textContent = 'Guardado en este teléfono. Se sincronizará cuando haya señal.';
    }
  } else {
    status.textContent = 'Guardado en este teléfono.';
  }

  // Reset the whole form back to its initial state
  $('#ff_marca').value = '';
  $('#ff_marcaOtra').value = '';
  $('#ff_marcaOtraWrap').hidden = true;
  $('#ff_campana').innerHTML = '<option value="">Primero elige la marca</option>';
  $('#ff_campana').disabled = true;
  $('#ff_campanaOtra').value = '';
  $('#ff_campanaOtraWrap').hidden = true;
  resetCategoriaEmpty();
  clearAgencia();
  $('#ff_autor').value = '';
  $('#dupHint').textContent = '';

  setTimeout(() => { status.textContent = ''; showView('view-home'); renderHome(); }, 1200);
}

/* ---------- Info modal ---------- */
function openInfo() {
  $('#infoBackdrop').classList.add('open');
  $('#infoSheet').classList.add('open');
}
function closeInfo() {
  $('#infoBackdrop').classList.remove('open');
  $('#infoSheet').classList.remove('open');
}

/* ---------- Sync ---------- */
async function sync(manual) {
  if (!CONFIG.sync.csvUrl || CONFIG.sync.csvUrl.startsWith('PEGA_AQUI')) {
    renderStatus(true);
    $('#statusLabel').textContent = 'Modo local · configura la hoja compartida (ver README)';
    return;
  }
  try {
    const res = await fetch(CONFIG.sync.csvUrl + (CONFIG.sync.csvUrl.includes('?') ? '&' : '?') + 'ts=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('bad response');
    const text = await res.text();
    const rows = parseCSV(text);
    SYNCED_ROWS = rows.map(mapCsvRowToEntry);
    lastSync = Date.now();
    localStorage.setItem(CACHE_KEY, JSON.stringify({ rows: SYNCED_ROWS, lastSync }));
    renderStatus(false);
    renderHome();
  } catch (err) {
    renderStatus(true);
    if (manual) console.warn('Sync falló:', err);
  }
}

function loadCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached) {
      SYNCED_ROWS = cached.rows || [];
      lastSync = cached.lastSync || null;
    }
  } catch (e) { /* ignore */ }
  try {
    LOCAL_ROWS = JSON.parse(localStorage.getItem(LOCAL_ENTRIES_KEY) || '[]');
  } catch (e) { LOCAL_ROWS = []; }
}

/* ---------- Boot ---------- */
async function boot() {
  const [cfgRes, seedRes] = await Promise.all([
    fetch('data/config.json'),
    fetch('data/seed-entries.json')
  ]);
  CONFIG = await cfgRes.json();
  SEED = await seedRes.json();
  buildCanonicalIndexes();

  loadCache();
  renderHome();
  renderStatus(!navigator.onLine);
  initFormOptions();

  $('#refreshBtn').addEventListener('click', () => sync(true));
  window.addEventListener('online', () => sync(true));
  window.addEventListener('offline', () => renderStatus(true));

  $('#updateBtn').addEventListener('click', () => showView('view-form'));
  $('#backFromForm').addEventListener('click', () => showView('view-home'));
  $('#backFromMarca').addEventListener('click', () => showView('view-home'));
  $('#ff_submit').addEventListener('click', submitForm);

  $('#infoBtn').addEventListener('click', openInfo);
  $('#closeInfo').addEventListener('click', closeInfo);
  $('#infoBackdrop').addEventListener('click', closeInfo);

  $('#searchInput').addEventListener('change', (e) => {
    const val = e.target.value.trim();
    if (val) showEntity(val);
  });
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) showEntity(e.target.value.trim());
  });

  sync(false);
  setInterval(() => sync(false), (CONFIG.sync.intervaloSegundos || 20) * 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      // Check for a newer sw.js every time the app opens, and take over
      // as soon as it's ready — no need to remember bumping a version number.
      reg.update().catch(() => {});
      if (reg.waiting) reg.waiting.postMessage('skipWaiting');
    }).catch(() => {});
    let refreshedOnce = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshedOnce) return;
      refreshedOnce = true;
      window.location.reload();
    });
  }
}

document.addEventListener('DOMContentLoaded', boot);
