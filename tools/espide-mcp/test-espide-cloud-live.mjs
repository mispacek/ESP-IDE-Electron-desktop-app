import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.ESPIDE_MCP_PORT || 8765);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["src/server.mjs"],
  cwd: serverDirectory,
  env: Object.assign({}, process.env, { ESPIDE_MCP_PORT: String(port) })
});
const client = new Client({ name: "espide-cloud-live-test", version: "1.0.0" });
let undoToken = null;

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    const message = result.structuredContent?.error?.message || `ESP IDE tool failed: ${name}`;
    throw new Error(message);
  }
  return result.structuredContent;
}

async function waitForBrowserPage() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const status = await call("espide_bridge_status");
    if (status.connected && status.activePage?.ready) return status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`ESP IDE did not connect to the MCP bridge on port ${port}.`);
}

async function waitForCloudToolbox() {
  let result = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    result = await call("espide_list_blocks", {
      query: "espide_cloud",
      limit: 20,
      includeSpec: true
    });
    if (result.total === 8) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Cloud toolbox did not finish loading (found ${result?.total || 0} of 8 blocks).`);
}

await client.connect(transport);

try {
  const bridge = await waitForBrowserPage();
  const addonsResult = await call("espide_list_addons");
  const addons = Array.isArray(addonsResult) ? addonsResult : (addonsResult.addons || []);
  const cloudAddon = addons.find((addon) => addon.name === "esp_ide_cloud" || addon.id === "esp_ide_cloud");
  assert.ok(cloudAddon?.enabled, "ESP IDE Cloud add-on is not installed and enabled.");

  const listed = await waitForCloudToolbox();
  assert.equal(listed.total, 8, "The Cloud toolbox must expose exactly eight blocks.");

  const describedStart = await call("espide_describe_block", { type: "espide_cloud_start" });
  const describedSetOutput = await call("espide_describe_block", { type: "espide_cloud_set_output" });
  const describedInput = await call("espide_describe_block", { type: "espide_cloud_get_input" });
  const describedReadInputs = await call("espide_describe_block", { type: "espide_cloud_read_inputs" });
  assert.equal(describedStart.previous, true);
  assert.equal(describedStart.next, true);
  assert.equal(describedSetOutput.previous, true);
  assert.equal(describedInput.output, true);
  assert.equal(describedReadInputs.previous, true);
  assert.equal(describedReadInputs.next, true);

  const before = await call("espide_get_workspace");
  const operations = [
    { op: "create", ref: "cloudStart", type: "espide_cloud_start", fields: { CONNECTION: "HTTP" }, x: 40, y: 40 },
    { op: "create", ref: "cloudSetOutput", type: "espide_cloud_set_output", fields: { INDEX: "0" } },
    { op: "create", ref: "cloudSync", type: "espide_cloud_sync" },
    { op: "create", ref: "cloudReadInputs", type: "espide_cloud_read_inputs" },
    { op: "create", ref: "cloudPrint", type: "text_print", fromToolbox: false },
    { op: "create", ref: "cloudInput", type: "espide_cloud_get_input", fields: { INDEX: "1" } },
    { op: "connect_input", parent: "cloudPrint", input: "TEXT", child: "cloudInput" },
    { op: "connect_sequence", parent: "cloudStart", child: "cloudSetOutput" },
    { op: "connect_sequence", parent: "cloudSetOutput", child: "cloudSync" },
    { op: "connect_sequence", parent: "cloudSync", child: "cloudReadInputs" },
    { op: "connect_sequence", parent: "cloudReadInputs", child: "cloudPrint" }
  ];

  const preview = await call("espide_apply_workspace_patch", {
    expectedRevision: before.revision,
    description: "ESP IDE Cloud live test preview",
    dryRun: true,
    operations
  });
  assert.equal(preview.committed, false);
  assert.equal(preview.validation?.valid, true);

  const committed = await call("espide_apply_workspace_patch", {
    expectedRevision: before.revision,
    description: "ESP IDE Cloud live test",
    operations
  });
  assert.equal(committed.committed, true);
  undoToken = committed.undoToken;

  const generated = await call("espide_get_generated_code");
  assert.match(generated.code, /from EspIdeCloud import EspIdeCloud/);
  assert.match(generated.code, /secure=False/);
  assert.match(generated.code, /cloud\.set_output\(0, 0\)/);
  assert.match(generated.code, /cloud\.sync\(\)/);
  assert.match(generated.code, /cloud\.read_inputs\(\)/);
  assert.match(generated.code, /cloud\.get_input\(1\)/);

  const validation = await call("espide_validate_workspace");
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);

  await call("espide_undo_workspace_patch", { token: undoToken });
  undoToken = null;
  const after = await call("espide_get_workspace");
  assert.equal(after.blockCount, before.blockCount, "Undo did not restore the original workspace block count.");

  console.log(JSON.stringify({
    ok: true,
    page: bridge.activePage.pageUrl,
    addon: { name: cloudAddon.name, version: cloudAddon.version, enabled: cloudAddon.enabled },
    blockTypes: listed.blocks.map((item) => item.type),
    generatedCode: generated.code,
    validation: { valid: validation.valid, warnings: validation.warnings.length },
    workspaceRestored: after.blockCount === before.blockCount
  }, null, 2));
} finally {
  if (undoToken) {
    try { await call("espide_undo_workspace_patch", { token: undoToken }); } catch (_) {}
  }
  await client.close();
}
