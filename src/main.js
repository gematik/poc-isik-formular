// LForms Classic-Build (stellt window.LForms bereit)
import 'lforms/dist/lforms/webcomponent/assets/lib/zone.min.js';
import 'lforms/dist/lforms/webcomponent/styles.css';
import 'lforms/dist/lforms/webcomponent/lhc-forms.js';
import 'lforms/dist/lforms/fhir/R4/lformsFHIR.min.js';

// UCUM aus npm importieren und als Global verfügbar machen (für evtl. Abhängigkeiten)
import { UcumLhcUtils } from '@lhncbc/ucum-lhc';
window.UcumLhcUtils = UcumLhcUtils;

// Sanity Checks
console.log('Zone present?', typeof window.Zone !== 'undefined');
console.log('WebComponent registered?', !!customElements.get('lhc-forms'));
console.log('UcumLhcUtils?', typeof window.UcumLhcUtils);

function getParam(...names) {
  const sp = new URLSearchParams(window.location.search);
  for (const n of names) {
    const v = sp.get(n);
    if (v !== null && v !== '') return v;
  }
  return null;
}

// Minimal-Modus via URL-Parameter ?minimal=true
(() => {
  const sp = new URLSearchParams(window.location.search);
  const minimal = (sp.get('minimal') || '').toLowerCase() === 'true';
  if (minimal) document.body.classList.add('minimal');
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
    const lf = window.LForms.Util.convertFHIRQuestionnaireToLForms(q, 'R4');
    window.LForms.Util.addFormToPage(lf, document.getElementById('renderTarget'));
    status('Erfolgreich gerendert ✅', 'ok');
  } catch (e) {
    console.error(e);
    status('Konvertierung/Rendering fehlgeschlagen: '+e.message, 
'err');
  }
}

const el = (id) => document.getElementById(id);
const status = (msg, cls) => { const s = el('status'); s.className = cls||''; s.textContent = msg||''; };

// Baut einen teilbaren URL mit den aktuellen Eingaben
function updateShareUrl() {
  const baseUrl = window.location.origin + window.location.pathname;
  const sp = new URLSearchParams();
  const fhirUrl = el('fhirUrl')?.value?.trim();
  const fhirBase = el('fhirBase')?.value?.trim();
  const qId = el('qId')?.value?.trim();
  const prepopBase = el('prepopBase')?.value?.trim();
  const patientId = el('patientId')?.value?.trim();
  const encounterId = el('encounterId')?.value?.trim();
  const userId = el('userId')?.value?.trim();

  if (fhirUrl) {
    sp.set('q', fhirUrl);
  } else if (fhirBase && qId) {
    sp.set('base', fhirBase);
    sp.set('id', qId);
  }
  if (prepopBase) sp.set('prepopBase', prepopBase);
  if (patientId) sp.set('patient', patientId);
  if (encounterId) sp.set('encounter', encounterId);
  if (userId) sp.set('user', userId);
  if (document.body.classList.contains('minimal')) sp.set('minimal', 'true');

  const full = sp.toString() ? `${baseUrl}?${sp.toString()}` : baseUrl;
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
    // Default headers (we will negotiate Accept if needed)
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
    const acceptVariants = [
      'application/fhir+json; fhirVersion=4.0'
    ];
    let lastError;
    for (let i = 0; i < acceptVariants.length; i++) {
      opts.headers['Accept'] = acceptVariants[i];
      try {
        const res = await fetch(u.toString(), opts);
        // Retry on content negotiation issues
        if (res.status === 415 || res.status === 406) {
          lastError = new Error('HTTP ' + res.status + ' for ' + acceptVariants[i]);
          continue;
        }
        if (!res.ok) {
          // Not an Accept issue; throw to outer catch
          throw new Error('FHIR request failed: ' + res.status + ' ' + u.toString());
        }
        return res.json();
      } catch (e) {
        lastError = e;
        // try next Accept
      }
    }
    // If all variants failed
    throw lastError || new Error('FHIR request failed (negotiation): ' + u.toString());
  };
  const stub = (type, id) => ({
    id,
    read: () => id ? doRequest(`${type}/${encodeURIComponent(id)}`) : Promise.resolve(null)
  });
  return {
    request: doRequest,
    patient: stub('Patient', ids.patient),
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
      const res = await client.request(`${type}/${encodeURIComponent(idVal)}`);
      if (res && res.resourceType === type) {
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

async function loadQuestionnaireFromUrl(url) {
  status('Lade Questionnaire von URL …');
  const res = await fetch(url, { headers: { 'Accept': 'application/fhir+json' } });
  if (!res.ok) throw new Error('HTTP '+res.status+' beim Laden von '+url);
  return await res.json();
}

async function loadQuestionnaireFromServer(base, id) {
  const sep = base.endsWith('/') ? '' : '/';
  const url = base + sep + 'Questionnaire/' + encodeURIComponent(id) + '?_format=json';
  return await loadQuestionnaireFromUrl(url);
}

// UI Handlers
el('btnLoadUrl').onclick = async () => {
  try {
    const url = el('fhirUrl').value.trim();
    if (!url) return status('Bitte eine URL angeben.', 'err');
    // Falls Base + IDs in UI vorhanden, Kontext setzen
    const uiBase = el('fhirBase')?.value?.trim();
    const preBase = el('prepopBase')?.value?.trim();
    const base = preBase || uiBase;
    const ids = {
      patient: el('patientId')?.value?.trim() || undefined,
      encounter: el('encounterId')?.value?.trim() || undefined,
      user: el('userId')?.value?.trim() || undefined,
    };
    if (base) await configureLFormsFHIRContext(base, ids);
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
    const ids = {
      patient: el('patientId')?.value?.trim() || undefined,
      encounter: el('encounterId')?.value?.trim() || undefined,
      user: el('userId')?.value?.trim() || undefined,
    };
    // Prepopulation-Kontext für diese Base (inkl. IDs) setzen
    const preBase = el('prepopBase')?.value?.trim();
    await configureLFormsFHIRContext(preBase || base, ids);
    const q = await loadQuestionnaireFromServer(base, id);
    el('jsonArea').value = JSON.stringify(q, null, 2);
    renderQuestionnaire(q);
  } catch (e) { status(e.message, 'err'); }
};

el('btnRenderJson').onclick = () => {
  try {
    // Kontext aus Base-Feld übernehmen, falls vorhanden
    const uiBase = el('fhirBase')?.value?.trim();
    const preBase = el('prepopBase')?.value?.trim();
    const base = preBase || uiBase;
    if (base && base !== _configuredFHIRBase) {
      const ids = {
        patient: el('patientId')?.value?.trim() || undefined,
        encounter: el('encounterId')?.value?.trim() || undefined,
        user: el('userId')?.value?.trim() || undefined,
      };
      configureLFormsFHIRContext(base, ids);
    }
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
      const uiBase = el('fhirBase')?.value?.trim();
      const preBase = el('prepopBase')?.value?.trim();
      const base = preBase || uiBase;
      if (!base) return status('Bitte zuerst eine FHIR Base (oder Prepopulation Base) angeben.', 'err');
      const ids = {
        patient: el('patientId')?.value?.trim() || undefined,
        encounter: el('encounterId')?.value?.trim() || undefined,
        user: el('userId')?.value?.trim() || undefined,
      };
      const res = await configureLFormsFHIRContext(base, ids);
      const details = [];
      if (ids.patient) details.push('Patient: ' + res.results.patient);
      if (ids.encounter) details.push('Encounter: ' + res.results.encounter);
      if (ids.user) details.push('User: ' + res.results.user);
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
      hideLeftPanelAndExpandMain();
      // FHIR-Kontext setzen: bevorzugt prepopBase (URL/UI), sonst base (URL/UI)
      const effBase = prepopBase || base || el('prepopBase')?.value?.trim() || el('fhirBase')?.value?.trim();
      if (effBase) await configureLFormsFHIRContext(effBase, { patient: patientId, encounter: encounterId, user: userId });
      const q = await loadQuestionnaireFromUrl(qUrl);
      // UI spiegeln & persistieren
      if (el('fhirUrl')) setAndPersist('fhirUrl', qUrl);
      el('jsonArea') && (el('jsonArea').value = JSON.stringify(q, null, 2));
      // Classic-API nutzt intern R4/R5 im convert; hier Beispiel R4:
      renderQuestionnaire(q);
      return;
    }

    // Alternativ base+id
    if (base && id) {
      hideLeftPanelAndExpandMain();
      await configureLFormsFHIRContext(prepopBase || base, { patient: patientId, encounter: encounterId, user: userId });
      const q = await loadQuestionnaireFromServer(base, id);
      if (el('fhirBase')) setAndPersist('fhirBase', base);
      if (el('qId')) setAndPersist('qId', id);
      el('jsonArea') && (el('jsonArea').value = JSON.stringify(q, null, 2));
      renderQuestionnaire(q);
      return;
    }

    // Kein Auto-Render → normale UI sichtbar lassen
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
