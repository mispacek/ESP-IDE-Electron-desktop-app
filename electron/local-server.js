'use strict';

const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { createEspideProtocolHandler } = require('./protocol-handler');
const { createHttpProxyHandler } = require('./http-proxy');

const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_PORT = 48765;
const TOKEN_HEADER = 'x-espide-local-token';

function fixedHeaders(extra = {}) {
  return {
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
    ...extra,
  };
}

function tokenMatches(value, token) {
  if (typeof value !== 'string' || typeof token !== 'string') return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function shouldInjectToken(details, appOrigin, appUrl) {
  if (details.resourceType === 'mainFrame' && details.url === appUrl) return true;
  // Electron 30 exposes the browser-controlled referrer here; newer Electron
  // releases may additionally expose initiator. Never authorize an absent or
  // cross-origin source merely because it shares the same session.
  const source = details.initiator || details.referrer;
  try {
    return Boolean(source) && new URL(source).origin === appOrigin;
  } catch (_) {
    return false;
  }
}

function fetchSiteAllowed(request) {
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite === 'same-origin') return true;
  return fetchSite === 'none'
    && request.method === 'GET'
    && request.url === '/esp_ide_v2/index.html';
}

function writeText(response, status, text, headers = {}) {
  response.writeHead(status, fixedHeaders({
    'content-type': 'text/plain; charset=utf-8',
    ...headers,
  }));
  response.end(text);
}

function copyResponseHeaders(response, headers) {
  for (const [name, value] of headers.entries()) response.setHeader(name, value);
  for (const [name, value] of Object.entries(fixedHeaders())) response.setHeader(name, value);
}

async function writeProtocolResponse(response, protocolResponse, method) {
  copyResponseHeaders(response, protocolResponse.headers);
  response.statusCode = protocolResponse.status;
  if (method === 'HEAD' || protocolResponse.status === 204 || protocolResponse.status === 205 || protocolResponse.status === 304) {
    response.end();
    return;
  }
  response.end(Buffer.from(await protocolResponse.arrayBuffer()));
}

function createRequestListener({ token, port, getPort, protocolHandler }) {
  const exactHost = () => `${LOOPBACK_HOST}:${getPort ? getPort() : port}`;
  return async function localRequestListener(request, response) {
    if (request.headers.host !== exactHost()) {
      writeText(response, 403, 'Forbidden');
      return;
    }
    if (!tokenMatches(request.headers[TOKEN_HEADER], token)) {
      writeText(response, 403, 'Forbidden');
      return;
    }
    if (!fetchSiteAllowed(request)) {
      writeText(response, 403, 'Forbidden');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      writeText(response, 405, 'Method Not Allowed', { allow: 'GET, HEAD' });
      return;
    }
    if (!request.url || !request.url.startsWith('/')) {
      writeText(response, 400, 'Bad Request');
      return;
    }
    try {
      const mappedRequest = new Request(`espide://app${request.url}`, { method: request.method });
      await writeProtocolResponse(response, await protocolHandler(mappedRequest), request.method);
    } catch (_) {
      writeText(response, 500, 'Internal Server Error');
    }
  };
}

function startLocalServer(options) {
  const port = options.port === undefined ? LOOPBACK_PORT : options.port;
  const protocolHandler = options.protocolHandler || createEspideProtocolHandler({
    ideRoot: options.ideRoot,
    simulatorRoot: options.simulatorRoot,
    proxyHandler: options.proxyHandler || createHttpProxyHandler(),
  });
  let server;
  const listener = createRequestListener({
    token: options.token,
    port,
    getPort: () => server && server.address() && server.address().port,
    protocolHandler,
  });
  server = http.createServer(listener);
  server.maxHeadersCount = 64;
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ exclusive: true, host: LOOPBACK_HOST, port }, () => {
      server.removeListener('error', reject);
      const address = server.address();
      resolve({
        close: () => new Promise((closeResolve) => server.close(() => closeResolve())),
        origin: `http://${LOOPBACK_HOST}:${address.port}`,
        port: address.port,
        server,
      });
    });
  });
}

module.exports = {
  LOOPBACK_HOST,
  LOOPBACK_PORT,
  TOKEN_HEADER,
  createRequestListener,
  shouldInjectToken,
  startLocalServer,
  tokenMatches,
};
