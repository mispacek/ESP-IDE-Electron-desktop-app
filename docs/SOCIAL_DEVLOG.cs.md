# ESP IDE Social Development Log

Interní chronologický zdroj kontextu pro technické příspěvky o vývoji ESP IDE.
Nejde o veřejný changelog ani marketingový text. Záznamy uvádějí pouze ověřená
fakta, technickou souvislost a skutečně provedené testování.

## 2026-08-04 – Číselné vstupy pro textové a OLED bloky

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

**Co se změnilo:**

- Textové a OLED bloky bezpečně přijímají číselný vstup po převodu na text.
- Bloky délky a kontroly prázdné hodnoty zachovávají původní chování pro texty,
  seznamy a další kolekce.
- Distribuční Blockly bloky a Python generátor byly znovu sestaveny.

**Proč:**
unknown

**Technické poznámky:**
Změna vznikla ve zdrojových blocích a Python generátoru a následně se propsala
do komprimovaných distribučních souborů Blockly i ESP IDE.

**Dopad:**
Číselné hodnoty lze připojit k uvedeným textovým a OLED blokům bez pomocného
ručního převodu na text.

**Testování:**

- Historický commit obsahuje synchronizovaný český a anglický changelog.
- Konkrétní automatické, browserové ani zařízení testy z historických podkladů:
  unknown.

**Poznámka autora:** missing

**AI inference:**
Přijetí čísel pravděpodobně snižuje počet pomocných převodových bloků a chyb
kompatibility typů v generovaném MicroPythonu.

**Social potential:** low

**Suggested visual:**
Krátké before/after Blockly zapojení čísla do OLED textového bloku s ukázkou
vygenerovaného MicroPythonu.
