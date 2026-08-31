# ESP IDE add-on and example patterns

## Bilingual block definitions

Use the global helper when creating labels and tooltips:

```javascript
this.appendDummyInput()
  .appendField(espideAddonText("Rozsviť LED", "Turn LED on"));
this.setTooltip(espideAddonText(
  "Nastaví výstupní pin na logickou jedničku.",
  "Sets an output pin high."
));
```

Keep technical identifiers, block types, field names, and generated Python identical in both locales.

## Bilingual toolbox XML

Provide both language variants whenever a direct localized attribute is used:

```xml
<category name="LED" data-name-cs="LED výstupy" data-name-en="LED outputs" colour="#00979d">
  <label text="Základní bloky" data-text-cs="Základní bloky" data-text-en="Basic blocks"></label>
  <block type="demo_led_on"></block>
</category>
```

Supported pairs:

- `data-name-cs` and `data-name-en` for categories,
- `data-text-cs` and `data-text-en` for labels and buttons,
- `data-value-cs` and `data-value-en` for field contents.

The `.newblk` validator reports an incomplete pair.

## Language-neutral Blockly examples

Store examples as workspace XML or transactional patch operations. Block type names, field names, and connections are language-neutral; the active ESP IDE locale supplies visible core Blockly labels. Accompany an example with a Czech and English explanation when requested.

## Transactional patch example

Read the current workspace revision, then preview before commit:

```json
{
  "expectedRevision": 12,
  "description": "Print number 42 / Vypiš číslo 42",
  "dryRun": true,
  "operations": [
    { "op": "create", "ref": "print", "type": "text_print", "fromToolbox": true, "x": 80, "y": 120 },
    { "op": "create", "ref": "value", "type": "math_number", "fromToolbox": true, "fields": { "NUM": 42 } },
    { "op": "connect_input", "parent": "print", "input": "TEXT", "child": "value" }
  ]
}
```

Use toolbox templates by default so shadows, mutators, processor defaults, and translated fields match normal drag-and-drop behavior.

## Required static checks

- exactly one delimiter,
- JavaScript syntax,
- toolbox XML parsing,
- no normal blocks nested in shadows,
- no variable references in shadows,
- visible block definitions and Python generators,
- toolbox button callback registration,
- `pin_defaults` and `data-pin-role` consistency,
- complete CZ/EN attribute pairs.
