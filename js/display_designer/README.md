# ESP IDE Display Designer

This directory contains the UI and scene-management code for the adaptive
monochrome display editor. Projects without display-target metadata keep the
original 128x64 behavior.

## Source locations

- Blockly block: `blockly-6.20210701.0/blocks/mpy_blocks.js` from the repository
  root (`blockly-6.20210701.0` is a sibling of `esp_ide_v2`).
- Python generator: `blockly-6.20210701.0/generators/python/mpy.js`.
- Editor UI: `display_designer.js`.
- Editor styles: `display_designer.css`.
- Safe REPL live preview protocol: `live_preview.js`.
- MFNT v1 codec and validator: `mfnt_codec.js`.
- Monochrome bitmap packing, conversion and resize: `bitmap_codec.js`.
- Built-in catalog and previews: `default_fonts/` (generated; see below).
- Lossless BDF/PSF bitmap importers: `bitmap_font_importer.js`.
- MFNT pixel editor: `font_editor.js` and `font_editor.css`.
- System-font Canvas rasterizer: `font_rasterizer.js`.
- Firmware module installed as `/lib/espide_monofont.py`:
  `espide_monofont.py`.
- Static scene compiler and Python-plan builder: `scene_compiler.js`.
- Workspace display-profile registry and public add-on API: `display_targets.js`.
- Toolbox entries: every `esp_ide_v2/toolbox*.xml` variant.

The dialog reuses ESP IDE's global `--ui-*` and `--button-*` CSS variables, so
it follows light/dark theme changes without maintaining separate theme state.
Its modal overlay uses only a translucent color; `backdrop-filter` is
deliberately avoided to keep interaction responsive on tablets and
lower-powered devices.

The block and generator source sections are visibly delimited with
`ESP IDE DISPLAY DESIGNER 128x64 MONOCHROME - BEGIN/END`. They are appended at
the end of the MicroPython source files so future maintainers and AI tools can
find the complete integration quickly.

## Data ownership

The Blockly block mutation is the canonical source of truth. It stores a
versioned JSON scene under the `scene` attribute. Generated Python is an output
only and must never be parsed to recreate the editor state.

The block's **precompute static layers** checkbox is enabled by default and is
stored as a normal Blockly field. In this mode all visible layers without a
dynamic binding are rasterized in the browser into the exact
`width * ceil(height / 8)` byte
`MONO_VLSB` display image. Generated Python performs one fast `buffer[:]` copy,
then dynamic layers are drawn on top. The separate **refresh display** field is
also enabled by default and appends `display.show()` after the complete scene.
Disabling it leaves the framebuffer pending so the user may add other drawing
blocks and refresh later. Static MFNT text is already pixels in this image and
therefore needs neither its font file nor the `espide_monofont` module at
runtime. If composition produces no visible static pixels, the framebuffer
constant is omitted and generated code uses only `fbuf.fill(0)` before drawing
dynamic layers. When precomputation is disabled, one-pixel lines and
square-corner rectangles remain readable `fbuf` commands. Rounded rectangles,
thick lines, and other pixel-only layers use individual transparent blits.
Those local layer bitmaps are generated as `MONO_VLSB`, with height rounded to
eight-pixel pages. This is directly accepted for every layer width, matches the
OLED target layout and avoids the differing HLSB/HMSB horizontal bit-order
conventions.

### Framebuffer alignment and clipping

Every framebuffer producer and reader follows one of two explicit layouts:

- complete scenes and generated local layer buffers use `MONO_VLSB`; their
  allocated height is rounded up to a whole eight-pixel page,
- editable/imported bitmap data uses `MONO_HLSB`; every row occupies
  `ceil(width / 8)` complete bytes.

Padding bits outside the declared width or height are always left at zero.
Pixel readers return black for coordinates outside their source buffer and
pixel writers ignore them, so malformed indexes can neither wrap into another
row nor corrupt adjacent data.

Scene coordinates are signed and may be negative or lie completely outside
the selected display. Objects keep their original dimensions and pixels; clipping
happens only while composing into the final display framebuffer. Direct-mode
pixel layers are first rasterized in their own local coordinate system and
then blitted at the signed scene position. Moving a previously clipped dynamic
layer back onto the display therefore restores all of its original pixels.

## Dynamic layer bindings

Scenes are static by default. The selected layer exposes a compact **Dynamic
block inputs** group where the user may independently enable:

- text value (text layers only),
- X position,
- Y position,
- visibility.

Each enabled property adds one value input to the Display Designer Blockly
block. Turning a property off removes only that input; connections on all
unchanged inputs are preserved. A missing connection falls back to the value
stored in the scene.

As soon as any property is dynamic, the whole layer is excluded from the
static framebuffer. All such layers are listed above static layers in the
editor and are always generated after the static background, so their runtime
composition order is unambiguous. For a line, dynamic X/Y moves the whole line
while preserving the distance between its endpoints.

Generated runtime symbols use the compact scene/layer scheme
`_espide_s<scene>_d<dynamic-layer>` instead of persistent Blockly and layer
IDs. Dynamic X/Y expressions are emitted directly in the drawing call when
they are used once. Lines retain short temporary coordinates because each
origin is referenced by two endpoints and a connected Blockly expression must
not be evaluated twice. A dynamic rounded rectangle or thick line is
rasterized once in the browser and moved or hidden as a transparent bitmap;
radius-zero rectangles still use `rect()`/`fill_rect()` and one-pixel lines
still use `line()` directly in MicroPython.

Dynamic text accepts any Blockly value. The runtime calls `str(value)` and
draws the resulting string; number formatting, decimal places, prefixes and
suffixes intentionally remain the responsibility of ordinary Blockly blocks.
Only dynamically changing text needs its MFNT file uploaded to `/gfx`. The
renderer is imported from the firmware with
`from espide_monofont import MonoFont`; ESP IDE does not upload Python library
source at Run time. Static text stays compiled into pixels. The generator
places the optional `display.show()` only after all static and dynamic layers.

The **store scene data in file** checkbox is disabled by default. It is a
project-wide option: changing it on one Display Designer block mirrors the
value to every scene block, and newly created scenes inherit it. When enabled,
all non-empty static scene images are compiled into one `/gfx/scene.dat`
immediately before `run_code()` uploads the generated program. The generated
source contains only the packed framebuffer index and a shared file loader;
file mode therefore takes precedence over the per-scene precomputation
checkbox. Empty and dynamic-only scenes are omitted from the file and use
`fbuf.fill(0)`. If every scene is empty, `/gfx/scene.dat` is not uploaded.

`scene.dat` is deliberately uncompressed and has no index table:

| Offset | Size | Value |
| --- | ---: | --- |
| 0 | 4 | ASCII `ESCN` |
| 4 | 1 | format version `1` |
| 5 | 1 | framebuffer format `1` (`MONO_VLSB`) |
| 6 | 2 | stored framebuffer count, little endian |
| 8 | 4 | FNV-1a build identifier, little endian |
| 12 | 2 | bytes per scene (`width * ceil(height / 8)`) |
| 14 | 2 | header size (`16`) |
| 16 | N × bytes per scene | raw scene framebuffers |

Stored framebuffer `N` starts at `16 + N * bytes_per_scene`. MicroPython opens the file once, validates
the small header once, and switches scenes with `seek()` followed by
`readinto(buffer)`. No decompression, JSON parsing, allocation of a second
framebuffer, or `display.show()` is involved.

All file-backed scenes in one project must have the same resolution. The
compiler rejects a mixed-size pack instead of generating offsets that would be
ambiguous on the board.

## Adaptive display targets and add-ons

`window.ESPIDE_DISPLAY_TARGETS` is the stable browser API for `.newblk`
display add-ons. A display is considered only when its initialization block is
actually present in the workspace; toolbox entries do not affect the editor.
The most recently created or changed registered init block is active. The use
order is stored as a namespaced marker in Blockly block data, so save/load is
deterministic and existing add-on data is preserved. Deleting the active init
block falls back to the preceding valid target. With no registered init block,
the result is always 128x64.

Minimal registration, guarded for an older ESP IDE:

```javascript
if (window.ESPIDE_DISPLAY_TARGETS) {
  window.ESPIDE_DISPLAY_TARGETS.register("my_epaper_init", function(block) {
    return {
      profileId: "my-epaper-400x300",
      width: 400,
      height: 300,
      mode: "mono",
      label: "My e-paper 4.2"
    };
  });
}
```

An add-on may keep using the built-in `espide_display_designer` scene block; its
editor button resolves the active init profile automatically. A custom newblk
block can own a persistent scene and open the same editor with:

```javascript
Blockly.Blocks["my_epaper_scene"] = {
  init: function() {
    this.appendDummyInput().appendField("e-paper scene");
    if (window.ESPIDE_DISPLAY_TARGETS) {
      window.ESPIDE_DISPLAY_TARGETS.attachDesigner(this, {
        buttonLabel: "Open graphic editor"
      });
    }
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
  }
};
```

`attachDesigner()` chains any mutation handlers already owned by the add-on,
stores its scene under additive mutation attributes, and supplies
`getDisplayDesignerScene()` / `setDisplayDesignerScene()`. The guarded call is
a no-op design choice in older ESP IDE versions: the add-on block still loads,
but has no adaptive editor button. A generator for a custom scene block remains
the add-on's responsibility; using the built-in scene block reuses ESP IDE's
complete generator including dynamic inputs and `scene.dat` support.

Manual width and height in the dialog override the current scene only and are
saved in the additive `espide.adaptive-display-v1` extension. An untouched
default scene adopts the active init profile when opened. A non-empty or
manually sized scene is never silently resized merely because another init
block became active; the dialog shows both values and offers an explicit
"use display profile" action.

The Blockly type remains `espide_display_designer`, mutation version remains
`1`, and the main scene shape remains valid for old projects. Older IDE builds
therefore open the project with their 128x64 fallback while preserving unknown
extension data. As before, an IDE so old that it does not know a block type at
all cannot load that unknown block without its corresponding add-on.

MFNT assets referenced by dynamically changing text are uploaded to `/gfx` as
separate files, including the default 5x8 font when it is needed at runtime.
Equal font binaries are deduplicated, and a successful font upload is cached
for the active device connection until its content fingerprint changes.
The scene pack itself is refreshed on every Run so its build identifier always
matches the generated source.

## Firmware deployment

Copy `espide_monofont.py` to `/lib/espide_monofont.py` in every supported
firmware image. Version 1.4.1 is the minimum runtime expected by this Display
Designer implementation. MicroPython includes `/lib` in its normal module
search path, so generated programs use a conventional import:

```python
from espide_monofont import MonoFont
```

Do not rename the installed file to `monofont.py`; the ESP IDE-specific module
name deliberately avoids collisions with user libraries. Font data remains in
ordinary `/gfx/*.mfnt` files and is not compiled into the firmware.

Current schema:

```json
{
  "schema": "espide.display-designer",
  "version": 1,
  "width": 128,
  "height": 64,
  "mode": "mono",
  "name": "Screen",
  "fonts": [],
  "layers": [
    {
      "id": "rect-1",
      "type": "rect",
      "label": "Main frame",
      "x": 8,
      "y": 6,
      "width": 40,
      "height": 18,
      "radius": 4,
      "filled": false,
      "color": 1,
      "visible": true,
      "bindings": {
        "x": true,
        "visible": true
      }
    },
    {
      "id": "line-1",
      "type": "line",
      "x1": 4,
      "y1": 4,
      "x2": 80,
      "y2": 36,
      "strokeWidth": 3,
      "color": 1,
      "visible": true
    },
    {
      "id": "ellipse-1",
      "type": "ellipse",
      "x": 56,
      "y": 8,
      "width": 32,
      "height": 20,
      "filled": false,
      "color": 1,
      "visible": true
    },
    {
      "id": "text-1",
      "type": "text",
      "x": 4,
      "y": 4,
      "width": 45,
      "height": 8,
      "text": "ABCabc123",
      "color": 0,
      "fontId": "builtin-font-5x8",
      "parameterId": null,
      "visible": true
    },
    {
      "id": "bitmap-1",
      "type": "bitmap",
      "x": 12,
      "y": 10,
      "width": 24,
      "height": 16,
      "name": "logo.png",
      "format": "mono-hlsb",
      "data": "base64 packed pixels",
      "color": 1,
      "transparent": true,
      "visible": true
    }
  ],
  "parameters": []
}
```

`width`, `height`, and `mode` are deliberately fixed by normalization. Every
layer has a stable ID and integer pixel coordinates. Rectangle dimensions are
clamped during load and editing, so corrupt or hand-edited project data cannot
draw outside the 128x64 scene. Later milestones add more layer types and stable
parameter IDs without changing this ownership model.

Every layer may also store a trimmed `label` of up to 40 characters. An empty
label keeps the localized automatic name. A custom label is shown both in the
layer list and beside dynamic Blockly inputs, while the stable layer ID remains
unchanged so connected blocks survive renaming.

Every layer also stores `visible`. Older projects without this property load
with the layer visible. An unchecked layer remains editable in the layer list,
but is omitted from the editor framebuffer, pointer hit testing and future
MicroPython framebuffer output.

Rectangle layers store `radius`, which defaults to `0` for backward
compatibility and is limited to half of the shorter side. Line layers store
`strokeWidth`; supported values match the drawing tool (`1`, `2`, `3`, and
`5` px) and older projects default to `1`.

All ordinary drawable layers store `color` as `1` (white) or `0` (black).
Missing values remain white for compatibility. Older text layers with
`inverted: true` are migrated to `color: 0`; black object pixels overwrite
white pixels from lower layers in static, direct and dynamic rendering.

Text layers already reserve `parameterId`. It is `null` while the visible text
field supplies a literal value. A later Blockly mutation can assign a stable
parameter ID and expose the corresponding external block input without
changing the layer schema or its persistent identity. Typing a new literal in
the designer intentionally clears that binding. Glyph background pixels are
always transparent; use a separate rectangle when an opaque text background
is wanted.

Bitmap layers store only their final 1-bit pixels. `mono-hlsb` is identical to
MicroPython `framebuf.MONO_HLSB`: rows are packed horizontally and the left-most
pixel uses the least-significant bit. This keeps a full 128x64 image at 1024
bytes before Base64 and avoids carrying the original PNG/JPEG inside Blockly
XML. `transparent` selects how zero bits are composited: `true` preserves
lower layers, while `false` draws them in the opposite of the selected object
colour. This preserves an imported black-and-white image while allowing its
set pixels to be recoloured. Older projects default to white with transparency
enabled.
Invalid byte lengths or unknown formats are rejected during scene load.

### Embedded font assets

The optional `scene.fonts` array stores each MFNT v1 binary once as Base64,
together with a stable ID, display name and `.mfnt` filename. Future text
layers reference that ID; they do not duplicate the binary. Keeping the asset
inside the scene mutation makes a `.blk` project portable while still allowing
the editor to export the exact `.mfnt` bytes or upload them to `/fonts`.

ESP IDE's built-in catalog is different from `scene.fonts`: its MFNT binaries
and pre-rendered sample PNGs are ordinary web-app assets. Opening
the text picker loads only catalog metadata and previews. The selected MFNT is
fetched and copied into `scene.fonts` only when a text layer actually uses it;
unused built-ins are removed again when the scene is saved. Imported and
hand-edited fonts remain project assets until the user deletes them explicitly.
The picker always lists the fixed built-in catalog first. User-imported project
fonts retain their project order and are appended after the final built-in
font, so adding a personal font never changes the production catalog order.

MFNT v1 uses an eight-byte header (`MFNT`, version, width, height, format) and
exactly 96 fixed-size glyphs: printable ASCII 32 through 126 plus a fallback.
`mfnt_codec.js` is the only browser implementation of bit packing and validates
the exact length, empty space, fallback warning and unused tail bits. The codec
can read IDs 0 `MONO_HLSB`, 1 `MONO_HMSB` and 2 `MONO_VLSB` for compatibility.
The editor deliberately writes only ID 2 `MONO_VLSB`; imported legacy layouts
are decoded and become canonical VLSB on the next save or export. Every glyph
uses `width * ceil(height / 8)` bytes. The final vertical page is zero-filled
above the logical glyph height.

`espide_monofont.py` is the firmware runtime supplied for this feature. It
keeps one glyph `bytearray` and `FrameBuffer`, opens a font once per complete
text, uses `readinto()` and `blit()`, skips file access for spaces, and
deliberately does not call `display.show()`.

New MFNT files already use `MONO_VLSB`, which is directly accepted for
arbitrary cell widths and keeps the device render loop on its fast
`readinto()` + `blit()` path. No browser or processor conversion is needed.
Before Run, ESP IDE still converts imported legacy HLSB/HMSB assets in the
browser as a compatibility safeguard. Firmware runtime 1.3.0 can also expand
older compact horizontal files in place, so manually copied legacy fonts do
not fail for widths not divisible by eight. Characters outside printable ASCII
32 through 126 are treated as spaces before calculating a file offset, so the
renderer cannot seek beyond the fixed 96-glyph MFNT data area.

### Character spacing contract

Every renderer advances by `glyph width + 1 px`. The mandatory separator is
outside the MFNT glyph cell, so font binaries remain compact and compatible.
It is applied consistently by the OLED designer, font-editor sample, generated
catalog PNGs and `espide_monofont.py`. Text bounds contain separators only
between characters (`count * width + count - 1`); the runtime cursor advances
through the separator after the last character so another `text()` call can
continue at the correct next origin. The runtime's `spacing` argument adds
extra pixels on top of the mandatory one and cannot reduce it.

## Editor controls

- The Blockly block exposes a prominent **Open graphic editor** CTA on its own
  row instead of relying on a small edit icon. The button opens the same
  mutation-backed designer and does not change scene persistence.
- **Rectangle**: press or click, then drag across the display. The editor
  switches back to **Select** after creating one rectangle. Object properties
  provide a pixel corner radius from zero up to half of the shorter side for
  both outline and filled rectangles.
- **Line**: drag from the first endpoint to the second. Bresenham rendering
  keeps the preview strictly monochrome and deterministic. Either blue endpoint
  can be dragged independently; dragging the line itself moves both endpoints.
  Object properties select a 1, 2, 3, or 5 px square-brush stroke.
- **Ellipse**: drag its bounding box like a rectangle. It supports outline and
  filled modes, four resize handles and deterministic pixel-only rasterization
  without browser antialiasing.
- **Text** first opens a compact preview picker for the integrated fonts. The
  custom listbox shows a real pre-rendered `ABCabc123` bitmap for text fonts
  and a numeric sample for the 7 Segment font, so relevant glyphs can be
  compared without loading any MFNT binary into the project. Adding text creates a movable text layer;
  its content and font can be changed from object properties. Selecting black
  in the contextual colour bar renders black glyph pixels without touching the
  surrounding framebuffer. Runtime text uses the existing reusable glyph
  buffer and blit transparency key `1`; no palette or second font is allocated.
- **Bitmap** immediately opens the native file chooser for PNG, JPEG, BMP or
  WebP images up to 16 MB; its service-only file input is never shown in the
  designer. The conversion panel initially fits the image inside
  128x64 without upscaling and exposes output width/height, black threshold,
  inversion and optional Floyd-Steinberg dithering. Source-image alpha becomes
  an unlit bitmap pixel. In the selected bitmap's object properties, **Black
  is transparent** chooses whether those unlit pixels preserve lower layers;
  its active-pixel colour is selected in the contextual bar under the display.
  Transparency is enabled by default. Only the
  converted `mono-hlsb` bytes are embedded in the scene. Imported layers
  support the same move, multi-select, copy, visibility and corner-resize
  workflow as shapes; resizing their stored pixels uses deterministic
  nearest-neighbour sampling.
- **Import or edit fonts** opens the optional MFNT library editor. It can create multiple fixed-cell
  fonts, edit all 96 glyphs pixel by pixel, resize cells, preview sample text,
  import validated `.mfnt`, `.bdf`, `.psf`, `.psfu`, `.psf.gz` and `.psfu.gz`
  files and export the current font. BDF glyph bearings are placed inside the
  declared `FONTBOUNDINGBOX`; PSF1/PSF2 Unicode tables are honored when they
  are present. Missing printable ASCII glyphs use the imported fallback and
  proportional BDF advances are normalized to one fixed cell. All exports use
  MFNT v1 `MONO_VLSB` with height padded to whole 8-pixel pages, so firmware
  does not need a per-font addressing choice or runtime conversion.
  Saving the font library writes it into the scene data; closing with Cancel
  leaves the block untouched.
- **Glyph shift X/Y** translates the actual pixels of all 96 glyphs inside
  their unchanged cells. Negative values move left/up, positive values move
  right/down, newly exposed pixels are cleared, and the editor reports how
  many lit pixels were clipped at a cell edge. The fields reset to zero after
  each application because the operation modifies font data immediately.
- **Preset fonts** in the advanced editor use the same generated catalog as the
  text picker. Pixel-identical duplicates are not added.
- **Generate from system font** rasterizes ASCII 32 through 126 with the same
  cell origin and alphabetic baseline, applies a configurable monochrome
  threshold and creates a visible fallback glyph. On desktop Chromium the
  Local Font Access API can enumerate installed faces after user permission.
  Other browsers and mobile devices can use the manual font-family field and
  the normal Canvas font fallback mechanism. These controls live in a closed
  disclosure panel because preset or imported bitmap fonts are the primary
  workflow.
- System-font generation is a convenience path for arbitrary outline fonts;
  thresholding cannot reconstruct an original bitmap that the browser has
  already antialiased. For exact pixel fonts, use the source bitmap strike.
- `tools/convert-otb-to-mfnt.py` extracts a 1-bit fixed-size EBDT/EBLC strike
  directly from an OpenType Bitmap (`.otb`) file. It does no rasterization, so
  the resulting MFNT pixels are deterministic and identical to the source.
  Example:

  ```text
  python esp_ide_v2/tools/convert-otb-to-mfnt.py source.otb output.mfnt
  ```

  The script requires `fonttools`. Converted files remain subject to the source
  font license; keep the license and attribution next to any distributed font
  catalog.
- **Select**: press inside the topmost layer and drag to move it. Movement is
  constrained to the display bounds. Drag any blue corner handle to resize;
  handles have an enlarged invisible hit area for touch screens.
- Hold `Ctrl`, `Cmd`, or `Shift` while clicking objects or layer-list rows to
  add/remove them from the selection. Dragging any selected object moves the
  complete selection while preserving relative positions. Resize handles are
  intentionally hidden for multi-selection.
- With two or more objects selected, a compact panel aligns their left, center,
  right, top, middle or bottom bounds. Horizontal and vertical distribution
  become available for three or more objects; the outer objects stay fixed and
  equal free space is inserted between all object bounds. Lines participate
  through their endpoint bounding boxes.
- Arrow keys move the selection by one display pixel. `Shift` plus an arrow
  moves it by five pixels. The complete group remains inside 128x64 bounds.
- Exact rectangle position/size or line endpoint coordinates are available in
  the object properties panel. Rectangles also expose filled/outline mode.
- A single selected rectangle, line, ellipse, text or bitmap shows its compact
  **White / Black** colour bar below the display instead of consuming sidebar
  space. Every newly created layer starts white regardless of earlier layer or
  brush choices; black is therefore always an explicit per-layer decision.
- The main toolbar contains one uncluttered **Drawing** tool. Activating it
  reveals a contextual panel below the display with Brush, Eraser and sizes
  1, 2, 3 and 5 px; choosing another main tool hides the panel again. Brush
  and eraser artwork is served locally from `../../media/` as monochrome SVG
  masks, so no icon font or CDN request is required.
- **Brush** creates a transparent full-screen `kind: "drawing"` bitmap layer
  on the first stroke. Bresenham interpolation keeps fast mouse and touch
  strokes continuous. A colored editor-only footprint follows the pointer and
  shows the exact 1/2/3/5-pixel square that the next brush or eraser action
  affects; it is rendered on the selection canvas and is never serialized.
  Selecting an existing drawing before using the brush continues in that
  layer; otherwise a new `Drawing N` layer is created. White and black brush
  buttons choose which mask receives each stroke.
- **Eraser** clears pixels only in the selected drawing (or the topmost drawing
  when none is selected), revealing lower layers without changing them. Each
  completed stroke is one local undo/redo step. Drawing layers store two
  transparent 128x64 `MONO_HLSB` masks: `data` for white and `blackData` for
  black. A pixel absent from both masks is transparent, and old one-mask
  drawings automatically receive an empty black mask. Static framebuffer
  compilation and `/gfx/scene.dat` still need no special firmware support.
  Their editor selection rectangle is derived from the actual painted pixels;
  dragging it changes the layer X/Y offset without resampling the bitmap, and
  subsequent brush strokes are converted back into local bitmap coordinates.
  They can be renamed, hidden, duplicated, deleted and reordered like other
  layers; only visibility may be exposed as a dynamic input.
- **Duplicate** creates new topmost layers offset by three pixels. `Ctrl+C`
  and `Ctrl+V` copy the complete selection with its relative layout and layer
  order. The internal structured-object clipboard does not affect text fields.
  Repeated paste operations cascade copies instead of stacking them exactly.
- Layers are stored bottom-to-top in `scene.layers` and shown topmost-first in
  the layer list. The checkbox before each name controls persistent visibility;
  hidden layers remain in the project but are not rendered. The trash button
  after each name deletes exactly that row after confirmation. Four order buttons
  send the selection to the front/back or move it by one step. They also work
  with multi-selection and preserve the selected layers' relative order.
  Dynamic layers form a separate top group because the device always renders
  them after the static framebuffer.
- Selection outlines and handles use a separate transparent canvas. They are
  editor-only and never become display pixels or serialized scene data.
- The 128x64 grid uses its own device-pixel-aware canvas instead of a CSS
  gradient. The work surface is fitted only to a whole-number physical-pixel
  scale (including 125%, 150% and Retina scaling), so every OLED cell has
  exactly the same size. Every eighth line is slightly stronger to make byte
  and character alignment easier to see.
- The dialog uses a stable grid height and reserves the object-property area,
  so selecting a layer cannot resize or recenter the editor. Property controls
  use a compact 320px area without their own scrollbar; the recovered vertical
  space belongs to the layer panel, whose list scrolls only when its contents
  genuinely exceed the available height.
- The header size button toggles between a larger default dialog and a
  viewport-filling layout without invoking the browser Fullscreen API. On wide
  monitors the working grid remains a centered 1280px unit, so the 300px
  property panel stays 24px from the preview instead of following the right
  edge of the viewport. Below the mobile breakpoint the columns still stack.
- While the modal is open, object copy/paste and delete shortcuts are captured
  before Blockly receives them. This prevents the underlying designer block
  from being duplicated or deleted together with a selected layer. Opening the
  modal also explicitly deselects the source Blockly block and moves DOM focus
  into the dialog, providing a second independent safeguard for `Delete`.
- The header provides a local 40-step undo/redo history for scene edits made
  before Save. `Ctrl+Z`, `Ctrl+Y` and `Ctrl+Shift+Z` are captured only outside
  text inputs, where the browser's native text-editing history remains active.
  Saving still creates the single outer Blockly workspace undo event.
- Closing through the header, Cancel or `Escape` compares the current scene
  with its normalized opening snapshot. A themed warning appears only for
  actual unsaved changes; undoing all the way back to the opening state closes
  immediately. Save and the public programmatic `close()` path do not prompt.
- **Live preview** uses the already connected USB, BLE or WebREPL transport
  without changing its driver. The same raw-REPL entry/exit methods used by
  file upload install small helper functions in board RAM. Updates then use
  ordinary printable `_espide_preview(offset, base64)` commands in friendly
  REPL, followed by `_espide_preview_show()`. The first frame is sent in
  128-byte blocks; later frames send only changed blocks. A 140ms debounce,
  one sequential queue and explicit inter-command delays prevent pointer
  movement from flooding slower boards. While active, a one-second safety
  reconciliation rerenders the scene and passes it through the same diff and
  queue, so a missed UI event is recovered without sending unchanged frames
  or starting a concurrent transfer. The helper accepts any framebuffer
  byte length, validates it against the current scene, looks for the standard
  `buffer` and `display.show()` globals (with `display.buffer` fallback), and
  reports stable ASCII status codes which the UI translates into useful
  errors. Starting a normal project run or closing the designer ends the
  preview session and restores terminal capture/muting state.
- Preview pacing is transport-specific. USB keeps 128-byte framebuffer blocks
  and short delays. BLE uses 48-byte framebuffer blocks; every printable
  command is itself fed to the existing driver in pieces of at most 20
  characters with a 90ms gap, commands are separated by another 140ms, and
  response/raw-command timeouts are extended to 12/15 seconds. The Python
  bootstrap is an ordered list of independently compiled raw-REPL commands
  rather than one large source string, reducing parser peaks on small boards.
  The same sender also bounds long USB/WebREPL commands, but with much shorter
  gaps.

## Build and deployment

After changing Blockly sources, rebuild them in `blockly-6.20210701.0`:

```text
npm run build
```

Then copy `blocks_compressed.js` and `python_compressed.js` into
`esp_ide_v2/js/`. Language files are likewise maintained in the Blockly root
and copied to `esp_ide_v2/js/`.

The catalog source is `../fonts/default`. Rebuild copied MFNT assets, catalog
metadata and deterministic grayscale PNG previews with:

```text
python esp_ide_v2/tools/build-default-font-catalog.py
```

The scene-format regression test does not require a browser:

```text
node --test esp_ide_v2/js/display_designer/display_designer.test.cjs
node --test esp_ide_v2/js/display_designer/blockly_integration.test.cjs
node --test esp_ide_v2/js/display_designer/bitmap_codec.test.cjs
node --test esp_ide_v2/js/display_designer/scene_compiler.test.cjs
node --test esp_ide_v2/js/display_designer/default_font_catalog.test.cjs
node --test esp_ide_v2/js/display_designer/mfnt_codec.test.cjs
node --test esp_ide_v2/js/display_designer/font_rasterizer.test.cjs
node --test esp_ide_v2/js/display_designer/live_preview.test.cjs
python esp_ide_v2/js/display_designer/espide_monofont_test.py
```
