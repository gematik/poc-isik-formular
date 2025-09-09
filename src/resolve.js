// Simple resolver page: searches Patient/Account by identifier and Questionnaire by canonical

const $ = (id) => document.getElementById(id);
const statusEl = () => $('status');
const setStatus = (msg, cls) => { const s = statusEl(); if (!s) return; s.className = (cls||''); s.textContent = msg||''; };
let initialMinimal = undefined;
let initialBrowse = undefined;

function spGet(...names) {
  const sp = new URLSearchParams(window.location.search);
  for (const n of names) {
    const v = sp.get(n);
    if (v !== null && v !== '') return v;
  }
  return null;
}

function mergeParamsFromInputs() {
  const keys = ['base','prepopBase','pid','fid','qCanonical','patient','encounter','user','id','q','minimal'];
  const out = {};
  for (const k of keys) {
    const el = $(k);
    if (el && el.value.trim() !== '') out[k] = el.value.trim();
  }
  return out;
}

function reflectParamsToInputs(params) {
  const keys = ['base','prepopBase','pid','fid','qCanonical','patient','encounter','user','id','q'];
  for (const k of keys) {
    if ($(k) && params[k] !== undefined && params[k] !== null) $(k).value = String(params[k]);
  }
}

function readInitialParams() {
  const p = {
    base: spGet('base'),
    prepopBase: spGet('prepopBase'),
    pid: spGet('pid'),
    fid: spGet('fid'),
    qCanonical: spGet('qCanonical', 'canonical'),
    patient: spGet('patient'),
    encounter: spGet('encounter'),
    user: spGet('user'),
    id: spGet('id'),
    q: spGet('q', 'questionnaire'),
    minimal: (spGet('minimal')||'').toLowerCase() === 'true' ? 'true' : undefined,
  };
  initialMinimal = p.minimal;
  initialBrowse = spGet('browse');
  reflectParamsToInputs(p);
  return p;
}

function makeAbs(base, pathOrUrl) {
  if (!pathOrUrl) return base;
  if (/^https?:/i.test(pathOrUrl)) return pathOrUrl;
  const b = (base||'').replace(/\/?$/,'');
  const p = String(pathOrUrl).replace(/^\//,'');
  return `${b}/${p}`;
}

function collectParamsForShare() {
  // Build params from current input values; include minimal if present initially
  const vals = mergeParamsFromInputs();
  if (initialMinimal === 'true') vals.minimal = 'true';
  if (initialBrowse) vals.browse = initialBrowse;
  return vals;
}

function encodeForQueryPreservingSpecials(val) {
  // Encode, but keep ':' '/' and '|' readable; still encode '&' and '?' etc.
  return encodeURIComponent(val)
    .replace(/%3A/gi, ':')
    .replace(/%2F/gi, '/')
    .replace(/%7C/gi, '|');
}

function updateShareUrl() {
  const baseUrl = window.location.origin + window.location.pathname;
  const p = collectParamsForShare();
  const parts = [];
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== null && String(v) !== '') {
      parts.push(`${k}=${encodeForQueryPreservingSpecials(String(v))}`);
    }
  }
  const qs = parts.join('&');
  const full = qs ? `${baseUrl}?${qs}` : baseUrl;
  const out = $('shareUrl');
  if (out) out.value = full;
}

async function fetchFHIR(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/fhir+json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function bundleEntries(bundle) {
  if (!bundle || bundle.resourceType !== 'Bundle') return [];
  return (bundle.entry || []).map(e => e && (e.resource || e)).filter(Boolean);
}

function getPatientName(p) {
  const names = Array.isArray(p.name) ? p.name.map(n => [n.prefix, n.given, n.family].flat().filter(Boolean).join(' ')).filter(Boolean) : [];
  return names[0] || '(ohne Name)';
}
function patientDetails(p) {
  const rows = [];
  if (p.id) rows.push(['ID', p.id]);
  if (p.birthDate) rows.push(['Geburtsdatum', p.birthDate]);
  if (p.gender) rows.push(['Geschlecht', p.gender]);
  const idents = Array.isArray(p.identifier) ? p.identifier.map(i => `${i.system||''}|${i.value||''}`).filter(Boolean) : [];
  if (idents.length) rows.push(['Identifier', idents.join(', ')]);
  return rows;
}

function getAccountTitle(a) { return a.name || a.description || '(Account)'; }
function accountDetails(a) {
  const rows = [];
  if (a.id) rows.push(['ID', a.id]);
  if (a.status) rows.push(['Status', a.status]);
  const idents = Array.isArray(a.identifier) ? a.identifier.map(i => `${i.system||''}|${i.value||''}`).filter(Boolean) : [];
  if (idents.length) rows.push(['Identifier', idents.join(', ')]);
  return rows;
}

function getQuestionnaireTitle(q) { return q.title || q.name || q.id || '(Questionnaire)'; }
function questionnaireDetails(q) {
  const rows = [];
  if (q.id) rows.push(['ID', q.id]);
  if (q.version) rows.push(['Version', q.version]);
  if (q.url) rows.push(['URL', q.url]);
  if (q.description) rows.push(['Beschreibung', { html: mdToHtml(String(q.description)), markdown: true, block: true }]);
  return rows;
}

function renderChoices(containerId, title, items, onSelect, kind) {
  const container = $(containerId);
  if (!container) return;
  container.replaceChildren();
  if (!items || items.length === 0) return;
  const heading = document.createElement('div');
  heading.className = 'result-title';
  heading.textContent = `${title} – mehrere Treffer, bitte wählen:`;
  container.appendChild(heading);
  const toHeaderAndRows = (res) => {
    if (kind === 'Patient') return [getPatientName(res), patientDetails(res)];
    if (kind === 'Account') return [getAccountTitle(res), accountDetails(res)];
    return [getQuestionnaireTitle(res), questionnaireDetails(res)];
  };
  items.forEach((res) => {
    const [hdr, rows] = toHeaderAndRows(res);
    const card = document.createElement('div');
    card.className = 'pick-panel';
    card.setAttribute('role','button');
    card.setAttribute('tabindex','0');
    const h3 = document.createElement('h3');
    h3.textContent = hdr;
    const inner = document.createElement('div');
    inner.className = 'inner';
    const kv = document.createElement('div');
    kv.className = 'kv';
    rows.forEach(([k,v]) => {
      const isBlock = v && typeof v === 'object' && v.block;
      const kEl = document.createElement('div'); kEl.className = 'k' + (isBlock ? ' block' : ''); kEl.textContent = k;
      const vEl = document.createElement('div'); vEl.className = 'v' + (isBlock ? ' block' : '');
      if (v && typeof v === 'object' && v.html) {
        vEl.classList.add('markdown');
        if (v.markdown) vEl.classList.add('desc');
        vEl.innerHTML = v.html;
      } else {
        vEl.textContent = String(v ?? '');
      }
      if (isBlock) {
        // key on its own row, value below (full width)
        kv.appendChild(kEl);
        kv.appendChild(vEl);
      } else {
        kv.appendChild(kEl);
        kv.appendChild(vEl);
      }
    });
    inner.appendChild(kv);
    card.appendChild(h3);
    card.appendChild(inner);
    card.onclick = () => onSelect(res);
    card.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(res); } };
    container.appendChild(card);
  });
}

function clearResultContainers() {
  ['patientResults','accountResults','questionnaireResults'].forEach(id => { const el = $(id); if (el) el.replaceChildren(); });
}

function buildRedirectUrl(paramsOut) {
  const target = new URL('index.html', window.location.href);
  const sp = new URLSearchParams();
  // Prefer passing base+id when we have an id; otherwise q
  if (paramsOut.q) sp.set('q', paramsOut.q);
  if (paramsOut.base) sp.set('base', paramsOut.base);
  if (paramsOut.id) sp.set('id', paramsOut.id);
  if (paramsOut.prepopBase) sp.set('prepopBase', paramsOut.prepopBase);
  if (paramsOut.patient) sp.set('patient', paramsOut.patient);
  if (paramsOut.encounter) sp.set('encounter', paramsOut.encounter);
  if (paramsOut.user) sp.set('user', paramsOut.user);
  // Pass through account if resolved; index.html currently ignores it but it is useful downstream
  if (paramsOut.account) sp.set('account', paramsOut.account);
  if (paramsOut.minimal === 'true') sp.set('minimal', 'true');
  target.search = sp.toString();
  return target.toString();
}

async function runResolution(params) {
  clearResultContainers();
  const base = params.base;
  const patientSearchBase = params.prepopBase || params.base;
  if (!base && !patientSearchBase) { setStatus('Bitte FHIR Base angeben.', 'err'); return; }

  setStatus('Suche wird ausgeführt …');
  // Outputs we may resolve
  const out = { ...params };

  // Short-circuit: if q is already present, skip qCanonical
  const needQ = !out.q && !out.id && !!out.qCanonical;
  const needPatient = !out.patient && !!out.pid;
  const needAccount = !!out.fid; // always resolve account if fid present, even if account not used by index
  const browseAllQs = (initialBrowse && String(initialBrowse).toLowerCase().startsWith('q')) || (!needQ && !needPatient && !needAccount && initialBrowse && String(initialBrowse).toLowerCase() !== 'patient');
  const browseAllPatients = (initialBrowse && String(initialBrowse).toLowerCase().startsWith('p'));

  // Prepare searches
  const tasks = [];

  if (needPatient) {
    const url = makeAbs(base, `Patient?identifier=${encodeURIComponent(out.pid)}`);
    tasks.push(fetchFHIR(url).then(bundle => ({ key: 'patient', bundle })).catch(e => ({ key: 'patient', error: e })));
  }

  if (needAccount) {
    const url = makeAbs(base, `Account?identifier=${encodeURIComponent(out.fid)}`);
    tasks.push(fetchFHIR(url).then(bundle => ({ key: 'account', bundle })).catch(e => ({ key: 'account', error: e })));
  }

  if (needQ) {
    // qCanonical might include |version; split accordingly
    let urlParam = out.qCanonical;
    let versionParam = null;
    if (urlParam.includes('|')) {
      const [u, v] = urlParam.split('|');
      urlParam = u; versionParam = v;
    }
    const search = versionParam ? `Questionnaire?url=${encodeURIComponent(urlParam)}&version=${encodeURIComponent(versionParam)}`
                                : `Questionnaire?url=${encodeURIComponent(urlParam)}`;
    const url = makeAbs(base, search);
    tasks.push(fetchFHIR(url).then(bundle => ({ key: 'questionnaire', bundle })).catch(e => ({ key: 'questionnaire', error: e })));
  }

  if (browseAllQs) {
    const search = `Questionnaire?_count=100&_elements=id,title,name,version,description,url`;
    const url = makeAbs(base, search);
    tasks.push(fetchAllPages(url).then(items => ({ key: 'questionnaireAll', items })).catch(e => ({ key: 'questionnaireAll', error: e })));
  }

  if (browseAllPatients) {
    const search = `Patient?_count=100&_elements=id,name,birthDate,gender,identifier`;
    const eff = patientSearchBase || base;
    const url = makeAbs(eff, search);
    tasks.push(fetchAllPages(url).then(items => ({ key: 'patientAll', items })).catch(e => ({ key: 'patientAll', error: e })));
  }

  const results = await Promise.all(tasks);

  let needUserChoice = false;

  for (const r of results) {
    if (r.error) {
      setStatus(`Fehler bei ${r.key}-Suche: ${r.error.message}`, 'err');
      return;
    }
    const items = bundleEntries(r.bundle);
    if (r.key === 'patient') {
      if (items.length === 0) { setStatus('Kein Patient für pid gefunden.', 'err'); return; }
      if (items.length === 1) {
        out.patient = items[0].id;
      } else {
        needUserChoice = true;
        renderChoices('patientResults', 'Patient', items, (sel) => { out.patient = sel.id; attemptRedirect(out); }, 'Patient');
      }
    }
    if (r.key === 'account') {
      if (items.length === 0) { setStatus('Kein Account für fid gefunden.', 'err'); return; }
      if (items.length === 1) {
        out.account = items[0].id;
      } else {
        needUserChoice = true;
        renderChoices('accountResults', 'Account', items, (sel) => { out.account = sel.id; attemptRedirect(out); }, 'Account');
      }
    }
    if (r.key === 'questionnaire') {
      if (items.length === 0) { setStatus('Kein Questionnaire für qCanonical gefunden.', 'err'); return; }
      if (items.length === 1) {
        out.id = items[0].id;
      } else {
        needUserChoice = true;
        renderChoices('questionnaireResults', 'Questionnaire', items, (sel) => { out.id = sel.id; attemptRedirect(out); }, 'Questionnaire');
      }
    }
    if (r.key === 'questionnaireAll') {
      if (r.error) { setStatus(`Fehler beim Laden aller Questionnaires: ${r.error.message}`, 'err'); return; }
      const items = r.items || [];
      if (items.length === 0) { setStatus('Keine Questionnaires gefunden.', 'err'); return; }
      needUserChoice = true;
      renderChoices('questionnaireResults', 'Questionnaires', items, (sel) => { out.id = sel.id; attemptRedirect(out); }, 'Questionnaire');
    }
    if (r.key === 'patientAll') {
      if (r.error) { setStatus(`Fehler beim Laden aller Patienten: ${r.error.message}`, 'err'); return; }
      const items = r.items || [];
      if (items.length === 0) { setStatus('Keine Patienten gefunden.', 'err'); return; }
      needUserChoice = true;
      renderChoices('patientResults', 'Patienten', items, (sel) => { out.patient = sel.id; attemptRedirect(out); }, 'Patient');
    }
  }

  if (!needUserChoice) {
    attemptRedirect(out);
  } else {
    setStatus('Bitte eine Auswahl treffen, dann wird weitergeleitet …', 'ok');
  }
}

function attemptRedirect(out) {
  // We redirect when nothing remains unresolved among requested lookups
  const unresolved = [];
  if (out.pid && !out.patient) unresolved.push('patient');
  if (out.fid && !out.account) unresolved.push('account');
  if (out.qCanonical && !out.q && !out.id) unresolved.push('questionnaire');
  if (unresolved.length > 0) return; // wait for user selection(s)

  // If we resolved an id but base is present, prefer base+id path
  if (out.id && out.base) {
    out.q = undefined; // not needed
  } else if (!out.id && out.q) {
    // keep q
  } else if (out.id && !out.base) {
    // We cannot construct a Questionnaire URL without a base
    setStatus('Questionnaire-ID vorhanden, aber kein base-Parameter. Bitte base setzen.', 'err');
    return;
  }

  const url = buildRedirectUrl(out);
  setStatus('Weiterleitung zur Formular-Seite …', 'ok');
  window.location.assign(url);
}

// Wire up UI and init
(function init() {
  const params = readInitialParams();
  // Initialize share URL
  updateShareUrl();

  // Update share URL whenever inputs change
  ['base','prepopBase','pid','fid','qCanonical','patient','encounter','user','id','q']
    .forEach(id => { const node = $(id); if (node) node.addEventListener('input', updateShareUrl); });

  // Copy button
  const btnCopy = $('btnCopyUrl');
  if (btnCopy) {
    btnCopy.onclick = async () => {
      try {
        const val = $('shareUrl')?.value || '';
        if (!val) return setStatus('Kein Link vorhanden.', 'err');
        await navigator.clipboard.writeText(val);
        setStatus('Link kopiert.', 'ok');
      } catch (e) {
        setStatus('Kopieren fehlgeschlagen.', 'err');
      }
    };
  }
  $('btnRun').onclick = async () => {
    try {
      const merged = { ...params, ...mergeParamsFromInputs() };
      // normalize empties to undefined
      Object.keys(merged).forEach(k => { if (merged[k] === '') delete merged[k]; });
      await runResolution(merged);
    } catch (e) { setStatus(e.message, 'err'); }
  };

  // If base present and at least one of pid/fid/qCanonical present, run immediately
  if (params.base && (params.pid || params.fid || params.qCanonical || initialBrowse)) {
    runResolution(params);
  } else {
    setStatus('Parameter prüfen und ggf. „Suchen“ klicken …');
  }
})();

// --- Minimal Markdown renderer (safe subset) -----------------------------
function escapeHtml(s) { return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function mdToHtml(md) {
  if (!md) return '';
  let s = String(md).replace(/\r\n/g, '\n');
  s = escapeHtml(s);
  // Links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => {
    try {
      const safeUrl = /^https?:/i.test(u) ? u : '#';
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${t}</a>`;
    } catch { return t; }
  });
  // Bold **text** or __text__
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // Italic *text* or _text_
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>').replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
  // Inline code `code`
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Simple headings: # H -> bold line
  s = s.replace(/^#{1,6}\s*(.+)$/gm, '<strong>$1</strong>');
  // Line breaks
  s = s.replace(/\n/g, '<br>');
  return s;
}
async function fetchAllPages(firstUrl, cap = 1000) {
  const items = [];
  let url = firstUrl;
  let guard = 0;
  while (url && guard < cap) {
    const bundle = await fetchFHIR(url);
    items.push(...bundleEntries(bundle));
    const next = (bundle.link || []).find(l => l.relation === 'next')?.url;
    url = next ? makeAbs(new URL(firstUrl).origin, next) : null;
    guard += 1;
  }
  return items;
}
