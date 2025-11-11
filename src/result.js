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

function renderPayload(data) {
  const metaLine = $('metaLine');
  const meta = data?.meta || {};
  const parts = [];
  if (meta.generatedAt) parts.push('Erzeugt: ' + new Date(meta.generatedAt).toLocaleString());
  if (meta.type === 'templateExtract') {
    parts.push(meta.templateExtractSuccess === false ? 'Template-Extract (OperationOutcome)' : 'Template-Extract Bundle');
  } else if (meta.includeObservations === true) {
    parts.push('Inklusive Observations');
  } else if (meta.includeObservations === false) {
    parts.push('Nur QuestionnaireResponse');
  }
  if (meta.questionnaireTitle) {
    parts.push('Questionnaire: ' + meta.questionnaireTitle);
  } else if (meta.questionnaireId) {
    parts.push('Questionnaire-ID: ' + meta.questionnaireId);
  }
  metaLine.textContent = parts.length > 0 ? parts.join(' | ') : 'Keine Metadaten vorhanden.';
  if (meta.type === 'templateExtract' && meta.templateExtractSuccess === false) metaLine.classList.add('err');
  else metaLine.classList.remove('err');

  const resources = [];
  if (data?.questionnaireResponse) resources.push(data.questionnaireResponse);
  if (Array.isArray(data?.observations)) resources.push(...data.observations);
  if (data?.templateExtractBundle) resources.push(data.templateExtractBundle);
  if (data?.templateExtractIssues) resources.push(data.templateExtractIssues);
  if (data?.templateExtractOutcome) resources.push(data.templateExtractOutcome);
  if (data?.templateExtractDebugInfo) resources.push(data.templateExtractDebugInfo);
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
}

(function init() {
  const { data, error } = tryLoadPayload();
  const metaLine = $('metaLine');
  if (error) {
    // Fallback: auf postMessage vom opener warten (z. B. bei iframe/partitioniertem Storage)
    metaLine.textContent = 'Warte auf Exportdaten …';
    metaLine.classList.remove('err');
    let settled = false;
    const handler = (ev) => {
      try {
        if (!ev || !ev.data) return;
        if (ev.origin !== window.location.origin) return; // nur gleiches Origin akzeptieren
        if (ev.data?.type !== 'lhc-export') return;
        settled = true;
        window.removeEventListener('message', handler);
        const payload = ev.data?.payload;
        if (!payload) throw new Error('Keine Nutzdaten empfangen.');
        renderPayload(payload);
      } catch (e) {
        metaLine.textContent = 'Exportdaten konnten nicht empfangen werden: ' + (e?.message || e);
        metaLine.classList.add('err');
        $('emptyMsg').textContent = 'Keine Daten zum Anzeigen.';
      }
    };
    window.addEventListener('message', handler);
    // Optionales Timeout als Rückfallebene
    setTimeout(() => {
      if (settled) return;
      metaLine.textContent = error || 'Keine Daten gefunden.';
      metaLine.classList.add('err');
      $('emptyMsg').textContent = 'Keine Daten zum Anzeigen.';
    }, 5000);
    return;
  }
  renderPayload(data);
})();
