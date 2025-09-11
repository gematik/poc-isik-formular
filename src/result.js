// Read payload from sessionStorage via key k
import { buildIsikBerichtsBundle } from './isikBundle.js';
const $ = (id) => document.getElementById(id);

function spGet(name) { return new URLSearchParams(window.location.search).get(name); }

function tryLoadPayload() {
  const key = spGet('k');
  if (!key) return { error: 'Kein Schlüssel (k) in URL gefunden.' };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { error: 'Keine Exportdaten im localStorage gefunden.' };
    const data = JSON.parse(raw);
    // Optionally clear after read
    try { localStorage.removeItem(key); } catch {}
    return { data };
  } catch (e) {
    return { error: 'Fehler beim Laden/Parsen der Exportdaten: ' + e.message };
  }
}

function formatJSON(obj) { try { return JSON.stringify(obj, null, 2); } catch { return String(obj); } }

function buildTabs(resources) {
  const tabs = $('tabs');
  if (!tabs) return;
  tabs.replaceChildren();

  const list = document.createElement('div');
  list.className = 'tab-list';
  const panels = document.createElement('div');
  panels.className = 'tab-panels';

  const makeId = (i) => 'tab-' + i;

  resources.forEach((res, i) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn';
    // Detect ISiK Bericht Bundle
    const isIsikBundle = (() => {
      try {
        if (res?.resourceType !== 'Bundle') return false;
        if (Array.isArray(res?.meta?.profile) && res.meta.profile.includes('https://gematik.de/fhir/isik/StructureDefinition/ISiKBerichtBundle')) return true;
        const tags = res?.meta?.tag || [];
        return tags.some(t => t?.code === 'isik-bundle');
      } catch { return false; }
    })();
    const label = isIsikBundle
      ? 'ISiKBerichtBundle'
      : (res && res.resourceType ? `${res.resourceType}${res.id ? ' #' + res.id : ''}` : `Resource ${i+1}`);
    btn.textContent = label;
    btn.setAttribute('data-for', makeId(i));
    list.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'tab-panel';
    panel.id = makeId(i);
    const actions = document.createElement('div');
    actions.className = 'panel-actions';
    const title = document.createElement('div');
    title.className = 'hint';
    title.textContent = label;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn small secondary';
    copyBtn.textContent = 'JSON kopieren';
    copyBtn.onclick = async () => {
      try { await navigator.clipboard.writeText(formatJSON(res)); copyBtn.textContent = 'Kopiert!'; setTimeout(() => copyBtn.textContent = 'JSON kopieren', 1200); }
      catch { copyBtn.textContent = 'Fehler'; setTimeout(() => copyBtn.textContent = 'JSON kopieren', 1200); }
    };
    actions.appendChild(title);
    actions.appendChild(copyBtn);
    // Optional demo hint for ISiK bundle
    const maybeHint = (() => {
      try {
        if (res?.resourceType === 'Bundle' && res?.type === 'document') {
          const tags = res?.meta?.tag || [];
          const isIsik = tags.some(t => t?.code === 'isik-bundle');
          if (isIsik) {
            const info = document.createElement('div');
            info.className = 'hint';
            info.textContent = "Aus Demogründen wurde der KDL Typ 'AM170103 - Patientenfragebogen' für die Composition gewählt. Hier muss natürlich ein passender Code gesetzt werden";
            return info;
          }
        }
      } catch {}
      return null;
    })();

    const pre = document.createElement('pre');
    pre.className = 'json-box';
    pre.textContent = formatJSON(res);
    panel.appendChild(actions);
    if (maybeHint) panel.appendChild(maybeHint);
    // Fallback: also show hint when bundle is recognized via meta.profile
    if (!maybeHint && isIsikBundle) {
      const info = document.createElement('div');
      info.className = 'hint';
      info.textContent = "Aus Demogründen wurde der KDL Typ 'AM170103 - Patientenfragebogen' für die Composition gewählt. Hier muss natürlich ein passender Code gesetzt werden";
      panel.appendChild(info);
    }
    panel.appendChild(pre);
    panels.appendChild(panel);
  });

  tabs.appendChild(list);
  tabs.appendChild(panels);

  // Activate first tab by default
  const activate = (id) => {
    Array.from(tabs.querySelectorAll('.tab-btn')).forEach(b => b.classList.toggle('active', b.getAttribute('data-for') === id));
    Array.from(tabs.querySelectorAll('.tab-panel')).forEach(p => p.classList.toggle('active', p.id === id));
  };
  list.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.tab-btn');
    if (!btn) return;
    activate(btn.getAttribute('data-for'));
  });
  if (resources.length > 0) activate('tab-0');
  tabs.classList.remove('hidden');
}

(function init() {
  const { data, error } = tryLoadPayload();
  const metaLine = $('metaLine');
  if (error) {
    metaLine.textContent = error;
    metaLine.classList.add('err');
    $('emptyMsg').textContent = 'Keine Daten zum Anzeigen.';
    return;
  }
  const parts = [];
  if (data?.meta?.generatedAt) parts.push('Erzeugt: ' + new Date(data.meta.generatedAt).toLocaleString());
  if (data?.meta?.includeObservations) parts.push('Inklusive Observations'); else parts.push('Nur QuestionnaireResponse');
  metaLine.textContent = parts.join(' | ');

  const resources = [];
  if (data?.questionnaireResponse) resources.push(data.questionnaireResponse);
  if (Array.isArray(data?.observations)) resources.push(...data.observations);
  // Build and append ISiK BerichtsBundle (Composition + entries)
  try {
    const isikBundle = buildIsikBerichtsBundle({
      questionnaireResponse: data?.questionnaireResponse,
      observations: data?.observations,
      meta: data?.meta,
    });
    if (isikBundle) resources.push(isikBundle);
  } catch (e) {
    console.warn('ISiK BerichtsBundle konnte nicht erzeugt werden:', e?.message || e);
  }
  if (resources.length === 0) {
    $('emptyMsg').textContent = 'Keine Ressourcen vorhanden.';
    return;
  }
  buildTabs(resources);
})();
