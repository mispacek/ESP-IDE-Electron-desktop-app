"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  collectWorkspaceBlockTypes,
  createRegistry
} = require("./blockly_project_dependencies.js");

function workspace(types) {
  return {
    getAllBlocks() {
      return types.map(type => ({ type }));
    }
  };
}

function createBlockly() {
  return {
    Blocks: {
      program_start: {},
      math_number: {},
      text: {}
    },
    Python: {
      program_start() {},
      math_number() {},
      text() {}
    }
  };
}

function install(registry, blockly, entries) {
  registry.trackRegistrations(blockly, setOwner => {
    for (const [name, installer] of entries) {
      setOwner(name);
      installer(blockly);
    }
    setOwner("");
  });
}

test("collects nested and shadow blocks through the live workspace API", () => {
  assert.deepEqual(
    Array.from(collectWorkspaceBlockTypes(workspace([
      "program_start",
      "aht_init",
      "math_number",
      "aht_init"
    ]))),
    ["program_start", "aht_init", "math_number"]
  );
});

test("built-in-only projects contain no add-ons", () => {
  const registry = createRegistry();
  const blockly = createBlockly();
  registry.captureCore(blockly);

  const result = registry.resolve(
    workspace(["program_start", "math_number"]),
    {},
    null
  );
  assert.deepEqual(result.names, []);
});

test("selects exactly the add-ons that registered used blocks", () => {
  const registry = createRegistry();
  const blockly = createBlockly();
  registry.captureCore(blockly);
  install(registry, blockly, [
    ["aht20", b => {
      b.Blocks.aht_init = {};
      b.Python.aht_init = function() {};
    }],
    ["oled_charts", b => {
      b.Blocks.oled_data_add = {};
      b.Python.oled_data_add = function() {};
    }]
  ]);

  const records = {
    aht20: { js: "aht source", xml: "", enabled: true },
    oled_charts: { js: "oled source", xml: "", enabled: true },
    unused: { js: "unused source", xml: "", enabled: true }
  };
  const result = registry.resolve(
    workspace(["program_start", "aht_init", "math_number", "oled_data_add"]),
    records,
    null
  );
  assert.deepEqual(result.names, ["aht20", "oled_charts"]);
});

test("tracks registrations made by a real newblk add-on", () => {
  const registry = createRegistry();
  const blockly = createBlockly();
  blockly.Blocks = {};
  blockly.Python.definitions_ = {};
  registry.captureCore(blockly);

  const raw = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "addons", "aht20.newblk"),
    "utf8"
  );
  const source = raw.split("<!toolbox!>")[0];
  install(registry, blockly, [
    ["aht20", b => {
      Function("Blockly", source)(b);
    }]
  ]);

  const result = registry.resolve(
    workspace(["aht_init", "aht_temperature"]),
    { aht20: { js: source, xml: "", enabled: true } },
    null
  );
  assert.deepEqual(result.names, ["aht20"]);
});

test("a generator override makes an add-on a project dependency", () => {
  const registry = createRegistry();
  const blockly = createBlockly();
  registry.captureCore(blockly);
  install(registry, blockly, [
    ["custom_math", b => {
      b.Python.math_number = function() {};
    }]
  ]);

  const result = registry.resolve(
    workspace(["math_number"]),
    { custom_math: { js: "custom source", xml: "", enabled: true } },
    null
  );
  assert.deepEqual(result.names, ["custom_math"]);
});

test("used disabled add-ons are still selected as required dependencies", () => {
  const registry = createRegistry();
  const blockly = createBlockly();
  registry.captureCore(blockly);
  install(registry, blockly, [
    ["aht20", b => {
      b.Blocks.aht_init = {};
    }]
  ]);

  const result = registry.resolve(
    workspace(["aht_init"]),
    { aht20: { js: "aht source", xml: "", enabled: false } },
    null
  );
  assert.deepEqual(result.names, ["aht20"]);
});

test("missing sources and unknown custom blocks fail instead of producing incomplete projects", () => {
  const missingRegistry = createRegistry();
  const missingBlockly = createBlockly();
  missingRegistry.captureCore(missingBlockly);
  install(missingRegistry, missingBlockly, [
    ["removed_addon", b => {
      b.Blocks.removed_block = {};
    }]
  ]);

  assert.throws(
    () => missingRegistry.resolve(workspace(["removed_block"]), {}, null),
    error => error.code === "MISSING_EXTENSION_SOURCE"
  );

  const unknownRegistry = createRegistry();
  const unknownBlockly = createBlockly();
  unknownRegistry.captureCore(unknownBlockly);
  assert.throws(
    () => unknownRegistry.resolve(workspace(["unknown_block"]), {}, null),
    error => error.code === "UNRESOLVED_BLOCK_TYPES"
  );
});

test("a failed runtime tracker keeps all available add-ons as a safe fallback", () => {
  const registry = createRegistry();
  const blockly = createBlockly();
  registry.captureCore(blockly);
  registry.markUnreliable("test failure");

  const records = {
    first: { js: "first source", xml: "", enabled: true },
    second: { js: "second source", xml: "", enabled: false }
  };
  const result = registry.resolve(workspace(["program_start"]), records, null);
  assert.deepEqual(result.names, ["first", "second"]);
  assert.equal(result.conservative, true);
});

test("reintegrating an updated add-on removes ownership from its old source", () => {
  const registry = createRegistry();
  const blockly = createBlockly();
  registry.captureCore(blockly);
  install(registry, blockly, [
    ["changing_addon", b => {
      b.Blocks.old_type = {};
    }]
  ]);
  install(registry, blockly, [
    ["changing_addon", b => {
      b.Blocks.new_type = {};
    }]
  ]);

  const records = {
    changing_addon: { js: "new source", xml: "", enabled: true }
  };
  assert.throws(
    () => registry.resolve(workspace(["old_type"]), records, null),
    error => error.code === "UNRESOLVED_BLOCK_TYPES"
  );
  assert.deepEqual(
    registry.resolve(workspace(["new_type"]), records, null).names,
    ["changing_addon"]
  );
});

test("an add-on integration error blocks project export", () => {
  const registry = createRegistry();
  const blockly = createBlockly();
  registry.captureCore(blockly);
  registry.beginIntegration();
  registry.markInvalid("broken add-on");

  assert.throws(
    () => registry.resolve(
      workspace(["program_start"]),
      { broken: { js: "broken source", xml: "", enabled: true } },
      null
    ),
    error => error.code === "EXTENSION_INTEGRATION_FAILED"
  );
});
