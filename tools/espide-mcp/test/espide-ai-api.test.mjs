import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

class FakeConnection {
  constructor(source) {
    this.sourceBlock_ = source;
    this.targetConnection = null;
  }
  connect(other) { this.targetConnection = other; other.targetConnection = this; }
  disconnect() {
    if (!this.targetConnection) return;
    const other = this.targetConnection;
    this.targetConnection = null;
    other.targetConnection = null;
  }
  isConnected() { return !!this.targetConnection; }
  getCheck() { return null; }
}

class FakeBlock {
  constructor(workspace, type) {
    this.workspace = workspace;
    this.type = type;
    this.id = `b${++workspace.idCounter}`;
    this.fields = {};
    this.inputs = {};
    this.inputList = [];
    this.xy = { x: 0, y: 0 };
    if (type === "math_number") {
      this.fields.NUM = "0";
      this.outputConnection = new FakeConnection(this);
    } else if (type === "text_print") {
      this.previousConnection = new FakeConnection(this);
      this.nextConnection = new FakeConnection(this);
      this.inputs.TEXT = { name: "TEXT", type: 1, connection: new FakeConnection(this), fieldRow: [] };
      this.inputList.push(this.inputs.TEXT);
    }
  }
  initSvg() {}
  render() {}
  getField(name) { return Object.hasOwn(this.fields, name) ? { name } : null; }
  setFieldValue(value, name) { this.fields[name] = value; }
  getInput(name) { return this.inputs[name] || null; }
  getParent() { return null; }
  getColour() { return "#000"; }
  getRelativeToSurfaceXY() { return this.xy; }
  moveBy(x, y) { this.xy = { x: this.xy.x + x, y: this.xy.y + y }; }
  getWarningText() { return null; }
  dispose() { this.workspace.blocks.delete(this.id); }
}

class FakeWorkspace {
  constructor() {
    this.blocks = new Map();
    this.listeners = [];
    this.idCounter = 0;
  }
  newBlock(type) { const block = new FakeBlock(this, type); this.blocks.set(block.id, block); return block; }
  getBlockById(id) { return this.blocks.get(id) || null; }
  getAllBlocks() { return Array.from(this.blocks.values()); }
  getTopBlocks() { return this.getAllBlocks(); }
  clear() { this.blocks.clear(); }
  addChangeListener(listener) { this.listeners.push(listener); }
  removeChangeListener(listener) { this.listeners = this.listeners.filter((item) => item !== listener); }
}

function serializeWorkspace(workspace) {
  return JSON.stringify(workspace.getAllBlocks().map((block) => ({
    id: block.id,
    type: block.type,
    fields: block.fields,
    xy: block.xy
  })));
}

function restoreWorkspace(workspace, text) {
  workspace.clear();
  const rows = JSON.parse(text || "[]");
  for (const row of rows) {
    const block = workspace.newBlock(row.type);
    workspace.blocks.delete(block.id);
    block.id = row.id;
    block.fields = Object.assign({}, row.fields);
    block.xy = row.xy;
    workspace.blocks.set(block.id, block);
  }
}

function loadApi() {
  const workspace = new FakeWorkspace();
  const terminal = { output: "", write(data) { this.output += data; } };
  const window = {
    document: { documentElement: { lang: "cs" }, getElementById() { return null; } },
    dispatchEvent() {},
    addEventListener() {},
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    Blockly: {
      INPUT_VALUE: 1,
      selected: null,
      Events: { disable() {}, enable() {} },
      Xml: {
        workspaceToDom(ws) { return { text: serializeWorkspace(ws) }; },
        domToText(dom) { return dom.text; },
        textToDom(text) { JSON.parse(text || "[]"); return { text }; },
        domToWorkspace(dom, ws) { restoreWorkspace(ws, dom.text); return ws.getAllBlocks().map((block) => block.id); }
      },
      Python: { INFINITE_LOOP_TRAP: null, workspaceToCode(ws) { return ws.getAllBlocks().map((block) => block.type).join("\n"); } }
    }
  };
  window.window = window;
  const context = vm.createContext({ window, CustomEvent: window.CustomEvent, console, Date, Math, JSON, Object, Array, Map, Set, String, Number, RegExp, Error });
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(here, "../../../js/espide_ai_api.js"), "utf8");
  vm.runInContext(source, context);
  window.ESPIDE_AI.initialize({
    getWorkspace: () => workspace,
    getTerminal: () => terminal,
    getGeneratedCode: () => window.Blockly.Python.workspaceToCode(workspace),
    getSettings: () => ({ processor: "ESP32", password: "hidden" }),
    getAddons: () => ({ Demo: { version: "1.0.0", enabled: true, js: "x", xml: "y" } }),
    getConnectionState: () => ({ connected: false, activeLink: "none" })
  });
  return { api: window.ESPIDE_AI, workspace, terminal };
}

test("ESPIDE_AI supports dry-run, commit, validation and undo", async () => {
  const { api, workspace, terminal } = loadApi();
  const initialRevision = api.revision;
  const operations = [
    { op: "create", ref: "print", type: "text_print", fromToolbox: false },
    { op: "create", ref: "value", type: "math_number", fromToolbox: false, fields: { NUM: 42 } },
    { op: "connect_input", parent: "print", input: "TEXT", child: "value" }
  ];

  const preview = await api.call("apply_workspace_patch", { expectedRevision: initialRevision, dryRun: true, operations });
  assert.equal(preview.committed, false);
  assert.equal(preview.validation.valid, true);
  assert.equal(workspace.getAllBlocks().length, 0);
  assert.equal(api.revision, initialRevision);

  const commit = await api.call("apply_workspace_patch", { expectedRevision: initialRevision, description: "test", operations });
  assert.equal(commit.committed, true);
  assert.ok(commit.undoToken);
  assert.equal(workspace.getAllBlocks().length, 2);
  assert.match((await api.call("get_generated_code", {})).code, /text_print/);

  const settings = await api.call("get_settings", {});
  assert.equal(settings.password, "[redacted]");
  terminal.write("first\r\nsecond");
  assert.match((await api.call("get_terminal", { lines: 10 })).text, /first/);

  const undone = await api.call("undo_workspace_patch", { token: commit.undoToken });
  assert.equal(undone.undone, true);
  assert.equal(workspace.getAllBlocks().length, 0);
});

test("ESPIDE_AI rolls back a failed transaction", async () => {
  const { api, workspace } = loadApi();
  await assert.rejects(
    api.call("apply_workspace_patch", {
      operations: [
        { op: "create", ref: "value", type: "math_number", fromToolbox: false },
        { op: "set_field", block: "value", field: "MISSING", value: 1 }
      ]
    }),
    /Field not found/
  );
  assert.equal(workspace.getAllBlocks().length, 0);
});
