// LForms Classic-Build (stellt window.LForms bereit)
import 'lforms/dist/lforms/webcomponent/assets/lib/zone.min.js';
import 'lforms/dist/lforms/webcomponent/styles.css';
import 'lforms/dist/lforms/webcomponent/lhc-forms.js';
import 'lforms/dist/lforms/fhir/R4/lformsFHIR.min.js';

// UCUM aus npm importieren und als Global verfügbar machen (für evtl. Abhängigkeiten)
import { UcumLhcUtils } from '@lhncbc/ucum-lhc';
window.UcumLhcUtils = UcumLhcUtils;
// Keep track of the last rendered Questionnaire for export metadata
let _lastQuestionnaire = null;


function getParam(...names) {
  const sp = new URLSearchParams(window.location.search);
  for (const n of names) {
    const v = sp.get(n);
    if (v !== null && v !== '') return v;
  }
  return null;
}

// Minimal-Modus via URL-Parameter ?minimal=true | ?minimal=withButtons
(() => {
  const sp = new URLSearchParams(window.location.search);
  const m = (sp.get('minimal') || '').toLowerCase();
  if (m) {
    document.body.classList.add('minimal');
    if (m === 'true' || m === '1' || m === 'yes' || m === 'nobuttons' || m === 'no-buttons') {
      document.body.classList.add('minimal-nobuttons');
    } else if (m === 'withbuttons' || m === 'buttons' || m === 'with-buttons') {
      document.body.classList.add('minimal-withbuttons');
    } else {
      // Default to no buttons if unrecognized but minimal requested
      document.body.classList.add('minimal-nobuttons');
    }
  }
})();

function hideLeftPanelAndExpandMain() {
  const left = document.getElementById('leftPanel');
  if (left) left.classList ? left.classList.add('hidden') : (left.style.display = 'none');
  const mainEl = document.querySelector('main');
  if (mainEl) mainEl.style.gridTemplateColumns = '1fr';
}

function renderQuestionnaire(q) {
  try {
    // Vor dem Rendern: Prüfe auf modifierExtension und zeige ggf. Warnung
    updateModifierWarning(q);
    _lastQuestionnaire = q || null;
    const lf = window.LForms.Util.convertFHIRQuestionnaireToLForms(q, 'R4');
    // Prepopulation einschalten, damit z.B. observationLinkPeriod greift
    window.LForms.Util.addFormToPage(lf, document.getElementById('renderTarget'), { prepopulate: true });
    setExportVisible(true);
    status('Erfolgreich gerendert ✅', 'ok');
  } catch (e) {
    console.error(e);
    setExportVisible(false);
    status('Konvertierung/Rendering fehlgeschlagen: '+e.message, 
'err');
  }
}

const el = (id) => document.getElementById(id);
const status = (msg, cls) => { const s = el('status'); s.className = cls||''; s.textContent = msg||''; };

// --- UI Helpers -----------------------------------------------------------
function getUiValues() {
  const fhirUrl = el('fhirUrl')?.value?.trim() || '';
  const fhirBase = el('fhirBase')?.value?.trim() || '';
  const qId = el('qId')?.value?.trim() || '';
  const prepopBase = el('prepopBase')?.value?.trim() || '';
  const ids = {
    patient: el('patientId')?.value?.trim() || undefined,
    encounter: el('encounterId')?.value?.trim() || undefined,
    user: el('userId')?.value?.trim() || undefined,
  };
  return { fhirUrl, fhirBase, qId, prepopBase, ids };
}

function getEffectivePrepopBase(vals) {
  return (vals.prepopBase || vals.fhirBase || '').trim() || null;
}

async function configureFromUI() {
  const vals = getUiValues();
  const effBase = getEffectivePrepopBase(vals);
  if (!effBase) return { ok: false, messages: { base: 'Keine FHIR Base angegeben' }, results: {} };
  return await configureLFormsFHIRContext(effBase, vals.ids);
}

// Baut einen teilbaren URL mit den aktuellen Eingaben
function encodeForQueryPreservingSpecials(val) {
  // Encode, but keep ':' '/' and '|' readable; still encode '&' and '?' etc.
  return encodeURIComponent(val)
    .replace(/%3A/gi, ':')
    .replace(/%2F/gi, '/')
    .replace(/%7C/gi, '|');
}

function updateShareUrl() {
  const baseUrl = window.location.origin + window.location.pathname;
  const fhirUrl = el('fhirUrl')?.value?.trim();
  const fhirBase = el('fhirBase')?.value?.trim();
  const qId = el('qId')?.value?.trim();
  const prepopBase = el('prepopBase')?.value?.trim();
  const patientId = el('patientId')?.value?.trim();
  const encounterId = el('encounterId')?.value?.trim();
  const userId = el('userId')?.value?.trim();

  const params = {};
  if (fhirUrl) {
    params.q = fhirUrl;
  } else if (fhirBase && qId) {
    params.base = fhirBase;
    params.id = qId;
  }
  if (prepopBase) params.prepopBase = prepopBase;
  if (patientId) params.patient = patientId;
  if (encounterId) params.encounter = encounterId;
  if (userId) params.user = userId;
  if (document.body.classList.contains('minimal')) {
    params.minimal = document.body.classList.contains('minimal-withbuttons') ? 'withButtons' : 'true';
  }

  const parts = Object.entries(params).map(([k, v]) => `${k}=${encodeForQueryPreservingSpecials(String(v))}`);
  const qs = parts.join('&');
  const full = qs ? `${baseUrl}?${qs}` : baseUrl;
  const out = el('shareUrl');
  if (out) out.value = full;
}

// ---- FHIR Context / Prepopulation --------------------------------------
let _configuredFHIRBase = null;
function createFhirClient(base, ids = {}) {
  const normBase = (base || '').replace(/\/?$/,'');
  const makeAbs = (url) => {
    if (/^https?:/i.test(url)) return url;
    return normBase + '/' + url.replace(/^\//,'');
  };
  const doRequest = async (arg) => {
    let url, opts = {};
    if (typeof arg === 'string') {
      url = arg;
    } else if (arg && typeof arg === 'object') {
      url = arg.url;
      opts.method = arg.method || 'GET';
      if (arg.headers) opts.headers = arg.headers;
      if (arg.body !== undefined) opts.body = arg.body;
    } else {
      throw new Error('Invalid request argument for FHIR client');
    }
    url = makeAbs(url);
    const u = new URL(url);
    // Default headers
    opts.headers = Object.assign({}, opts.headers || {});
    const method = (opts.method || 'GET').toUpperCase();
    // Ensure correct Content-Type for write-like requests
    if ((method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      if (!opts.headers['Content-Type'] && !opts.headers['content-type']) {
        opts.headers['Content-Type'] = 'application/fhir+json; fhirVersion=4.0';
      }
      if (opts.body && typeof opts.body !== 'string') {
        opts.body = JSON.stringify(opts.body);
      }
    } else if (method === 'GET') {
      // Some servers reject GET with a body → strip it
      delete opts.body;
    }
    // Nur FHIR JSON anfragen (GET ohne Body)
    opts.headers['Accept'] = 'application/fhir+json';
    const res = await fetch(u.toString(), opts);
    if (!res.ok) throw new Error('FHIR request failed: ' + res.status + ' ' + u.toString());
    return res.json();
  };
  const patientScopedRequest = async (arg) => {
    if (!ids.patient) return doRequest(arg);
    // Normalize input to URL string and merge patient param
    let url, opts = {};
    if (typeof arg === 'string') {
      url = arg;
    } else if (arg && typeof arg === 'object') {
      url = arg.url;
      opts.method = arg.method || 'GET';
      if (arg.headers) opts.headers = arg.headers;
      if (arg.body !== undefined) opts.body = arg.body;
    } else {
      throw new Error('Invalid request argument for patient.request');
    }
    // Append patient search parameter if not already present
    const abs = makeAbs(url);
    const u = new URL(abs);
    if (!u.searchParams.has('patient')) {
      u.searchParams.set('patient', ids.patient);
    }
    return doRequest({ url: u.toString(), method: opts.method, headers: opts.headers, body: opts.body });
  };
  const stub = (type, id, withRequest = false) => ({
    id,
    read: () => id ? doRequest(`${type}/${encodeURIComponent(id)}`) : Promise.resolve(null),
    ...(withRequest ? { request: patientScopedRequest } : {})
  });
  // Expose a helper for LForms to detect FHIR server version
  const getFhirVersion = async () => {
    try {
      const meta = await doRequest('metadata');
      // Return the raw FHIR version string (e.g., '4.0.1'); LForms maps this to R4/R4B/etc.
      return meta?.fhirVersion || '4.0.1';
    } catch (e) {
      // Fallback to common default
      return '4.0.1';
    }
  };
  return {
    request: doRequest,
    getFhirVersion,
    patient: stub('Patient', ids.patient, true),
    encounter: stub('Encounter', ids.encounter),
    user: stub('Practitioner', ids.user)
  };
}

async function configureLFormsFHIRContext(base, ids = {}) {
  const result = { ok: true, results: { patient: 'skipped', encounter: 'skipped', user: 'skipped' }, messages: {} };
  if (!base) { result.ok = false; result.messages.base = 'Keine FHIR Base angegeben'; return result; }
  const client = createFhirClient(base, ids);
  const vars = {};
  const load = async (key, type, idVal) => {
    if (!idVal) { result.results[key] = 'skipped'; return; }
    try {
      let urlSpec;
      if (/^https?:\/\//i.test(idVal)) urlSpec = idVal; // absolute URL
      else if (idVal.includes('/')) urlSpec = idVal; // e.g. "Patient/123"
      else urlSpec = `${type}/${encodeURIComponent(idVal)}`;
      const res = await client.request(urlSpec);
      if (res && res.resourceType === 'OperationOutcome') {
        const issues = Array.isArray(res.issue)
          ? res.issue.map(i => i?.details?.text || i?.diagnostics || i?.code).filter(Boolean).join('; ')
          : 'OperationOutcome';
        result.results[key] = 'error';
        result.ok = false;
        result.messages[key] = issues || 'OperationOutcome vom Server';
      } else if (res && res.resourceType === type) {
        vars[key] = res;
        result.results[key] = 'ok';
      } else {
        result.results[key] = 'notfound';
        result.ok = false;
        result.messages[key] = 'Nicht gefunden oder falscher Ressourcentyp';
      }
    } catch (e) {
      result.results[key] = 'error';
      result.ok = false;
      result.messages[key] = e?.message || 'Fehler beim Laden';
    }
  };
  await load('patient', 'Patient', ids.patient);
  await load('encounter', 'Encounter', ids.encounter);
  await load('user', 'Practitioner', ids.user);
  if (window.LForms?.Util?.setFHIRContext) {
    window.LForms.Util.setFHIRContext(client, vars);
    _configuredFHIRBase = base;
    console.log('FHIR context configured for', base, 'vars:', Object.keys(vars));
  }
  return result;
}

// Persistente Eingabefelder (über Seiten-Reload hinweg)
const STORAGE_PREFIX = 'persist:';
function initPersistentInput(id) {
  const input = el(id);
  if (!input) return;
  const key = STORAGE_PREFIX + id;
  const saved = localStorage.getItem(key);
  if (saved !== null) input.value = saved;
  input.addEventListener('input', () => {
    try { localStorage.setItem(key, input.value); } catch {}
    updateShareUrl();
  });
}

function setAndPersist(id, value) {
  const input = el(id);
  if (!input) return;
  input.value = value;
  try { localStorage.setItem(STORAGE_PREFIX + id, value); } catch {}
}

// Felder initialisieren
['fhirUrl','fhirBase','qId','prepopBase','patientId','encounterId','userId'].forEach(initPersistentInput);
// initial befüllen
updateShareUrl();

// Presets für FHIR Base Auswahl
const FHIR_BASE_PRESETS = {
  hl7: 'https://fhir.hl7.de/fhir',
  simplifier: 'https://fhir.simplifier.net/isik-stufe-5',
};

function applyFhirBasePreset(preset) {
  const baseInput = el('fhirBase');
  if (!baseInput) return;
  const known = FHIR_BASE_PRESETS[preset];
  if (preset === 'custom') {
    // Zeige freies Eingabefeld
    baseInput.parentElement?.classList?.remove('hidden');
    baseInput.style.display = '';
    baseInput.disabled = false;
    baseInput.readOnly = false;
    baseInput.placeholder = 'FHIR Base URL, z. B. http://localhost:8080/fhir';
    baseInput.focus();
  } else if (known) {
    // Setze bekannten Wert und verstecke freies Feld
    baseInput.value = known;
    try { localStorage.setItem('persist:fhirBase', known); } catch {}
    updateShareUrl();
    // Feld sichtbar und bearbeitbar anzeigen (nicht read-only)
    baseInput.style.display = '';
    baseInput.disabled = false;
    baseInput.readOnly = false;
  }
}

// Init Preset-Auswahl basierend auf aktuellem Wert
const presetSel = document.getElementById('fhirBasePreset');
if (presetSel) {
  const cur = el('fhirBase')?.value?.trim();
  const matchKey = Object.keys(FHIR_BASE_PRESETS).find(k => FHIR_BASE_PRESETS[k] === cur);
  if (matchKey) {
    presetSel.value = matchKey;
    applyFhirBasePreset(matchKey);
  } else {
    presetSel.value = 'custom';
    applyFhirBasePreset('custom');
  }
  presetSel.addEventListener('change', () => applyFhirBasePreset(presetSel.value));

  // Wenn Base-URL manuell geändert wird, Preset entsprechend anpassen
  const baseInput = el('fhirBase');
  if (baseInput) {
    baseInput.addEventListener('input', () => {
      const v = baseInput.value.trim();
      const k = Object.keys(FHIR_BASE_PRESETS).find(key => FHIR_BASE_PRESETS[key] === v);
      presetSel.value = k || 'custom';
    });
  }
}

// Collapsible stacks on the left panel
(function initCollapsibles(){
  const stacks = Array.from(document.querySelectorAll('#leftPanel .body > .stack.collapsible'));
  stacks.forEach((stack, idx) => {
    // Build header
    const header = document.createElement('div');
    header.className = 'col-header';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = stack.dataset.title || `Abschnitt ${idx+1}`;
    const chev = document.createElement('div');
    chev.className = 'chev';
    chev.textContent = '▾';
    header.appendChild(title);
    header.appendChild(chev);
    // Move existing children into body
    const body = document.createElement('div');
    body.className = 'col-body';
    while (stack.firstChild) body.appendChild(stack.firstChild);
    stack.appendChild(header);
    stack.appendChild(body);
    // Toggle behavior
    const storageKey = 'collapse:' + (stack.dataset.title || idx);
    const applyState = (collapsed) => {
      if (collapsed) { stack.classList.add('collapsed'); chev.textContent = '▸'; }
      else { stack.classList.remove('collapsed'); chev.textContent = '▾'; }
    };
    const saved = localStorage.getItem(storageKey);
    if (saved === '1') applyState(true);
    header.addEventListener('click', () => {
      const isCollapsed = stack.classList.toggle('collapsed');
      chev.textContent = isCollapsed ? '▸' : '▾';
      try { localStorage.setItem(storageKey, isCollapsed ? '1' : '0'); } catch {}
    });
  });
})();

async function loadQuestionnaireFromUrl(url) {
  status('Lade Questionnaire von URL …');
  const res = await fetch(url, { headers: { 'Accept': 'application/fhir+json' } });
  if (!res.ok) throw new Error('HTTP '+res.status+' beim Laden von '+url);
  return await res.json();
}

async function loadQuestionnaireFromServer(base, id) {
  const sep = base.endsWith('/') ? '' : '/';
  const url = base + sep + 'Questionnaire/' + encodeURIComponent(id);
  return await loadQuestionnaireFromUrl(url);
}

// --- Extraction/Export --------------------------------------------------
function buildSubjectFromUI() {
  const pid = document.getElementById('patientId')?.value?.trim();
  if (pid) return { resourceType: 'Patient', id: pid };
  return undefined;
}

function buildResultPayload(includeObservations) {
  if (!window.LForms?.Util?.getFormFHIRData) throw new Error('LHC-Forms nicht initialisiert. Bitte Formular rendern.');
  const subject = buildSubjectFromUI();
  if (includeObservations) {
    // Use SDC extraction: returns [QuestionnaireResponse, ...Observations]
    const arr = window.LForms.Util.getFormFHIRData('QuestionnaireResponse', 'R4', undefined, { extract: true, subject });
    const list = Array.isArray(arr) ? arr : [arr].filter(Boolean);
    const qr = list.find(r => r && r.resourceType === 'QuestionnaireResponse') || null;
    const observations = list.filter(r => r && r.resourceType === 'Observation');
    const meta = { generatedAt: new Date().toISOString(), includeObservations: true };
    const qTitle = _lastQuestionnaire?.title || _lastQuestionnaire?.name || _lastQuestionnaire?.id;
    if (qTitle) meta.questionnaireTitle = qTitle;
    return { questionnaireResponse: qr, observations, meta };
  } else {
    // Plain QuestionnaireResponse only
    const qr = window.LForms.Util.getFormFHIRData('QuestionnaireResponse', 'R4', undefined, { subject });
    const meta = { generatedAt: new Date().toISOString(), includeObservations: false };
    const qTitle = _lastQuestionnaire?.title || _lastQuestionnaire?.name || _lastQuestionnaire?.id;
    if (qTitle) meta.questionnaireTitle = qTitle;
    return { questionnaireResponse: qr, observations: [], meta };
  }
}

function openResultsPage(payload) {
  const id = 'lhcResult:' + Date.now() + ':' + Math.random().toString(36).slice(2);
  try { localStorage.setItem(id, JSON.stringify(payload)); } catch (e) { throw new Error('Speichern der Exportdaten fehlgeschlagen: ' + e.message); }
  const url = new URL('result.html', window.location.href);
  url.searchParams.set('k', id);
  window.open(url.toString(), '_blank', 'noopener');
}

function doExport(includeObservations) {
  try {
    const payload = buildResultPayload(includeObservations);
    openResultsPage(payload);
  } catch (e) {
    console.error(e);
    status(e.message || 'Export fehlgeschlagen', 'err');
  }
}

// Hook up export buttons
const btnExportQR = document.getElementById('btnExportQR');
if (btnExportQR) btnExportQR.onclick = () => doExport(false);
const btnExportQROBS = document.getElementById('btnExportQROBS');
if (btnExportQROBS) btnExportQROBS.onclick = () => doExport(true);

function setExportVisible(show) {
  const box = document.getElementById('exportActions');
  if (!box) return;
  const hideForMinimal = document.body.classList.contains('minimal-nobuttons');
  if (show && !hideForMinimal) box.classList.remove('hidden');
  else box.classList.add('hidden');
}

// UI Handlers
el('btnLoadUrl').onclick = async () => {
  try {
    const url = el('fhirUrl').value.trim();
    if (!url) return status('Bitte eine URL angeben.', 'err');
    // Kontext aus UI übernehmen
    await configureFromUI();
    const q = await loadQuestionnaireFromUrl(url);
    el('jsonArea').value = JSON.stringify(q, null, 2);
    renderQuestionnaire(q);
  } catch (e) { status(e.message, 'err'); }
};

// Kopieren-Button für Share-URL
const btnCopy = document.getElementById('btnCopyUrl');
if (btnCopy) {
  btnCopy.onclick = async () => {
    try {
      const val = el('shareUrl')?.value || '';
      if (!val) return status('Kein Link vorhanden.', 'err');
      await navigator.clipboard.writeText(val);
      status('Link kopiert.', 'ok');
    } catch (e) {
      status('Kopieren fehlgeschlagen.', 'err');
    }
  };
}

el('btnLoadServer').onclick = async () => {
  try {
    const base = el('fhirBase').value.trim();
    const id = el('qId').value.trim();
    if (!base || !id) return status('Bitte Base‑URL und ID angeben.', 'err');
    // Kontext aus UI übernehmen
    await configureFromUI();
    const q = await loadQuestionnaireFromServer(base, id);
    el('jsonArea').value = JSON.stringify(q, null, 2);
    renderQuestionnaire(q);
  } catch (e) { status(e.message, 'err'); }
};

// --- Browse als Popup ----------------------------------------------------
function $(id){ return document.getElementById(id); }

function bmStatus(msg, cls){ const s=$('browseStatus'); if (!s) return; s.className = 'hint ' + (cls||''); s.textContent = msg||''; }
function bmOpen(title, info){
  const ov = $('browseModal');
  if (!ov) return;
  $('browseTitle').textContent = title || 'Suche';
  $('browseInfo').textContent = info || '';
  $('browseResults')?.replaceChildren();
  bmStatus('', '');
  ov.classList.remove('hidden');
  $('browseClose')?.focus();
}
function bmClose(){ const ov = $('browseModal'); if (ov) ov.classList.add('hidden'); }
$('browseClose')?.addEventListener('click', bmClose);
// Close on ESC
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') bmClose(); });
// Close when clicking backdrop only
$('browseModal')?.addEventListener('click', (ev) => { if (ev.target === $('browseModal')) bmClose(); });

async function fetchFHIR(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/fhir+json' } });
  if (!res.ok) throw new Error('HTTP '+res.status+' für '+url);
  return res.json();
}
function bundleEntries(bundle) { if (!bundle || bundle.resourceType !== 'Bundle') return []; return (bundle.entry||[]).map(e=>e && (e.resource||e)).filter(Boolean); }
async function fetchAllPages(firstUrl, cap = 1000) {
  const items=[]; let url=firstUrl; let guard=0;
  while (url && guard < cap) {
    const bundle = await fetchFHIR(url);
    items.push(...bundleEntries(bundle));
    const next = (bundle.link||[]).find(l=>l.relation==='next')?.url;
    url = next ? new URL(next, new URL(firstUrl)).toString() : null;
    guard += 1;
  }
  return items;
}

function getPatientName(p){ const names = Array.isArray(p.name) ? p.name.map(n => [n.prefix, n.given, n.family].flat().filter(Boolean).join(' ')).filter(Boolean) : []; return names[0] || '(ohne Name)'; }
function patientDetails(p){
  const rows=[]; if (p.id) rows.push(['ID', p.id]); if (p.birthDate) rows.push(['Geburtsdatum', p.birthDate]); if (p.gender) rows.push(['Geschlecht', p.gender]);
  const idents = Array.isArray(p.identifier) ? p.identifier.map(i => `${i.system||''}|${i.value||''}`).filter(Boolean) : [];
  if (idents.length) rows.push(['Identifier', idents.join(', ')]);
  return rows;
}
function getQuestionnaireTitle(q){ return q.title || q.name || q.id || '(Questionnaire)'; }
function questionnaireDetails(q){ const rows=[]; if (q.id) rows.push(['ID', q.id]); if (q.version) rows.push(['Version', q.version]); if (q.url) rows.push(['URL', q.url]); return rows; }

// Encounter Anzeige-Helfer
function getEncounterTitle(e){
  const bits = [];
  if (e.id) bits.push(`Encounter ${e.id}`);
  if (e.status) bits.push(String(e.status));
  const cls = e.class || e.classCode; // class in R4; fallback just in case
  if (cls && (cls.display || cls.code)) bits.push(cls.display || cls.code);
  return bits.join(' • ') || '(Encounter)';
}
function encounterDetails(e){
  const rows=[];
  if (e.id) rows.push(['ID', e.id]);
  if (e.status) rows.push(['Status', e.status]);
  const cls = e.class || e.classCode;
  if (cls && (cls.display || cls.code)) rows.push(['Klasse', cls.display || cls.code]);
  const st = e.period?.start; const en = e.period?.end;
  if (st || en) rows.push(['Zeitraum', [st||'', en||''].filter(Boolean).join(' → ')]);
  if (e.subject?.reference || e.subject?.display) rows.push(['Subject', e.subject.display || e.subject.reference]);
  if (Array.isArray(e.identifier) && e.identifier.length) {
    const idents = e.identifier.map(i => `${i.system||''}|${i.value||''}`).filter(Boolean);
    if (idents.length) rows.push(['Identifier', idents.join(', ')]);
  }
  if (e.serviceType?.coding?.length) {
    const stc = e.serviceType.coding[0];
    rows.push(['Service', stc.display || stc.code || '']);
  } else if (e.serviceType?.text) {
    rows.push(['Service', e.serviceType.text]);
  }
  return rows;
}

function renderChoicesModal(items, kind, onSelect){
  const container = $('browseResults'); if (!container) return;
  container.replaceChildren();
  const toHeaderAndRows = (res) => {
    if (kind === 'Patient') return [getPatientName(res), patientDetails(res)];
    if (kind === 'Encounter') return [getEncounterTitle(res), encounterDetails(res)];
    return [getQuestionnaireTitle(res), questionnaireDetails(res)];
  };
  items.forEach((res) => {
    const [hdr, rows] = toHeaderAndRows(res);
    const card = document.createElement('div'); card.className = 'pick-panel'; card.setAttribute('role','button'); card.setAttribute('tabindex','0');
    const h3 = document.createElement('h3'); h3.textContent = hdr;
    const inner = document.createElement('div'); inner.className = 'inner';
    const kv = document.createElement('div'); kv.className = 'kv';
    rows.forEach(([k,v]) => {
      const kEl = document.createElement('div'); kEl.className = 'k'; kEl.textContent = k;
      const vEl = document.createElement('div'); vEl.className = 'v'; vEl.textContent = String(v ?? '');
      kv.appendChild(kEl); kv.appendChild(vEl);
    });
    inner.appendChild(kv); card.appendChild(h3); card.appendChild(inner);
    card.onclick = () => onSelect(res);
    card.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(res); } };
    container.appendChild(card);
  });
}

async function openQuestionnaireBrowser(){
  const base = el('fhirBase')?.value?.trim();
  if (!base) { status('Bitte Base‑URL angeben.', 'err'); return; }
  bmOpen('Questionnaires durchsuchen', `Quelle: ${base}`);
  try {
    bmStatus('Lade Questionnaires …');
    const sep = base.endsWith('/') ? '' : '/';
    const search = `Questionnaire?_count=100&_elements=id,title,name,version,description,url`;
    const url = base + sep + search;
    const items = await fetchAllPages(url);
    if (!items.length) { bmStatus('Keine Questionnaires gefunden.', 'err'); return; }
    bmStatus(`${items.length} Treffer gefunden. Auswahl zum Übernehmen klicken.`, 'ok');
    renderChoicesModal(items, 'Questionnaire', (sel) => {
      setAndPersist('qId', sel.id);
      updateShareUrl();
      bmClose();
    });
  } catch (e) { bmStatus(e.message || 'Fehler bei der Suche', 'err'); }
}

async function openPatientBrowser(){
  const vals = getUiValues();
  const effBase = getEffectivePrepopBase(vals) || vals.fhirBase;
  if (!effBase) { status('Bitte zuerst eine FHIR Base (oder Prepopulation Base) angeben.', 'err'); return; }
  bmOpen('Patienten durchsuchen', `Quelle: ${effBase}`);
  try {
    bmStatus('Lade Patienten …');
    const sep = effBase.endsWith('/') ? '' : '/';
    const search = `Patient?_count=100&_elements=id,name,birthDate,gender,identifier`;
    const url = effBase + sep + search;
    const items = await fetchAllPages(url);
    if (!items.length) { bmStatus('Keine Patienten gefunden.', 'err'); return; }
    bmStatus(`${items.length} Treffer gefunden. Auswahl zum Übernehmen klicken.`, 'ok');
    renderChoicesModal(items, 'Patient', (sel) => {
      setAndPersist('patientId', sel.id);
      updateShareUrl();
      bmClose();
    });
  } catch (e) { bmStatus(e.message || 'Fehler bei der Suche', 'err'); }
}

async function openEncounterBrowser(){
  const vals = getUiValues();
  const effBase = getEffectivePrepopBase(vals) || vals.fhirBase;
  if (!effBase) { status('Bitte zuerst eine FHIR Base (oder Prepopulation Base) angeben.', 'err'); return; }
  const pid = (vals.ids.patient || '').trim();
  bmOpen('Encounters durchsuchen', `Quelle: ${effBase}${pid ? ` • Patient: ${pid}` : ''}`);
  try {
    bmStatus('Lade Encounters …');
    const sep = effBase.endsWith('/') ? '' : '/';
    const elems = '_elements=id,subject,period,class,status,serviceType,identifier';
    let search = `Encounter?_count=100&${elems}`;
    if (pid) {
      // Referenzwert für Suche bestimmen: akzeptiere bereits vollständige Referenzen
      const ref = pid.includes('/') ? pid : `Patient/${pid}`;
      search += `&patient=${encodeURIComponent(ref)}`;
    }
    const url = effBase + sep + search;
    const items = await fetchAllPages(url);
    if (!items.length) { bmStatus('Keine Encounters gefunden.', 'err'); return; }
    bmStatus(`${items.length} Treffer gefunden. Auswahl zum Übernehmen klicken.`, 'ok');
    renderChoicesModal(items, 'Encounter', (sel) => {
      setAndPersist('encounterId', sel.id);
      updateShareUrl();
      bmClose();
    });
  } catch (e) { bmStatus(e.message || 'Fehler bei der Suche', 'err'); }
}

// Browse-Buttons → Popups
const btnBrowse = document.getElementById('btnBrowse');
if (btnBrowse) btnBrowse.onclick = openQuestionnaireBrowser;

const btnBrowsePatient = document.getElementById('btnBrowsePatient');
if (btnBrowsePatient) btnBrowsePatient.onclick = openPatientBrowser;

const btnBrowseEncounter = document.getElementById('btnBrowseEncounter');
if (btnBrowseEncounter) btnBrowseEncounter.onclick = openEncounterBrowser;

el('btnRenderJson').onclick = async () => {
  try {
    // Kontext aus UI übernehmen
    await configureFromUI();
    const txt = el('jsonArea').value.trim();
    if (!txt) return status('Bitte Questionnaire JSON einfügen.', 'err');
    const q = JSON.parse(txt);
    renderQuestionnaire(q);
  } catch (e) { status('JSON‑Fehler: '+e.message, 'err'); }
};

// Expliziter Button: Kontext setzen
const btnCtx = document.getElementById('btnSetContext');
if (btnCtx) {
  btnCtx.onclick = async () => {
    try {
      const vals = getUiValues();
      const effBase = getEffectivePrepopBase(vals);
      if (!effBase) return status('Bitte zuerst eine FHIR Base (oder Prepopulation Base) angeben.', 'err');
      const res = await configureLFormsFHIRContext(effBase, vals.ids);
      const details = [];
      if (vals.ids.patient) details.push('Patient: ' + res.results.patient);
      if (vals.ids.encounter) details.push('Encounter: ' + res.results.encounter);
      if (vals.ids.user) details.push('User: ' + res.results.user);
      if (details.length === 0) {
        status('Kontext gesetzt (ohne Ressourcen).', 'ok');
      } else if (res.ok) {
        status('Kontext gesetzt. ' + details.join(' | '), 'ok');
      } else {
        status('Kontext teilweise/fehlerhaft: ' + details.join(' | '), 'err');
        console.warn('Kontext-Fehlerdetails:', res.messages);
      }
    } catch (e) { status(e.message, 'err'); }
  };
}

el('btnLoadSample').onclick = () => {
  const sample = {
    resourceType: 'Questionnaire',
    status: 'active',
    title: 'Demo: Patient Intake',
    id: 'demo-intake',
    item: [
      { linkId: 'name', text: 'Name', type: 'string' },
      { linkId: 'birthDate', text: 'Geburtsdatum', type: 'date' },
      { linkId: 'gender', text: 'Geschlecht', type: 'choice', answerOption: [
        { valueCoding: { code: 'male', display: 'männlich' }},
        { valueCoding: { code: 'female', display: 'weiblich' }},
        { valueCoding: { code: 'other', display: 'divers' }}
      ]},
      { linkId: 'symptoms', text: 'Symptome', type: 'open-choice' },
      { linkId: 'smoker', text: 'RaucherIn?', type: 'boolean' },
      { linkId: 'height', text: 'Größe (cm)', type: 'decimal' }
    ]
  };
  el('jsonArea').value = JSON.stringify(sample, null, 2);
  status('Beispiel geladen. Jetzt „Rendern“ klicken oder automatisch rendern …');
  renderQuestionnaire(sample);
};

el('btnClear').onclick = () => {
  el('jsonArea').value = '';
  el('renderTarget').innerHTML = '';
  updateModifierWarning(null); // Warnbox ausblenden
  status('Zurückgesetzt.');
  setExportVisible(false);
};

// ---- Auto-Init from URL ----
(async function initFromQuery() {
  try {
    // Unterstützte Parameter:
    // q, questionnaire, questionnaireUrl  -> komplette FHIR-URL
    // (optional) base + id                 -> FHIR-Basis & Ressource-ID

    const qUrl = getParam('q', 'questionnaire', 'questionnaireUrl');
    const base = getParam('base');
    const prepopBase = getParam('prepopBase');
    const id = getParam('id');
    const patientId = getParam('patient');
    const encounterId = getParam('encounter');
    const userId = getParam('user');

    // Wenn explizite URL vorhanden, diese nutzen
    if (qUrl) {
      if (document.body.classList.contains('minimal')) hideLeftPanelAndExpandMain();
      // FHIR-Kontext setzen: bevorzugt prepopBase (URL/UI), sonst base (URL/UI)
      const effBase = prepopBase || base || el('prepopBase')?.value?.trim() || el('fhirBase')?.value?.trim();
      if (effBase) await configureLFormsFHIRContext(effBase, { patient: patientId, encounter: encounterId, user: userId });
      const q = await loadQuestionnaireFromUrl(qUrl);
      // UI spiegeln & persistieren
      if (el('fhirUrl')) setAndPersist('fhirUrl', qUrl);
      updateShareUrl();
      el('jsonArea') && (el('jsonArea').value = JSON.stringify(q, null, 2));
      // Classic-API nutzt intern R4/R5 im convert; hier Beispiel R4:
      renderQuestionnaire(q);
      return;
    }

    // Alternativ base+id
    if (base && id) {
      if (document.body.classList.contains('minimal')) hideLeftPanelAndExpandMain();
      await configureLFormsFHIRContext(prepopBase || base, { patient: patientId, encounter: encounterId, user: userId });
      const q = await loadQuestionnaireFromServer(base, id);
      if (el('fhirBase')) setAndPersist('fhirBase', base);
      if (el('qId')) setAndPersist('qId', id);
      updateShareUrl();
      el('jsonArea') && (el('jsonArea').value = JSON.stringify(q, null, 2));
      renderQuestionnaire(q);
      return;
    }

    // Kein Auto-Render → aber ggf. FHIR-Kontext aus Query setzen
    const anyCtxIds = !!(patientId || encounterId || userId);
    const effBaseNoQ = prepopBase || base || el('prepopBase')?.value?.trim() || el('fhirBase')?.value?.trim();
    if (effBaseNoQ && anyCtxIds) {
      // UI spiegeln & persistieren
      if (el('prepopBase') && prepopBase) setAndPersist('prepopBase', prepopBase);
      if (el('fhirBase') && base) setAndPersist('fhirBase', base);
      if (el('patientId') && patientId) setAndPersist('patientId', patientId);
      if (el('encounterId') && encounterId) setAndPersist('encounterId', encounterId);
      if (el('userId') && userId) setAndPersist('userId', userId);
      updateShareUrl();
      await configureLFormsFHIRContext(effBaseNoQ, { patient: patientId, encounter: encounterId, user: userId });
    }

    // Normale UI sichtbar lassen
  } catch (e) {
    console.error(e);
    status('Auto-Render fehlgeschlagen: ' + e.message, 'err');
  }
})();

// ---- ModifierExtension Warnhinweis -------------------------------------
function collectModifierExtensionUrls(obj, acc = new Set()) {
  if (!obj) return acc;
  if (Array.isArray(obj)) {
    for (const it of obj) collectModifierExtensionUrls(it, acc);
    return acc;
  }
  if (typeof obj === 'object') {
    if (Array.isArray(obj.modifierExtension)) {
      for (const ext of obj.modifierExtension) {
        if (ext && typeof ext.url === 'string' && ext.url) acc.add(ext.url);
      }
    }
    for (const k of Object.keys(obj)) {
      // Tiefensuche, aber die modifierExtension selbst wurde schon verarbeitet
      if (k === 'modifierExtension') continue;
      collectModifierExtensionUrls(obj[k], acc);
    }
  }
  return acc;
}

function ensureWarningContainer() {
  const body = document.querySelector('#renderPanel .body');
  if (!body) return null;
  let box = document.getElementById('modifierWarning');
  if (!box) {
    box = document.createElement('div');
    box.id = 'modifierWarning';
    box.className = 'warning-banner';
    // Immer vor dem Formular einfügen
    const target = document.getElementById('renderTarget');
    if (target && target.parentElement === body) {
      body.insertBefore(box, target);
    } else {
      body.insertBefore(box, body.firstChild);
    }
  }
  return box;
}

function updateModifierWarning(questionnaire) {
  const box = ensureWarningContainer();
  if (!box) return; // kein Zielcontainer vorhanden
  if (!questionnaire) {
    box.style.display = 'none';
    box.textContent = '';
    return;
  }
  const urls = Array.from(collectModifierExtensionUrls(questionnaire));
  if (urls.length === 0) {
    box.style.display = 'none';
    box.textContent = '';
    return;
  }
  // Baue den Hinweis mit klickbaren Links
  const prefix = 'Das Questionnaire wurde für Anschauungszwecke gerendert, beinhaltet allerdings die Modifier-Extension ';
  const suffix = ', welche nicht vom Renderer interpretiert wurde.';
  box.replaceChildren();
  box.append(document.createTextNode(prefix));
  urls.forEach((u, i) => {
    if (i > 0) box.append(document.createTextNode(', '));
    const a = document.createElement('a');
    a.href = u;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = u;
    box.append(a);
  });
  box.append(document.createTextNode(suffix));
  box.style.display = '';
}

// Export selected helpers for tests
export const __test__ = {
  encodeForQueryPreservingSpecials,
  collectModifierExtensionUrls,
  getEffectivePrepopBase,
  getPatientName,
  patientDetails,
  getEncounterTitle,
  encounterDetails,
  getQuestionnaireTitle,
  questionnaireDetails,
  createFhirClient,
};
