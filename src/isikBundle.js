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

function resolveAuthorFromQR(qr) {
  // Use QR.author if present; otherwise we add a synthetic Organization as author
  if (qr && qr.author) {
    if (typeof qr.author === 'string') return { reference: qr.author };
    if (typeof qr.author === 'object') return { reference: qr.author.reference, display: qr.author.display };
  }
  return null;
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

  // Assign IDs where missing
  const compUUID = uuidv4();
  const qrUUID = uuidv4();
  const qrId = qr.id || qrUUID;
  if (!qr.id) qr.id = qrId;
  const obsIds = observations.map((o) => o?.id || uuidv4());

  // Author display only (no resource, no reference)
  let authorDisplay = 'LHC-Forms Demo App';
  if (qr && qr.author) {
    if (typeof qr.author === 'object') {
      authorDisplay = qr.author.display || qr.author.reference || authorDisplay;
    } else if (typeof qr.author === 'string') {
      authorDisplay = qr.author || authorDisplay;
    }
  }

  const subjectRef = resolveSubjectFromQR(qr);
  const encounterRef = resolveEncounterFromQR(qr);

  // Try to include Patient resource if QR.subject references a Patient/{id}
  let patientEntry = null;
  let patientRefInBundle = null;
  const subjRefStr = subjectRef?.reference || (typeof subjectRef === 'string' ? subjectRef : null);
  if (subjRefStr) {
    const m = subjRefStr.match(/(^|\/)Patient\/([^\/?#]+)/i);
    const pid = m && m[2];
    if (pid) {
      const patFullUrl = `Patient/${pid}`;
      patientEntry = {
        fullUrl: patFullUrl,
        resource: {
          resourceType: 'Patient',
          // Use the original Patient id from the reference
          id: pid,
          // Keep linkage to original id as identifier for traceability
          identifier: [{ system: 'urn:source-id', value: pid }]
        }
      };
      patientRefInBundle = { reference: patFullUrl };
    }
  }

  // Composition with sections pointing to QR and each Observation separately
  const compRef = `Composition/${compUUID}`;
  const qrRef = `QuestionnaireResponse/${qrId}`;
  const comp = {
    resourceType: 'Composition',
    id: compUUID,
    status: 'final',
    identifier: { system: 'urn:ietf:rfc:3986', value: `urn:uuid:${compUUID}` },
    meta: { profile: ['https://gematik.de/fhir/isik/StructureDefinition/ISiKBerichtSubSysteme'] },
    // Minimal type; ISiK profile would further constrain coding/system.
    type: {
      coding: [{ system: 'http://dvmd.de/fhir/CodeSystem/kdl', code: 'AM170103', display: 'Patientenfragebogen' }],
      text: 'AM170103 - Patientenfragebogen'
    },
    date: nowIso,
    title: 'ISiK Bericht',
    // Prefer internal reference to the Patient entry if available
    ...((patientRefInBundle || subjectRef) ? { subject: (patientRefInBundle || subjectRef) } : {}),
    ...(encounterRef ? { encounter: encounterRef } : {}),
    author: [ { display: authorDisplay } ],
    section: [
      { title: 'QuestionnaireResponse', text: buildQRNarrative(qr), entry: [ { reference: qrRef } ] },
      ...observations.map((obs, idx) => ({
        title: obsTitle(obs),
        text: buildObservationNarrative(obs),
        entry: [ { reference: `Observation/${obsIds[idx]}` } ]
      }))
    ]
  };

  // Add document header narrative to Composition.text (summary per ISiK guidance)
  try {
    const subjectRefStrForHeader = (patientRefInBundle?.reference || subjectRef?.reference || (typeof subjectRef === 'string' ? subjectRef : '')) || '';
    comp.text = buildCompositionNarrative(comp, {
      patient: patientEntry?.resource || null,
      subjectRefStr: subjectRefStrForHeader,
      authorDisplay
    });
  } catch {}

  // Bundle entries: Composition first, then QR, then Observations, plus author Organization if created
  const bundle = {
    resourceType: 'Bundle',
    type: 'document',
    timestamp: nowIso,
    identifier: { system: 'urn:ietf:rfc:3986', value: `urn:uuid:${uuidv4()}` },
    meta: {
      profile: ['https://gematik.de/fhir/isik/StructureDefinition/ISiKBerichtBundle']
    },
    entry: [
      { fullUrl: compRef, resource: comp },
      ...(patientEntry ? [patientEntry] : []),
      { fullUrl: qrRef, resource: qr },
      ...observations.map((obs, idx) => ({
        fullUrl: `Observation/${obsIds[idx]}`,
        resource: { ...(obs || {}), id: obsIds[idx] }
      }))
    ]
  };

  // Populate narrative text for QR and Observations (and optionally Composition)
  try {
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
  } catch {}
  observations.forEach((obs, i) => {
    try { obs.text = buildObservationNarrative(obs); } catch {}
  });

  return bundle;
}
