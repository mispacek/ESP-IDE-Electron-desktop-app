import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(toolsDirectory, "../..");
const addonPath = path.join(repositoryRoot, "addons", "esp_ide_cloud.newblk");
const libraryPath = path.join(repositoryRoot, "cloud", "device", "EspIdeCloud.py");
const source = fs.readFileSync(addonPath, "utf8");
const parts = source.split("<!toolbox!>");

assert.equal(parts.length, 2, "The add-on must contain exactly one toolbox delimiter.");

const Blockly = {
  Blocks: {},
  Python: {
    definitions_: {},
    ORDER_ATOMIC: 0,
    valueToCode(block, name) {
      return block.values?.[name] || "";
    }
  }
};

const localText = (cs) => cs;
const atobForNode = (value) => Buffer.from(value, "base64").toString("binary");
new Function("Blockly", "espideAddonText", "atob", parts[0])(
  Blockly,
  localText,
  atobForNode
);

const expectedBlocks = [
  "espide_cloud_start",
  "espide_cloud_set_output",
  "espide_cloud_get_input",
  "espide_cloud_sync",
  "espide_cloud_read_inputs",
  "espide_cloud_connected",
  "espide_cloud_last_error",
  "espide_cloud_write_one"
];

for (const type of expectedBlocks) {
  assert.ok(Blockly.Blocks[type], `Missing Blockly definition: ${type}`);
  assert.equal(typeof Blockly.Python[type], "function", `Missing Python generator: ${type}`);
  assert.match(parts[1], new RegExp(`<block\\s+type=["']${type}["']`), `Block is not visible: ${type}`);
}

function block(values = {}, fields = {}) {
  return {
    values,
    getFieldValue(name) {
      return fields[name];
    }
  };
}

const startHttp = Blockly.Python.espide_cloud_start(
  block({ TOKEN: '"eic_d1_TEST_DEVICE_TOKEN_123456789"' }, { CONNECTION: "HTTP" })
);
assert.equal(
  startHttp,
  'cloud = EspIdeCloud("eic_d1_TEST_DEVICE_TOKEN_123456789", secure=False)\n'
);
assert.equal(
  Blockly.Python.definitions_.espide_cloud_import,
  "from EspIdeCloud import EspIdeCloud"
);

const startHttps = Blockly.Python.espide_cloud_start(
  block({ TOKEN: '"eic_d1_TEST_DEVICE_TOKEN_123456789"' }, { CONNECTION: "HTTPS" })
);
assert.match(startHttps, /secure=True/);

assert.equal(
  Blockly.Python.espide_cloud_set_output(block({ VALUE: "23.5" }, { INDEX: "7" })),
  "cloud.set_output(7, 23.5)\n"
);
assert.deepEqual(
  Blockly.Python.espide_cloud_get_input(block({}, { INDEX: "4" })),
  ["cloud.get_input(4)", Blockly.Python.ORDER_ATOMIC]
);
assert.equal(Blockly.Python.espide_cloud_sync(), "cloud.sync()\n");
assert.equal(Blockly.Python.espide_cloud_read_inputs(), "cloud.read_inputs()\n");
assert.equal(
  Blockly.Python.espide_cloud_write_one(block({ VALUE: "23.5" }, { INDEX: "7" })),
  "cloud.write(7, 23.5)\n"
);
assert.deepEqual(Blockly.Python.espide_cloud_connected(), ["cloud.connected", 0]);
assert.deepEqual(
  Blockly.Python.espide_cloud_last_error(),
  ["str(cloud.last_error or '')", 0]
);
assert.doesNotMatch(source, /☁|⬆|️/, "The add-on must not use emoji.");

const generatedPython = [
  Blockly.Python.definitions_.espide_cloud_import,
  "",
  startHttp.trimEnd(),
  Blockly.Python.espide_cloud_set_output(block({ VALUE: "23.5" }, { INDEX: "0" })).trimEnd(),
  Blockly.Python.espide_cloud_sync().trimEnd(),
  Blockly.Python.espide_cloud_read_inputs().trimEnd(),
  `switch_value = ${Blockly.Python.espide_cloud_get_input(block({}, { INDEX: "1" }))[0]}`
].join("\n");

const pythonCheck = spawnSync(
  "python",
  ["-c", "import ast,sys; ast.parse(sys.stdin.read())"],
  { input: generatedPython, encoding: "utf8" }
);
assert.equal(pythonCheck.status, 0, pythonCheck.stderr || "Generated Python is not valid.");

const base64Match = parts[0].match(/var CLOUD_LIBRARY_BASE64 = "([A-Za-z0-9+/=]+)";/);
assert.ok(base64Match, "Embedded MicroPython library is missing.");
const embeddedLibrary = Buffer.from(base64Match[1], "base64");
const sourceLibrary = fs.readFileSync(libraryPath);
assert.deepEqual(embeddedLibrary, sourceLibrary, "Embedded library differs from cloud/device/EspIdeCloud.py.");

console.log("[OK] ESP IDE Cloud add-on generators, toolbox and embedded library");
console.log(generatedPython);
