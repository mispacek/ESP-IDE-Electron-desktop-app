---
name: develop-espide-addons
description: Create, modify, validate, and live-test ESP IDE `.newblk` Blockly add-ons and CZ/EN block examples. Use for work under `addons`, toolbox XML and shadows, Blockly Python generators, processor pin defaults, add-on examples, or runtime verification through the local ESP IDE MCP server.
---

# Develop ESP IDE add-ons

## Gather context

1. Read the repository `AGENTS.md`.
2. Read `../Dokumentace/docs/Doplnky/format-newblk.md` and one or two similar working add-ons.
3. Inspect the current processor, locale, toolbox, workspace, generated code, and installed add-ons through ESP IDE MCP when the page is connected.
4. Preserve user changes and any compatibility contract named in the task.

## Implement an add-on

1. Keep one JavaScript section, exactly one `<!toolbox!>` delimiter, and one toolbox XML fragment.
2. Keep block and generator names stable when updating an existing add-on.
3. Generate concise MicroPython and reuse existing symbols, imports, helpers, and shared buses.
4. Prefer composable, classroom-friendly blocks and toolbox defaults.
5. Use valid shadows and processor-aware `pin_defaults`/`data-pin-role` pairs.
6. Apply the bilingual patterns in [references/addon-and-example-patterns.md](references/addon-and-example-patterns.md) when user-facing labels or examples need CZ/EN support.

## Validate statically

Run:

`powershell -ExecutionPolicy Bypass -File tools/validate-newblk.ps1 <path-to-addon>`

Resolve every error. Review warnings deliberately; do not suppress an existing compatibility mismatch by weakening the validator.

## Verify in live ESP IDE

1. Start Codex/MCP, open or reload `http://127.0.0.1/esp_ide_v2/?espide_mcp=1`, then call `espide_bridge_status`. Stop live verification if no page is connected.
2. Call `espide_get_state` and `espide_list_blocks` for the active processor and locale.
3. Inspect required block inputs with `espide_describe_block`.
4. Read `espide_get_workspace` and keep its `revision`.
5. Preview an example with `espide_apply_workspace_patch` using `dryRun: true` and `expectedRevision`.
6. Inspect the returned validation and Python code before committing the same patch.
7. Call `espide_get_generated_code` and `espide_validate_workspace` after commit.
8. Undo with `espide_undo_workspace_patch` when the result is wrong.

Do not upload to a board or install firmware unless the user explicitly asks and a connected device is available.

## Report

Separate these results:

- static `.newblk` checks,
- live Blockly/toolbox checks,
- generated-code checks,
- real device checks.

State the active processor and locale for every generated example.
