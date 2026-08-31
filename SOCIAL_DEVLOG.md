# ESP IDE Social Development Log

Interní, chronologický zdroj kontextu pro budoucí technické příspěvky o vývoji ESP IDE. Není to veřejný changelog ani marketingový text. Každý záznam zachycuje pouze ověřená fakta o dokončeném významném vývojovém kroku, jeho technické souvislosti a skutečně provedené testování.

Záznamy jsou řazeny od nejnovějšího. Používají pole **Status**, **Version**, **Commit**, **Files**, **What changed**, **Why**, **Technical notes**, **User impact**, **Testing**, **Author note**, **AI inference**, **Social potential** a **Suggested visual**. Neznámé údaje se uvádějí jako `pending`, `unknown` nebo `missing`; domněnky AI zůstávají výhradně v poli **AI inference**.

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

**What changed:**

- Textové bloky pro znak, podřetězec, hledání, změnu velikosti písmen a ořezání mezer nyní bezpečně přijímají číselný vstup po převodu na text.
- Bloky délky a kontroly prázdné hodnoty přijímají čísla a zachovávají původní chování pro texty, seznamy a další kolekce.
- OLED bloky pro běžný i malý text přijímají číslo; generovaný MicroPython hodnotu převede na text.
- Distribuční Blockly bloky a Python generátor byly znovu sestaveny.

**Why:**
unknown

**Technical notes:**
Změna byla provedena ve zdrojových blocích a v Python generátoru distribuovaného Blockly. Commit současně aktualizoval komprimované distribuční soubory pro Blockly i ESP IDE. Veřejný changelog explicitně uvádí bezpečný převod číselného vstupu na text a zachování chování pro další typy kolekcí.

**User impact:**
Číselné hodnoty lze připojit k uvedeným textovým a OLED blokům bez nutnosti vkládat samostatný ruční převod na text.

**Testing:**

- Historický commit obsahuje synchronizovanou aktualizaci českého i anglického changelogu a distribučních artefaktů.
- Konkrétní automatické, browserové ani zařízení testy z historických podkladů: unknown.

**Author note:**
missing

**AI inference:**
Přijetí čísel ve vstupních blocích pravděpodobně snižuje potřebu pomocných převodových bloků a omezuje chyby kompatibility typů v generovaném MicroPythonu.

**Social potential:**
low – jde o praktickou kompatibilitní úpravu s omezeným vizuálním dopadem.

**Suggested visual:**
Krátké before/after Blockly zapojení čísla do OLED textového bloku s ukázkou vygenerovaného MicroPythonu.
