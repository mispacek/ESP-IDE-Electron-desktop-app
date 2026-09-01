'use strict';

const TRUSTED_REMOTE_ORIGINS = new Set([
  'https://espide.eu',
  'https://www.espide.eu',
]);

const TRUSTED_REMOTE_FILTERS = [
  'https://espide.eu/*',
  'https://www.espide.eu/*',
];

const APP_PATH_REDIRECTS = new Map([
  ['/joy_cs/', 'https://www.espide.eu/joy_cs/'],
  ['/joy_en/', 'https://www.espide.eu/joy_en/'],
]);

function parseUrl(value) {
  try {
    return new URL(value);
  } catch (_) {
    return null;
  }
}

function isTrustedRemoteUrl(value) {
  const url = parseUrl(value);
  return Boolean(url && TRUSTED_REMOTE_ORIGINS.has(url.origin));
}

function isAppUrl(value, appOrigin) {
  const url = parseUrl(value);
  return Boolean(url && url.origin === appOrigin);
}

function resolveTrustedExternalUrl(value, appOrigin) {
  const url = parseUrl(value);
  if (!url) return null;
  if (TRUSTED_REMOTE_ORIGINS.has(url.origin)) return url.href;
  if (url.origin !== appOrigin) return null;
  return APP_PATH_REDIRECTS.get(url.pathname) || null;
}

function replaceHeader(headers, name, value) {
  const result = { ...(headers || {}) };
  for (const existingName of Object.keys(result)) {
    if (existingName.toLowerCase() === name.toLowerCase()) delete result[existingName];
  }
  result[name] = [value];
  return result;
}

function trustedEmbedResponseHeaders(details, mainWebContentsId) {
  if (!details || details.resourceType !== 'subFrame') return null;
  if (!Number.isInteger(mainWebContentsId) || details.webContentsId !== mainWebContentsId) return null;
  if (!isTrustedRemoteUrl(details.url)) return null;

  // The local IDE is cross-origin isolated for Simulator Lite. Cross-origin
  // iframe documents must opt in to a compatible embedder policy as well.
  let headers = replaceHeader(details.responseHeaders, 'Cross-Origin-Embedder-Policy', 'credentialless');
  headers = replaceHeader(headers, 'Cross-Origin-Resource-Policy', 'cross-origin');
  return headers;
}

function installTrustedEmbedPolicy(session, getMainWebContentsId) {
  session.webRequest.onHeadersReceived({ urls: TRUSTED_REMOTE_FILTERS }, (details, callback) => {
    const headers = trustedEmbedResponseHeaders(details, getMainWebContentsId());
    callback({ responseHeaders: headers || details.responseHeaders });
  });
}

function openExternalSafely(openExternal, url) {
  setImmediate(() => {
    Promise.resolve(openExternal(url)).catch(() => {});
  });
}

function installNavigationPolicy(webContents, appOrigin, openExternal) {
  webContents.on('will-navigate', (event, url) => {
    const externalUrl = resolveTrustedExternalUrl(url, appOrigin);
    if (!externalUrl && isAppUrl(url, appOrigin)) return;
    event.preventDefault();
    if (externalUrl) openExternalSafely(openExternal, externalUrl);
  });

  webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = resolveTrustedExternalUrl(url, appOrigin);
    if (externalUrl) {
      openExternalSafely(openExternal, externalUrl);
      return { action: 'deny' };
    }
    return isAppUrl(url, appOrigin) ? { action: 'allow' } : { action: 'deny' };
  });
}

module.exports = {
  APP_PATH_REDIRECTS,
  TRUSTED_REMOTE_FILTERS,
  TRUSTED_REMOTE_ORIGINS,
  installNavigationPolicy,
  installTrustedEmbedPolicy,
  isAppUrl,
  isTrustedRemoteUrl,
  replaceHeader,
  resolveTrustedExternalUrl,
  trustedEmbedResponseHeaders,
};
