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

function setStatus(message, options = {}) {
  if (!statusEl) return;
  if (options.html) {
    statusEl.innerHTML = message;
  } else {
    statusEl.textContent = message;
  }
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
    const hasParams = Array.from(params.keys()).length > 0;
    if (!hasParams) {
      const launchUrl = `${window.location.origin}${window.location.pathname}`;
      setStatus(
        `Um den SMART App Launch zu testen, nutzen Sie bitte die <a href="https://launch.smarthealthit.org/" target="_blank" rel="noopener">SMART Health IT Sandbox</a> und geben Sie <a href="${launchUrl}" target="_blank" rel="noopener">${launchUrl}</a> als Launch URL an.`,
        { html: true },
      );
      showDetails(null);
      return;
    }
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
