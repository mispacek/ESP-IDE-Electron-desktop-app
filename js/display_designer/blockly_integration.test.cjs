"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {JSDOM} = require("../../../blockly-6.20210701.0/node_modules/jsdom");

const appRoot = path.resolve(__dirname, "../..");

function loadScript(dom, fileName) {
  const source = fs.readFileSync(fileName, "utf8");
  dom.window.eval(source);
}

function loadBlocklyHarness() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "outside-only",
    url: "http://127.0.0.1/esp_ide_v2/"
  });
  dom.window.console = console;
  dom.window.alert = () => {};
  loadScript(dom, path.join(appRoot, "js/blockly_compressed.js"));
  loadScript(dom, path.join(appRoot, "js/cs.js"));
  loadScript(dom, path.join(appRoot, "js/blocks_compressed.js"));
  loadScript(dom, path.join(appRoot, "js/python_compressed.js"));
  loadScript(dom, path.join(appRoot, "js/display_designer/mfnt_codec.js"));
  loadScript(dom, path.join(appRoot, "js/display_designer/bitmap_codec.js"));
  loadScript(dom, path.join(appRoot, "js/display_designer/scene_compiler.js"));
  loadScript(dom, path.join(appRoot, "js/display_designer/display_targets.js"));
  loadScript(dom, path.join(appRoot, "js/display_designer/display_designer.js"));
  return dom;
}

test("Blockly refreshes the display by default and allows manual show timing", () => {
  const dom = loadBlocklyHarness();
  const Blockly = dom.window.Blockly;
  const workspace = new Blockly.Workspace();
  const block = workspace.newBlock("espide_display_designer");

  assert.equal(block.getFieldValue("SHOW_DISPLAY"), "TRUE");
  Blockly.Python.INFINITE_LOOP_TRAP = null;
  assert.match(Blockly.Python.workspaceToCode(workspace), /display\.show\(\)/);

  block.setFieldValue("FALSE", "SHOW_DISPLAY");
  assert.doesNotMatch(
      Blockly.Python.workspaceToCode(workspace), /display\.show\(\)/);
});

test("Blockly keeps file storage global and generates indexed scene loads", () => {
  const dom = loadBlocklyHarness();
  const Blockly = dom.window.Blockly;
  const workspace = new Blockly.Workspace();
  const first = workspace.newBlock("espide_display_designer");

  assert.equal(first.getFieldValue("STORE_SCENE_FILE"), "FALSE");
  first.setFieldValue("TRUE", "STORE_SCENE_FILE");

  const second = workspace.newBlock("espide_display_designer");
  assert.equal(second.getFieldValue("STORE_SCENE_FILE"), "TRUE",
      "new scenes inherit the project-wide choice");

  second.setFieldValue("FALSE", "STORE_SCENE_FILE");
  assert.equal(first.getFieldValue("STORE_SCENE_FILE"), "FALSE");
  assert.equal(second.getFieldValue("STORE_SCENE_FILE"), "FALSE");

  first.setDisplayDesignerScene({
    name: "First",
    fonts: [],
    layers: [{id: "first-pixel", type: "rect", x: 0, y: 0, width: 1, height: 1,
      filled: true, visible: true}]
  }, false);
  second.setDisplayDesignerScene({
    name: "Second",
    fonts: [],
    layers: [{id: "second-pixel", type: "rect", x: 127, y: 63, width: 1, height: 1,
      filled: true, visible: true}]
  }, false);
  first.setFieldValue("TRUE", "STORE_SCENE_FILE");

  Blockly.Python.INFINITE_LOOP_TRAP = null;
  const code = Blockly.Python.workspaceToCode(workspace);
  const assets = dom.window.ESPIDE_DISPLAY_DESIGNER.buildRunAssets(workspace);

  assert.equal((code.match(/open\('\/gfx\/scene\.dat', 'rb'\)/g) || []).length, 1);
  assert.match(code, /_espide_load_scene\(0\)/);
  assert.match(code, /_espide_load_scene\(1\)/);
  assert.doesNotMatch(code, /_espide_scene_[A-Za-z0-9_]+ = \(/);
  assert.doesNotMatch(code, /\\x00\\x00\\x00\\x00/);
  assert.equal(assets.files[0].path, "/gfx/scene.dat");
  assert.equal(assets.files[0].bytes.length, 16 + 2 * 1024);
});

test("Blockly clears an empty default scene without embedding 1024 zero bytes", () => {
  const dom = loadBlocklyHarness();
  const Blockly = dom.window.Blockly;
  const workspace = new Blockly.Workspace();
  const block = workspace.newBlock("espide_display_designer");

  Blockly.Python.INFINITE_LOOP_TRAP = null;
  const code = Blockly.Python.workspaceToCode(workspace);
  const assets = dom.window.ESPIDE_DISPLAY_DESIGNER.buildRunAssets(workspace);

  assert.equal(block.getFieldValue("STORE_SCENE_FILE"), "FALSE");
  assert.match(code, /fbuf\.fill\(0\)/);
  assert.doesNotMatch(code, /_espide_s0_scene = \(/);
  assert.doesNotMatch(code, /buffer\[:\]/);
  assert.doesNotMatch(code, /\/gfx\/scene\.dat/);
  assert.equal(assets.enabled, false);
  assert.equal(assets.files.length, 0);
});

test("adaptive scenes keep the original block type and mutation version", () => {
  const dom = loadBlocklyHarness();
  const Blockly = dom.window.Blockly;
  const workspace = new Blockly.Workspace();
  const block = workspace.newBlock("espide_display_designer");
  block.setDisplayDesignerScene({
    width: 400,
    height: 300,
    extensions: {
      "espide.adaptive-display-v1": {version: 1, width: 400, height: 300}
    },
    layers: []
  }, false);
  const xml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));
  assert.match(xml, /type="espide_display_designer"/);
  assert.match(xml, /display_designer_version="1"/);
  assert.match(xml, /espide\.adaptive-display-v1/);

  const restored = new Blockly.Workspace();
  Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(xml), restored);
  const scene = restored.getAllBlocks(false)[0].getDisplayDesignerScene();
  assert.equal(scene.width, 400);
  assert.equal(scene.height, 300);
});

test("add-on init profile opens an adaptive canvas and manual resolution persists", () => {
  const dom = loadBlocklyHarness();
  const Blockly = dom.window.Blockly;
  const context = {
    clearRect() {}, fillRect() {}, strokeRect() {}, setLineDash() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, ellipse() {}, fill() {},
    save() {}, restore() {}
  };
  dom.window.HTMLCanvasElement.prototype.getContext = () => context;
  dom.window.requestAnimationFrame = callback => { callback(); return 0; };
  dom.window.ResizeObserver = undefined;
  Blockly.Blocks.addon_epaper_init = {
    init() { this.appendDummyInput().appendField("e-paper init"); }
  };
  const workspace = new Blockly.Workspace();
  const init = workspace.newBlock("addon_epaper_init");
  const sceneBlock = workspace.newBlock("espide_display_designer");
  const targets = dom.window.ESPIDE_DISPLAY_TARGETS;
  targets.register("addon_epaper_init", () => ({
    profileId: "weact-42-bw", width: 400, height: 300, label: "WeAct 4.2 BW"
  }));
  targets.markUsed(init);

  targets.openDesigner(sceneBlock);
  const canvas = dom.window.document.querySelector(
      '[data-testid="display-designer-canvas"]');
  assert.equal(canvas.width, 400);
  assert.equal(canvas.height, 300);
  assert.equal(dom.window.document.querySelector('[data-resolution="width"]').value,
      "400");
  const resolutionToggle = dom.window.document.querySelector(
      '[data-action="toggle-resolution"]');
  const resolutionPopover = dom.window.document.querySelector(
      ".espide-display-designer-resolution-popover");
  assert.equal(resolutionPopover.hidden, true);
  assert.match(resolutionToggle.textContent, /400\s*×\s*300/);
  resolutionToggle.click();
  assert.equal(resolutionPopover.hidden, false);
  assert.equal(resolutionToggle.getAttribute("aria-expanded"), "true");

  dom.window.document.querySelector('[data-resolution="width"]').value = "320";
  dom.window.document.querySelector('[data-resolution="height"]').value = "200";
  dom.window.document.querySelector('[data-action="apply-resolution"]').click();
  assert.equal(resolutionPopover.hidden, true);
  assert.equal(resolutionToggle.getAttribute("aria-expanded"), "false");
  dom.window.document.querySelector('[data-action="save"]').click();
  const saved = sceneBlock.getDisplayDesignerScene();
  assert.equal(saved.width, 320);
  assert.equal(saved.height, 200);
  assert.equal(saved.extensions["espide.adaptive-display-v1"].source, "manual");
});

test("newblk scene helper chains mutation storage and respects its init block", () => {
  const dom = loadBlocklyHarness();
  const Blockly = dom.window.Blockly;
  const targets = dom.window.ESPIDE_DISPLAY_TARGETS;
  const context = {clearRect() {}, fillRect() {}, strokeRect() {}, setLineDash() {}};
  dom.window.HTMLCanvasElement.prototype.getContext = () => context;
  dom.window.requestAnimationFrame = () => 0;
  dom.window.ResizeObserver = undefined;
  targets.register("custom_display_init", () => ({
    profileId: "custom-400x300", width: 400, height: 300, label: "Custom e-paper"
  }));
  Blockly.Blocks.custom_display_init = {
    init() { this.appendDummyInput().appendField("custom init"); }
  };
  Blockly.Blocks.custom_display_scene = {
    init() {
      this.appendDummyInput().appendField("custom scene");
      targets.attachDesigner(this, {buttonLabel: "Open designer"});
    }
  };
  const workspace = new Blockly.Workspace();
  const init = workspace.newBlock("custom_display_init");
  const sceneBlock = workspace.newBlock("custom_display_scene");
  targets.markUsed(init);
  targets.openDesigner(sceneBlock);
  assert.equal(dom.window.document.querySelector(
      '[data-testid="display-designer-canvas"]').width, 400);
  dom.window.document.querySelector('[data-action="save"]').click();

  const xml = Blockly.Xml.workspaceToDom(workspace);
  const xmlText = Blockly.Xml.domToText(xml);
  assert.match(xmlText, /espide_display_scene_version="1"/);
  assert.match(xmlText, /espide\.adaptive-display-v1/);
  const restored = new Blockly.Workspace();
  Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(xmlText), restored);
  const restoredScene = restored.getAllBlocks(false)
      .find(block => block.type === "custom_display_scene")
      .getDisplayDesignerScene();
  assert.equal(restoredScene.width, 400);
  assert.equal(restoredScene.height, 300);
});

test("a non-empty legacy scene is not silently resized by another init profile", () => {
  const dom = loadBlocklyHarness();
  const Blockly = dom.window.Blockly;
  const context = {clearRect() {}, fillRect() {}, strokeRect() {}, setLineDash() {}};
  dom.window.HTMLCanvasElement.prototype.getContext = () => context;
  dom.window.requestAnimationFrame = () => 0;
  dom.window.ResizeObserver = undefined;
  Blockly.Blocks.safe_resize_init = {
    init() { this.appendDummyInput().appendField("large display"); }
  };
  const workspace = new Blockly.Workspace();
  const init = workspace.newBlock("safe_resize_init");
  const sceneBlock = workspace.newBlock("espide_display_designer");
  sceneBlock.setDisplayDesignerScene({width: 128, height: 64, layers: [
    {id: "legacy", type: "rect", x: 1, y: 1, width: 8, height: 8,
      filled: true, visible: true}
  ]}, false);
  const targets = dom.window.ESPIDE_DISPLAY_TARGETS;
  targets.register("safe_resize_init", () => ({
    profileId: "large-400x300", width: 400, height: 300, label: "Large display"
  }));
  targets.markUsed(init);
  targets.openDesigner(sceneBlock);

  const canvas = dom.window.document.querySelector(
      '[data-testid="display-designer-canvas"]');
  const useTarget = dom.window.document.querySelector(
      '[data-action="use-target-resolution"]');
  assert.equal(canvas.width, 128);
  assert.equal(canvas.height, 64);
  assert.equal(useTarget.hidden, false);
  useTarget.click();
  assert.equal(canvas.width, 400);
  assert.equal(canvas.height, 300);
});

test("file mode stores only scenes with visible static pixels", () => {
  const dom = loadBlocklyHarness();
  const Blockly = dom.window.Blockly;
  const workspace = new Blockly.Workspace();
  const empty = workspace.newBlock("espide_display_designer");
  const firstStatic = workspace.newBlock("espide_display_designer");
  const secondStatic = workspace.newBlock("espide_display_designer");

  empty.setDisplayDesignerScene({name: "Dynamic only", fonts: [], layers: [{
    id: "dynamic", type: "rect", x: 1, y: 2, width: 3, height: 4,
    filled: true, bindings: {x: true}, visible: true
  }]}, false);
  firstStatic.setDisplayDesignerScene({name: "Static A", fonts: [], layers: [{
    id: "static-a", type: "rect", x: 0, y: 0, width: 1, height: 1,
    filled: true, visible: true
  }]}, false);
  secondStatic.setDisplayDesignerScene({name: "Static B", fonts: [], layers: [{
    id: "static-b", type: "rect", x: 127, y: 63, width: 1, height: 1,
    filled: true, visible: true
  }]}, false);
  empty.setFieldValue("TRUE", "STORE_SCENE_FILE");

  Blockly.Python.INFINITE_LOOP_TRAP = null;
  const code = Blockly.Python.workspaceToCode(workspace);
  const assets = dom.window.ESPIDE_DISPLAY_DESIGNER.buildRunAssets(workspace);

  assert.match(code, /Dynamic only\nfbuf\.fill\(0\)/);
  assert.equal((code.match(/_espide_load_scene\(/g) || []).length, 3,
      "one function definition and two calls are generated");
  assert.match(code, /_espide_load_scene\(0\)/);
  assert.match(code, /_espide_load_scene\(1\)/);
  assert.equal(assets.files.length, 1);
  assert.equal(assets.files[0].path, "/gfx/scene.dat");
  assert.equal(assets.files[0].bytes.length, 16 + 2 * 1024);
  assert.deepEqual(Array.from(
      assets.pack.sceneRecordIndexes).sort((a, b) => a - b),
      [-1, 0, 1],
      "Blockly block IDs define scene order, but exactly one scene is omitted");
});

test("file mode uploads no scene.dat when every scene is dynamic-only", () => {
  const dom = loadBlocklyHarness();
  const Blockly = dom.window.Blockly;
  const workspace = new Blockly.Workspace();
  const block = workspace.newBlock("espide_display_designer");
  block.setDisplayDesignerScene({name: "Dynamic only", fonts: [], layers: [{
    id: "dynamic", type: "rect", x: 1, y: 2, width: 3, height: 4,
    filled: true, bindings: {x: true}, visible: true
  }]}, false);
  block.setFieldValue("TRUE", "STORE_SCENE_FILE");

  Blockly.Python.INFINITE_LOOP_TRAP = null;
  const code = Blockly.Python.workspaceToCode(workspace);
  const assets = dom.window.ESPIDE_DISPLAY_DESIGNER.buildRunAssets(workspace);

  assert.match(code, /fbuf\.fill\(0\)/);
  assert.doesNotMatch(code, /scene\.dat|_espide_load_scene|buffer\[:\]/);
  assert.equal(assets.pack.sceneCount, 0);
  assert.equal(assets.files.length, 0);
  assert.equal(assets.enabled, false);
});

test("bitmap properties preserve transparency and off-screen coordinates", () => {
  const dom = loadBlocklyHarness();
  const context = {
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    setLineDash() {}
  };
  dom.window.HTMLCanvasElement.prototype.getContext = () => context;
  dom.window.requestAnimationFrame = () => 0;
  dom.window.ResizeObserver = undefined;

  let savedScene = null;
  const block = {
    getDisplayDesignerScene: () => ({
      fonts: [],
      layers: [{
        id: "logo", type: "bitmap", x: 0, y: 0, width: 1, height: 1,
        name: "logo.png", format: "mono-hlsb", data: "AQ==",
        transparent: true, bindings: {}, visible: true
      }]
    }),
    setDisplayDesignerScene: scene => {
      savedScene = scene;
    }
  };

  dom.window.ESPIDE_DISPLAY_DESIGNER.open(block);
  const layerButton = dom.window.document.querySelector(
      '.espide-display-designer-layer-name');
  layerButton.click();
  const checkbox = dom.window.document.querySelector(
      '[data-property="transparent"]');
  assert.equal(checkbox.parentElement.hidden, false);
  assert.equal(checkbox.checked, true);
  assert.equal(checkbox.parentElement.textContent.trim(), "Černá je průhledná");

  checkbox.checked = false;
  checkbox.dispatchEvent(new dom.window.Event("change", {bubbles: true}));

  const xInput = dom.window.document.querySelector('[data-property="x"]');
  const yInput = dom.window.document.querySelector('[data-property="y"]');
  xInput.value = "-3";
  xInput.dispatchEvent(new dom.window.Event("change", {bubbles: true}));
  yInput.value = "65";
  yInput.dispatchEvent(new dom.window.Event("change", {bubbles: true}));

  dom.window.document.querySelector('[data-action="save"]').click();

  assert.equal(savedScene.layers[0].transparent, false);
  assert.equal(savedScene.layers[0].x, -3);
  assert.equal(savedScene.layers[0].y, 65);
});

test("font picker keeps 5x8 selected and appends a user font after built-ins", () => {
  const dom = loadBlocklyHarness();
  loadScript(dom, path.join(
      appRoot, "js/display_designer/default_fonts/catalog.js"));
  const context = {
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    setLineDash() {}
  };
  dom.window.HTMLCanvasElement.prototype.getContext = () => context;
  dom.window.HTMLCanvasElement.prototype.toDataURL =
      () => "data:image/png;base64,";
  dom.window.requestAnimationFrame = () => 0;
  dom.window.ResizeObserver = undefined;

  const bytes = dom.window.ESPIDE_MFNT.createBlankFont(
      4, 8, dom.window.ESPIDE_MFNT.CANONICAL_FORMAT);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const block = {
    getDisplayDesignerScene: () => ({
      fonts: [{
        id: "my-font",
        name: "Můj font",
        fileName: "my_font.mfnt",
        data: dom.window.btoa(binary)
      }],
      layers: []
    }),
    setDisplayDesignerScene() {}
  };

  dom.window.ESPIDE_DISPLAY_DESIGNER.open(block);
  dom.window.document.querySelector('[data-action="fonts"]').click();
  const names = Array.from(dom.window.document.querySelectorAll(
      '.espide-display-designer-font-options [role="option"] strong'),
  element => element.textContent);

  assert.equal(
      dom.window.document.querySelector("[data-selected-font-name]").textContent,
      "Font 5×8");
  assert.equal(names.length, dom.window.ESPIDE_DEFAULT_FONTS.length + 1);
  assert.equal(names[names.length - 1], "Můj font");
  dom.window.ESPIDE_DISPLAY_DESIGNER.close();
});

test("selects the visible tail of text wider than the display", () => {
  const dom = loadBlocklyHarness();
  const selectionStrokes = [];
  const context = {
    clearRect() {},
    fillRect() {},
    strokeRect(x, y, width, height) {
      selectionStrokes.push({x, y, width, height});
    },
    setLineDash() {}
  };
  dom.window.HTMLCanvasElement.prototype.getContext = () => context;
  dom.window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 128, height: 64, right: 128, bottom: 64
  });
  dom.window.requestAnimationFrame = () => 0;
  dom.window.ResizeObserver = undefined;

  const mfnt = dom.window.ESPIDE_MFNT;
  const bytes = mfnt.createBlankFont(5, 8, mfnt.FORMAT_HLSB);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const block = {
    getDisplayDesignerScene: () => ({
      fonts: [{
        id: "wide-font",
        name: "Wide",
        fileName: "wide.mfnt",
        data: dom.window.btoa(binary)
      }],
      layers: [{
        id: "wide-text",
        type: "text",
        x: -60,
        y: 2,
        text: "A".repeat(40),
        fontId: "wide-font",
        visible: true
      }]
    }),
    setDisplayDesignerScene() {}
  };

  dom.window.ESPIDE_DISPLAY_DESIGNER.open(block);
  const screen = dom.window.document.querySelector(
      ".espide-display-designer-screen");
  screen.setPointerCapture = () => {};
  screen.hasPointerCapture = () => false;
  screen.releasePointerCapture = () => {};
  screen.dispatchEvent(new dom.window.MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 100,
    clientY: 4
  }));

  const layerButton = dom.window.document.querySelector(
      '.espide-display-designer-layer-name[data-layer-id="wide-text"]');
  assert.equal(layerButton.getAttribute("aria-pressed"), "true",
      "the visible tail remains selectable beyond the former 128px bound");
  assert.ok(selectionStrokes.some(stroke =>
    stroke.x === -59.5 && stroke.width === 238),
  "selection chrome uses the complete 239px text width");
  dom.window.ESPIDE_DISPLAY_DESIGNER.close();
});

test("arrow layer ordering keeps dynamic layers on top and supports local history", () => {
  const dom = loadBlocklyHarness();
  const context = {
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    setLineDash() {}
  };
  dom.window.HTMLCanvasElement.prototype.getContext = () => context;
  dom.window.requestAnimationFrame = () => 0;
  dom.window.ResizeObserver = undefined;

  let savedScene = null;
  const rect = (id, x, bindings = {}) => ({
    id, type: "rect", x, y: 0, width: 2, height: 2,
    filled: true, bindings, visible: true
  });
  const block = {
    getDisplayDesignerScene: () => ({
      fonts: [],
      layers: [
        rect("a", 0),
        rect("b", 3),
        rect("dynamic", 12, {x: true}),
        rect("c", 6),
        rect("d", 9)
      ]
    }),
    setDisplayDesignerScene: scene => {
      savedScene = scene;
    }
  };

  dom.window.ESPIDE_DISPLAY_DESIGNER.open(block);
  const visibleLayerIds = () => Array.from(dom.window.document.querySelectorAll(
      ".espide-display-designer-layer-name"), button => button.dataset.layerId);
  const layerButton = id => dom.window.document.querySelector(
      `.espide-display-designer-layer-name[data-layer-id="${id}"]`);
  const undoButton = dom.window.document.querySelector('[data-action="undo"]');
  const redoButton = dom.window.document.querySelector('[data-action="redo"]');
  assert.equal(dom.window.document.querySelector(
      ".espide-display-designer-layer-drag"), null);
  assert.equal(undoButton.disabled, true);
  layerButton("b").click();
  layerButton("c").dispatchEvent(new dom.window.MouseEvent("click", {
    bubbles: true,
    ctrlKey: true
  }));
  dom.window.document.querySelector('[data-layer-order="front"]').click();
  assert.deepEqual(visibleLayerIds(), ["dynamic", "c", "b", "d", "a"]);
  assert.equal(undoButton.disabled, false);

  dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "z",
    ctrlKey: true,
    bubbles: true,
    cancelable: true
  }));
  assert.deepEqual(visibleLayerIds(), ["dynamic", "d", "c", "b", "a"]);
  assert.equal(redoButton.disabled, false);

  redoButton.click();
  assert.deepEqual(visibleLayerIds(), ["dynamic", "c", "b", "d", "a"]);
  dom.window.document.querySelector('[data-action="save"]').click();

  assert.deepEqual(Array.from(savedScene.layers, layer => layer.id),
      ["a", "d", "b", "c", "dynamic"]);
});

test("multi-selection alignment is compact and distributes only three objects", () => {
  const dom = loadBlocklyHarness();
  const context = {
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    setLineDash() {}
  };
  dom.window.HTMLCanvasElement.prototype.getContext = () => context;
  dom.window.requestAnimationFrame = () => 0;
  dom.window.ResizeObserver = undefined;

  let savedScene = null;
  const block = {
    getDisplayDesignerScene: () => ({
      fonts: [],
      layers: [
        {id: "a", type: "rect", x: 2, y: 1, width: 2, height: 2,
          filled: true, bindings: {}, visible: true},
        {id: "b", type: "rect", x: 8, y: 4, width: 3, height: 2,
          filled: true, bindings: {}, visible: true},
        {id: "c", type: "rect", x: 15, y: 10, width: 2, height: 3,
          filled: true, bindings: {}, visible: true}
      ]
    }),
    setDisplayDesignerScene: scene => {
      savedScene = scene;
    }
  };

  dom.window.ESPIDE_DISPLAY_DESIGNER.open(block);
  const select = (id, additive = false) => {
    dom.window.document.querySelector(
        `.espide-display-designer-layer-name[data-layer-id="${id}"]`)
        .dispatchEvent(new dom.window.MouseEvent("click", {
          bubbles: true,
          ctrlKey: additive
        }));
  };
  const arrange = dom.window.document.querySelector(
      ".espide-display-designer-arrange-fields");
  const distributeX = dom.window.document.querySelector(
      '[data-arrange="distribute-x"]');
  select("a");
  const layerLabel = dom.window.document.querySelector('[data-property="label"]');
  layerLabel.value = "Levý okraj";
  layerLabel.dispatchEvent(new dom.window.Event("change", {bubbles: true}));
  assert.equal(dom.window.document.querySelector(
      '.espide-display-designer-layer-name[data-layer-id="a"]').textContent,
      "Levý okraj");
  select("b", true);
  assert.equal(arrange.hidden, false);
  assert.equal(distributeX.disabled, true);
  select("c", true);
  assert.equal(distributeX.disabled, false);

  dom.window.document.querySelector('[data-arrange="left"]').click();
  dom.window.document.querySelector('[data-action="save"]').click();
  assert.deepEqual(Array.from(savedScene.layers, layer => layer.x), [2, 2, 2]);
  assert.equal(savedScene.layers[0].label, "Levý okraj");
});

test("dynamic bindings create mutation inputs, preserve connections and render last", () => {
  const dom = loadBlocklyHarness();
  const Blockly = dom.window.Blockly;
  const workspace = new Blockly.Workspace();
  const block = workspace.newBlock("espide_display_designer");
  const fontBytes = dom.window.ESPIDE_MFNT.createBlankFont(
      5, 8, dom.window.ESPIDE_MFNT.FORMAT_HLSB);
  const fontData = Buffer.from(fontBytes).toString("base64");
  const scene = {
    name: "Dynamic",
    fonts: [{id: "font", name: "5x8", fileName: "font_5x8.mfnt",
      data: fontData, source: "builtin", catalogId: "font-5x8"}],
    layers: [
      {id: "background", type: "rect", x: 0, y: 0, width: 128, height: 64,
        filled: false, bindings: {}, visible: true},
      {id: "moving", type: "rect", label: "Ukazatel", x: 4, y: 5, width: 6, height: 7,
        filled: true, bindings: {x: true, visible: true}, visible: true},
      {id: "value", type: "text", label: "Hodnota", x: 10, y: 12, width: 5, height: 8,
        text: "0", fontId: "font", parameterId: "value-text",
        bindings: {text: true, y: true}, visible: true}
    ]
  };
  block.setDisplayDesignerScene(scene, false);

  assert.ok(block.getInput("DDYN_moving_X"));
  assert.ok(block.getInput("DDYN_moving_VISIBLE"));
  assert.ok(block.getInput("DDYN_value_TEXT"));
  assert.ok(block.getInput("DDYN_value_Y"));
  assert.equal(block.getInput("DDYN_background_X"), null);
  assert.match(block.getInput("DDYN_moving_X").fieldRow[0].getValue(), /^Ukazatel ·/);

  const xValue = workspace.newBlock("math_number");
  xValue.setFieldValue("17", "NUM");
  block.getInput("DDYN_moving_X").connection.connect(xValue.outputConnection);
  const textValue = workspace.newBlock("math_number");
  textValue.setFieldValue("42", "NUM");
  block.getInput("DDYN_value_TEXT").connection.connect(textValue.outputConnection);

  const editedScene = JSON.parse(JSON.stringify(scene));
  editedScene.layers[2].text = "fallback changed";
  editedScene.layers[1].label = "Pozice";
  block.setDisplayDesignerScene(editedScene, false);
  assert.equal(block.getInput("DDYN_moving_X").connection.targetBlock(), xValue);
  assert.equal(block.getInput("DDYN_value_TEXT").connection.targetBlock(), textValue);
  assert.match(block.getInput("DDYN_moving_X").fieldRow[0].getValue(), /^Pozice ·/);

  const xml = Blockly.Xml.workspaceToDom(workspace);
  const restoredWorkspace = new Blockly.Workspace();
  Blockly.Xml.domToWorkspace(xml, restoredWorkspace);
  const restoredBlock = restoredWorkspace.getAllBlocks(false)
      .find(candidate => candidate.type === "espide_display_designer");
  assert.ok(restoredBlock.getInput("DDYN_moving_X").connection.targetBlock());
  assert.ok(restoredBlock.getInput("DDYN_value_TEXT").connection.targetBlock());
  assert.equal(restoredBlock.getFieldValue("SHOW_DISPLAY"), "TRUE");

  Blockly.Python.INFINITE_LOOP_TRAP = null;
  const code = Blockly.Python.workspaceToCode(restoredWorkspace);
  const assets = dom.window.ESPIDE_DISPLAY_DESIGNER.buildRunAssets(restoredWorkspace);
  assert.match(code, /buffer\[:\] = _espide_s0_scene/);
  assert.doesNotMatch(code, /_espide_(?:x|y)_/);
  assert.match(code, /fbuf\.fill_rect\(int\(17\), 5, 6, 7, 1\)/);
  assert.match(code, /\.text\(fbuf, str\(42\),/);
  assert.ok(code.indexOf("buffer[:") < code.indexOf("fbuf.fill_rect"));
  assert.ok(code.indexOf("fbuf.fill_rect") < code.indexOf(".text(fbuf"));
  assert.ok(code.indexOf(".text(fbuf") < code.indexOf("display.show()"));
  assert.match(code, /from espide_monofont import MonoFont/);
  assert.doesNotMatch(code, /\/gfx\/monofont\.py/);
  assert.deepEqual(Array.from(assets.files, file => file.path), [
    "/gfx/font_5x8.mfnt"
  ]);
});

test("brush creates a continuous drawing layer and eraser clears only its pixels", () => {
  const dom = loadBlocklyHarness();
  const cursorStrokes = [];
  const context = {
    clearRect() {},
    fillRect() {},
    strokeRect(x, y, width, height) {
      cursorStrokes.push({x, y, width, height});
    },
    setLineDash() {}
  };
  dom.window.HTMLCanvasElement.prototype.getContext = () => context;
  dom.window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 128, height: 64, right: 128, bottom: 64
  });
  dom.window.requestAnimationFrame = () => 0;
  dom.window.ResizeObserver = undefined;

  let savedScene = null;
  const block = {
    getDisplayDesignerScene: () => ({fonts: [], layers: []}),
    setDisplayDesignerScene: scene => {
      savedScene = scene;
    }
  };
  dom.window.ESPIDE_DISPLAY_DESIGNER.open(block);
  const screen = dom.window.document.querySelector(".espide-display-designer-screen");
  let captured = false;
  screen.setPointerCapture = () => {
    captured = true;
  };
  screen.hasPointerCapture = () => captured;
  screen.releasePointerCapture = () => {
    captured = false;
  };
  const pointer = (type, x, y) => screen.dispatchEvent(
      new dom.window.MouseEvent(type, {
        bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y
      }));

  const drawingTool = dom.window.document.querySelector('[data-tool="drawing"]');
  const drawingControls = dom.window.document.querySelector(
      ".espide-display-designer-drawing-controls");
  assert.ok(drawingTool);
  assert.ok(drawingTool.querySelector(
      ".espide-display-designer-tool-icon.is-brush"));
  assert.ok(drawingControls.querySelector(
      '[data-drawing-mode="eraser"] .espide-display-designer-tool-icon.is-eraser'));
  assert.equal(dom.window.document.querySelector(
      '.espide-display-designer-toolbar [data-drawing-mode]'), null);
  assert.equal(dom.window.document.querySelector(
      '.espide-display-designer-toolbar [data-brush-size]'), null);
  assert.equal(drawingControls.hidden, true);
  drawingTool.click();
  assert.equal(drawingControls.hidden, false);
  pointer("pointerdown", 5, 5);
  pointer("pointermove", 8, 5);
  pointer("pointerup", 8, 5);

  const layerButton = dom.window.document.querySelector(
      '.espide-display-designer-layer-name[data-layer-id="drawing-1"]');
  assert.ok(layerButton);
  assert.equal(layerButton.textContent, "Nákres 1");
  assert.equal(dom.window.document.querySelector(
      ".espide-display-designer-coordinate-grid").hidden, true);
  assert.equal(dom.window.document.querySelector(
      ".espide-display-designer-bitmap-transparent").hidden, true);
  assert.ok(cursorStrokes.some(stroke => stroke.width === 0.6),
      "1px brush footprint is visible on the editor overlay");

  const brushSizeSelect = dom.window.document.querySelector("[data-brush-size]");
  brushSizeSelect.value = "5";
  brushSizeSelect.dispatchEvent(new dom.window.Event("change", {bubbles: true}));
  pointer("pointermove", 10, 10);
  assert.ok(cursorStrokes.at(-1).width > 4,
      "cursor footprint grows with the selected brush size");
  brushSizeSelect.value = "1";
  brushSizeSelect.dispatchEvent(new dom.window.Event("change", {bubbles: true}));

  const undo = dom.window.document.querySelector('[data-action="undo"]');
  const redo = dom.window.document.querySelector('[data-action="redo"]');
  undo.click();
  assert.equal(dom.window.document.querySelectorAll(
      ".espide-display-designer-layer-name").length, 0);
  redo.click();
  assert.equal(dom.window.document.querySelectorAll(
      ".espide-display-designer-layer-name").length, 1);

  dom.window.document.querySelector('[data-drawing-mode="eraser"]').click();
  pointer("pointerdown", 6, 5);
  pointer("pointerup", 6, 5);
  dom.window.document.querySelector('[data-action="save"]').click();

  const bitmap = require("./bitmap_codec.js");
  const bytes = Buffer.from(savedScene.layers[0].data, "base64");
  assert.equal(savedScene.layers[0].kind, "drawing");
  assert.equal(savedScene.layers[0].transparent, true);
  assert.equal(bitmap.getPixel(bytes, 128, 5, 5), 1);
  assert.equal(bitmap.getPixel(bytes, 128, 6, 5), 0);
  assert.equal(bitmap.getPixel(bytes, 128, 7, 5), 1);
  assert.equal(bitmap.getPixel(bytes, 128, 8, 5), 1);
});

test("closing warns only when the scene has unsaved changes", () => {
  const dom = loadBlocklyHarness();
  const context = {
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    setLineDash() {}
  };
  dom.window.HTMLCanvasElement.prototype.getContext = () => context;
  dom.window.requestAnimationFrame = () => 0;
  dom.window.ResizeObserver = undefined;

  let saveCount = 0;
  const block = {
    getDisplayDesignerScene: () => ({fonts: [], layers: []}),
    setDisplayDesignerScene: () => {
      saveCount++;
    }
  };
  const api = dom.window.ESPIDE_DISPLAY_DESIGNER;
  const editorOverlay = () => dom.window.document.querySelector(
      '[data-testid="display-designer-dialog"]');
  const warning = () => dom.window.document.querySelector(
      ".espide-display-designer-unsaved-overlay");
  const cancel = () => dom.window.document.querySelector(
      ".espide-display-designer-footer [data-action=\"cancel\"]");

  api.open(block);
  cancel().click();
  assert.equal(editorOverlay().hidden, true, "unchanged scene closes immediately");

  api.open(block);
  const nameInput = dom.window.document.querySelector(
      '[data-testid="display-designer-name"]');
  const originalName = nameInput.value;
  nameInput.value = "Changed without blur";
  cancel().click();
  assert.equal(editorOverlay().hidden, false);
  assert.equal(warning().hidden, false);
  assert.equal(warning().querySelector("[data-label=\"unsaved-title\"]").textContent,
      "Neuložené změny");

  warning().querySelector('[data-action="continue-editing"]').click();
  assert.equal(warning().hidden, true);
  assert.equal(editorOverlay().hidden, false);

  dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "Escape", bubbles: true, cancelable: true
  }));
  assert.equal(warning().hidden, false, "Escape requests safe closing");
  dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "Escape", bubbles: true, cancelable: true
  }));
  assert.equal(warning().hidden, true, "second Escape returns to editing");

  cancel().click();
  warning().querySelector('[data-action="discard-changes"]').click();
  assert.equal(editorOverlay().hidden, true);
  assert.equal(saveCount, 0);

  api.open(block);
  const historyName = dom.window.document.querySelector(
      '[data-testid="display-designer-name"]');
  historyName.value = "Temporary";
  historyName.dispatchEvent(new dom.window.Event("change", {bubbles: true}));
  dom.window.document.querySelector('[data-action="undo"]').click();
  assert.equal(historyName.value, originalName);
  cancel().click();
  assert.equal(editorOverlay().hidden, true,
      "undoing back to the opening snapshot removes the warning");
});
