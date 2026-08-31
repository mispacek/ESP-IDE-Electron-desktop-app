/**
 * ESP IDE MFNT font editor.
 *
 * The editor works only with decoded monochrome pixels. ESPIDE_MFNT performs
 * all binary packing, parsing and validation, so import, export and future ESP
 * uploads share exactly the same MFNT v1 contract.
 */
(function(global) {
  "use strict";

  var elements = null;
  var models = [];
  var selectedFontIndex = 0;
  var selectedGlyphIndex = 33; // "A"
  var drawValue = 1;
  var drawing = false;
  var saveCallback = null;
  var previousBodyOverflow = "";
  var localFonts = [];
  var loadedFontFace = null;
  var LEGACY_PRESET_FONTS = [
    {name: "IBM BIOS 8x8", path: "js/display_designer/system_fonts/Bm437_IBM_BIOS.mfnt"},
    {name: "IBM EGA 8x14", path: "js/display_designer/system_fonts/Bm437_IBM_EGA_8x14.mfnt"},
    {name: "IBM VGA 8x16", path: "js/display_designer/system_fonts/Bm437_IBM_VGA_8x16.mfnt"},
    {name: "Toshiba Satellite 9x16", path: "js/display_designer/system_fonts/Bm437_ToshibaSat_9x16.mfnt"},
    {name: "Cordata PPC-21 16x26", path: "js/display_designer/system_fonts/Bm437_Cordata_PPC-21.mfnt"}
  ];

  function presetFonts() {
    if (Array.isArray(global.ESPIDE_DEFAULT_FONTS) && global.ESPIDE_DEFAULT_FONTS.length) {
      return global.ESPIDE_DEFAULT_FONTS.map(function(font) {
        return {id: font.id, name: font.name, path: font.path, fileName: font.fileName};
      });
    }
    return LEGACY_PRESET_FONTS;
  }

  // ESP IDE writes one native framebuffer layout. The codec keeps support for
  // reading older HLSB/HMSB files, but every edited/exported font is VLSB:
  // glyph height is stored in complete 8-pixel pages and unused bits stay 0.
  function canonicalFormat() {
    return codec().CANONICAL_FORMAT;
  }

  function codec() {
    if (!global.ESPIDE_MFNT) throw new Error("MFNT codec is not available");
    return global.ESPIDE_MFNT;
  }

  function message(key, fallback) {
    return global.Blockly && global.Blockly.Msg && global.Blockly.Msg[key] || fallback;
  }

  function bytesToBase64(bytes) {
    var binary = "";
    var chunk = 0x4000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return global.btoa(binary);
  }

  function base64ToBytes(value) {
    var binary = global.atob(String(value || ""));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function cleanName(value, fallback) {
    var name = String(value || "").trim().substring(0, 60);
    return name || fallback;
  }

  function fileNameFor(model) {
    var base = cleanName(model.name, "font")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    return (base || "font") + ".mfnt";
  }

  function nextId() {
    var used = Object.create(null);
    models.forEach(function(model) { used[model.id] = true; });
    var number = 1;
    while (used["font-" + number]) number++;
    return "font-" + number;
  }

  function newModel(width, height, formatId, name) {
    var mfnt = codec();
    formatId = canonicalFormat();
    var bytes = mfnt.createBlankFont(width, height, formatId);
    var font = mfnt.parse(bytes);
    return {
      id: nextId(),
      name: cleanName(name, "Font " + width + "x" + height),
      width: width,
      height: height,
      formatId: formatId,
      glyphs: mfnt.decodeAllGlyphs(font)
    };
  }

  function assetToModel(asset) {
    try {
      var mfnt = codec();
      var validation = mfnt.validate(base64ToBytes(asset && asset.data));
      if (!validation.valid) return null;
      var model = {
        id: cleanName(asset.id, "font-imported"),
        name: cleanName(asset.name, "Font " + validation.font.width + "x" + validation.font.height),
        width: validation.font.width,
        height: validation.font.height,
        formatId: canonicalFormat(),
        glyphs: mfnt.decodeAllGlyphs(validation.font)
      };
      if (asset.source === "builtin") model.source = "builtin";
      if (asset.catalogId) model.catalogId = asset.catalogId;
      if (asset.fileName) model.fileName = asset.fileName;
      return model;
    } catch (error) {
      return null;
    }
  }

  function modelBytes(model) {
    return codec().serialize({
      width: model.width,
      height: model.height,
      formatId: canonicalFormat(),
      glyphs: model.glyphs
    });
  }

  function modelToAsset(model) {
    var asset = {
      id: model.id,
      name: cleanName(model.name, "Font"),
      fileName: model.fileName || fileNameFor(model),
      data: bytesToBase64(modelBytes(model))
    };
    if (model.source === "builtin") asset.source = "builtin";
    if (model.catalogId) asset.catalogId = model.catalogId;
    return asset;
  }

  function currentModel() {
    return models[selectedFontIndex] || null;
  }

  function buildDom() {
    if (elements) return;
    var overlay = document.createElement("div");
    overlay.className = "espide-font-editor-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "espide-font-editor-title");
    overlay.innerHTML =
      '<div class="espide-font-editor-dialog">' +
        '<header class="espide-font-editor-header">' +
          '<div><h2 id="espide-font-editor-title"></h2><p data-label="subtitle"></p></div>' +
          '<button type="button" data-action="cancel" class="espide-font-editor-close">&times;</button>' +
        '</header>' +
        '<div class="espide-font-editor-toolbar">' +
          '<select data-field="font" aria-label="Font"></select>' +
          '<button type="button" data-action="new"></button>' +
          '<button type="button" data-action="import"></button>' +
          '<button type="button" data-action="export"></button>' +
          '<button type="button" data-action="delete-font"></button>' +
          '<input type="file" accept=".mfnt,.bdf,.psf,.psfu,.psf.gz,.psfu.gz,application/octet-stream,text/plain,application/gzip" data-field="file" hidden>' +
        '</div>' +
        '<main class="espide-font-editor-main">' +
          '<section class="espide-font-editor-glyph-panel">' +
            '<h3 data-label="glyphs"></h3><div class="espide-font-editor-glyphs"></div>' +
          '</section>' +
          '<section class="espide-font-editor-pixel-panel">' +
            '<div class="espide-font-editor-glyph-title"></div>' +
            '<div class="espide-font-editor-pixel-stage">' +
              '<canvas data-canvas="glyph"></canvas><div class="espide-font-editor-pixel-grid"></div>' +
            '</div>' +
            '<div class="espide-font-editor-glyph-actions">' +
              '<button type="button" data-action="clear"></button>' +
              '<button type="button" data-action="invert"></button>' +
            '</div>' +
            '<label class="espide-font-editor-sample-label"><span data-label="sample"></span>' +
              '<input type="text" data-field="sample" maxlength="80" value="Hello, ESP IDE!"></label>' +
            '<canvas class="espide-font-editor-sample" data-canvas="sample" width="128" height="64"></canvas>' +
          '</section>' +
          '<aside class="espide-font-editor-settings">' +
            '<section class="espide-font-editor-presets">' +
              '<h3 data-label="presets-title"></h3>' +
              '<label><span data-label="preset-font"></span>' +
                '<select data-field="preset-font"></select></label>' +
              '<button type="button" data-action="add-preset"></button>' +
            '</section>' +
            '<label><span data-label="name"></span><input type="text" data-field="name" maxlength="60"></label>' +
            '<div class="espide-font-editor-size-fields">' +
              '<label><span data-label="width"></span><input type="number" data-field="width" min="1" max="64"></label>' +
              '<label><span data-label="height"></span><input type="number" data-field="height" min="1" max="64"></label>' +
            '</div>' +
            '<button type="button" data-action="resize"></button>' +
            '<div class="espide-font-editor-shift-fields">' +
              '<label><span data-label="shift-x"></span><input type="number" data-field="shift-x" min="-64" max="64" step="1" value="0"></label>' +
              '<label><span data-label="shift-y"></span><input type="number" data-field="shift-y" min="-64" max="64" step="1" value="0"></label>' +
            '</div>' +
            '<p class="espide-font-editor-shift-hint" data-label="shift-hint"></p>' +
            '<button type="button" data-action="shift-glyphs"></button>' +
            '<div class="espide-font-editor-format-note">MFNT v1 <span aria-hidden="true">&middot;</span> MONO_VLSB</div>' +
            '<p class="espide-font-editor-size"></p>' +
            '<details class="espide-font-editor-generator">' +
              '<summary data-label="generator-title"></summary>' +
              '<div class="espide-font-editor-generator-body">' +
                '<button type="button" data-action="load-system-fonts"></button>' +
                '<label><span data-label="system-font"></span>' +
                  '<select data-field="system-font"><option value=""></option></select></label>' +
                '<label class="espide-font-editor-manual-font" hidden><span data-label="font-family"></span>' +
                  '<input type="text" data-field="font-family" value="Arial" maxlength="120"></label>' +
                '<div class="espide-font-editor-generator-grid">' +
                  '<label><span data-label="font-size"></span>' +
                    '<input type="number" data-field="font-size" min="1" max="512"></label>' +
                  '<label><span data-label="threshold"></span>' +
                    '<input type="number" data-field="threshold" min="0" max="255" value="128"></label>' +
                  '<label><span data-label="offset-x"></span>' +
                    '<input type="number" data-field="offset-x" min="-255" max="255" value="0"></label>' +
                  '<label><span data-label="baseline-y"></span>' +
                    '<input type="number" data-field="baseline-y" min="-255" max="510"></label>' +
                '</div>' +
                '<button type="button" data-action="generate-font" class="espide-font-editor-generate"></button>' +
              '</div>' +
            '</details>' +
            '<p class="espide-font-editor-help" data-label="help"></p>' +
            '<p class="espide-font-editor-status" role="status"></p>' +
          '</aside>' +
        '</main>' +
        '<footer class="espide-font-editor-footer">' +
          '<button type="button" data-action="cancel"></button>' +
          '<button type="button" data-action="save" class="espide-font-editor-save"></button>' +
        '</footer>' +
      '</div>';
    document.body.appendChild(overlay);

    elements = {
      overlay: overlay,
      fontSelect: overlay.querySelector('[data-field="font"]'),
      fileInput: overlay.querySelector('[data-field="file"]'),
      presetSelect: overlay.querySelector('[data-field="preset-font"]'),
      presetButton: overlay.querySelector('[data-action="add-preset"]'),
      generatorDetails: overlay.querySelector(".espide-font-editor-generator"),
      nameInput: overlay.querySelector('[data-field="name"]'),
      widthInput: overlay.querySelector('[data-field="width"]'),
      heightInput: overlay.querySelector('[data-field="height"]'),
      glyphOffsetXInput: overlay.querySelector('[data-field="shift-x"]'),
      glyphOffsetYInput: overlay.querySelector('[data-field="shift-y"]'),
      systemFontSelect: overlay.querySelector('[data-field="system-font"]'),
      manualFontControl: overlay.querySelector(".espide-font-editor-manual-font"),
      fontFamilyInput: overlay.querySelector('[data-field="font-family"]'),
      fontSizeInput: overlay.querySelector('[data-field="font-size"]'),
      thresholdInput: overlay.querySelector('[data-field="threshold"]'),
      offsetXInput: overlay.querySelector('[data-field="offset-x"]'),
      baselineYInput: overlay.querySelector('[data-field="baseline-y"]'),
      generateButton: overlay.querySelector('[data-action="generate-font"]'),
      sampleInput: overlay.querySelector('[data-field="sample"]'),
      glyphList: overlay.querySelector(".espide-font-editor-glyphs"),
      glyphTitle: overlay.querySelector(".espide-font-editor-glyph-title"),
      glyphCanvas: overlay.querySelector('[data-canvas="glyph"]'),
      pixelGrid: overlay.querySelector(".espide-font-editor-pixel-grid"),
      sampleCanvas: overlay.querySelector('[data-canvas="sample"]'),
      sizeInfo: overlay.querySelector(".espide-font-editor-size"),
      status: overlay.querySelector(".espide-font-editor-status")
    };

    overlay.addEventListener("click", onClick);
    elements.fontSelect.addEventListener("change", onFontChange);
    elements.fileInput.addEventListener("change", onImport);
    elements.nameInput.addEventListener("input", onNameChange);
    elements.sampleInput.addEventListener("input", renderSample);
    elements.systemFontSelect.addEventListener("change", onSystemFontChange);
    elements.glyphCanvas.addEventListener("pointerdown", onPixelPointerDown);
    elements.glyphCanvas.addEventListener("pointermove", onPixelPointerMove);
    elements.glyphCanvas.addEventListener("pointerup", onPixelPointerUp);
    elements.glyphCanvas.addEventListener("pointercancel", onPixelPointerUp);
    global.addEventListener("keydown", onKeyDown, true);
    global.addEventListener("resize", updateGlyphStageSize);
  }

  function setText(selector, key, fallback) {
    elements.overlay.querySelector(selector).textContent = message(key, fallback);
  }

  function applyTranslations() {
    setText("#espide-font-editor-title", "MPY_FONT_EDITOR_TITLE", "MFNT Font Editor");
    setText('[data-label="subtitle"]', "MPY_FONT_EDITOR_SUBTITLE", "96 monospace ASCII glyphs, MFNT v1");
    setText('[data-label="glyphs"]', "MPY_FONT_EDITOR_GLYPHS", "Glyphs");
    setText('[data-label="sample"]', "MPY_FONT_EDITOR_SAMPLE", "Text preview");
    setText('[data-label="name"]', "MPY_FONT_EDITOR_NAME", "Font name");
    setText('[data-label="width"]', "MPY_DISPLAY_DESIGNER_WIDTH", "Width");
    setText('[data-label="height"]', "MPY_DISPLAY_DESIGNER_HEIGHT", "Height");
    setText('[data-label="shift-x"]', "MPY_FONT_EDITOR_SHIFT_X", "Glyph shift X");
    setText('[data-label="shift-y"]', "MPY_FONT_EDITOR_SHIFT_Y", "Glyph shift Y");
    setText('[data-label="shift-hint"]', "MPY_FONT_EDITOR_SHIFT_HINT", "Negative: left/up, positive: right/down.");
    setText('[data-label="presets-title"]', "MPY_FONT_EDITOR_PRESETS_TITLE", "Preset fonts");
    setText('[data-label="preset-font"]', "MPY_FONT_EDITOR_PRESET_FONT", "ESP IDE font");
    setText('[data-label="generator-title"]', "MPY_FONT_EDITOR_GENERATOR_TITLE", "Generate from system font");
    setText('[data-label="system-font"]', "MPY_FONT_EDITOR_SYSTEM_FONT", "Installed font");
    setText('[data-label="font-family"]', "MPY_FONT_EDITOR_FONT_FAMILY", "Font family or name");
    setText('[data-label="font-size"]', "MPY_FONT_EDITOR_FONT_SIZE", "Font size (px)");
    setText('[data-label="threshold"]', "MPY_FONT_EDITOR_THRESHOLD", "B/W threshold");
    setText('[data-label="offset-x"]', "MPY_FONT_EDITOR_OFFSET_X", "X offset");
    setText('[data-label="baseline-y"]', "MPY_FONT_EDITOR_BASELINE_Y", "Baseline Y");
    setText('[data-label="help"]', "MPY_FONT_EDITOR_HELP", "Click a pixel to toggle it; drag to draw or erase.");
    setText('[data-action="new"]', "MPY_FONT_EDITOR_NEW", "New font");
    setText('[data-action="import"]', "MPY_FONT_EDITOR_IMPORT", "Import font");
    setText('[data-action="export"]', "MPY_FONT_EDITOR_EXPORT", "Export .mfnt");
    setText('[data-action="delete-font"]', "MPY_FONT_EDITOR_DELETE", "Delete font");
    setText('[data-action="clear"]', "MPY_FONT_EDITOR_CLEAR", "Clear glyph");
    setText('[data-action="invert"]', "MPY_FONT_EDITOR_INVERT", "Invert glyph");
    setText('[data-action="resize"]', "MPY_FONT_EDITOR_RESIZE", "Apply size");
    setText('[data-action="shift-glyphs"]', "MPY_FONT_EDITOR_SHIFT_APPLY", "Shift all glyphs");
    setText('[data-action="add-preset"]', "MPY_FONT_EDITOR_ADD_PRESET", "Add font");
    setText('[data-action="load-system-fonts"]', "MPY_FONT_EDITOR_LOAD_SYSTEM_FONTS", "Load installed fonts");
    setText('[data-action="generate-font"]', "MPY_FONT_EDITOR_GENERATE", "Generate 96 glyphs");
    setText('[data-action="save"]', "MPY_FONT_EDITOR_SAVE", "Save font library");
    var cancelButtons = elements.overlay.querySelectorAll('[data-action="cancel"]');
    for (var i = 0; i < cancelButtons.length; i++) {
      if (!cancelButtons[i].classList.contains("espide-font-editor-close")) {
        cancelButtons[i].textContent = message("MPY_DISPLAY_DESIGNER_CANCEL", "Cancel");
      }
      cancelButtons[i].setAttribute("aria-label", message("MPY_DISPLAY_DESIGNER_CANCEL", "Cancel"));
    }
  }

  function glyphLabel(index) {
    if (index === codec().FALLBACK_INDEX) return "? fallback";
    var code = index + codec().FIRST_CHAR;
    return code === 32 ? "SP 32" : String.fromCharCode(code) + " " + code;
  }

  function renderFontSelect() {
    elements.fontSelect.textContent = "";
    models.forEach(function(model, index) {
      var option = document.createElement("option");
      option.value = String(index);
      option.textContent = model.name + " (" + model.width + "x" + model.height + ")";
      elements.fontSelect.appendChild(option);
    });
    elements.fontSelect.value = String(selectedFontIndex);
  }

  function renderPresetFontSelect() {
    elements.presetSelect.textContent = "";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = message("MPY_FONT_EDITOR_PRESET_PLACEHOLDER", "Choose a font...");
    elements.presetSelect.appendChild(placeholder);
    presetFonts().forEach(function(preset, index) {
      var option = document.createElement("option");
      option.value = String(index);
      option.textContent = preset.name;
      elements.presetSelect.appendChild(option);
    });
    elements.presetSelect.value = "";
  }

  function drawPixels(canvas, pixels, width, height, background) {
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.fillStyle = background || "#000";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#fff";
    for (var i = 0; i < pixels.length; i++) {
      if (pixels[i]) context.fillRect(i % width, Math.floor(i / width), 1, 1);
    }
  }

  function renderGlyphButton(index) {
    var button = elements.glyphList.querySelector('[data-glyph="' + index + '"]');
    if (!button) return;
    var model = currentModel();
    drawPixels(button.querySelector("canvas"), model.glyphs[index], model.width, model.height);
  }

  function renderGlyphList() {
    var model = currentModel();
    elements.glyphList.textContent = "";
    for (var index = 0; index < codec().GLYPH_COUNT; index++) {
      var button = document.createElement("button");
      button.type = "button";
      button.dataset.glyph = String(index);
      button.className = index === selectedGlyphIndex ? "is-selected" : "";
      button.title = glyphLabel(index);
      button.setAttribute("aria-label", glyphLabel(index));
      var canvas = document.createElement("canvas");
      var label = document.createElement("span");
      label.textContent = index === codec().FALLBACK_INDEX ? "?" :
          (index === 0 ? "SP" : String.fromCharCode(index + codec().FIRST_CHAR));
      button.appendChild(canvas);
      button.appendChild(label);
      elements.glyphList.appendChild(button);
      drawPixels(canvas, model.glyphs[index], model.width, model.height);
    }
  }

  function renderGlyphEditor() {
    var model = currentModel();
    elements.glyphTitle.textContent = glyphLabel(selectedGlyphIndex);
    drawPixels(elements.glyphCanvas, model.glyphs[selectedGlyphIndex], model.width, model.height);
    updateGlyphStageSize();
    elements.pixelGrid.style.backgroundSize =
        "calc(100% / " + model.width + ") calc(100% / " + model.height + ")";
  }

  /**
   * Use an integer CSS zoom so every bitmap pixel and grid cell occupies an
   * exact number of screen pixels. Fractional scaling made tall OTB glyphs
   * appear to have uneven or missing grid rows even though their data were OK.
   */
  function updateGlyphStageSize() {
    if (!elements || elements.overlay.hidden || !currentModel()) return;
    var model = currentModel();
    var panel = elements.glyphCanvas.parentNode.parentNode;
    var panelWidth = Math.max(240, panel.clientWidth - 32);
    var maxWidth = Math.min(600, panelWidth);
    var maxHeight = Math.min(620, Math.max(360, Math.floor(global.innerHeight * 0.62)));
    var zoom = Math.floor(Math.min(maxWidth / model.width, maxHeight / model.height));
    zoom = Math.max(4, Math.min(40, zoom));
    var stage = elements.glyphCanvas.parentNode;
    stage.style.width = (model.width * zoom) + "px";
    stage.style.height = (model.height * zoom) + "px";
  }

  function renderSample() {
    var model = currentModel();
    if (!model) return;
    var canvas = elements.sampleCanvas;
    var context = canvas.getContext("2d");
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
    var x = 2;
    var y = 2;
    var sample = elements.sampleInput.value || "";
    for (var character of sample) {
      if (character === "\n") { x = 2; y += model.height + 1; continue; }
      var index = codec().glyphIndexForCharacter(character);
      var pixels = model.glyphs[index];
      for (var py = 0; py < model.height; py++) {
        for (var px = 0; px < model.width; px++) {
          if (pixels[py * model.width + px]) context.fillRect(x + px, y + py, 1, 1);
        }
      }
      x += model.width + 1;
      if (x + model.width > canvas.width) { x = 2; y += model.height + 1; }
      if (y >= canvas.height) break;
    }
  }

  function renderSettings() {
    var model = currentModel();
    elements.nameInput.value = model.name;
    elements.widthInput.value = model.width;
    elements.heightInput.value = model.height;
    elements.glyphOffsetXInput.value = 0;
    elements.glyphOffsetYInput.value = 0;
    elements.sizeInfo.textContent = message("MPY_FONT_EDITOR_FILE_SIZE", "File size") +
        ": " + modelBytes(model).length + " B";
  }

  function renderAll() {
    renderFontSelect();
    renderGlyphList();
    renderGlyphEditor();
    renderSettings();
    renderSample();
  }

  function showStatus(value, isError) {
    elements.status.textContent = value || "";
    elements.status.classList.toggle("is-error", !!isError);
  }

  function onClick(event) {
    var button = event.target.closest("button");
    if (!button || !elements.overlay.contains(button)) return;
    var glyph = button.dataset.glyph;
    if (glyph != null) {
      selectedGlyphIndex = Number(glyph);
      renderGlyphList();
      renderGlyphEditor();
      return;
    }
    var action = button.dataset.action;
    if (action === "cancel") close();
    else if (action === "save") save();
    else if (action === "new") addNewFont();
    else if (action === "import") elements.fileInput.click();
    else if (action === "export") exportCurrent();
    else if (action === "delete-font") deleteCurrent();
    else if (action === "clear") changeGlyph("clear");
    else if (action === "invert") changeGlyph("invert");
    else if (action === "resize") resizeCurrent();
    else if (action === "shift-glyphs") shiftAllGlyphs();
    else if (action === "add-preset") addPresetFont();
    else if (action === "load-system-fonts") loadSystemFonts();
    else if (action === "generate-font") generateSystemFont();
  }

  function onFontChange() {
    selectedFontIndex = Number(elements.fontSelect.value) || 0;
    selectedGlyphIndex = 33;
    resetGeneratorDefaults();
    showStatus("");
    renderAll();
  }

  function onNameChange() {
    currentModel().name = cleanName(elements.nameInput.value, "Font");
    renderFontSelect();
  }

  function resetGeneratorDefaults() {
    var model = currentModel();
    elements.fontSizeInput.value = Math.max(1, Math.round(model.height * 0.9));
    elements.offsetXInput.value = 0;
    elements.baselineYInput.value = Math.max(0, model.height - 1);
    elements.thresholdInput.value = 128;
  }

  function onSystemFontChange() {
    var rawIndex = elements.systemFontSelect.value;
    if (rawIndex === "") {
      setManualFontMode(true);
      return;
    }
    var index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || !localFonts[index]) return;
    setManualFontMode(false);
    elements.fontFamilyInput.value = localFonts[index].fullName ||
        localFonts[index].family || localFonts[index].postscriptName || "";
  }

  function setManualFontMode(visible) {
    elements.manualFontControl.hidden = !visible;
  }

  function renderSystemFontSelect() {
    elements.systemFontSelect.textContent = "";
    var manual = document.createElement("option");
    manual.value = "";
    manual.textContent = message("MPY_FONT_EDITOR_MANUAL_FONT", "Manual font name");
    elements.systemFontSelect.appendChild(manual);
    for (var i = 0; i < localFonts.length; i++) {
      var option = document.createElement("option");
      option.value = String(i);
      option.textContent = localFonts[i].fullName || localFonts[i].postscriptName ||
          localFonts[i].family || ("Font " + (i + 1));
      elements.systemFontSelect.appendChild(option);
    }
  }

  async function loadSystemFonts() {
    if (typeof global.queryLocalFonts !== "function") {
      setManualFontMode(true);
      showStatus(message("MPY_FONT_EDITOR_LOCAL_UNSUPPORTED",
          "This browser cannot enumerate local fonts. Enter the font name manually."), true);
      return;
    }
    try {
      showStatus(message("MPY_FONT_EDITOR_LOCAL_LOADING", "Waiting for font permission..."));
      var available = await global.queryLocalFonts();
      var unique = Object.create(null);
      localFonts = [];
      for (var i = 0; i < available.length; i++) {
        var key = available[i].postscriptName || available[i].fullName ||
            (available[i].family + "|" + available[i].style);
        if (unique[key]) continue;
        unique[key] = true;
        localFonts.push(available[i]);
      }
      renderSystemFontSelect();
      if (localFonts.length) {
        elements.systemFontSelect.value = "0";
        onSystemFontChange();
      } else {
        setManualFontMode(true);
      }
      showStatus(message("MPY_FONT_EDITOR_LOCAL_LOADED", "Installed fonts loaded") +
          ": " + localFonts.length);
    } catch (error) {
      setManualFontMode(true);
      showStatus(message("MPY_FONT_EDITOR_LOCAL_DENIED",
          "Local font access was denied or is unavailable:") + " " +
          (error.message || String(error)), true);
    }
  }

  function equalBytes(left, right) {
    if (left.length !== right.length) return false;
    for (var i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
  }

  async function addPresetFont() {
    var rawIndex = elements.presetSelect.value;
    if (rawIndex === "") return;
    var preset = presetFonts()[Number(rawIndex)];
    if (!preset) return;
    elements.presetButton.disabled = true;
    try {
      showStatus(message("MPY_FONT_EDITOR_PRESET_LOADING", "Loading preset font..."));
      var presetUrl = typeof global.resolveAppUrl === "function" ?
          global.resolveAppUrl(preset.path) : preset.path;
      if (typeof global.withAppVersion === "function") presetUrl = global.withAppVersion(presetUrl);
      var response = await global.fetch(presetUrl, {cache: "force-cache"});
      if (!response.ok) throw new Error("HTTP " + response.status);
      var bytes = new Uint8Array(await response.arrayBuffer());
      var validation = codec().validate(bytes);
      if (!validation.valid) throw new Error(validation.errors.join("; "));
      var presetGlyphs = codec().decodeAllGlyphs(validation.font);
      var canonicalPresetBytes = codec().serialize({
        width: validation.font.width,
        height: validation.font.height,
        formatId: canonicalFormat(),
        glyphs: presetGlyphs
      });
      for (var i = 0; i < models.length; i++) {
        if (equalBytes(modelBytes(models[i]), canonicalPresetBytes)) {
          selectedFontIndex = i;
          renderAll();
          showStatus(message("MPY_FONT_EDITOR_PRESET_EXISTS", "This font is already in the project."));
          return;
        }
      }
      models.push({
        id: nextId(),
        name: preset.name,
        fileName: preset.fileName,
        source: preset.id ? "builtin" : undefined,
        catalogId: preset.id,
        width: validation.font.width,
        height: validation.font.height,
        formatId: canonicalFormat(),
        glyphs: presetGlyphs
      });
      selectedFontIndex = models.length - 1;
      selectedGlyphIndex = 33;
      resetGeneratorDefaults();
      renderAll();
      showStatus(message("MPY_FONT_EDITOR_PRESET_ADDED", "Preset font added to the project."));
    } catch (error) {
      showStatus(message("MPY_FONT_EDITOR_PRESET_ERROR", "Preset font could not be loaded:") +
          " " + (error.message || String(error)), true);
    } finally {
      elements.presetButton.disabled = false;
    }
  }

  async function selectedRasterFamily() {
    var rawIndex = elements.systemFontSelect.value;
    var index = rawIndex === "" ? -1 : Number(rawIndex);
    var selected = Number.isInteger(index) && index >= 0 ? localFonts[index] : null;
    if (!selected || typeof selected.blob !== "function" || typeof global.FontFace !== "function") {
      return cleanName(elements.fontFamilyInput.value, "monospace");
    }

    if (loadedFontFace && document.fonts && document.fonts.delete) {
      document.fonts.delete(loadedFontFace);
      loadedFontFace = null;
    }
    var blob = await selected.blob();
    var family = "ESPIDE MFNT Source " + Date.now();
    loadedFontFace = new global.FontFace(family, await blob.arrayBuffer());
    await loadedFontFace.load();
    document.fonts.add(loadedFontFace);
    return family;
  }

  async function generateSystemFont() {
    if (!global.ESPIDE_FONT_RASTERIZER) {
      showStatus("Font rasterizer is not available.", true);
      return;
    }
    if (!global.confirm(message("MPY_FONT_EDITOR_GENERATE_CONFIRM",
        "Replace all 96 glyphs of the current font with generated data?"))) return;

    var model = currentModel();
    elements.generateButton.disabled = true;
    try {
      showStatus(message("MPY_FONT_EDITOR_GENERATING", "Generating font..."));
      var family = await selectedRasterFamily();
      if (document.fonts && document.fonts.load) {
        await document.fonts.load((Number(elements.fontSizeInput.value) || model.height) +
            'px "' + family.replace(/["\\]/g, "") + '"');
      }
      var canvas = document.createElement("canvas");
      canvas.width = model.width;
      canvas.height = model.height;
      var context = canvas.getContext("2d", {willReadFrequently: true});
      model.glyphs = global.ESPIDE_FONT_RASTERIZER.rasterizeAscii(context, {
        width: model.width,
        height: model.height,
        family: family,
        fontSize: Number(elements.fontSizeInput.value),
        offsetX: Number(elements.offsetXInput.value),
        baselineY: Number(elements.baselineYInput.value),
        threshold: Number(elements.thresholdInput.value)
      });
      selectedGlyphIndex = 33;
      renderAll();
      showStatus(message("MPY_FONT_EDITOR_GENERATED",
          "Font generated. Inspect the glyphs and preview before saving."));
    } catch (error) {
      showStatus(message("MPY_FONT_EDITOR_GENERATE_ERROR", "Font generation failed:") +
          " " + (error.message || String(error)), true);
    } finally {
      elements.generateButton.disabled = false;
    }
  }

  function addNewFont() {
    var width = Math.max(1, Math.min(64, Number(elements.widthInput.value) || 8));
    var height = Math.max(1, Math.min(64, Number(elements.heightInput.value) || 8));
    models.push(newModel(width, height, canonicalFormat()));
    selectedFontIndex = models.length - 1;
    selectedGlyphIndex = 33;
    resetGeneratorDefaults();
    renderAll();
  }

  function deleteCurrent() {
    if (models.length === 1) {
      showStatus(message("MPY_FONT_EDITOR_KEEP_ONE", "At least one editable font must remain."), true);
      return;
    }
    models.splice(selectedFontIndex, 1);
    selectedFontIndex = Math.max(0, selectedFontIndex - 1);
    selectedGlyphIndex = 33;
    resetGeneratorDefaults();
    renderAll();
  }

  function resizeCurrent() {
    var model = currentModel();
    var width = Math.max(1, Math.min(64, Number(elements.widthInput.value) || model.width));
    var height = Math.max(1, Math.min(64, Number(elements.heightInput.value) || model.height));
    if (width === model.width && height === model.height) return;
    var resized = [];
    for (var index = 0; index < model.glyphs.length; index++) {
      var pixels = new Uint8Array(width * height);
      for (var y = 0; y < Math.min(height, model.height); y++) {
        for (var x = 0; x < Math.min(width, model.width); x++) {
          pixels[y * width + x] = model.glyphs[index][y * model.width + x];
        }
      }
      resized.push(pixels);
    }
    model.width = width;
    model.height = height;
    model.glyphs = resized;
    resetGeneratorDefaults();
    renderAll();
    showStatus(message("MPY_FONT_EDITOR_RESIZED", "Font cell resized."));
  }

  function shiftAllGlyphs() {
    var model = currentModel();
    var offsetX = Math.max(-64, Math.min(64, Math.trunc(Number(elements.glyphOffsetXInput.value) || 0)));
    var offsetY = Math.max(-64, Math.min(64, Math.trunc(Number(elements.glyphOffsetYInput.value) || 0)));
    if (offsetX === 0 && offsetY === 0) {
      showStatus(message("MPY_FONT_EDITOR_SHIFT_ZERO", "Set a non-zero glyph shift."));
      return;
    }
    var result = codec().shiftGlyphs(model.glyphs, model.width, model.height, offsetX, offsetY);
    model.glyphs = result.glyphs;
    renderAll();
    var status = message("MPY_FONT_EDITOR_SHIFTED", "All glyphs were shifted.");
    if (result.clippedPixels) {
      status += " " + message("MPY_FONT_EDITOR_SHIFT_CLIPPED", "Clipped pixels") +
          ": " + result.clippedPixels + ".";
    }
    showStatus(status);
  }

  function changeGlyph(action) {
    var pixels = currentModel().glyphs[selectedGlyphIndex];
    for (var i = 0; i < pixels.length; i++) pixels[i] = action === "invert" ? 1 - pixels[i] : 0;
    renderGlyphButton(selectedGlyphIndex);
    renderGlyphEditor();
    renderSample();
  }

  function pixelFromPointer(event) {
    var rect = elements.glyphCanvas.getBoundingClientRect();
    var model = currentModel();
    return {
      x: Math.max(0, Math.min(model.width - 1, Math.floor((event.clientX - rect.left) * model.width / rect.width))),
      y: Math.max(0, Math.min(model.height - 1, Math.floor((event.clientY - rect.top) * model.height / rect.height)))
    };
  }

  function paintPointer(event) {
    var model = currentModel();
    var point = pixelFromPointer(event);
    model.glyphs[selectedGlyphIndex][point.y * model.width + point.x] = drawValue;
    renderGlyphEditor();
  }

  function onPixelPointerDown(event) {
    event.preventDefault();
    var model = currentModel();
    var point = pixelFromPointer(event);
    drawValue = model.glyphs[selectedGlyphIndex][point.y * model.width + point.x] ? 0 : 1;
    drawing = true;
    elements.glyphCanvas.setPointerCapture(event.pointerId);
    paintPointer(event);
  }

  function onPixelPointerMove(event) {
    if (drawing) paintPointer(event);
  }

  function onPixelPointerUp(event) {
    if (!drawing) return;
    drawing = false;
    try { elements.glyphCanvas.releasePointerCapture(event.pointerId); } catch (ignore) {}
    renderGlyphButton(selectedGlyphIndex);
    renderSample();
  }

  async function onImport() {
    var file = elements.fileInput.files && elements.fileInput.files[0];
    elements.fileInput.value = "";
    if (!file) return;
    try {
      var bytes = new Uint8Array(await file.arrayBuffer());
      var sourceFormat = "MFNT";
      var warnings = [];
      var width;
      var height;
      var glyphs;
      var isMfnt = bytes.length >= 4 && bytes[0] === 77 && bytes[1] === 70 &&
          bytes[2] === 78 && bytes[3] === 84;
      if (isMfnt) {
        var validation = codec().validate(bytes);
        if (!validation.valid) throw new Error(validation.errors.join("; "));
        width = validation.font.width;
        height = validation.font.height;
        glyphs = codec().decodeAllGlyphs(validation.font);
        warnings = validation.warnings;
      } else {
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
          if (!global.pako || typeof global.pako.ungzip !== "function") {
            throw new Error("Gzip decompressor is not available");
          }
          bytes = global.pako.ungzip(bytes);
        }
        if (!global.ESPIDE_BITMAP_FONT_IMPORTER) {
          throw new Error("Bitmap font importer is not available");
        }
        var imported = global.ESPIDE_BITMAP_FONT_IMPORTER.parse(bytes, file.name);
        sourceFormat = imported.sourceFormat;
        width = imported.width;
        height = imported.height;
        glyphs = imported.glyphs;
        warnings = imported.warnings || [];
      }
      var model = {
        id: nextId(),
        name: cleanName(file.name.replace(/\.(mfnt|bdf|psfu?|psfu?\.gz)$/i, ""), "Imported font"),
        width: width,
        height: height,
        formatId: canonicalFormat(),
        glyphs: glyphs
      };
      models.push(model);
      selectedFontIndex = models.length - 1;
      selectedGlyphIndex = 33;
      resetGeneratorDefaults();
      renderAll();
      showStatus(message("MPY_FONT_EDITOR_IMPORTED", "Font imported successfully.") +
          " (" + sourceFormat + ")" + (warnings.length ? " " + warnings.join("; ") : ""));
    } catch (error) {
      showStatus(message("MPY_FONT_EDITOR_IMPORT_ERROR", "The font file is invalid:") + " " +
          (error.message || String(error)), true);
    }
  }

  function exportCurrent() {
    var model = currentModel();
    var validation = codec().validate(modelBytes(model));
    if (!validation.valid) {
      showStatus(validation.errors.join("; "), true);
      return;
    }
    var blob = new Blob([modelBytes(model)], {type: "application/octet-stream"});
    var anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = fileNameFor(model);
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(function() {
      URL.revokeObjectURL(anchor.href);
      if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
    }, 0);
    showStatus(message("MPY_FONT_EDITOR_EXPORTED", "MFNT font exported."));
  }

  function onKeyDown(event) {
    if (!elements || elements.overlay.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); close();
    } else if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "s") {
      event.preventDefault(); event.stopPropagation(); save();
    }
  }

  function open(options) {
    buildDom();
    applyTranslations();
    options = options || {};
    models = (options.fonts || []).map(assetToModel).filter(Boolean);
    if (!models.length) models = [newModel(8, 8, canonicalFormat(), "Font 8x8")];
    selectedFontIndex = 0;
    selectedGlyphIndex = 33;
    localFonts = [];
    renderPresetFontSelect();
    renderSystemFontSelect();
    elements.generatorDetails.open = false;
    setManualFontMode(typeof global.queryLocalFonts !== "function");
    resetGeneratorDefaults();
    saveCallback = typeof options.onSave === "function" ? options.onSave : null;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    elements.overlay.hidden = false;
    showStatus("");
    renderAll();
  }

  function close() {
    if (!elements || elements.overlay.hidden) return;
    elements.overlay.hidden = true;
    document.body.style.overflow = previousBodyOverflow;
    models = [];
    saveCallback = null;
    localFonts = [];
    if (loadedFontFace && document.fonts && document.fonts.delete) {
      document.fonts.delete(loadedFontFace);
      loadedFontFace = null;
    }
  }

  function save() {
    for (var i = 0; i < models.length; i++) {
      var validation = codec().validate(modelBytes(models[i]));
      if (!validation.valid) {
        selectedFontIndex = i;
        renderAll();
        showStatus(models[i].name + ": " + validation.errors.join("; "), true);
        return;
      }
    }
    if (saveCallback) saveCallback(models.map(modelToAsset));
    close();
  }

  global.ESPIDE_FONT_EDITOR = {open: open, close: close};
})(window);
