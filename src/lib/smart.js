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

// Utilities and helpers for SMART on FHIR App Launch

const STORAGE_KEYS = {
  pending: 'smart:pending',
  session: 'smart:session',
};

export const SMART_DEFAULTS = {
  clientId: 'my_web_app',
  scope: 'launch launch/patient openid profile fhirUser patient/Patient.read patient/Encounter.read patient/Questionnaire.read patient/QuestionnaireResponse.read patient/Observation.read',
};

export function resolveAppPath(path) {
  const current = window.location;
  const basePath = current.pathname.replace(/\/[^/]*$/, '/');
  return new URL(path, `${current.origin}${basePath}`).toString();
}

export function getDefaultRedirectUri() {
  return resolveAppPath('index.html');
}

function safeJsonParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function savePendingLaunch(data) {
  sessionStorage.setItem(STORAGE_KEYS.pending, JSON.stringify(data));
}

export function readPendingLaunch() {
  return safeJsonParse(sessionStorage.getItem(STORAGE_KEYS.pending));
}

export function clearPendingLaunch() {
  sessionStorage.removeItem(STORAGE_KEYS.pending);
}

export function saveSmartSession(data) {
  sessionStorage.setItem(STORAGE_KEYS.session, JSON.stringify(data));
}

export function readSmartSession() {
  return safeJsonParse(sessionStorage.getItem(STORAGE_KEYS.session));
}

export function clearSmartSession() {
  sessionStorage.removeItem(STORAGE_KEYS.session);
}

function base64UrlEncode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function randomUrlSafeString(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  window.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function createPkcePair() {
  const verifier = randomUrlSafeString(64);
  const data = new TextEncoder().encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  const challenge = base64UrlEncode(digest);
  return { verifier, challenge };
}

function normalizeIss(iss) {
  if (!iss) return '';
  return iss.replace(/\/+$/, '');
}

function toAbsoluteUrl(url, base) {
  if (!url) return url;
  try {
    return new URL(url, base).toString();
  } catch (err) {
    throw new Error(`Ungueltige URL in SMART-Konfiguration: ${url}`);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} beim Laden von ${url}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function discoverSmartConfiguration(iss) {
  const normalizedIss = normalizeIss(iss);
  if (!normalizedIss) {
    throw new Error('FHIR Basis-URL (iss) fehlt.');
  }
  const base = `${normalizedIss}/`;
  const wellKnownUrl = `${normalizedIss}/.well-known/smart-configuration`;
  try {
    const wellKnown = await fetchJson(wellKnownUrl, { headers: { Accept: 'application/json' } });
    if (!wellKnown.authorization_endpoint || !wellKnown.token_endpoint) {
      throw new Error('SMART-Konfiguration unvollstaendig (authorize/token fehlen).');
    }
    return {
      source: 'well-known',
      configurationUrl: wellKnownUrl,
      authorization_endpoint: toAbsoluteUrl(wellKnown.authorization_endpoint, base),
      token_endpoint: toAbsoluteUrl(wellKnown.token_endpoint, base),
      registration_endpoint: wellKnown.registration_endpoint ? toAbsoluteUrl(wellKnown.registration_endpoint, base) : undefined,
      introspection_endpoint: wellKnown.introspection_endpoint ? toAbsoluteUrl(wellKnown.introspection_endpoint, base) : undefined,
      revocation_endpoint: wellKnown.revocation_endpoint ? toAbsoluteUrl(wellKnown.revocation_endpoint, base) : undefined,
    };
  } catch (err) {
    if (err.status && err.status !== 404) throw err;
  }

  const metadataUrl = `${normalizedIss}/metadata`;
  const capability = await fetchJson(metadataUrl, { headers: { Accept: 'application/fhir+json' } });
  const rest = Array.isArray(capability.rest) ? capability.rest.find((r) => r.mode === 'server') : null;
  const security = rest?.security;
  const smartExt = security?.extension?.find((ext) => ext.url === 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris');
  if (!smartExt?.extension) {
    throw new Error('FHIR CapabilityStatement enthaelt keine SMART OAuth-Informationen.');
  }
  const endpoints = {};
  for (const entry of smartExt.extension) {
    if (!entry?.url) continue;
    if (entry.url === 'authorize') endpoints.authorization_endpoint = entry.valueUri || entry.valueUrl;
    if (entry.url === 'token') endpoints.token_endpoint = entry.valueUri || entry.valueUrl;
    if (entry.url === 'register') endpoints.registration_endpoint = entry.valueUri || entry.valueUrl;
    if (entry.url === 'manage') endpoints.management_endpoint = entry.valueUri || entry.valueUrl;
    if (entry.url === 'introspect') endpoints.introspection_endpoint = entry.valueUri || entry.valueUrl;
    if (entry.url === 'revoke') endpoints.revocation_endpoint = entry.valueUri || entry.valueUrl;
  }
  if (!endpoints.authorization_endpoint || !endpoints.token_endpoint) {
    throw new Error('CapabilityStatement liefert keine vollstaendigen OAuth-Endpunkte.');
  }
  return {
    source: 'metadata',
    configurationUrl: metadataUrl,
    authorization_endpoint: toAbsoluteUrl(endpoints.authorization_endpoint, base),
    token_endpoint: toAbsoluteUrl(endpoints.token_endpoint, base),
    registration_endpoint: endpoints.registration_endpoint ? toAbsoluteUrl(endpoints.registration_endpoint, base) : undefined,
    management_endpoint: endpoints.management_endpoint ? toAbsoluteUrl(endpoints.management_endpoint, base) : undefined,
    introspection_endpoint: endpoints.introspection_endpoint ? toAbsoluteUrl(endpoints.introspection_endpoint, base) : undefined,
    revocation_endpoint: endpoints.revocation_endpoint ? toAbsoluteUrl(endpoints.revocation_endpoint, base) : undefined,
  };
}

export async function buildAuthorizeRequest({ iss, launch, clientId, scope, redirectUri }) {
  const config = await discoverSmartConfiguration(iss);
  const { verifier, challenge } = await createPkcePair();
  const state = randomUrlSafeString(32);
  const authUrl = new URL(config.authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('aud', iss);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  if (launch) {
    authUrl.searchParams.set('launch', launch);
  }
  return {
    authorizationUrl: authUrl.toString(),
    pending: {
      createdAt: Date.now(),
      iss,
      launch: launch || null,
      clientId,
      scope,
      redirectUri,
      state,
      codeVerifier: verifier,
      tokenEndpoint: config.token_endpoint,
      configurationSource: config.source,
    },
  };
}

export function normalizeRedirectUri(value) {
  if (!value) return null;
  try {
    return new URL(value, window.location.href).toString();
  } catch {
    throw new Error(`Ungueltige redirect_uri: ${value}`);
  }
}

function base64UrlDecode(str) {
  if (!str) return '';
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  return atob(padded);
}

function decodeJwt(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = base64UrlDecode(parts[1]);
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function readContextFromToken(tokenResponse) {
  const ctx = {};
  const fhirCtx = tokenResponse?.fhirContext || tokenResponse?.fhir_context;
  if (tokenResponse?.patient) ctx.patient = tokenResponse.patient;
  if (tokenResponse?.encounter) ctx.encounter = tokenResponse.encounter;
  if (tokenResponse?.location) ctx.location = tokenResponse.location;
  if (fhirCtx?.patient && !ctx.patient) ctx.patient = fhirCtx.patient;
  if (fhirCtx?.encounter && !ctx.encounter) ctx.encounter = fhirCtx.encounter;
  if (fhirCtx?.location && !ctx.location) ctx.location = fhirCtx.location;
  if (tokenResponse?.fhirUser) ctx.fhirUser = tokenResponse.fhirUser;
  if (tokenResponse?.fhir_user && !ctx.fhirUser) ctx.fhirUser = tokenResponse.fhir_user;
  return ctx;
}

export async function requestSmartAccessToken(pending, code) {
  if (!pending?.tokenEndpoint) {
    throw new Error('SMART Token Endpoint fehlt im gespeicherten Launch-State.');
  }
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    client_id: pending.clientId,
    code_verifier: pending.codeVerifier,
  });
  const response = await fetch(pending.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const snippet = raw ? raw.slice(0, 200) : '';
    throw new Error(`SMART Token Endpoint antwortete mit HTTP ${response.status}. ${snippet}`);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('SMART Token Endpoint lieferte keine JSON-Antwort.');
  }
  return data;
}

export function buildSmartSession(pending, tokenResponse) {
  if (!tokenResponse?.access_token) {
    throw new Error('SMART Token Antwort enthaelt kein access_token.');
  }
  const now = Date.now();
  const expiresIn = Number.parseInt(tokenResponse.expires_in ?? '', 10);
  const expiresAt = Number.isFinite(expiresIn) ? now + Math.max(0, expiresIn) * 1000 : null;

  const context = readContextFromToken(tokenResponse);
  if (!context.fhirUser && tokenResponse?.id_token) {
    const decoded = decodeJwt(tokenResponse.id_token);
    if (decoded?.fhirUser) context.fhirUser = decoded.fhirUser;
    if (decoded?.profile) context.profile = decoded.profile;
  }
  if (context.fhirUser && !context.user) {
    context.user = context.fhirUser;
  }

  return {
    createdAt: now,
    accessToken: tokenResponse.access_token,
    tokenType: tokenResponse.token_type || 'Bearer',
    scope: tokenResponse.scope || pending.scope,
    expiresAt,
    refreshToken: tokenResponse.refresh_token || null,
    idToken: tokenResponse.id_token || null,
    patientBanner: tokenResponse.need_patient_banner ?? null,
    smartStyleUrl: tokenResponse.smart_style_url || null,
    context,
    iss: pending.iss,
    launch: pending.launch,
    clientId: pending.clientId,
    tokenEndpoint: pending.tokenEndpoint,
    rawResponse: tokenResponse,
  };
}

export function isSessionExpired(session, skewMs = 60000) {
  if (!session?.expiresAt) return false;
  return Date.now() + Math.max(0, skewMs) >= session.expiresAt;
}

