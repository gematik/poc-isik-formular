/*
*
* Copyright 2025 gematik GmbH
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*
* *******
*
* For additional notes and disclaimer from gematik and in case of changes by gematik find details in the "Readme" file.
*/

// LForms Classic-Build (stellt window.LForms bereit)
import 'lforms/dist/lforms/webcomponent/assets/lib/zone.min.js';
import 'lforms/dist/lforms/webcomponent/styles.css';
import 'lforms/dist/lforms/webcomponent/lhc-forms.js';
import 'lforms/dist/lforms/fhir/R4/lformsFHIR.min.js';

// UCUM aus npm importieren und als Global verfügbar machen (für evtl. Abhängigkeiten)
import { UcumLhcUtils } from '@lhncbc/ucum-lhc';
import { inAppExtract, extractResultIsOperationOutcome } from '@aehrc/sdc-template-extract';
import {
  readPendingLaunch,
  clearPendingLaunch,
  readSmartSession,
  saveSmartSession,
  requestSmartAccessToken,
  buildSmartSession,
  isSessionExpired,
  clearSmartSession,
} from './lib/smart.js';
window.UcumLhcUtils = UcumLhcUtils;
// Keep track of the last rendered Questionnaire for export metadata
let _lastQuestionnaire = null;
let _smartSession = null;
let _smartReadyPromise = null;
const TEMPLATE_EXTRACT_EXTENSION_URL = 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-templateExtract';
let _templateExtractEnabled = false;


function getParam(...names) {
  const sp = new URLSearchParams(window.location.search);
  for (const n of names) {
    const v = sp.get(n);
    if (v !== null && v !== '') return v;
  }
  return null;
}

function deepCloneResource(resource) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(resource); } catch { /* ignore and fall back */ }
  }
  return JSON.parse(JSON.stringify(resource));
}

function resourceHasExtension(resource, extensionUrl) {
  if (!resource || typeof resource !== 'object') return false;
  const stack = [resource];
  const seen = new Set();
  const matchesExtension = (list) => Array.isArray(list) && list.some((ext) => ext && typeof ext === 'object' && ext.url === extensionUrl);
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (matchesExtension(current.extension) || matchesExtension(current.modifierExtension)) return true;
    for (const value of Object.values(current)) {
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        for (const entry of value) stack.push(entry);
      } else {
        stack.push(value);
      }
    }
  }
  return false;
}

function questionnaireSupportsTemplateExtract(questionnaire) {
  return resourceHasExtension(questionnaire, TEMPLATE_EXTRACT_EXTENSION_URL);
}

function setTemplateExtractAvailable(enabled) {
  const btn = document.getElementById('btnTemplateExtract');
  _templateExtractEnabled = !!enabled;
  if (!btn) return;
  if (enabled) {
    btn.classList.remove('hidden');
    btn.disabled = false;
  } else {
    btn.classList.add('hidden');
    btn.disabled = true;
  }
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

const normalizeBaseUrl = (url) => (url || '').replace(/\/+$/, '');
function getSmartAuthHeader(targetBase) {
  if (!_smartSession?.accessToken) return null;
  const sessionBase = normalizeBaseUrl(_smartSession.iss);
  const compareBase = normalizeBaseUrl(targetBase);
  if (!sessionBase || !compareBase || sessionBase !== compareBase) return null;
  const tokenType = _smartSession.tokenType || 'Bearer';
  return `${tokenType} ${_smartSession.accessToken}`;
}
function renderQuestionnaire(q) {
  try {
    // Vor dem Rendern: Prüfe auf modifierExtension und zeige ggf. Warnung
    updateModifierWarning(q);
    _lastQuestionnaire = q || null;
    setTemplateExtractAvailable(questionnaireSupportsTemplateExtract(q));
    const lf = window.LForms.Util.convertFHIRQuestionnaireToLForms(q, 'R4');
    // Prepopulation einschalten, damit z.B. observationLinkPeriod greift
    window.LForms.Util.addFormToPage(lf, document.getElementById('renderTarget'), { prepopulate: true });
    setExportVisible(true);
    status('Erfolgreich gerendert ✅', 'ok');
  } catch (e) {
    console.error(e);
    setExportVisible(false);
    setTemplateExtractAvailable(false);
    status('Konvertierung/Rendering fehlgeschlagen: ' + e.message,
      'err');
  }
}

const el = (id) => document.getElementById(id);
const status = (msg, cls) => { const s = el('status'); s.className = cls || ''; s.textContent = msg || ''; };
// --- UI Helpers -----------------------------------------------------------
const SMART_CONTEXT_FIELDS = [
  { id: 'smartContextUser', keys: ['user', 'fhirUser'], typeHint: null },
  { id: 'smartContextPatient', keys: ['patient'], typeHint: 'Patient' },
  { id: 'smartContextEncounter', keys: ['encounter'], typeHint: 'Encounter' },
];
let _smartContextRefreshSeq = 0;

function setSmartContextValue(id, value) {
  const node = el(id);
  if (node) node.textContent = value || '–';
}

function resetSmartContextDisplay() {
  const container = el('smartContextInfo');
  if (container) container.classList.add('hidden');
  SMART_CONTEXT_FIELDS.forEach((field) => setSmartContextValue(field.id, '–'));
}

function normalizeSmartReference(ref, fallbackType) {
  if (!ref) return null;
  if (/^https?:/i.test(ref)) return { url: ref, resourceType: null, id: null, absolute: true };
  if (/^(urn|oid|uuid):/i.test(ref)) return { url: ref, resourceType: null, id: null };
  const segments = String(ref).split('/').filter(Boolean);
  if (segments.length >= 2) {
    return {
      url: segments.slice(0, 2).join('/'),
      resourceType: segments[0],
      id: segments[1],
    };
  }
  if (fallbackType) {
    return { url: `${fallbackType}/${ref}`, resourceType: fallbackType, id: ref };
  }
  return { url: ref, resourceType: null, id: ref };
}

function humanNameToString(name) {
  if (!name) return '';
  if (typeof name === 'string') return name;
  if (name.text) return name.text;
  const parts = [];
  if (Array.isArray(name.prefix)) parts.push(...name.prefix.filter(Boolean));
  if (Array.isArray(name.given)) parts.push(...name.given.filter(Boolean));
  if (name.family) parts.push(name.family);
  return parts.join(' ').trim();
}

function extractResourceName(resource) {
  if (!resource) return '';
  const names = [];
  if (Array.isArray(resource.name)) names.push(...resource.name);
  else if (resource.name) names.push(resource.name);
  for (const n of names) {
    const txt = humanNameToString(n);
    if (txt) return txt;
  }
  return '';
}

function formatSmartContextResource(resource) {
  if (!resource || !resource.resourceType) return '';
  if (resource.resourceType === 'Patient') {
    const name = getPatientName(resource);
    return name ? `${name} (${resource.id || ''})`.trim() : `Patient ${resource.id || ''}`.trim();
  }
  if (resource.resourceType === 'Encounter') {
    return getEncounterTitle(resource) || `Encounter ${resource.id || ''}`.trim();
  }
  if (resource.resourceType === 'Practitioner' || resource.resourceType === 'RelatedPerson' || resource.resourceType === 'Person') {
    const name = extractResourceName(resource);
    if (name) return `${name}${resource.id ? ` (${resource.id})` : ''}`;
    return `${resource.resourceType}${resource.id ? ` ${resource.id}` : ''}`;
  }
  if (resource.resourceType === 'PractitionerRole') {
    const codeDisplay = Array.isArray(resource.code)
      ? (resource.code[0]?.text || resource.code[0]?.coding?.find(c => c.display)?.display || '')
      : '';
    const orgDisplay = resource.organization?.display || resource.organization?.reference || '';
    const parts = [codeDisplay, orgDisplay].filter(Boolean);
    const base = parts.join(' • ');
    return base || `PractitionerRole${resource.id ? ` ${resource.id}` : ''}`;
  }
  if (resource.resourceType === 'Organization' || resource.resourceType === 'Location') {
    const name = resource.name || resource.alias?.[0] || resource.display;
    return name ? `${name}${resource.id ? ` (${resource.id})` : ''}` : `${resource.resourceType}${resource.id ? ` ${resource.id}` : ''}`;
  }
  return `${resource.resourceType}${resource.id ? ` ${resource.id}` : ''}`;
}

async function updateSmartContextDisplay(session) {
  const container = el('smartContextInfo');
  if (!container) return;
  if (!session) {
    resetSmartContextDisplay();
    return;
  }

  const ctx = session.context || {};
  const sessionBase = session.iss ? normalizeBaseUrl(session.iss) : null;
  const baseSep = sessionBase ? (sessionBase.endsWith('/') ? '' : '/') : '';
  const seq = ++_smartContextRefreshSeq;

  container.classList.remove('hidden');
  SMART_CONTEXT_FIELDS.forEach((field) => {
    const value = field.keys.map((key) => ctx[key]).find(Boolean) || null;
    const display = value ? String(value) : '–';
    setSmartContextValue(field.id, display);
  });

  if (!sessionBase) return;
  await Promise.all(SMART_CONTEXT_FIELDS.map(async (field) => {
    const value = field.keys.map((key) => ctx[key]).find(Boolean);
    if (!value) return;
    const ref = normalizeSmartReference(value, field.typeHint);
    if (!ref || !ref.url || !ref.resourceType || !ref.id) return;
    const targetUrl = /^https?:/i.test(ref.url) ? ref.url : `${sessionBase}${baseSep}${ref.url}`;
    try {
      const resource = await fetchFHIR(targetUrl);
      if (_smartContextRefreshSeq !== seq) return;
      const formatted = formatSmartContextResource(resource);
      if (formatted) setSmartContextValue(field.id, formatted);
    } catch (err) {
      console.warn('SMART Kontext Ressource konnte nicht geladen werden:', err);
    }
  }));
}

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
  return (vals.prepopBase || vals.fhirBase || _smartSession?.iss || '').trim() || null;
}

async function configureFromUI() {
  await _smartReadyPromise;
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
  const normBase = normalizeBaseUrl(base);
  const getAuthorizationHeader = () => getSmartAuthHeader(normBase);
  const makeAbs = (url) => {
    if (/^https?:/i.test(url)) return url;
    return normBase + '/' + url.replace(/^\//, '');
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
      // Some servers reject GET with a body �� strip it
      delete opts.body;
    }
      // Nur FHIR JSON anfragen (GET ohne Body)
      opts.headers['Accept'] = 'application/fhir+json';
      const authHeader = getAuthorizationHeader();
      if (authHeader && !opts.headers.Authorization && !opts.headers.authorization) {
        opts.headers.Authorization = authHeader;
      }
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
    getAuthorizationHeader,
    accessToken: _smartSession?.accessToken || null,
    tokenType: _smartSession?.tokenType || 'Bearer',
    fhirBase: normBase,
    patient: stub('Patient', ids.patient, true),
    encounter: stub('Encounter', ids.encounter),
    user: stub('Practitioner', ids.user)
  };
}

async function configureLFormsFHIRContext(base, ids = {}) {
  const result = { ok: true, results: { patient: 'skipped', encounter: 'skipped', user: 'skipped' }, messages: {} };
  if (!base) { result.ok = false; result.messages.base = 'Keine FHIR Base angegeben'; return result; }
  const client = createFhirClient(base, ids);
  const authHeader = client.getAuthorizationHeader ? client.getAuthorizationHeader() : null;
  if (authHeader) client.authHeader = authHeader;
  client.smartSession = _smartSession;
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
    try { localStorage.setItem(key, input.value); } catch { }
    updateShareUrl();
  });
}

function setAndPersist(id, value) {
  const input = el(id);
  if (!input) return;
  input.value = value;
  try { localStorage.setItem(STORAGE_PREFIX + id, value); } catch { }
}

function applySmartContextToUi(session) {
  updateSmartContextDisplay(session);
  if (!session) return;
  const ctx = session.context || {};
  if (session.iss) {
    setAndPersist('fhirBasePreset', 'custom')
    setAndPersist('fhirBase', session.iss);
    setAndPersist('prepopBase', session.iss);
  }
  if (ctx.patient) setAndPersist('patientId', ctx.patient);
  if (ctx.encounter) setAndPersist('encounterId', ctx.encounter);
  if (ctx.user) setAndPersist('userId', ctx.user);
  updateShareUrl();
}
async function completeSmartLaunch() {
  let session = readSmartSession();
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (code) {
      const pending = readPendingLaunch();
      if (!pending) throw new Error('SMART Launch konnte nicht abgeschlossen werden: kein gespeicherter Zustand.');
      if (pending.state !== state) throw new Error('SMART Launch abgebrochen: state Parameter stimmt nicht.');
      const tokenResponse = await requestSmartAccessToken(pending, code);
      session = buildSmartSession(pending, tokenResponse);
      saveSmartSession(session);
      clearPendingLaunch();
      ['code', 'state', 'iss', 'launch'].forEach((key) => params.delete(key));
      const newQuery = params.toString();
      const newUrl = `${window.location.origin}${window.location.pathname}${newQuery ? `?${newQuery}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', newUrl);
      status('SMART Launch abgeschlossen. Zugriffstoken erhalten.', 'ok');
    } else if (session && isSessionExpired(session)) {
      status('SMART Sitzung ist abgelaufen. Bitte erneut starten.', 'err');
      clearSmartSession();
      session = null;
    }
  } catch (err) {
    console.error('SMART Launch error', err);
    status('SMART Launch fehlgeschlagen: ' + (err?.message || err), 'err');
    clearPendingLaunch();
    clearSmartSession();
    session = null;
  }
  _smartSession = session;
  applySmartContextToUi(session);
  return session;
}
// Felder initialisieren
['fhirUrl', 'fhirBase', 'qId', 'prepopBase', 'patientId', 'encounterId', 'userId'].forEach(initPersistentInput);
// initial befüllen
updateShareUrl();

_smartReadyPromise = completeSmartLaunch();
// Presets für FHIR Base Auswahl
const FHIR_BASE_PRESETS = {
  hl7: 'https://fhir.hl7.de/fhir',
  simplifier: 'https://fhir.simplifier.net/isik-stufe-5',
  miiPro: "https://fhir.simplifier.net/MII-Erweiterungsmodul-PRO-2025"
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
    baseInput.placeholder = 'FHIR Base URL, z.B. http://localhost:8080/fhir';
    baseInput.focus();
  } else if (known) {
    // Setze bekannten Wert und verstecke freies Feld
    baseInput.value = known;
    try { localStorage.setItem('persist:fhirBase', known); } catch { }
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
(function initCollapsibles() {
  const stacks = Array.from(document.querySelectorAll('#leftPanel .body > .stack.collapsible'));
  stacks.forEach((stack, idx) => {
    // Build header
    const header = document.createElement('div');
    header.className = 'col-header';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = stack.dataset.title || `Abschnitt ${idx + 1}`;
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
      try { localStorage.setItem(storageKey, isCollapsed ? '1' : '0'); } catch { }
    });
  });
})();

async function loadQuestionnaireFromUrl(url, baseForAuth) {
  await _smartReadyPromise;
  status('Lade Questionnaire von URL ...');
  const headers = { 'Accept': 'application/fhir+json' };
  let authBase = baseForAuth ? normalizeBaseUrl(baseForAuth) : null;
  const sessionBase = _smartSession?.iss ? normalizeBaseUrl(_smartSession.iss) : null;
  if (!authBase) {
    const isAbsolute = /^https?:/i.test(url);
    if (!isAbsolute && sessionBase) {
      authBase = sessionBase;
    } else if (sessionBase && (url === sessionBase || url.startsWith(sessionBase + '/'))) {
      authBase = sessionBase;
    }
  }
  const authHeader = authBase ? getSmartAuthHeader(authBase) : null;
  if (authHeader) headers.Authorization = authHeader;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' beim Laden von ' + url);
  return await res.json();
}

async function loadQuestionnaireFromServer(base, id) {
  const sep = base.endsWith('/') ? '' : '/';
  const url = base + sep + 'Questionnaire/' + encodeURIComponent(id);
  return await loadQuestionnaireFromUrl(url, base);
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
  // Öffne neues Fenster/Tab und versuche zusätzlich, die Daten direkt zu übermitteln.
  // Hintergrund: In iframes oder bei partitioniertem Storage kann localStorage nicht lesbar sein.
  const win = window.open(url.toString(), '_blank');
  try {
    // Fallback: Daten direkt per postMessage an das Result-Fenster senden
    const msg = { type: 'lhc-export', key: id, payload };
    const tgt = new URL(url.toString());
    const targetOrigin = tgt.origin;
    let attempts = 0;
    const maxAttempts = 30; // ~6 Sekunden bei 200ms
    const send = () => {
      attempts += 1;
      try {
        if (!win || win.closed) return clearInterval(timer);
        if (typeof win.postMessage === 'function') {
          win.postMessage(msg, targetOrigin);
        }
        if (attempts >= maxAttempts) clearInterval(timer);
      } catch {
        if (attempts >= maxAttempts) clearInterval(timer);
      }
    };
    // Sofort senden und mehrfach nachschicken, bis Listener bereit ist
    const timer = setInterval(send, 200);
    send();
  } catch { }
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

async function doTemplateExtract() {
  if (!_lastQuestionnaire) {
    status('Kein Questionnaire geladen.', 'err');
    return;
  }
  if (!_templateExtractEnabled || !questionnaireSupportsTemplateExtract(_lastQuestionnaire)) {
    status('Dieses Questionnaire unterstützt keinen Template-Extract.', 'err');
    return;
  }
  if (!window.LForms?.Util?.getFormFHIRData) {
    status('LHC-Forms nicht initialisiert. Bitte Formular rendern.', 'err');
    return;
  }
  try {
    const subject = buildSubjectFromUI();
    const qr = window.LForms.Util.getFormFHIRData('QuestionnaireResponse', 'R4', undefined, { subject });
    if (!qr) throw new Error('Keine QuestionnaireResponse vorhanden.');
    const extractionInput = deepCloneResource(qr);
    const extraction = await inAppExtract(extractionInput, _lastQuestionnaire, null);
    const success = extraction?.extractSuccess && extraction && !extractResultIsOperationOutcome(extraction.extractResult);
    const meta = {
      generatedAt: new Date().toISOString(),
      type: 'templateExtract',
      questionnaireId: _lastQuestionnaire?.id || null,
      questionnaireTitle: _lastQuestionnaire?.title || _lastQuestionnaire?.name || null,
      templateExtractSuccess: !!success,
    };
    const payload = {
      questionnaireResponse: qr,
      meta,
    };
    if (success) {
      const extractResult = extraction.extractResult;
      payload.templateExtractBundle = extractResult?.extractedBundle || null;
      if (extractResult?.issues) payload.templateExtractIssues = extractResult.issues;
      if (extractResult?.debugInfo) {
        payload.templateExtractDebugInfo = {
          resourceType: 'TemplateExtractDebugInfo',
          info: deepCloneResource(extractResult.debugInfo),
        };
      }
      openResultsPage(payload);
      status('Template-Extract erfolgreich erzeugt.', 'ok');
    } else {
      let outcome = null;
      if (extraction && extractResultIsOperationOutcome(extraction.extractResult)) {
        outcome = extraction.extractResult;
      } else if (extraction && extraction.extractResult && extraction.extractResult.issues) {
        outcome = extraction.extractResult.issues;
      }
      if (outcome) payload.templateExtractOutcome = outcome;
      payload.meta.templateExtractSuccess = false;
      openResultsPage(payload);
      status('Template-Extract lieferte Hinweise (OperationOutcome).', 'err');
    }
  } catch (e) {
    console.error(e);
    status('Template-Extract fehlgeschlagen: ' + (e?.message || e), 'err');
  }
}

// Hook up export buttons
const btnExportQR = document.getElementById('btnExportQR');
if (btnExportQR) btnExportQR.onclick = () => doExport(false);
const btnTemplateExtract = document.getElementById('btnTemplateExtract');
if (btnTemplateExtract) btnTemplateExtract.onclick = () => { void doTemplateExtract(); };
const btnExportQROBS = document.getElementById('btnExportQROBS');
if (btnExportQROBS) btnExportQROBS.onclick = () => doExport(true);

function setExportVisible(show) {
  const box = document.getElementById('exportActions');
  if (!box) return;
  const hideForMinimal = document.body.classList.contains('minimal-nobuttons');
  if (show && !hideForMinimal) box.classList.remove('hidden');
  else {
    box.classList.add('hidden');
    if (!show) setTemplateExtractAvailable(false);
  }
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
    if (!base || !id) return status('Bitte Base-URL und ID angeben.', 'err');
    // Kontext aus UI übernehmen
    await configureFromUI();
    const q = await loadQuestionnaireFromServer(base, id);
    el('jsonArea').value = JSON.stringify(q, null, 2);
    renderQuestionnaire(q);
  } catch (e) { status(e.message, 'err'); }
};

// Globale Seitengröße für Browse-Listen
const BROWSE_COUNT = 9;

// --- Browse als Popup ----------------------------------------------------
function $(id) { return document.getElementById(id); }

function bmStatus(msg, cls) { const s = $('browseStatus'); if (!s) return; s.className = 'hint ' + (cls || ''); s.textContent = msg || ''; }
function bmOpen(title, info) {
  const ov = $('browseModal');
  if (!ov) return;
  $('browseTitle').textContent = title || 'Suche';
  $('browseInfo').textContent = info || '';
  $('browseResults')?.replaceChildren();
  bmStatus('', '');
  // Reset paging controls (hidden by default)
  const ctrls = $('browseControls');
  const prev = $('browsePrev');
  const next = $('browseNext');
  const page = $('browsePage');
  if (ctrls) ctrls.style.display = 'none';
  if (prev) prev.disabled = true;
  if (next) next.disabled = true;
  if (page) page.textContent = 'Seite 1';
  // Reset search widgets
  const sInput = $('browseSearch');
  const sBtn = $('browseSearchBtn');
  if (sInput) { sInput.value = ''; sInput.placeholder = 'Suche'; }
  if (sBtn) { sBtn.disabled = false; }
  ov.classList.remove('hidden');
  $('browseClose')?.focus();
}
function bmClose() { const ov = $('browseModal'); if (ov) ov.classList.add('hidden'); }
$('browseClose')?.addEventListener('click', bmClose);
// Close on ESC
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') bmClose(); });
// Close when clicking backdrop only
$('browseModal')?.addEventListener('click', (ev) => { if (ev.target === $('browseModal')) bmClose(); });

async function fetchFHIR(url) {
  await _smartReadyPromise;
  const headers = { 'Accept': 'application/fhir+json' };
  const sessionBase = _smartSession?.iss ? normalizeBaseUrl(_smartSession.iss) : null;
  let authBase = null;
  if (sessionBase) {
    const isAbsolute = /^https?:/i.test(url);
    if (!isAbsolute) {
      authBase = sessionBase;
    } else if (url === sessionBase || url.startsWith(sessionBase + '/')) {
      authBase = sessionBase;
    }
  }
  const authHeader = authBase ? getSmartAuthHeader(authBase) : null;
  if (authHeader) headers.Authorization = authHeader;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' fuer ' + url);
  return res.json();
}

function bundleEntries(bundle) {
  if (!bundle || bundle.resourceType !== 'Bundle') return [];
  return (bundle.entry || [])
    .map(e => e && (e.resource || e))
    .filter(Boolean)
    // Do not surface OperationOutcome entries in browse results
    .filter(res => res && res.resourceType !== 'OperationOutcome');
}
async function fetchAllPages(firstUrl, cap = 1000) {
  const items = []; let url = firstUrl; let guard = 0;
  while (url && guard < cap) {
    const bundle = await fetchFHIR(url);
    items.push(...bundleEntries(bundle));
    const next = (bundle.link || []).find(l => l.relation === 'next')?.url;
    url = next ? new URL(next, new URL(firstUrl)).toString() : null;
    guard += 1;
  }
  return items;
}

function getPatientName(p) { const names = Array.isArray(p.name) ? p.name.map(n => [n.prefix, n.given, n.family].flat().filter(Boolean).join(' ')).filter(Boolean) : []; return names[0] || '(ohne Name)'; }
function patientDetails(p) {
  const rows = []; if (p.id) rows.push(['ID', p.id]); if (p.birthDate) rows.push(['Geburtsdatum', p.birthDate]); if (p.gender) rows.push(['Geschlecht', p.gender]);
  const idents = Array.isArray(p.identifier) ? p.identifier.map(i => `${i.system || ''}|${i.value || ''}`).filter(Boolean) : [];
  if (idents.length) rows.push(['Identifier', idents.join(', ')]);
  return rows;
}

function getQuestionnaireTitle(q) { return q.title || q.name || q.id || '(Questionnaire)'; }
function questionnaireDetails(q) { const rows = []; if (q.id) rows.push(['ID', q.id]); if (q.version) rows.push(['Version', q.version]); if (q.url) rows.push(['URL', q.url]); return rows; }

// Encounter Anzeige-Helfer
function getEncounterTitle(e) {
  const bits = [];
  if (e.id) bits.push(`Encounter ${e.id}`);
  if (e.status) bits.push(String(e.status));
  const cls = e.class || e.classCode; // class in R4; fallback just in case
  if (cls && (cls.display || cls.code)) bits.push(cls.display || cls.code);
  return bits.join('  ') || '(Encounter)';
}
function encounterDetails(e) {
  const rows = [];
  if (e.id) rows.push(['ID', e.id]);
  if (e.status) rows.push(['Status', e.status]);
  const cls = e.class || e.classCode;
  if (cls && (cls.display || cls.code)) rows.push(['Klasse', cls.display || cls.code]);
  const st = e.period?.start; const en = e.period?.end;
  if (st || en) rows.push(['Zeitraum', [st || '', en || ''].filter(Boolean).join(' → ')]);
  if (e.subject?.reference || e.subject?.display) rows.push(['Subject', e.subject.display || e.subject.reference]);
  if (Array.isArray(e.identifier) && e.identifier.length) {
    const idents = e.identifier.map(i => `${i.system || ''}|${i.value || ''}`).filter(Boolean);
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

function renderChoicesModal(items, kind, onSelect) {
  const container = $('browseResults'); if (!container) return;
  container.replaceChildren();
  const toHeaderAndRows = (res) => {
    if (kind === 'Patient') return [getPatientName(res), patientDetails(res)];
    if (kind === 'Encounter') return [getEncounterTitle(res), encounterDetails(res)];
    return [getQuestionnaireTitle(res), questionnaireDetails(res)];
  };
  items.forEach((res) => {
    const [hdr, rows] = toHeaderAndRows(res);
    const card = document.createElement('div'); card.className = 'pick-panel'; card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0');
    const h3 = document.createElement('h3'); h3.textContent = hdr;
    const inner = document.createElement('div'); inner.className = 'inner';
    const kv = document.createElement('div'); kv.className = 'kv';
    rows.forEach(([k, v]) => {
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

async function openPagedBrowser({
  modalTitle,
  modalSubtitle,
  placeholder = 'Suche',
  buildFirstUrl,
  resourceType,
  onSelect = () => {},
  messages = {},
  autoSearchPredicate,
}) {
  if (typeof buildFirstUrl !== 'function') throw new Error('buildFirstUrl function is required');
  bmOpen(modalTitle, modalSubtitle);

  const sInput = $('browseSearch');
  const sBtn = $('browseSearchBtn');
  if (sInput) { sInput.placeholder = placeholder; }
  const ctrls = $('browseControls');
  const prevBtn = $('browsePrev');
  const nextBtn = $('browseNext');
  const pageEl = $('browsePage');
  if (ctrls) ctrls.style.display = '';

  const defaultResultMsg = (count) => `${count} Treffer auf dieser Seite. Auswahl zum Uebernehmen klicken.`;
  const autoPredicate = autoSearchPredicate || ((term) => term.length === 0 || term.length > 3);

  let currentUrl = buildFirstUrl(sInput?.value || '');
  let nextUrl = null;
  const prevStack = [];
  let pageNum = 1;

  async function load(url) {
    try {
      bmStatus(messages.loading || 'Lade Ergebnisse ...');
      if (prevBtn) prevBtn.disabled = prevStack.length === 0;
      if (nextBtn) nextBtn.disabled = true;

      const bundle = await fetchFHIR(url);
      const items = bundleEntries(bundle).filter(r => r && r.resourceType === resourceType);
      if (!items.length) {
        bmStatus(messages.empty || 'Keine Ergebnisse gefunden.', 'err');
        renderChoicesModal([], resourceType, () => {});
      } else {
        const msg = typeof messages.results === 'function'
          ? messages.results(items.length)
          : (messages.results || defaultResultMsg(items.length));
        bmStatus(msg, 'ok');
        renderChoicesModal(items, resourceType, onSelect);
      }
      const linkNext = (bundle.link || []).find(l => l.relation === 'next')?.url || null;
      nextUrl = linkNext ? new URL(linkNext, new URL(url)).toString() : null;
      if (pageEl) pageEl.textContent = `Seite ${pageNum}`;
      if (nextBtn) nextBtn.disabled = !nextUrl;
      if (prevBtn) prevBtn.disabled = prevStack.length === 0;
    } catch (e) {
      const errMsg = typeof messages.error === 'function'
        ? messages.error(e)
        : (messages.error || e.message || 'Fehler bei der Suche');
      bmStatus(errMsg, 'err');
    }
  }

  if (prevBtn) prevBtn.onclick = async () => {
    if (prevStack.length === 0) return;
    const url = prevStack.pop();
    pageNum = Math.max(1, pageNum - 1);
    currentUrl = url;
    await load(currentUrl);
  };
  if (nextBtn) nextBtn.onclick = async () => {
    if (!nextUrl) return;
    prevStack.push(currentUrl);
    pageNum += 1;
    currentUrl = nextUrl;
    await load(currentUrl);
  };

  const runSearch = async () => {
    const term = sInput?.value || '';
    prevStack.length = 0;
    pageNum = 1;
    currentUrl = buildFirstUrl(term);
    await load(currentUrl);
  };

  if (sBtn) sBtn.onclick = runSearch;
  if (sInput) sInput.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); runSearch(); } };
  if (sInput) sInput.oninput = () => {
    const term = sInput.value || '';
    clearTimeout(sInput.__debounce);
    sInput.__debounce = setTimeout(() => {
      if (autoPredicate(term)) runSearch();
    }, 350);
  };

  await load(currentUrl);
}

async function openQuestionnaireBrowser(){
  const base = el('fhirBase')?.value?.trim();
  if (!base) { status('Bitte Base-URL angeben.', 'err'); return; }
  bmOpen('Questionnaires durchsuchen', `Quelle: ${base}`);
  try {
    bmStatus('Lade Questionnaires ...');
    const sep = base.endsWith('/') ? '' : '/';
    const search = `Questionnaire?_count=${BROWSE_COUNT}&_elements=id,title,name,version,description,url`;
    const url = base + sep + search;
    const items = (await fetchAllPages(url)).filter(r => r && r.resourceType === 'Questionnaire');
    if (!items.length) { bmStatus('Keine Questionnaires gefunden.', 'err'); return; }
    bmStatus(`${items.length} Treffer gefunden. Auswahl zum Uebernehmen klicken.`, 'ok');
    renderChoicesModal(items, 'Questionnaire', (sel) => {
      setAndPersist('qId', sel.id);
      updateShareUrl();
      bmClose();
    });
  } catch (e) { bmStatus(e.message || 'Fehler bei der Suche', 'err'); }
}

// Paged Questionnaire browser using BROWSE_COUNT and next link
async function openQuestionnaireBrowserPaged() {
  const base = el('fhirBase')?.value?.trim();
  if (!base) { status('Bitte Base-URL angeben.', 'err'); return; }
  const sep = base.endsWith('/') ? '' : '/';
  const baseQuery = `Questionnaire?_count=${BROWSE_COUNT}&_elements=id,title,name,version,description,url`;

  return openPagedBrowser({
    modalTitle: 'Questionnaires durchsuchen',
    modalSubtitle: `Quelle: ${base}`,
    placeholder: 'Titel suchen...',
    resourceType: 'Questionnaire',
    buildFirstUrl(term) {
      const t = (term || '').trim();
      const extra = t ? `&title:contains=${encodeURIComponent(t)}` : '';
      return base + sep + baseQuery + extra;
    },
    messages: {
      loading: 'Lade Questionnaires ...',
      empty: 'Keine Questionnaires gefunden.',
    },
    onSelect(sel) {
      setAndPersist('qId', sel.id);
      updateShareUrl();
      bmClose();
    },
  });
}

async function openPatientBrowser() {
  const vals = getUiValues();
  const effBase = getEffectivePrepopBase(vals) || vals.fhirBase;
  if (!effBase) { status('Bitte zuerst eine FHIR Base (oder Prepopulation Base) angeben.', 'err'); return; }

  const sep = effBase.endsWith('/') ? '' : '/';
  const elems = '_elements=id,name,birthDate,gender,identifier';
  const baseQuery = `Patient?_count=${BROWSE_COUNT}&${elems}`;

  const smartCtx = _smartSession?.context || {};
  const smartPatientRef = smartCtx.patient || null;
  if (smartPatientRef) {
    bmOpen('Patienten durchsuchen', `Quelle: ${effBase}`);
    const ctrls = $('browseControls');
    const sInput = $('browseSearch');
    const sBtn = $('browseSearchBtn');
    const prevBtn = $('browsePrev');
    const nextBtn = $('browseNext');
    if (ctrls) ctrls.style.display = 'none';
    if (sBtn) sBtn.disabled = true;
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (sInput) {
      sInput.disabled = true;
      sInput.value = '';
      sInput.placeholder = 'SMART Patient-Kontext aktiv';
    }
    try {
      bmStatus('SMART Patient wird geladen ...', 'ok');
      const refPath = smartPatientRef.includes('/') ? smartPatientRef : `Patient/${smartPatientRef}`;
      const patient = await fetchFHIR(effBase + sep + refPath);
      if (patient && patient.resourceType === 'Patient') {
        bmStatus('SMART Launch stellt diesen Patientenkontext bereit.', 'ok');
        renderChoicesModal([patient], 'Patient', (sel) => {
          setAndPersist('patientId', sel.id);
          updateShareUrl();
          bmClose();
        });
      } else {
        bmStatus('Patient aus SMART-Kontext konnte nicht geladen werden.', 'err');
      }
    } catch (e) {
      bmStatus(e?.message || 'Fehler beim Laden des SMART-Patients', 'err');
    }
    return;
  }

  return openPagedBrowser({
    modalTitle: 'Patienten durchsuchen',
    modalSubtitle: `Quelle: ${effBase}`,
    placeholder: 'Name suchen...',
    resourceType: 'Patient',
    buildFirstUrl(term) {
      const t = (term || '').trim();
      const extra = t ? `&name=${encodeURIComponent(t)}` : '';
      return effBase + sep + baseQuery + extra;
    },
    messages: {
      loading: 'Lade Patienten ...',
      empty: 'Keine Patienten gefunden.',
    },
    onSelect(sel) {
      setAndPersist('patientId', sel.id);
      updateShareUrl();
      bmClose();
    },
  });
}

async function openEncounterBrowser() {
  const vals = getUiValues();
  const effBase = getEffectivePrepopBase(vals) || vals.fhirBase;
  if (!effBase) { status('Bitte zuerst eine FHIR Base (oder Prepopulation Base) angeben.', 'err'); return; }
  const smartCtx = _smartSession?.context || {};
  const smartPatientRef = smartCtx.patient || null;
  let pid = (vals.ids.patient || '').trim();
  if (!pid && smartPatientRef) {
    pid = smartPatientRef.includes('/') ? smartPatientRef.split('/').pop() : smartPatientRef;
  }
  const patientRef = pid ? (pid.includes('/') ? pid : `Patient/${pid}`) : '';
  const patientLabel = pid || smartPatientRef || '';

  const sep = effBase.endsWith('/') ? '' : '/';
  const elems = '_elements=id,subject,period,class,status,serviceType,identifier';
  const patientFilter = patientRef ? `&patient=${encodeURIComponent(patientRef)}` : '';
  const baseQuery = `Encounter?_count=${BROWSE_COUNT}&${elems}${patientFilter}`;

  return openPagedBrowser({
    modalTitle: 'Encounters durchsuchen',
    modalSubtitle: `Quelle: ${effBase}${patientLabel ? ` - Patient: ${patientLabel}` : ''}`,
    placeholder: 'Identifier suchen...',
    resourceType: 'Encounter',
    buildFirstUrl(term) {
      const t = (term || '').trim();
      const extra = t ? `&identifier=${encodeURIComponent(t)}` : '';
      return effBase + sep + baseQuery + extra;
    },
    messages: {
      loading: 'Lade Encounters ...',
      empty: 'Keine Encounters gefunden.',
    },
    onSelect(sel) {
      setAndPersist('encounterId', sel.id);
      updateShareUrl();
      bmClose();
    },
  });
}
// Browse-Buttons �� Popups
const btnBrowse = document.getElementById('btnBrowse');
if (btnBrowse) btnBrowse.onclick = openQuestionnaireBrowserPaged;

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
  } catch (e) { status('JSON-Fehler: ' + e.message, 'err'); }
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
      {
        linkId: 'gender', text: 'Geschlecht', type: 'choice', answerOption: [
          { valueCoding: { code: 'male', display: 'männlich' } },
          { valueCoding: { code: 'female', display: 'weiblich' } },
          { valueCoding: { code: 'other', display: 'divers' } }
        ]
      },
      { linkId: 'symptoms', text: 'Symptome', type: 'open-choice' },
      { linkId: 'smoker', text: 'RaucherIn?', type: 'boolean' },
      { linkId: 'height', text: 'Größe (cm)', type: 'decimal' }
    ]
  };
  el('jsonArea').value = JSON.stringify(sample, null, 2);
  status('Beispiel geladen. Jetzt "Rendern" klicken oder automatisch rendern ...');
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
    await _smartReadyPromise;
    // Unterstützte Parameter:
    // q, questionnaire, questionnaireUrl  -> komplette FHIR-URL
    // (optional) base + id                 -> FHIR-Basis & Ressource-ID

    const qUrl = getParam('q', 'questionnaire', 'questionnaireUrl');
    const base = getParam('base');
    const prepopBase = getParam('prepopBase');
    const id = getParam('id');
    const smartCtx = _smartSession?.context || {};
    const patientId = getParam('patient') || smartCtx.patient || null;
    const encounterId = getParam('encounter') || smartCtx.encounter || null;
    const userId = getParam('user') || smartCtx.user || smartCtx.fhirUser || null;

    // Wenn explizite URL vorhanden, diese nutzen
    if (qUrl) {
      if (document.body.classList.contains('minimal')) hideLeftPanelAndExpandMain();
      // FHIR-Kontext setzen: bevorzugt prepopBase (URL/UI), sonst base (URL/UI)
      const effBase = prepopBase || base || _smartSession?.iss || el('prepopBase')?.value?.trim() || el('fhirBase')?.value?.trim();
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

    // Kein Auto-Render �� aber ggf. FHIR-Kontext aus Query setzen
    const anyCtxIds = !!(patientId || encounterId || userId);
    const effBaseNoQ = prepopBase || base || _smartSession?.iss || el('prepopBase')?.value?.trim() || el('fhirBase')?.value?.trim();
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


