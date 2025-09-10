// Shared pure helpers for testing and app use

// Build FHIR client for simple requests and patient-scoped searches
export function createFhirClient(base, ids = {}) {
  const normBase = (base || '').replace(/\/?$/,'');
  const makeAbs = (url) => {
    if (/^https?:/i.test(url)) return url;
    return normBase + '/' + String(url || '').replace(/^\//,'');
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
    if ((method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      if (!opts.headers['Content-Type'] && !opts.headers['content-type']) {
        opts.headers['Content-Type'] = 'application/fhir+json; fhirVersion=4.0';
      }
      if (opts.body && typeof opts.body !== 'string') {
        opts.body = JSON.stringify(opts.body);
      }
    } else if (method === 'GET') {
      delete opts.body;
    }
    opts.headers['Accept'] = 'application/fhir+json';
    const res = await fetch(u.toString(), opts);
    if (!res.ok) throw new Error('FHIR request failed: ' + res.status + ' ' + u.toString());
    return res.json();
  };
  const patientScopedRequest = async (arg) => {
    if (!ids.patient) return doRequest(arg);
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
  const getFhirVersion = async () => {
    try {
      const meta = await doRequest('metadata');
      return meta?.fhirVersion || '4.0.1';
    } catch {
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

export function getEffectivePrepopBase(vals) {
  return (vals.prepopBase || vals.fhirBase || '').trim() || null;
}

export function encodeForQueryPreservingSpecials(val) {
  return encodeURIComponent(val)
    .replace(/%3A/gi, ':')
    .replace(/%2F/gi, '/')
    .replace(/%7C/gi, '|');
}

export function collectModifierExtensionUrls(obj, acc = new Set()) {
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
      if (k === 'modifierExtension') continue;
      collectModifierExtensionUrls(obj[k], acc);
    }
  }
  return acc;
}

export function getPatientName(p){
  const names = Array.isArray(p?.name) ? p.name.map(n => [n.prefix, n.given, n.family].flat().filter(Boolean).join(' ')).filter(Boolean) : [];
  return names[0] || '(ohne Name)';
}
export function patientDetails(p){
  const rows=[]; if (p?.id) rows.push(['ID', p.id]); if (p?.birthDate) rows.push(['Geburtsdatum', p.birthDate]); if (p?.gender) rows.push(['Geschlecht', p.gender]);
  const idents = Array.isArray(p?.identifier) ? p.identifier.map(i => `${i.system||''}|${i.value||''}`).filter(Boolean) : [];
  if (idents.length) rows.push(['Identifier', idents.join(', ')]);
  return rows;
}
export function getQuestionnaireTitle(q){ return q?.title || q?.name || q?.id || '(Questionnaire)'; }
export function questionnaireDetails(q){ const rows=[]; if (q?.id) rows.push(['ID', q.id]); if (q?.version) rows.push(['Version', q.version]); if (q?.url) rows.push(['URL', q.url]); return rows; }

