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
  });
}

function setAndPersist(id, value) {
  const input = el(id);
  if (!input) return;
  input.value = value;
  try { localStorage.setItem(STORAGE_PREFIX + id, value); } catch {}
}

// Felder initialisieren
['fhirUrl','fhirBase','qId'].forEach(initPersistentInput);

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
    const q = await loadQuestionnaireFromUrl(url);
    el('jsonArea').value = JSON.stringify(q, null, 2);
    renderQuestionnaire(q);
  } catch (e) { status(e.message, 'err'); }
};

el('btnLoadServer').onclick = async () => {
  try {
    const base = el('fhirBase').value.trim();
    const id = el('qId').value.trim();
    if (!base || !id) return status('Bitte Base‑URL und ID angeben.', 'err');
    const q = await loadQuestionnaireFromServer(base, id);
    el('jsonArea').value = JSON.stringify(q, null, 2);
    renderQuestionnaire(q);
  } catch (e) { status(e.message, 'err'); }
};

el('btnRenderJson').onclick = () => {
  try {
    const txt = el('jsonArea').value.trim();
    if (!txt) return status('Bitte Questionnaire JSON einfügen.', 'err');
    const q = JSON.parse(txt);
    renderQuestionnaire(q);
  } catch (e) { status('JSON‑Fehler: '+e.message, 'err'); }
};

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
    const id = getParam('id');

    // Wenn explizite URL vorhanden, diese nutzen
    if (qUrl) {
      hideLeftPanelAndExpandMain();
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
