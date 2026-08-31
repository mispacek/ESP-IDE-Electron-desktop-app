import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, "../../../js/espide_ai_mcp_bridge.js"), "utf8");

function loadBridge(search = "") {
  const sockets = [];
  const storage = new Map();

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(type, listener) { this.listeners.set(type, listener); }
    send() {}
    close() {
      this.readyState = 3;
      this.listeners.get("close")?.();
    }
  }

  const window = {
    location: {
      hostname: "127.0.0.1",
      search,
      href: `http://127.0.0.1/esp_ide_v2/${search}`
    },
    document: { readyState: "complete", addEventListener() {} },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    addEventListener() {},
    setTimeout
  };
  window.window = window;

  const context = vm.createContext({
    window,
    WebSocket: FakeWebSocket,
    URL,
    URLSearchParams,
    console,
    JSON,
    String,
    Set
  });
  vm.runInContext(source, context);
  return { bridge: window.ESPIDE_AI_MCP_BRIDGE, sockets, storage };
}

test("browser bridge is silent by default and connects only after opt-in", () => {
  const normalPage = loadBridge();
  assert.equal(normalPage.bridge.enabled, false);
  assert.equal(normalPage.sockets.length, 0);

  assert.equal(normalPage.bridge.enable(), true);
  assert.equal(normalPage.bridge.enabled, true);
  assert.equal(normalPage.sockets.length, 1);

  normalPage.bridge.disable();
  assert.equal(normalPage.bridge.enabled, false);

  const aiPage = loadBridge("?espide_mcp=1");
  assert.equal(aiPage.bridge.enabled, true);
  assert.equal(aiPage.sockets.length, 1);
});
