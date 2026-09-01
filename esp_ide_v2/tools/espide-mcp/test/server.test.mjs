import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import WebSocket from "ws";

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

async function connectPage(port) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    try {
      await waitForOpen(socket);
      return socket;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError;
}

test("MCP server forwards read and transactional tools to the browser bridge", async (t) => {
  const port = 18000 + Math.floor(Math.random() * 2000);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    cwd: new URL("..", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1"),
    env: Object.assign({}, process.env, { ESPIDE_MCP_PORT: String(port) })
  });
  const client = new Client({ name: "espide-mcp-test", version: "1.0.0" });
  await client.connect(transport);
  t.after(async () => { await client.close(); });

  const page = await connectPage(port);
  t.after(() => page.close());
  page.send(JSON.stringify({
    type: "hello",
    protocol: "espide-ai-bridge/1",
    pageUrl: "http://127.0.0.1/esp_ide_v2/",
    apiVersion: "1.0.0",
    ready: true
  }));

  const seen = [];
  page.on("message", (data) => {
    const message = JSON.parse(data.toString("utf8"));
    if (message.type !== "request") return;
    seen.push(message);
    const result = message.tool === "get_state"
      ? { apiVersion: "1.0.0", revision: 7, locale: "cs", processor: "ESP32" }
      : { committed: !message.arguments.dryRun, revision: 8, validation: { valid: true } };
    page.send(JSON.stringify({ type: "response", id: message.id, ok: true, result }));
  });

  const status = await client.callTool({ name: "espide_bridge_status", arguments: {} });
  assert.equal(status.structuredContent.connected, true);

  const state = await client.callTool({ name: "espide_get_state", arguments: {} });
  assert.equal(state.structuredContent.processor, "ESP32");
  assert.equal(state.structuredContent.locale, "cs");

  const preview = await client.callTool({
    name: "espide_apply_workspace_patch",
    arguments: {
      expectedRevision: 7,
      dryRun: true,
      operations: [{ op: "create", ref: "value", type: "math_number", fromToolbox: false, fields: { NUM: 5 } }]
    }
  });
  assert.equal(preview.structuredContent.committed, false);
  assert.deepEqual(seen.map((item) => item.tool), ["get_state", "apply_workspace_patch"]);
});
