# ESP IDE development log

This is a factual development log for technical communication. It is not a
release changelog or a promise of future behavior. Each entry records the
known status, scope and available testing evidence; unknown historical details
are marked explicitly.

## 2026-08-04 — Numeric inputs for text and OLED blocks

**Status:** released

**Version:** 2.0.152

**Commit:** `15c84d2b339b0c7576c2bb71933147a27a039087`

**Files:**

- `blockly-6.20210701.0/blocks/text.js`
- `blockly-6.20210701.0/blocks/mpy_blocks.js`
- `blockly-6.20210701.0/generators/python/text.js`
- `esp_ide_v2/js/blocks_compressed.js`
- `esp_ide_v2/js/python_compressed.js`
- `esp_ide_v2/changelog_cs.txt`
- `esp_ide_v2/changelog_en.txt`

**What changed:**

- Text and OLED blocks safely accept numeric input by converting it to text.
- Length and empty-value checks keep their previous behavior for strings,
  lists and other collections.
- The distributed Blockly blocks and Python generator were rebuilt.

**Why:** unknown in the historical record.

**Technical notes:**

The change was made in the Blockly sources and Python generator, then carried
into the compressed distribution files used by ESP IDE. The public changelog
records the numeric-to-text conversion and preserved collection behavior.

**User impact:**

Numeric values can be connected to the affected text and OLED blocks without a
separate manual conversion block.

**Testing evidence:**

- The historical commit contains synchronized Czech and English changelog
  updates and rebuilt distribution artifacts.
- Specific automated, browser or device tests from the historical record:
  unknown.

**Author note:** missing

**AI inference:**

Accepting numeric input likely reduces helper conversion blocks and type
compatibility errors in generated MicroPython.

**Social potential:** low

**Suggested visual:**

A short before/after Blockly example connecting a number to an OLED text block,
with the generated MicroPython shown alongside it.
