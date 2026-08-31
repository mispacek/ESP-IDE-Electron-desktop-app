'use strict';

const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');

const MAX_RESPONSE_BYTES = 1048576;
const CONNECT_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 10000;

class ProxyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isPublicIPv4(address) {
  if (typeof address !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(address)) return false;
  const octets = address.split('.').map(Number);
  if (octets.some((value) => value > 255)) return false;
  const value = ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
  const inRange = (base, mask) => ((value & mask) >>> 0) === (base >>> 0);
  return !(
    inRange(0x00000000, 0xff000000) || // 0.0.0.0/8
    inRange(0x0a000000, 0xff000000) || // 10.0.0.0/8
    inRange(0x64400000, 0xffc00000) || // 100.64.0.0/10
    inRange(0x7f000000, 0xff000000) || // 127.0.0.0/8
    inRange(0xa9fe0000, 0xffff0000) || // 169.254.0.0/16
    inRange(0xac100000, 0xfff00000) || // 172.16.0.0/12
    inRange(0xc0000000, 0xffffff00) || // 192.0.0.0/24
    inRange(0xc0000200, 0xffffff00) || // 192.0.2.0/24
    inRange(0xc0a80000, 0xffff0000) || // 192.168.0.0/16
    inRange(0xc6120000, 0xfffe0000) || // 198.18.0.0/15
    inRange(0xc6336400, 0xffffff00) || // 198.51.100.0/24
    inRange(0xcb007100, 0xffffff00) || // 203.0.113.0/24
    inRange(0xe0000000, 0xf0000000) || // multicast
    inRange(0xf0000000, 0xf0000000)    // reserved
  );
}

function validateTarget(value) {
  if (typeof value !== 'string' || !value.trim()) throw new ProxyError(400, 'Invalid URL.');
  let target;
  try {
    target = new URL(value.trim());
  } catch (_) {
    throw new ProxyError(400, 'Invalid URL.');
  }
  const port = target.port ? Number(target.port) : (target.protocol === 'https:' ? 443 : 80);
  if (!['http:', 'https:'].includes(target.protocol) || !target.hostname) {
    throw new ProxyError(400, 'Only HTTP and HTTPS URLs are allowed.');
  }
  if (target.username || target.password || ![80, 443].includes(port)) {
    throw new ProxyError(400, 'Credentials and non-standard ports are not allowed.');
  }
  return { target, port, host: target.hostname.toLowerCase() };
}

async function resolvePublicIPv4(host, lookup = dns.promises.lookup) {
  const direct = isPublicIPv4(host) ? [{ address: host, family: 4 }] : null;
  const records = direct || await lookup(host, { all: true, family: 4, verbatim: true });
  if (!Array.isArray(records) || !records.length || records.some((record) => !isPublicIPv4(record.address))) {
    throw new ProxyError(403, 'The destination must resolve only to public IPv4 addresses.');
  }
  return records[0].address;
}

function defaultRequestFactory(options, onResponse) {
  return (options.protocol === 'https:' ? https : http).request(options, onResponse);
}

function fetchPinned(targetInfo, address, options = {}) {
  const requestFactory = options.requestFactory || defaultRequestFactory;
  return new Promise((resolve, reject) => {
    let settled = false;
    let totalTimer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      fn(value);
    };
    const fail = (error) => finish(reject, error instanceof ProxyError ? error : new ProxyError(502, error.message || 'The upstream HTTP request failed.'));
    const requestOptions = {
      protocol: targetInfo.target.protocol,
      hostname: address,
      port: targetInfo.port,
      path: `${targetInfo.target.pathname}${targetInfo.target.search}`,
      method: 'GET',
      headers: {
        'accept-encoding': 'identity',
        host: targetInfo.target.host,
        'user-agent': 'ESP-IDE-Simulator-Lite/1.0',
      },
      rejectUnauthorized: true,
      servername: targetInfo.host,
    };
    let req;
    try {
      req = requestFactory(requestOptions, (upstream) => {
        const chunks = [];
        let size = 0;
        upstream.on('data', (chunk) => {
          const data = Buffer.from(chunk);
          size += data.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy();
            fail(new ProxyError(413, 'HTTP response exceeds 1048576 bytes.'));
            return;
          }
          chunks.push(data);
        });
        upstream.once('error', fail);
        upstream.once('end', () => finish(resolve, {
          body: Buffer.concat(chunks),
          contentType: String(upstream.headers['content-type'] || 'application/octet-stream').replace(/[\r\n]/g, ''),
          status: Number(upstream.statusCode) || 502,
        }));
      });
      req.once('error', fail);
      req.setTimeout(CONNECT_TIMEOUT_MS, () => {
        req.destroy();
        fail(new ProxyError(502, 'The upstream HTTP request timed out.'));
      });
      totalTimer = setTimeout(() => {
        req.destroy();
        fail(new ProxyError(502, 'The upstream HTTP request timed out.'));
      }, REQUEST_TIMEOUT_MS);
      req.end();
    } catch (error) {
      fail(error);
    }
  });
}

function safeResponseStatus(status) {
  const value = Number(status);
  if (!Number.isInteger(value)) return 502;
  return Math.min(599, Math.max(200, value));
}

function proxyResponse(status, body, contentType, extraHeaders = {}) {
  const safeStatus = safeResponseStatus(status);
  const bodylessStatus = safeStatus === 204 || safeStatus === 205 || safeStatus === 304;
  return new Response(bodylessStatus ? null : body, {
    status: safeStatus,
    headers: {
      'cache-control': 'no-store',
      'content-type': contentType || 'application/octet-stream',
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function proxyError(error) {
  const status = error instanceof ProxyError ? error.status : 502;
  const message = error instanceof ProxyError ? error.message : 'The upstream HTTP request failed.';
  return proxyResponse(status, message, 'text/plain; charset=utf-8');
}

function createHttpProxyHandler(options = {}) {
  const lookup = options.lookup || dns.promises.lookup;
  const requestFactory = options.requestFactory || defaultRequestFactory;
  return async function handleHttpProxy(request) {
    if (request.method !== 'GET') return proxyResponse(405, 'Only GET is supported.', 'text/plain; charset=utf-8', { allow: 'GET' });
    try {
      const requestUrl = new URL(request.url);
      const targetInfo = validateTarget(requestUrl.searchParams.get('url') || '');
      const address = await resolvePublicIPv4(targetInfo.host, lookup);
      const upstream = await fetchPinned(targetInfo, address, { requestFactory });
      return proxyResponse(upstream.status, upstream.body, upstream.contentType);
    } catch (error) {
      return proxyError(error);
    }
  };
}

module.exports = {
  CONNECT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  createHttpProxyHandler,
  fetchPinned,
  isPublicIPv4,
  resolvePublicIPv4,
  safeResponseStatus,
  validateTarget,
};
