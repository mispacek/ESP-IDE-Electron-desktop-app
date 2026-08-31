'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.cur': 'image/x-icon',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mfnt': 'application/octet-stream',
  '.mpy': 'application/octet-stream',
  '.png': 'image/png',
  '.py': 'text/plain; charset=utf-8',
  '.raw': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.blk': 'application/xml; charset=utf-8',
  '.lst': 'text/plain; charset=utf-8',
});

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function staticHeaders(kind, filePath) {
  const headers = {
    'cache-control': 'no-store',
    'content-type': getMimeType(filePath),
    'cross-origin-embedder-policy': kind === 'simulator' ? 'require-corp' : 'credentialless',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
  };
  return headers;
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function badPath(pathname) {
  return pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some((part) => part === '.' || part === '..');
}

function mapEspideUrl(requestUrl, roots) {
  const authorityEnd = requestUrl.indexOf('/', requestUrl.indexOf('//') + 2);
  const rawPathname = authorityEnd >= 0
    ? requestUrl.slice(authorityEnd).split(/[?#]/, 1)[0]
    : '/';
  let url;
  try {
    url = new URL(requestUrl);
  } catch (_) {
    return { error: 400 };
  }
  if (url.protocol !== 'espide:' || url.hostname !== 'app') return { error: 403 };

  let pathname;
  try {
    // URL normalizes dot-segments. Validate the original escaped path first so
    // an encoded traversal cannot silently turn into a different routed URL.
    pathname = decodeURIComponent(rawPathname);
  } catch (_) {
    return { error: 400 };
  }
  if (badPath(pathname)) return { error: 403 };

  const mappings = [
    { prefix: '/esp_ide_v2/', kind: 'ide', root: roots.ideRoot },
    { prefix: '/simulator_lite/', kind: 'simulator', root: roots.simulatorRoot },
  ];
  const mapping = mappings.find((item) => pathname.startsWith(item.prefix));
  if (!mapping) return { error: 404 };

  const relativePath = pathname.slice(mapping.prefix.length);
  if (!relativePath) return { error: 404 };
  if (mapping.kind === 'simulator' && relativePath === 'http-proxy.php') {
    return { kind: 'proxy', pathname };
  }

  const root = path.resolve(mapping.root);
  const filePath = path.resolve(root, ...relativePath.split('/'));
  if (!isPathInside(root, filePath)) return { error: 403 };
  return { kind: mapping.kind, root, filePath, pathname };
}

function response(status, body, headers) {
  return new Response(body, { status, headers });
}

function errorResponse(status) {
  const messages = {
    400: 'Bad Request',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
  };
  const headers = {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
  };
  if (status === 405) headers.allow = 'GET, HEAD';
  return response(status, messages[status] || 'Error', headers);
}

function createEspideProtocolHandler(options) {
  const roots = {
    ideRoot: options.ideRoot,
    simulatorRoot: options.simulatorRoot,
  };
  const proxyHandler = options.proxyHandler;
  const fsApi = options.fsApi || fs;

  return async function handleEspideRequest(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse(405);
    const mapped = mapEspideUrl(request.url, roots);
    if (mapped.error) return errorResponse(mapped.error);
    if (mapped.kind === 'proxy') {
      if (request.method !== 'GET') return errorResponse(405);
      return proxyHandler(request);
    }

    try {
      // realpath prevents a symlink placed in the package directory from escaping its mapped root.
      const [realRoot, realFile] = await Promise.all([fsApi.realpath(mapped.root), fsApi.realpath(mapped.filePath)]);
      if (!isPathInside(realRoot, realFile)) return errorResponse(403);
      const info = await fsApi.stat(realFile);
      if (!info.isFile()) return errorResponse(404);
      const headers = staticHeaders(mapped.kind, realFile);
      if (request.method === 'HEAD') return response(200, null, headers);
      return response(200, await fsApi.readFile(realFile), headers);
    } catch (error) {
      if (error && ['ENOENT', 'ENOTDIR'].includes(error.code)) return errorResponse(404);
      return errorResponse(403);
    }
  };
}

module.exports = {
  MIME_TYPES,
  createEspideProtocolHandler,
  getMimeType,
  mapEspideUrl,
  staticHeaders,
};
