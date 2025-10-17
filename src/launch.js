import {
  SMART_DEFAULTS,
  buildAuthorizeRequest,
  clearPendingLaunch,
  clearSmartSession,
  getDefaultRedirectUri,
  normalizeRedirectUri,
  savePendingLaunch,
} from './lib/smart.js';

const statusEl = document.getElementById('status');
const detailsEl = document.getElementById('details');

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

function showDetails(obj) {
  if (!detailsEl) return;
  if (obj) {
    detailsEl.hidden = false;
    detailsEl.textContent = JSON.stringify(obj, null, 2);
  } else {
    detailsEl.hidden = true;
    detailsEl.textContent = '';
  }
}

function fail(message, extra) {
  setStatus(message);
  showDetails(extra);
  document.body.classList.add('error');
}

async function run() {
  try {
    clearPendingLaunch();
    clearSmartSession();

    const params = new URLSearchParams(window.location.search);
    const iss = params.get('iss')?.trim();
    if (!iss) {
      throw new Error('SMART launch parameter "iss" fehlt in der URL.');
    }
    const launch = params.get('launch')?.trim() || null;
    const clientId = params.get('client_id')?.trim() || SMART_DEFAULTS.clientId;
    if (!clientId) {
      throw new Error('SMART client_id ist nicht konfiguriert (Parameter client_id oder SMART_DEFAULTS).');
    }
    const scope = params.get('scope')?.trim() || SMART_DEFAULTS.scope;
    if (!scope) {
      throw new Error('SMART scope ist nicht konfiguriert (Parameter scope oder SMART_DEFAULTS).');
    }
    const redirectOverride = params.get('redirect_uri')?.trim();
    const redirectUri = redirectOverride ? normalizeRedirectUri(redirectOverride) : getDefaultRedirectUri();

    setStatus('SMART Konfiguration wird geladen ...');
    showDetails({ iss, launch, clientId, scope, redirectUri });

    const { authorizationUrl, pending } = await buildAuthorizeRequest({
      iss,
      launch,
      clientId,
      scope,
      redirectUri,
    });

    savePendingLaunch({
      ...pending,
      pkceMethod: 'S256',
    });

    setStatus('Weiterleitung zum Authorization Server ...');
    showDetails(null);
    window.location.assign(authorizationUrl);
  } catch (err) {
    console.error('SMART launch failed', err);
    fail(err?.message || String(err), {
      stack: err?.stack,
    });
  }
}

run();
