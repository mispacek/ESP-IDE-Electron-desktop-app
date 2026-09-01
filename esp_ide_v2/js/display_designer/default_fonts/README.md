# Generated default font catalog

Do not edit the MFNT, PNG or `catalog.js` files in this directory manually.
Their source is `C:\xampp\htdocs\fonts\new_default` and they are rebuilt with:

```text
python esp_ide_v2/tools/build-default-font-catalog.py
```

Text-font PNGs are deterministic 320×80 monochrome previews of `ABCabc123`.
The numeric 7 Segment font uses `0123.456789` instead. Tiny fonts are enlarged
with integer nearest-neighbour scaling; large fonts remain at their native
pixel size. A one-source-pixel gap separates adjacent preview glyphs even when
their MFNT cells have no side bearing. The browser fetches an MFNT file only
after the user creates a text layer with it.
