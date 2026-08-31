"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appRoot = path.join(__dirname, "..");
const indexSource = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
const workerSource = fs.readFileSync(path.join(appRoot, "sw.js"), "utf8");

test("service-worker startup timeouts cover the 45 second precache", () => {
  assert.match(workerSource, /PRECACHE_TIMEOUT_MS = 45000/);
  assert.match(indexSource, /SW_INSTALL_TIMEOUT_MS = 45000/);
  assert.match(indexSource, /SW_STARTUP_TIMEOUT_MS = 50000/);
  assert.doesNotMatch(indexSource, /Math\.min\(25000, remainingStartupTime/);
});

test("precache publishes versioned percentage-only progress", () => {
  assert.match(workerSource, /type: 'PRECACHE_PROGRESS'/);
  assert.match(workerSource, /appVersion: APP_VERSION/);
  assert.match(workerSource, /Math\.floor\(completed \* 100 \/ PRECACHE\.length\)/);
  assert.match(indexSource, /data\.appVersion !== APP_VERSION/);
  assert.match(indexSource, /loading\.updatingProgress/);
  assert.match(indexSource, /formatMessage\(fallback\[key\][^;]*, vars\)/);
  assert.doesNotMatch(indexSource, /\{completed\}|\{total\}|\{remaining\}/);
});

test("precache progress runs monotonically from zero to one hundred", async () => {
  const handlers = new Map();
  const messages = [];
  const cache = {
    async match() { return undefined; },
    async put() {},
  };
  const self = {
    location: {href: "https://example.test/esp_ide_v2/sw.js?v=test-version"},
    registration: {scope: "https://example.test/esp_ide_v2/"},
    clients: {
      async matchAll() {
        return [{postMessage(message) { messages.push(message); }}];
      },
    },
    addEventListener(type, handler) { handlers.set(type, handler); },
    skipWaiting() {},
  };
  vm.runInNewContext(workerSource, {
    AbortController,
    Headers,
    Request,
    Response,
    URL,
    caches: {
      async open() { return cache; },
      async keys() { return []; },
      async delete() { return true; },
    },
    console,
    fetch: async () => new Response("ok"),
    self,
    setTimeout,
    clearTimeout,
  });

  let installPromise;
  handlers.get("install")({waitUntil(value) { installPromise = value; }});
  await installPromise;

  const percentages = messages.map(message => message.percent);
  assert.equal(percentages[0], 0);
  assert.equal(percentages.at(-1), 100);
  assert.ok(percentages.every((value, index) =>
    Number.isInteger(value) && value >= 0 && value <= 100 &&
    (index === 0 || value > percentages[index - 1])));
  assert.ok(messages.every(message =>
    message.type === "PRECACHE_PROGRESS" &&
    message.appVersion === "test-version" &&
    Object.keys(message).sort().join(",") === "appVersion,percent,type"));
});
