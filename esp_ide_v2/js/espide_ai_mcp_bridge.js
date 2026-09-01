(function (global) {
  "use strict";

  const PROTOCOL_VERSION = "espide-ai-bridge/1";
  const DEFAULT_URL = "ws://127.0.0.1:8765";
  const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

  let socket = null;
  let unsubscribeEvents = null;
  let runtimeEnabled = false;

  function isLocalPage() {
    return LOCAL_HOSTS.has(String(global.location.hostname || "").toLowerCase());
  }

  function isEnabled() {
    try {
      const params = new URLSearchParams(global.location.search || "");
      if (params.get("espide_mcp") === "1") return true;
      if (params.get("espide_mcp") === "0") return false;
      return runtimeEnabled || global.localStorage.getItem("espide.ai.mcp.enabled") === "true";
    } catch (_) {
      return runtimeEnabled;
    }
  }

  function resolveBridgeUrl() {
    let configured = DEFAULT_URL;
    try {
      const params = new URLSearchParams(global.location.search || "");
      configured = params.get("espide_mcp_url") || global.localStorage.getItem("espide.ai.mcp.url") || DEFAULT_URL;
    } catch (_) {}
    const url = new URL(configured);
    if (url.protocol !== "ws:" || !LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
      throw new Error("ESP IDE MCP bridge accepts loopback ws:// addresses only.");
    }
    return url.toString();
  }

  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function sendHello() {
    const api = global.ESPIDE_AI;
    send({
      type: "hello",
      protocol: PROTOCOL_VERSION,
      pageUrl: global.location.href,
      apiVersion: api ? api.version : null,
      ready: !!(api && api.initialized),
      capabilities: api && api.initialized ? api.capabilities() : null
    });
  }

  function subscribeToApiEvents() {
    if (unsubscribeEvents || !global.ESPIDE_AI || !global.ESPIDE_AI.initialized) return;
    unsubscribeEvents = global.ESPIDE_AI.subscribe("*", (event) => {
      send({ type: "event", protocol: PROTOCOL_VERSION, event });
    });
  }

  function normalizeError(error) {
    return {
      code: error && error.code ? String(error.code) : "ESPIDE_TOOL_FAILED",
      message: error && error.message ? String(error.message) : String(error || "Unknown ESP IDE error"),
      details: error && error.details !== undefined ? error.details : null
    };
  }

  async function handleRequest(message) {
    const id = message.id;
    if (!global.ESPIDE_AI || !global.ESPIDE_AI.initialized) {
      send({ type: "response", id, ok: false, error: { code: "ESPIDE_NOT_READY", message: "ESPIDE_AI is not initialized.", details: null } });
      return;
    }
    try {
      const result = await global.ESPIDE_AI.call(message.tool, message.arguments || {});
      send({ type: "response", id, ok: true, result });
    } catch (error) {
      send({ type: "response", id, ok: false, error: normalizeError(error) });
    }
  }

  function connect() {
    if (!isEnabled() || !isLocalPage()) return false;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    let url;
    try {
      url = resolveBridgeUrl();
    } catch (error) {
      console.warn("ESP IDE MCP bridge disabled:", error.message);
      return;
    }
    try {
      socket = new WebSocket(url);
    } catch (_) {
      socket = null;
      return false;
    }
    socket.addEventListener("open", () => {
      sendHello();
      subscribeToApiEvents();
    });
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (!message || message.type !== "request" || !message.id || !message.tool) return;
      void handleRequest(message);
    });
    socket.addEventListener("close", () => {
      socket = null;
    });
    socket.addEventListener("error", () => {
      try { socket.close(); } catch (_) {}
    });
    return true;
  }

  function disconnect() {
    runtimeEnabled = false;
    if (unsubscribeEvents) {
      unsubscribeEvents();
      unsubscribeEvents = null;
    }
    const activeSocket = socket;
    socket = null;
    if (activeSocket) {
      try { activeSocket.close(); } catch (_) {}
    }
  }

  function enable(options) {
    const settings = options || {};
    runtimeEnabled = true;
    try {
      if (settings.persist === true) global.localStorage.setItem("espide.ai.mcp.enabled", "true");
    } catch (_) {}
    return connect();
  }

  function disable(options) {
    const settings = options || {};
    disconnect();
    try {
      if (settings.persist !== false) global.localStorage.removeItem("espide.ai.mcp.enabled");
    } catch (_) {}
  }

  global.addEventListener("espide-ai-ready", () => {
    subscribeToApiEvents();
    sendHello();
  });

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", connect, { once: true });
  } else {
    connect();
  }

  global.ESPIDE_AI_MCP_BRIDGE = {
    version: PROTOCOL_VERSION,
    connect,
    enable,
    disable,
    get enabled() { return isEnabled(); },
    get connected() { return !!(socket && socket.readyState === WebSocket.OPEN); },
    get url() { try { return resolveBridgeUrl(); } catch (_) { return null; } }
  };
})(window);
