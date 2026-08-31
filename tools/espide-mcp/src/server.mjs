import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer } from "ws";
import { z } from "zod";

const HOST = process.env.ESPIDE_MCP_HOST || "127.0.0.1";
const PORT = Number(process.env.ESPIDE_MCP_PORT || 8765);
const REQUEST_TIMEOUT_MS = Number(process.env.ESPIDE_MCP_TIMEOUT_MS || 15000);
const PROTOCOL_VERSION = "espide-ai-bridge/1";

const pages = new Map();
const pending = new Map();
let activePageId = null;
let requestCounter = 0;

function log(message, details) {
  const suffix = details === undefined ? "" : " " + JSON.stringify(details);
  process.stderr.write(`[espide-mcp] ${message}${suffix}\n`);
}

function publicPage(page) {
  if (!page) return null;
  return {
    id: page.id,
    connectedAt: page.connectedAt,
    pageUrl: page.hello?.pageUrl || null,
    apiVersion: page.hello?.apiVersion || null,
    ready: page.hello?.ready === true
  };
}

function bridgeStatus() {
  const active = activePageId ? pages.get(activePageId) : null;
  return {
    connected: !!active,
    host: HOST,
    port: PORT,
    activePage: publicPage(active),
    pages: Array.from(pages.values()).map(publicPage)
  };
}

function activePage() {
  const page = activePageId ? pages.get(activePageId) : null;
  if (!page || page.socket.readyState !== 1) {
    const error = new Error("No ESP IDE page is connected to the local MCP bridge.");
    error.code = "ESPIDE_PAGE_NOT_CONNECTED";
    throw error;
  }
  return page;
}

function rejectPendingForPage(pageId, reason) {
  for (const [id, entry] of pending.entries()) {
    if (entry.pageId !== pageId) continue;
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.reject(reason);
  }
}

async function callPage(tool, argumentsValue = {}) {
  const page = activePage();
  const id = `mcp-${Date.now().toString(36)}-${(++requestCounter).toString(36)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      const error = new Error(`ESP IDE tool timed out after ${REQUEST_TIMEOUT_MS} ms: ${tool}`);
      error.code = "ESPIDE_TOOL_TIMEOUT";
      reject(error);
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { pageId: page.id, resolve, reject, timer });
    page.socket.send(JSON.stringify({
      type: "request",
      protocol: PROTOCOL_VERSION,
      id,
      tool,
      arguments: argumentsValue
    }));
  });
}

function errorPayload(error) {
  return {
    code: error?.code || "ESPIDE_MCP_ERROR",
    message: error?.message || String(error),
    details: error?.details || null
  };
}

function resultContent(result) {
  const structured = result && typeof result === "object" ? result : { value: result };
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured
  };
}

function failedContent(error) {
  const structured = { ok: false, error: errorPayload(error), bridge: bridgeStatus() };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured
  };
}

async function pageTool(tool, args) {
  try {
    return resultContent(await callPage(tool, args));
  } catch (error) {
    return failedContent(error);
  }
}

const webSocketServer = new WebSocketServer({ host: HOST, port: PORT });

webSocketServer.on("connection", (socket, request) => {
  const pageId = `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const page = {
    id: pageId,
    socket,
    connectedAt: new Date().toISOString(),
    remoteAddress: request.socket.remoteAddress,
    hello: null
  };
  pages.set(pageId, page);
  activePageId = pageId;
  log("ESP IDE page connected", { pageId, remoteAddress: page.remoteAddress });

  socket.on("message", (data) => {
    let message;
    try { message = JSON.parse(data.toString("utf8")); } catch (_) { return; }
    if (message.type === "hello" && message.protocol === PROTOCOL_VERSION) {
      page.hello = message;
      activePageId = pageId;
      log("ESP IDE bridge ready", { pageId, apiVersion: message.apiVersion, pageUrl: message.pageUrl });
      return;
    }
    if (message.type === "event") {
      if (message.event?.type === "ready") page.hello = Object.assign({}, page.hello, { ready: true });
      return;
    }
    if (message.type !== "response" || !message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.ok) {
      entry.resolve(message.result);
    } else {
      const error = new Error(message.error?.message || "ESP IDE tool failed.");
      error.code = message.error?.code || "ESPIDE_TOOL_FAILED";
      error.details = message.error?.details;
      entry.reject(error);
    }
  });

  socket.on("close", () => {
    pages.delete(pageId);
    rejectPendingForPage(pageId, Object.assign(new Error("ESP IDE page disconnected."), { code: "ESPIDE_PAGE_DISCONNECTED" }));
    if (activePageId === pageId) activePageId = Array.from(pages.keys()).at(-1) || null;
    log("ESP IDE page disconnected", { pageId });
  });
});

webSocketServer.on("listening", () => log("browser bridge listening", { host: HOST, port: PORT }));
webSocketServer.on("error", (error) => log("browser bridge error", errorPayload(error)));

const server = new McpServer({ name: "espide", version: "1.0.0" });

server.registerTool(
  "espide_bridge_status",
  {
    title: "ESP IDE bridge status",
    description: "Check whether a local ESP IDE browser page is connected before using other ESP IDE tools.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async () => resultContent(bridgeStatus())
);

server.registerTool(
  "espide_get_state",
  {
    title: "Read ESP IDE state",
    description: "Read processor, locale, project mode, Blockly revision, block count and device connection state.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async () => pageTool("get_state", {})
);

server.registerTool(
  "espide_list_blocks",
  {
    title: "List ESP IDE toolbox blocks",
    description: "Search blocks available in the active processor toolbox. Start without XML/spec; request details only when needed.",
    inputSchema: {
      query: z.string().optional().describe("Substring in block type or category path."),
      category: z.string().optional().describe("Substring in the localized category path."),
      limit: z.number().int().min(1).max(1000).optional(),
      includeXml: z.boolean().optional(),
      includeSpec: z.boolean().optional()
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async (args) => pageTool("list_blocks", args)
);

server.registerTool(
  "espide_describe_block",
  {
    title: "Describe a Blockly block",
    description: "Inspect one block type's fields, inputs and compatible previous/next/output connections before composing a patch.",
    inputSchema: { type: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async (args) => pageTool("describe_block", args)
);

server.registerTool(
  "espide_get_workspace",
  {
    title: "Read Blockly workspace",
    description: "Return the current Blockly workspace XML, revision, block count and top block IDs.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async () => pageTool("get_workspace", {})
);

server.registerTool(
  "espide_get_generated_code",
  {
    title: "Generate MicroPython code",
    description: "Generate Python from the current Blockly workspace without changing it.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async () => pageTool("get_generated_code", {})
);

server.registerTool(
  "espide_validate_workspace",
  {
    title: "Validate Blockly workspace",
    description: "Validate workspace XML and Python generation and report Blockly warnings or orphaned output blocks.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async () => pageTool("validate_workspace", {})
);

server.registerTool(
  "espide_get_terminal",
  {
    title: "Read ESP IDE terminal",
    description: "Read the most recently captured terminal lines for MicroPython diagnostics.",
    inputSchema: { lines: z.number().int().min(1).max(1000).optional() },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async (args) => pageTool("get_terminal", args)
);

server.registerTool(
  "espide_get_settings",
  {
    title: "Read ESP IDE settings",
    description: "Read non-secret ESP IDE settings. Passwords, tokens and credentials are redacted by the page API.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async () => pageTool("get_settings", {})
);

server.registerTool(
  "espide_list_addons",
  {
    title: "List installed ESP IDE add-ons",
    description: "List installed add-on metadata and enabled state without returning executable source code.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async () => pageTool("list_addons", {})
);

const patchOperation = z.object({
  op: z.enum(["clear", "replace_xml", "create", "set_field", "connect_sequence", "connect_input", "move", "disconnect", "delete"]),
  ref: z.string().optional(),
  type: z.string().optional(),
  fromToolbox: z.boolean().optional(),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  block: z.string().optional(),
  parent: z.string().optional(),
  child: z.string().optional(),
  input: z.string().optional(),
  field: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  connection: z.enum(["previous", "next", "output"]).optional(),
  xml: z.string().optional(),
  healStack: z.boolean().optional()
});

server.registerTool(
  "espide_apply_workspace_patch",
  {
    title: "Apply transactional Blockly patch",
    description: "Atomically compose or edit Blockly blocks. Use expectedRevision from espide_get_workspace, preview with dryRun first, then commit the same operations. Failed patches roll back automatically.",
    inputSchema: {
      expectedRevision: z.number().int().optional(),
      description: z.string().optional(),
      dryRun: z.boolean().optional(),
      operations: z.array(patchOperation).min(1)
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  },
  async (args) => pageTool("apply_workspace_patch", args)
);

server.registerTool(
  "espide_undo_workspace_patch",
  {
    title: "Undo last ESPIDE_AI patch",
    description: "Undo the most recent committed ESPIDE_AI workspace transaction. Pass its undo token when available.",
    inputSchema: { token: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  },
  async (args) => pageTool("undo_workspace_patch", args)
);

const transport = new StdioServerTransport();
await server.connect(transport);

async function shutdown() {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  await server.close();
  for (const page of pages.values()) page.socket.terminate();
  await new Promise((resolve) => webSocketServer.close(resolve));
}

process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
