# ESP IDE development rules

## Scope

Apply these rules to `esp_ide_v2` and to ESP IDE add-ons in `../addons`.

## Preserve the working tree

- Inspect `git status --short` before editing. Existing changes belong to the user.
- Keep edits focused. Do not reformat the large `index.html` or compressed Blockly/Ace vendor files without a concrete need.
- Use the running app at `http://127.0.0.1/esp_ide_v2/` when behavior depends on Blockly, toolbox localization, transports or add-on loading.

## Local AI/MCP workflow

- Treat `window.ESPIDE_AI` in `js/espide_ai_api.js` as the stable developer interface. Keep DOM details and private globals behind that API.
- Keep MCP tools in `tools/espide-mcp` aligned with `ESPIDE_AI.capabilities()` and the browser bridge protocol.
- The browser MCP bridge is intentionally opt-in so a normal ESP IDE page never probes a stopped WebSocket server. For live AI work, start Codex/MCP first and open `http://127.0.0.1/esp_ide_v2/?espide_mcp=1`; the bridge does not retry forever after a failed connection.
- Before changing a Blockly workspace through MCP, read its revision, preview the patch with `dryRun: true`, inspect generated code and validation, then commit with the same `expectedRevision`.
- Use the returned `undoToken` to undo the most recent AI transaction when verification fails.
- Never read, copy or expose Codex authentication files. The local MCP server must not require or proxy OpenAI credentials.

## `.newblk` add-ons

- Read `../Dokumentace/docs/Doplnky/format-newblk.md` and a nearby working add-on before designing new blocks.
- Keep exactly one `<!toolbox!>` delimiter.
- Preserve repo contracts such as shared bus symbols and processor-specific pin defaults.
- Prefer toolbox templates and classroom-friendly blocks over raw low-level MicroPython APIs.
- Use legal Blockly shadows. Never place a normal `<block>` under `<shadow>` and never put variable references in shadows.
- For bilingual labels inside block definitions, use `espideAddonText("Česky", "English")`.
- For bilingual toolbox text, provide both `data-name-cs`/`data-name-en`, `data-text-cs`/`data-text-en`, or `data-value-cs`/`data-value-en`.
- Validate every edited add-on with:

  `powershell -ExecutionPolicy Bypass -File tools/validate-newblk.ps1 <path-to-addon>`

## Verification

- Run the full local AI and add-on check before reporting completion:

  `powershell -ExecutionPolicy Bypass -File tools/test-local-ai.ps1`

- For live Blockly examples, also use the ESP IDE MCP tools to list blocks, compose a dry-run patch, commit it, generate Python, and validate the resulting workspace.
- Report static validation separately from live browser/device verification. Never claim a device upload or firmware test unless it actually ran on a connected board.

## Repository map and durable workflow

### Boundaries and working tree

- `esp_ide_v2/` is the browser IDE. Its sibling `../blockly-6.20210701.0/` is the editable Blockly source; `../addons/` contains `.newblk` extensions; `../instalace*/` contains firmware/installer work. Do not mix an isolated experiment (for example `../simulator/`) into ESP IDE unless that is the requested scope.
- Start a task with targeted `rg`/`rg --files`, inspect only the relevant source and nearby established pattern, then check `git status --short`. The checkout can already contain meaningful user changes; preserve them and never reset/revert broadly.
- Prefer the smallest coherent patch. Do not reformat `index.html`, vendor code, or compressed/generated files incidentally. Treat processor defaults, pin choices, Blockly XML, generated MicroPython, UI labels, and toolboxes as one user-visible contract.

### Blockly source versus deployed runtime

- Edit source files in `../blockly-6.20210701.0/` (custom blocks commonly live in `blocks/mpy_blocks.js`; generators in `generators/python/mpy.js`; standard text work may also touch `blocks/text.js` and `generators/python/text.js`). Do not edit the compressed distributions as the primary source.
- After a Blockly source change, run `npm.cmd run build` in `../blockly-6.20210701.0/`. Copy only the intentionally rebuilt runtime artifacts, normally `blocks_compressed.js` and/or `python_compressed.js`, to `js/`, then hash-compare source distribution and deployed copy. Review the whole Blockly build diff because the build can regenerate unrelated artifacts.
- `demoWorkspace` is the live Blockly workspace. `Blockly.Python.workspaceToCode(demoWorkspace)` is the generated-code path. The active toolbox can be replaced dynamically, so use the selected processor's toolbox XML rather than assume `toolbox.xml` alone represents the live UI.
- When runtime behavior matters, use the running local application at `http://127.0.0.1/esp_ide_v2/`. Static source inspection or XML parsing is not a substitute for a live workspace import/generation check.

### Localization, examples, and user-facing content

- Keep Czech and English first-class. UI packs are `i18n/cs.json` and `i18n/en.json`; German is `i18n/de.json`. Blockly messages live in `../blockly-6.20210701.0/{cs,en,de}.js` and deployed copies in `js/`. Keep the deployed language files byte-identical to their Blockly source counterpart when those files change.
- Preserve every translation key, placeholder, HTML fragment, control token, and hardware identifier. Compare flattened key sets and placeholder/token parity; translate directions, pins, axes, and labels from both Czech and English context, not mechanically.
- Run `node .github/scripts/validate-i18n.mjs` for translation edits. Browser inspection remains valuable for Blockly wording and symbolic-coordinate labels.
- The Examples menu is catalog-driven through `js/examples_catalog.js`; do not hard-code new menu items. Store localized Blockly projects under `examples/cs/` and `examples/en/` at matching relative paths. Czech resolves Czech then English fallback; other languages resolve English. Parse/load XML before replacing the current workspace so a bad download cannot destroy the current project.
- Keep classroom examples short and concrete: visible output (REPL/LED/display), numeric portable pins when appropriate, wiring comments, clear processor metadata, and generated-code review for electrical or shared-resource risks.

### PWA and static assets

- Any new or changed startup/offline asset requires a Service Worker review in `sw.js`: update the applicable precache lists, then bump `APP_VERSION` in `index.html` as part of the same intentional cache invalidation. New deployment files must also be explicitly tracked.
- For PWA claims, distinguish static manifest/precache inspection from a real browser test. A proper deployed check covers initial load, hard reload/update, normal reload, offline reload, and usable phone/tablet viewport behavior.

### Add-ons and binary data

- Before creating or changing a `.newblk`, read `../Dokumentace/docs/Doplnky/format-newblk.md` and a comparable working add-on. The file has exactly one `<!toolbox!>` separator: JavaScript before it and toolbox XML after it.
- Keep add-ons classroom-friendly. Use `espideAddonText("Česky", "English")` for block text and bilingual `data-*-cs`/`data-*-en` attributes in toolbox XML. Preserve shared generated-symbol contracts, such as I2C bus names `i2c_<scl>_<sda>`, across all generator paths.
- Blockly shadow rules are structural: do not nest normal `<block>` elements in `<shadow>` and do not put variable references in shadows. Validate each add-on with `powershell -ExecutionPolicy Bypass -File tools/validate-newblk.ps1 <path>` before using it in the app.
- Treat Web Serial, Web Bluetooth, WebREPL, USB HID, firmware formats, and persistent settings as contracts. In particular, USB re-enumeration can disconnect REPL; real host/device USB behavior cannot be inferred from generated code. For binary installer assets (`.mpy`, `.dat`, `.mfnt`, `.raw`), preserve bytes with `arrayBuffer`/`Uint8Array`, never a text conversion.

### AI/MCP and evidence levels

- `window.ESPIDE_AI` in `js/espide_ai_api.js` is the stable browser automation interface. Keep direct DOM/private-global dependencies behind it. `window.__espideBlocklyAutomation` is the useful page-level helper when live Blockly composition/listing is needed.
- Start the local MCP service before opening `?espide_mcp=1`; the opt-in bridge intentionally does not retry forever. Keep browser bridge capabilities and `tools/espide-mcp` aligned.
- For a workspace mutation, get the revision, apply a `dryRun`, inspect the patch, generated Python, and validation, then commit with that same `expectedRevision`. Retain/use the returned undo token if verification fails.
- Baseline automated validation is `powershell -ExecutionPolicy Bypass -File tools/test-local-ai.ps1`, plus focused syntax/XML/hash checks appropriate to the edit. Report results in three separate levels: static/local checks; live browser/MCP checks; physical device/host checks. Never promote evidence from one level to another.
