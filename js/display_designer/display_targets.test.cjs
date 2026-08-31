"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {JSDOM} = require("../../../blockly-6.20210701.0/node_modules/jsdom");

const fileName = path.join(__dirname, "display_targets.js");

function workspace(blocks) {
  return {
    id: "workspace-test",
    blocks,
    listeners: [],
    getAllBlocks() { return this.blocks.slice(); },
    getBlockById(id) { return this.blocks.find(block => block.id === id) || null; },
    addChangeListener(listener) { this.listeners.push(listener); }
  };
}

test("falls back to the legacy 128x64 profile when no init block is present", () => {
  const api = require("./display_targets.js");
  const active = api.getActive(workspace([]));
  assert.equal(active.width, 128);
  assert.equal(active.height, 64);
  assert.equal(active.source, "default");
});

test("an instantiated add-on init block becomes the persistent active target", () => {
  const api = require("./display_targets.js");
  const type = "test_epaper_init";
  api.register(type, block => ({
    profileId: "weact-" + block.size,
    width: block.size === "large" ? 400 : 296,
    height: block.size === "large" ? 300 : 128,
    label: "Test e-paper"
  }));
  const first = {id: "first", type, size: "small", data: "addon-owned-data"};
  const second = {id: "second", type, size: "large", data: ""};
  const ws = workspace([first, second]);

  api.markUsed(first);
  api.markUsed(second);
  let active = api.getActive(ws);
  assert.equal(active.blockId, "second");
  assert.equal(active.width, 400);
  assert.match(second.data, /@espide-display-target-used:/);

  api.markUsed(first);
  active = api.getActive(ws);
  assert.equal(active.blockId, "first");
  assert.match(first.data, /^addon-owned-data\n@espide-display-target-used:/,
      "the namespaced marker preserves add-on block data");

  ws.blocks = [second];
  assert.equal(api.getActive(ws).blockId, "second",
      "deleting the active init block rolls back to the remaining target");
  api.unregister(type);
});

test("newblk code can open the designer through the active init profile", () => {
  const dom = new JSDOM("<!doctype html><body></body>", {runScripts: "outside-only"});
  dom.window.eval(fs.readFileSync(fileName, "utf8"));
  const api = dom.window.ESPIDE_DISPLAY_TARGETS;
  api.register("addon_init", () => ({
    profileId: "addon-400x300", width: 400, height: 300, label: "4.2 e-paper"
  }));
  const init = {id: "init", type: "addon_init", data: ""};
  const editor = {
    id: "scene", type: "addon_scene", data: "",
    getDisplayDesignerScene() { return {layers: []}; },
    setDisplayDesignerScene() {}
  };
  const ws = workspace([init, editor]);
  init.workspace = ws;
  editor.workspace = ws;
  api.markUsed(init);

  let opened = null;
  dom.window.ESPIDE_DISPLAY_DESIGNER = {
    open(block, options) { opened = {block, options}; }
  };
  api.openDesigner(editor);
  assert.equal(opened.block, editor);
  assert.equal(opened.options.target.width, 400);
  assert.equal(opened.options.target.height, 300);
});

test("workspace create and change events update last-used order automatically", () => {
  const api = require("./display_targets.js");
  const type = "event_display_init";
  api.register(type, block => ({width: block.width, height: 64}));
  const first = {id: "event-first", type, width: 128, data: ""};
  const second = {id: "event-second", type, width: 256, data: ""};
  const ws = workspace([first]);
  first.workspace = ws;
  api.getActive(ws);
  ws.blocks.push(second);
  second.workspace = ws;
  ws.listeners[0]({type: "create", ids: [second.id]});
  assert.equal(api.getActive(ws).blockId, second.id);

  first.width = 300;
  ws.listeners[0]({type: "change", blockId: first.id});
  assert.equal(api.getActive(ws).blockId, first.id);
  assert.equal(api.getActive(ws).width, 300);
  api.unregister(type);
});
