/*
*
* Copyright 2026 gematik GmbH
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

// Constructs an ISiK-style BerichtsBundle (FHIR R4 Document Bundle)
// Includes a Composition referencing the QuestionnaireResponse and Observations.
// Returns a FHIR Bundle resource.

function uuidv4() {
  // RFC4122-ish v4 UUID without external deps
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function asArray(x) { return Array.isArray(x) ? x : (x == null ? [] : [x]); }

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function narrative(divInnerHtml) {
  return { status: 'extensions', div: `<div xmlns="http://www.w3.org/1999/xhtml">${divInnerHtml}</div>` };
}

function codingDisplay(coding) {
  if (!coding) return '';
  const c = Array.isArray(coding) ? coding[0] : coding;
  return c?.display || c?.code || '';
}

function firstFamilyName(p) {
  const names = Array.isArray(p?.name) ? p.name : [];
  const first = names[0];
  return first?.family || '';
}

function findPid(p) {
  const idents = Array.isArray(p?.identifier) ? p.identifier : [];
  // Prefer identifier where type.coding contains code 'pid'
  for (const id of idents) {
    const codings = id?.type?.coding || [];
    if (codings.some(c => (c.code || '').toLowerCase() === 'pid')) {
      return id.value || '';
    }
  }
  // Next: system that looks like pid
  for (const id of idents) {
    if ((id.system || '').toLowerCase().includes('pid')) return id.value || '';
  }
  // Fallback: first identifier value
  if (idents.length) return idents[0].value || '';
  return '';
}

function buildCompositionNarrative(comp, opts) {
  const patient = opts?.patient || null;
  const subjectRefStr = opts?.subjectRefStr || '';
  const authorDisplay = opts?.authorDisplay || '';

  const patientFamily = patient ? firstFamilyName(patient) : '';
  const patientBirthDate = patient?.birthDate || '';
  let pid = patient ? findPid(patient) : '';
  if (!pid && subjectRefStr) {
    const m = subjectRefStr.match(/(^|\/)Patient\/([^\/?#]+)/i);
    pid = (m && m[2]) || '';
  }

  const rows = [
    `<tr><th>Patient (Familienname)</th><td>${esc(patientFamily)}</td></tr>`,
    `<tr><th>Geburtsdatum</th><td>${esc(patientBirthDate)}</td></tr>`,
    `<tr><th>Patienten-ID (pid)</th><td>${esc(pid)}</td></tr>`,
    `<tr><th>Status</th><td>${esc(comp.status || '')}</td></tr>`,
    `<tr><th>Dokumenttyp</th><td>${esc(comp.type?.text || '')}</td></tr>`,
    `<tr><th>Datum</th><td>${esc(comp.date || '')}</td></tr>`,
    `<tr><th>Titel</th><td>${esc(comp.title || '')}</td></tr>`,
    `<tr><th>Autor</th><td>${esc(authorDisplay)}</td></tr>`
  ].join('');

  const html = `
    <h2>Dokumenten-Header</h2>
    <table class="grid">${rows}</table>
  `;
  return narrative(html);
}

function isNumericString(s) {
  return typeof s === 'string' && /^-?\d+(?:[\.,]\d+)?(?:[eE][+-]?\d+)?$/.test(s.trim());
}

function normalizeQuantity(q) {
  if (!q) return;
  if (isNumericString(q.value)) {
    // Replace comma decimal separator if present
    const norm = q.value.replace(',', '.');
    const num = Number(norm);
    if (!Number.isNaN(num)) q.value = num;
  }
}

function normalizeObservation(obs) {
  if (!obs || obs.resourceType !== 'Observation') return obs;
  // Remove linkage that is not desired in ISiK export
  if (Object.prototype.hasOwnProperty.call(obs, 'derivedFrom')) {
    try { delete obs.derivedFrom; } catch {}
  }
  if (obs.valueQuantity) normalizeQuantity(obs.valueQuantity);
  if (Array.isArray(obs.component)) {
    obs.component.forEach(c => { if (c.valueQuantity) normalizeQuantity(c.valueQuantity); });
  }
  return obs;
}

function addQuestionnaireDisplayExtension(qr, title) {
  if (!qr || !title) return;
  const ext = { url: 'http://hl7.org/fhir/StructureDefinition/display', valueString: String(title) };
  qr._questionnaire = qr._questionnaire || {};
  const current = Array.isArray(qr._questionnaire.extension) ? qr._questionnaire.extension : [];
  const idx = current.findIndex(e => e && e.url === ext.url);
  if (idx >= 0) current[idx] = { ...current[idx], valueString: ext.valueString };
  else current.push(ext);
  qr._questionnaire.extension = current;
}

function hasTopLevelValue(obs) {
  if (!obs) return false;
  return (
    obs.valueString != null ||
    obs.valueBoolean != null ||
    obs.valueInteger != null ||
    obs.valueDecimal != null ||
    obs.valueCodeableConcept != null ||
    obs.valueQuantity != null ||
    obs.valueDateTime != null ||
    obs.valueDate != null ||
    obs.valueTime != null
  );
}

function obsTitle(obs) {
  return obs?.code?.text || codingDisplay(obs?.code?.coding) || `Observation ${obs?.id || ''}`.trim();
}

function fmtQuantity(q) {
  if (!q) return '';
  const val = q.value != null ? q.value : '';
  const unit = q.unit || q.code || q.system || '';
  return `${val} ${unit}`.trim();
}

function fmtObsValue(obs) {
  if (!obs) return '';
  if (obs.valueString != null) return esc(obs.valueString);
  if (obs.valueBoolean != null) return obs.valueBoolean ? 'ja' : 'nein';
  if (obs.valueInteger != null) return String(obs.valueInteger);
  if (obs.valueDecimal != null) return String(obs.valueDecimal);
  if (obs.valueCodeableConcept) return esc(obs.valueCodeableConcept.text || codingDisplay(obs.valueCodeableConcept.coding));
  if (obs.valueQuantity) return esc(fmtQuantity(obs.valueQuantity));
  if (obs.valueDateTime) return esc(obs.valueDateTime);
  if (obs.valueDate) return esc(obs.valueDate);
  if (obs.valueTime) return esc(obs.valueTime);
  return '';
}

function buildObservationNarrative(obs) {
  const title = esc(obsTitle(obs));
  const eff = obs.effectiveDateTime || obs.effectivePeriod?.start || '';
  const performer = (obs.performer && obs.performer[0]?.display) || '';
  const value = fmtObsValue(obs);
  const rows = [
    value ? `<tr><th>Wert</th><td>${esc(value)}</td></tr>` : '',
    eff ? `<tr><th>Erhoben am</th><td>${esc(eff)}</td></tr>` : '',
    performer ? `<tr><th>Erhoben von</th><td>${esc(performer)}</td></tr>` : ''
  ].filter(Boolean).join('');
  const html = `
    <h2>${title}</h2>
    <table class="grid">
      ${rows || '<tr><td colspan="2">(keine Details)</td></tr>'}
    </table>
  `;
  return narrative(html);
}

function formatQRAnswer(ans) {
  if (!ans) return '';
  if (ans.valueString != null) return esc(ans.valueString);
  if (ans.valueBoolean != null) return ans.valueBoolean ? 'ja' : 'nein';
  if (ans.valueInteger != null) return String(ans.valueInteger);
  if (ans.valueDecimal != null) return String(ans.valueDecimal);
  if (ans.valueDate) return esc(ans.valueDate);
  if (ans.valueDateTime) return esc(ans.valueDateTime);
  if (ans.valueTime) return esc(ans.valueTime);
  if (ans.valueCoding) return esc(ans.valueCoding.display || ans.valueCoding.code || '');
  if (ans.valueQuantity) return esc(fmtQuantity(ans.valueQuantity));
  if (ans.valueReference) return esc(ans.valueReference.display || ans.valueReference.reference || '');
  return '';
}

function walkQRItems(items, out) {
  if (!Array.isArray(items)) return;
  items.forEach(it => {
    const label = esc(it.text || it.linkId || '');
    const ans = (it.answer || []).map(a => formatQRAnswer(a)).filter(Boolean).join(', ');
    if (label || ans) out.push(`<li><strong>${label}:</strong> ${ans || '—'}</li>`);
    if (it.item) walkQRItems(it.item, out);
  });
}

function buildQRNarrative(qr) {
  const info = [
    qr.status ? `<tr><th>Status</th><td>${esc(qr.status)}</td></tr>` : '',
    qr.authored ? `<tr><th>Erstellt</th><td>${esc(qr.authored)}</td></tr>` : '',
    (qr.subject?.display || qr.subject?.reference) ? `<tr><th>Patient</th><td>${esc(qr.subject.display || qr.subject.reference)}</td></tr>` : ''
  ].filter(Boolean).join('');
  const items = [];
  walkQRItems(qr.item, items);
  const html = `
    <h2>Fragebogen</h2>
    <table class="grid">${info}</table>
    ${items.length ? `<ul>${items.join('')}</ul>` : '<div>(keine Antworten)</div>'}
  `;
  return narrative(html);
}

function resolveSubjectFromQR(qr) {
  // Prefer QR.subject as-is; fall back to contained subject if present
  if (qr && qr.subject && typeof qr.subject === 'object') return { reference: qr.subject.reference, display: qr.subject.display };
  if (qr && typeof qr.subject === 'string') return { reference: qr.subject };
  return undefined;
}

function resolveEncounterFromQR(qr) {
  if (qr && qr.encounter && typeof qr.encounter === 'object') return { reference: qr.encounter.reference, display: qr.encounter.display };
  if (qr && typeof qr.encounter === 'string') return { reference: qr.encounter };
  return undefined;
}

export function buildIsikBerichtsBundle(input) {
  const qr = input?.questionnaireResponse;
  const observations = asArray(input?.observations)
    .filter(Boolean)
    .map(normalizeObservation)
    // Keep only leaf observations with a direct value[x] to avoid panel duplications
    .filter(hasTopLevelValue);
  if (!qr || qr.resourceType !== 'QuestionnaireResponse') return null;

  const nowIso = (input?.meta?.generatedAt) || new Date().toISOString();
  const fhirBase = (input?.fhirBase || '').replace(/\/$/, '');

  // --- Generate all UUIDs upfront ---
  const compUUID = uuidv4();
  const qrUUID = uuidv4();
  const obsUUIDs = observations.map(() => uuidv4());
  const patientUUID = uuidv4();
  const encounterResource = input?.encounter || null;

  // Assign QR id
  if (!qr.id) qr.id = qrUUID;

  // --- Author display ---
  let authorDisplay = 'LHC-Forms Demo App';
  if (qr && qr.author) {
    if (typeof qr.author === 'object') {
      authorDisplay = qr.author.display || qr.author.reference || authorDisplay;
    } else if (typeof qr.author === 'string') {
      authorDisplay = qr.author || authorDisplay;
    }
  }

  // --- Patient entry ---
  // fullUrl: absolute if real resource available, urn:uuid if stub
  // resource.id: always a fresh UUID; original server ID preserved in identifier
  let patientEntry = null;
  let patientRef = null;

  const patientResource = input?.patient || null;
  const subjRefStr = (() => {
    const s = resolveSubjectFromQR(qr);
    return s?.reference || (typeof s === 'string' ? s : null) || null;
  })();

  if (patientResource && patientResource.resourceType === 'Patient' && patientResource.id && fhirBase) {
    // Real patient from FHIR context — keep original server ID
    const patFullUrl = `${fhirBase}/Patient/${patientResource.id}`;
    patientEntry = {
      fullUrl: patFullUrl,
      resource: { ...patientResource }
    };
    patientRef = { reference: patFullUrl };
  } else {
    // Stub: extract patient ID from QR.subject.reference
    const m = subjRefStr?.match(/(^|\/)Patient\/([^\/?#]+)/i);
    const pid = m && m[2];
    if (pid) {
      patientEntry = {
        fullUrl: `urn:uuid:${patientUUID}`,
        resource: {
          resourceType: 'Patient',
          id: patientUUID,
          identifier: [{ system: 'urn:source-id', value: pid }]
        }
      };
      patientRef = { reference: `urn:uuid:${patientUUID}` };
    }
  }

  // --- Encounter entry ---
  let encounterEntry = null;
  let encounterRef = null;

  if (encounterResource && encounterResource.resourceType === 'Encounter' && encounterResource.id && fhirBase) {
    const encFullUrl = `${fhirBase}/Encounter/${encounterResource.id}`;
    encounterEntry = {
      fullUrl: encFullUrl,
      resource: {
        resourceType: 'Encounter',
        id: encounterResource.id,
        ...(Array.isArray(encounterResource.identifier) && encounterResource.identifier.length ? { identifier: encounterResource.identifier } : {}),
        // Strip account.reference — referenced Account resources are not in the bundle.
        // Keep account.identifier to preserve the Fallnummer.
        ...(encounterResource.account?.length ? {
          account: encounterResource.account.map(({ reference: _ref, ...rest }) => rest).filter(a => Object.keys(a).length > 0)
        } : {}),
        status: encounterResource.status || 'unknown',
        class: encounterResource.class || { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP' }
      }
    };
    encounterRef = { reference: encFullUrl };
  }

  // --- Composition ---
  const compFullUrl = `urn:uuid:${compUUID}`;
  const qrFullUrl = `urn:uuid:${qrUUID}`;

  const comp = {
    resourceType: 'Composition',
    id: compUUID,
    status: 'final',
    identifier: { system: 'urn:ietf:rfc:3986', value: `urn:uuid:${compUUID}` },
    meta: { profile: ['https://gematik.de/fhir/isik/StructureDefinition/ISiKBerichtSubSysteme'] },
    type: {
      coding: [{ system: 'http://dvmd.de/fhir/CodeSystem/kdl', code: 'AM170103', display: 'Patientenfragebogen' }],
      text: 'AM170103 - Patientenfragebogen'
    },
    date: nowIso,
    title: input?.meta?.questionnaireTitle || 'ISiK Bericht',
    ...(patientRef ? { subject: patientRef } : {}),
    ...(encounterRef ? { encounter: encounterRef } : {}),
    author: [ { display: authorDisplay } ],
    section: [
      { title: 'QuestionnaireResponse', text: buildQRNarrative(qr), entry: [ { reference: qrFullUrl } ] },
      ...observations.map((obs, idx) => ({
        title: obsTitle(obs),
        text: buildObservationNarrative(obs),
        entry: [ { reference: `urn:uuid:${obsUUIDs[idx]}` } ]
      }))
    ]
  };

  // Add document header narrative to Composition.text
  try {
    comp.text = buildCompositionNarrative(comp, {
      patient: patientEntry?.resource || null,
      subjectRefStr: subjRefStr || '',
      authorDisplay
    });
  } catch {}

  // --- Prepare QR before bundle construction so the spread picks up all properties ---
  try {
    // Ensure authored is set (ISiKFormularDaten: 1..1)
    if (!qr.authored) qr.authored = nowIso;
    qr.text = buildQRNarrative(qr);
    // Add display extension to QuestionnaireResponse.questionnaire using meta.questionnaireTitle when available
    const qTitleFromMeta = input?.meta?.questionnaireTitle;
    if (qTitleFromMeta) addQuestionnaireDisplayExtension(qr, qTitleFromMeta);
    // Ensure QR carries ISiK profile
    qr.meta = qr.meta || {};
    const prof = Array.isArray(qr.meta.profile) ? qr.meta.profile.slice() : [];
    if (!prof.includes('https://gematik.de/fhir/isik/StructureDefinition/ISiKFormularDaten')) {
      prof.push('https://gematik.de/fhir/isik/StructureDefinition/ISiKFormularDaten');
    }
    qr.meta.profile = prof;
    // Use absolute subject/encounter references where available
    if (patientRef) qr.subject = patientRef;
    if (encounterRef) qr.encounter = encounterRef;
  } catch {}
  observations.forEach((obs) => {
    try { obs.text = buildObservationNarrative(obs); } catch {}
  });

  // --- Bundle ---
  const bundle = {
    resourceType: 'Bundle',
    type: 'document',
    timestamp: nowIso,
    identifier: { system: 'urn:ietf:rfc:3986', value: `urn:uuid:${uuidv4()}` },
    meta: {
      profile: ['https://gematik.de/fhir/isik/StructureDefinition/ISiKBerichtBundle']
    },
    entry: [
      { fullUrl: compFullUrl, resource: comp },
      ...(patientEntry ? [patientEntry] : []),
      ...(encounterEntry ? [encounterEntry] : []),
      { fullUrl: qrFullUrl, resource: { ...qr, id: qrUUID } },
      ...observations.map((obs, idx) => ({
        fullUrl: `urn:uuid:${obsUUIDs[idx]}`,
        resource: { ...(obs || {}), id: obsUUIDs[idx] }
      }))
    ]
  };

  return bundle;
}
