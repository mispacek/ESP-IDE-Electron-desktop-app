/**
 * ESP IDE Display Designer - adaptive monochrome editor.
 *
 * This module owns editor UI, scene validation and interactive canvas tools.
 * The Blockly block definition remains in
 * blockly-6.20210701.0/blocks/mpy_blocks.js, while the Python generator remains
 * in blockly-6.20210701.0/generators/python/mpy.js.
 *
 * The versioned scene model supports editable shapes, text, imported bitmaps,
 * and freehand drawing. Selection chrome is rendered on a separate canvas and
 * is never stored in scene data.
 */
(function(global) {
  "use strict";

  var SCHEMA = "espide.display-designer";
  var VERSION = 1;
  var DEFAULT_WIDTH = 128;
  var DEFAULT_HEIGHT = 64;
  var WIDTH = DEFAULT_WIDTH;
  var HEIGHT = DEFAULT_HEIGHT;
  var MAX_DIMENSION = 1024;
  var ADAPTIVE_EXTENSION = "espide.adaptive-display-v1";
  /* Stored coordinates may place an object partially or completely outside
   * the display. Limits keep hand-edited projects and generated MicroPython
   * values predictable without forcing visible pixels back inside 128x64. */
  var MIN_COORDINATE = -32768;
  var MAX_COORDINATE = 32767;

  var currentBlock = null;
  var draftScene = null;
  var elements = null;
  var previousBodyOverflow = "";
  var activeTool = "select";
  var brushSize = 1;
  /* Monochrome drawing still has two real colours. The shared selection is
   * reused for newly created shapes, text, bitmaps and brush strokes. */
  var activeColor = 1;
  /* Hover feedback lives only on the editor selection canvas and therefore
   * can never leak into saved scene pixels or generated framebuffers. */
  var brushCursorPoint = null;
  var selectedLayerId = null;
  var selectedLayerIds = [];
  var pointerAction = null;
  /* Internal object clipboard. It deliberately does not overwrite the system
   * clipboard and can therefore safely carry structured layer data. */
  var objectClipboard = null;
  /* Decoded glyphs are cached separately from scene data. A built-in MFNT is
   * still fetched and embedded only after the user actually applies it. */
  var decodedFontCache = Object.create(null);
  /* Bitmap bytes are decoded lazily and cached outside the serializable scene
   * so moving or selecting a layer never repeats Base64 parsing. */
  var decodedBitmapCache = Object.create(null);
  var selectedFontChoice = null;
  var fontPickerLayerId = null;
  var fontPickerBusy = false;
  var bitmapImportSource = null;
  var bitmapImportBytes = null;
  var gridResizeObserver = null;
  var gridRenderFrame = 0;
  /* The modal needs its own history because the Blockly workspace receives a
   * single scene change only after Save. String snapshots are capped to keep
   * imported bitmap/font assets from growing memory without limit. */
  var historyEntries = [];
  var historyIndex = -1;
  var historyRestoring = false;
  var MAX_HISTORY_ENTRIES = 40;
  var initialSceneSnapshot = "";
  var focusBeforeDiscardDialog = null;
  /* Live preview owns no device transport. It uses the small adapter exposed
   * by index.html, while this module only rasterizes and rate-limits frames. */
  var livePreviewActive = false;
  var livePreviewBusy = false;
  var livePreviewTimer = 0;
  var livePreviewPendingFrame = null;
  var livePreviewSending = false;
  var livePreviewLastFrame = null;
  var livePreviewGeneration = 0;
  var livePreviewRefreshInterval = 0;
  var livePreviewProfile = null;
  var currentTarget = null;

  function text(key, fallback) {
    return global.Blockly && global.Blockly.Msg && global.Blockly.Msg[key] || fallback;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function updateHistoryButtons() {
    if (!elements) return;
    elements.undoButton.disabled = historyIndex <= 0;
    elements.redoButton.disabled =
        historyIndex < 0 || historyIndex >= historyEntries.length - 1;
  }

  function recordHistory() {
    if (!draftScene || historyRestoring) return;
    draftScene.name = elements.nameInput.value;
    var serialized = JSON.stringify(draftScene);
    var current = historyEntries[historyIndex];
    if (current && current.serialized === serialized) {
      current.selection = selectedLayerIds.slice();
      updateHistoryButtons();
      return;
    }
    historyEntries = historyEntries.slice(0, historyIndex + 1);
    historyEntries.push({
      serialized: serialized,
      selection: selectedLayerIds.slice()
    });
    if (historyEntries.length > MAX_HISTORY_ENTRIES) historyEntries.shift();
    historyIndex = historyEntries.length - 1;
    updateHistoryButtons();
  }

  function resetHistory() {
    historyEntries = [];
    historyIndex = -1;
    recordHistory();
  }

  function restoreHistory(index) {
    if (index < 0 || index >= historyEntries.length || !draftScene) return;
    historyRestoring = true;
    try {
      historyIndex = index;
      var entry = historyEntries[index];
      draftScene = normalizeScene(JSON.parse(entry.serialized));
      /* The same stable layer ID may contain older bitmap/font bytes after an
       * undo, so decoded caches must not survive history restoration. */
      decodedBitmapCache = Object.create(null);
      decodedFontCache = Object.create(null);
      elements.nameInput.value = draftScene.name;
      setSelection(entry.selection);
      setActiveTool("select");
      renderEditor();
    } finally {
      historyRestoring = false;
      updateHistoryButtons();
    }
  }

  function undoHistory() {
    if (historyIndex > 0) restoreHistory(historyIndex - 1);
  }

  function redoHistory() {
    if (historyIndex < historyEntries.length - 1) restoreHistory(historyIndex + 1);
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function integer(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
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

  function validDimension(value, fallback) {
    var parsed = integer(value, fallback);
    return clamp(parsed, 1, MAX_DIMENSION);
  }

  function requestedDimensions(value, options) {
    value = value && typeof value === "object" ? value : {};
    options = options && typeof options === "object" ? options : {};
    var extension = value.extensions && value.extensions[ADAPTIVE_EXTENSION];
    extension = extension && typeof extension === "object" ? extension : {};
    var width = options.width !== undefined ? options.width :
        (extension.width !== undefined ? extension.width : value.width);
    var height = options.height !== undefined ? options.height :
        (extension.height !== undefined ? extension.height : value.height);
    width = validDimension(width, DEFAULT_WIDTH);
    height = validDimension(height, DEFAULT_HEIGHT);
    if (width * Math.ceil(height / 8) > 0xffff) {
      width = DEFAULT_WIDTH;
      height = DEFAULT_HEIGHT;
    }
    return {width: width, height: height};
  }

  function updateAdaptiveExtension(scene) {
    var extensions = scene.extensions && typeof scene.extensions === "object" ?
        scene.extensions : {};
    var previous = extensions[ADAPTIVE_EXTENSION];
    previous = previous && typeof previous === "object" ? previous : {};
    extensions[ADAPTIVE_EXTENSION] = {
      version: 1,
      width: scene.width,
      height: scene.height,
      profileId: scene.target && scene.target.profileId || previous.profileId || null,
      label: scene.target && scene.target.label || previous.label || null,
      source: scene.target && scene.target.source || previous.source || "scene"
    };
    scene.extensions = extensions;
    return scene;
  }

  /** Return a fresh scene, defaulting to the legacy 128x64 profile. */
  function createEmptyScene(options) {
    var dimensions = requestedDimensions({}, options);
    return updateAdaptiveExtension({
      schema: SCHEMA,
      version: VERSION,
      width: dimensions.width,
      height: dimensions.height,
      mode: "mono",
      name: text("MPY_DISPLAY_DESIGNER_DEFAULT_NAME", "Screen"),
      layers: [],
      fonts: [],
      parameters: []
    });
  }

  function normalizeLayerId(value, index, usedIds, prefix) {
    var base = typeof value === "string" ? value.replace(/[^a-zA-Z0-9_-]/g, "") : "";
    var suffix = 2;
    var fallback = prefix + "-" + (index + 1);
    var candidate = base || fallback;
    while (usedIds[candidate]) {
      candidate = (base || fallback) + "-" + suffix;
      suffix++;
    }
    usedIds[candidate] = true;
    return candidate;
  }

  function normalizeBindings(value, allowedProperties) {
    var source = value && value.bindings && typeof value.bindings === "object" ?
        value.bindings : {};
    var bindings = {};
    for (var i = 0; i < allowedProperties.length; i++) {
      var property = allowedProperties[i];
      if (source[property] === true) bindings[property] = true;
    }
    return bindings;
  }

  function isDrawingLayer(layer) {
    return !!layer && layer.type === "bitmap" && layer.kind === "drawing";
  }

  /** Old text layers used `inverted`; all new layers use explicit 0/1 colour. */
  function layerColor(layer) {
    if (layer && (layer.color === 0 || layer.color === "0")) return 0;
    if (layer && layer.type === "text" && layer.inverted === true &&
        layer.color === undefined) return 0;
    return 1;
  }

  function normalizeLayerLabel(value) {
    return value && typeof value.label === "string" ?
        value.label.replace(/[\r\n]+/g, " ").trim().substring(0, 40) : "";
  }

  function hasDynamicBindings(layer) {
    if (!layer || !layer.bindings) return false;
    return layer.bindings.text === true || layer.bindings.x === true ||
        layer.bindings.y === true || layer.bindings.visible === true;
  }

  function lineStrokeWidth(value) {
    var width = integer(value && value.strokeWidth !== undefined ?
        value.strokeWidth : value, 1);
    return width === 2 || width === 3 || width === 5 ? width : 1;
  }

  function rectangleRadius(value, width, height) {
    width = width === undefined ? value.width : width;
    height = height === undefined ? value.height : height;
    return clamp(integer(value && value.radius !== undefined ? value.radius : value, 0),
        0, Math.floor(Math.min(width, height) / 2));
  }

  /** Normalize size, while preserving intentional off-screen placement. */
  function normalizeRectangle(value, index, usedIds) {
    var id = normalizeLayerId(value.id, index, usedIds, "rect");
    var width = clamp(integer(value.width, 1), 1, WIDTH);
    var height = clamp(integer(value.height, 1), 1, HEIGHT);
    return {
      id: id,
      type: "rect",
      label: normalizeLayerLabel(value),
      x: clamp(integer(value.x, 0), MIN_COORDINATE, MAX_COORDINATE),
      y: clamp(integer(value.y, 0), MIN_COORDINATE, MAX_COORDINATE),
      width: width,
      height: height,
      radius: rectangleRadius(value, width, height),
      filled: value.filled === true,
      color: layerColor(value),
      bindings: normalizeBindings(value, ["x", "y", "visible"]),
      visible: value.visible !== false
    };
  }

  /** Ellipses share the same off-screen-capable box as rectangles. */
  function normalizeEllipse(value, index, usedIds) {
    var id = normalizeLayerId(value.id, index, usedIds, "ellipse");
    return {
      id: id,
      type: "ellipse",
      label: normalizeLayerLabel(value),
      x: clamp(integer(value.x, 0), MIN_COORDINATE, MAX_COORDINATE),
      y: clamp(integer(value.y, 0), MIN_COORDINATE, MAX_COORDINATE),
      width: clamp(integer(value.width, 1), 1, WIDTH),
      height: clamp(integer(value.height, 1), 1, HEIGHT),
      filled: value.filled === true,
      color: layerColor(value),
      bindings: normalizeBindings(value, ["x", "y", "visible"]),
      visible: value.visible !== false
    };
  }

  /** Normalize a line stored as two inclusive monochrome pixel endpoints. */
  function normalizeLine(value, index, usedIds) {
    var id = normalizeLayerId(value.id, index, usedIds, "line");
    return {
      id: id,
      type: "line",
      label: normalizeLayerLabel(value),
      x1: clamp(integer(value.x1, 0), MIN_COORDINATE, MAX_COORDINATE),
      y1: clamp(integer(value.y1, 0), MIN_COORDINATE, MAX_COORDINATE),
      x2: clamp(integer(value.x2, 0), MIN_COORDINATE, MAX_COORDINATE),
      y2: clamp(integer(value.y2, 0), MIN_COORDINATE, MAX_COORDINATE),
      strokeWidth: lineStrokeWidth(value),
      color: layerColor(value),
      bindings: normalizeBindings(value, ["x", "y", "visible"]),
      visible: value.visible !== false
    };
  }

  function findFontAsset(fonts, id) {
    for (var i = 0; i < fonts.length; i++) {
      if (fonts[i].id === id) return fonts[i];
    }
    return null;
  }

  function decodeFontAsset(asset) {
    if (!asset || !global.ESPIDE_MFNT) return null;
    var cached = decodedFontCache[asset.id];
    if (cached && cached.data === asset.data) return cached.value;
    try {
      var validation = global.ESPIDE_MFNT.validate(base64ToBytes(asset.data));
      if (!validation.valid) return null;
      var value = {
        width: validation.font.width,
        height: validation.font.height,
        glyphs: global.ESPIDE_MFNT.decodeAllGlyphs(validation.font)
      };
      decodedFontCache[asset.id] = {data: asset.data, value: value};
      return value;
    } catch (error) {
      return null;
    }
  }

  /**
   * Keep the complete text geometry even when it is wider than the display.
   * Canvas/framebuffer drawing performs the final 128x64 clipping. Truncating
   * these editor bounds would make a still-visible part of an off-screen text
   * impossible to select or move.
   */
  function textLayerMetrics(font, content) {
    var characterCount = Array.from(content).length;
    return {
      width: Math.max(1,
          characterCount * font.width + Math.max(0, characterCount - 1)),
      height: Math.max(1, font.height)
    };
  }

  function normalizeTextLayer(value, index, usedIds, fonts) {
    var asset = findFontAsset(fonts, String(value.fontId || ""));
    var font = decodeFontAsset(asset);
    if (!asset || !font) return null;
    var content = typeof value.text === "string" ?
        value.text.replace(/[\r\n]+/g, " ").substring(0, 80) : "Text";
    if (!content) content = "Text";
    var metrics = textLayerMetrics(font, content);
    var x = clamp(integer(value.x, 0), MIN_COORDINATE, MAX_COORDINATE);
    var y = clamp(integer(value.y, 0), MIN_COORDINATE, MAX_COORDINATE);
    var id = normalizeLayerId(value.id, index, usedIds, "text");
    var parameterId = typeof value.parameterId === "string" ?
        value.parameterId.replace(/[^a-zA-Z0-9_-]/g, "").substring(0, 80) : "";
    var bindings = normalizeBindings(value, ["text", "x", "y", "visible"]);
    if (parameterId) bindings.text = true;
    return {
      id: id,
      type: "text",
      label: normalizeLayerLabel(value),
      x: x,
      y: y,
      width: metrics.width,
      height: metrics.height,
      text: content,
      fontId: asset.id,
      color: layerColor(value),
      /* parameterId remains for compatibility with early preview projects.
       * New projects use bindings.text and derive a stable input from layer ID. */
      parameterId: bindings.text ? (parameterId || id + "-text") : null,
      bindings: bindings,
      visible: value.visible !== false
    };
  }

  /** Validate and bound a packed MONO_HLSB bitmap layer. */
  function normalizeBitmapLayer(value, index, usedIds) {
    if (!global.ESPIDE_BITMAP || typeof value.data !== "string") return null;
    if (value.format && value.format !== global.ESPIDE_BITMAP.FORMAT) return null;
    /* A drawing is deliberately stored as an ordinary full-screen bitmap.
     * The marker only changes editor ergonomics; compilers can keep treating
     * it as a transparent MONO_HLSB bitmap without a special code path. */
    var drawing = value.kind === "drawing";
    /* A drawing keeps the backing dimensions it had when created. Changing
     * the scene target must not reinterpret its packed bytes and drop it. */
    var sourceWidth = clamp(integer(value.width, 1), 1, MAX_DIMENSION);
    var sourceHeight = clamp(integer(value.height, 1), 1, MAX_DIMENSION);
    var bytes;
    try {
      bytes = base64ToBytes(value.data);
    } catch (error) {
      return null;
    }
    if (!global.ESPIDE_BITMAP.validate(bytes, sourceWidth, sourceHeight).valid) return null;
    bytes = global.ESPIDE_BITMAP.zeroPadding(bytes, sourceWidth, sourceHeight);
    var blackBytes = null;
    if (drawing) {
      try {
        blackBytes = typeof value.blackData === "string" ?
            base64ToBytes(value.blackData) :
            new Uint8Array(global.ESPIDE_BITMAP.byteLength(sourceWidth, sourceHeight));
      } catch (error) {
        return null;
      }
      if (!global.ESPIDE_BITMAP.validate(
          blackBytes, sourceWidth, sourceHeight).valid) return null;
      blackBytes = global.ESPIDE_BITMAP.zeroPadding(
          blackBytes, sourceWidth, sourceHeight);
      /* A pixel cannot be white and black simultaneously. Newer black strokes
       * win when hand-edited or mixed-version scene data overlap. */
      for (var maskIndex = 0; maskIndex < bytes.length; maskIndex++) {
        bytes[maskIndex] &= ~blackBytes[maskIndex];
      }
    }
    /* Drawing pixels keep their original full-screen backing bitmap, while
     * X/Y translates the complete sketch without rewriting its packed data. */
    var x = clamp(integer(value.x, 0), MIN_COORDINATE, MAX_COORDINATE);
    var y = clamp(integer(value.y, 0), MIN_COORDINATE, MAX_COORDINATE);
    var width = sourceWidth;
    var height = sourceHeight;
    var name = typeof value.name === "string" && value.name.trim() ?
        value.name.trim().replace(/[\\/]+/g, "_").substring(0, 60) : "Bitmap";
    var id = normalizeLayerId(value.id, index, usedIds, "bitmap");
    var normalized = {
      id: id,
      type: "bitmap",
      label: normalizeLayerLabel(value),
      x: x,
      y: y,
      width: width,
      height: height,
      name: name,
      format: global.ESPIDE_BITMAP.FORMAT,
      data: bytesToBase64(bytes),
      color: layerColor(value),
      /* Missing value means transparent for compatibility with older scenes. */
      transparent: drawing ? true : value.transparent !== false,
      bindings: normalizeBindings(value, drawing ? ["visible"] : ["x", "y", "visible"]),
      visible: value.visible !== false
    };
    if (drawing) {
      normalized.kind = "drawing";
      normalized.blackData = bytesToBase64(blackBytes);
      /* Drawing colour belongs to each pixel, not the entire bitmap layer. */
      delete normalized.color;
    }
    return normalized;
  }

  /**
   * Font binaries are stored once per scene and referenced by stable ID from
   * future text layers. This avoids embedding the same MFNT data in every text
   * object while keeping the Blockly project fully portable.
   */
  function normalizeFonts(value) {
    if (!Array.isArray(value)) return [];
    var normalized = [];
    var usedIds = Object.create(null);
    for (var i = 0; i < value.length; i++) {
      var asset = value[i];
      if (!asset || typeof asset.data !== "string" || !asset.data) continue;
      var id = normalizeLayerId(asset.id, i, usedIds, "font");
      var name = typeof asset.name === "string" && asset.name.trim() ?
          asset.name.trim().substring(0, 60) : "Font " + (i + 1);
      var fileName = typeof asset.fileName === "string" ?
          asset.fileName.replace(/[^a-zA-Z0-9_.-]/g, "_").substring(0, 80) : id + ".mfnt";
      if (!/\.mfnt$/i.test(fileName)) fileName += ".mfnt";

      /* Validate imported project data when the codec is available. A broken
       * font is omitted rather than allowed to fail later during rendering. */
      if (global.ESPIDE_MFNT && typeof global.atob === "function") {
        try {
          var binary = global.atob(asset.data);
          var bytes = new Uint8Array(binary.length);
          for (var b = 0; b < binary.length; b++) bytes[b] = binary.charCodeAt(b);
          if (!global.ESPIDE_MFNT.validate(bytes).valid) continue;
        } catch (error) {
          continue;
        }
      }
      var normalizedAsset = {id: id, name: name, fileName: fileName, data: asset.data};
      /* Catalog metadata lets save() discard unused built-ins. Imported or
       * hand-edited fonts intentionally remain in the project library. */
      if (asset.source === "builtin") normalizedAsset.source = "builtin";
      if (typeof asset.catalogId === "string" && asset.catalogId) {
        normalizedAsset.catalogId = asset.catalogId.replace(/[^a-zA-Z0-9_-]/g, "").substring(0, 80);
      }
      normalized.push(normalizedAsset);
    }
    return normalized;
  }

  /** Normalize data loaded from Blockly XML before exposing it to editor code. */
  function normalizeScene(value, options) {
    var scene;
    var normalizedLayers = [];
    var usedIds = Object.create(null);
    var dimensions = requestedDimensions(value, options);
    var previousWidth = WIDTH;
    var previousHeight = HEIGHT;
    WIDTH = dimensions.width;
    HEIGHT = dimensions.height;
    try {
      scene = clone(value || {});
    } catch (error) {
      scene = {};
    }
    scene.schema = SCHEMA;
    scene.version = VERSION;
    scene.width = dimensions.width;
    scene.height = dimensions.height;
    scene.mode = "mono";
    scene.name = typeof scene.name === "string" && scene.name.trim() ?
        scene.name.trim().substring(0, 80) :
        text("MPY_DISPLAY_DESIGNER_DEFAULT_NAME", "Screen");
    scene.fonts = normalizeFonts(scene.fonts);

    if (Array.isArray(scene.layers)) {
      for (var i = 0; i < scene.layers.length; i++) {
        var layer = scene.layers[i];
        if (layer && layer.type === "rect") {
          normalizedLayers.push(normalizeRectangle(layer, i, usedIds));
        } else if (layer && layer.type === "ellipse") {
          normalizedLayers.push(normalizeEllipse(layer, i, usedIds));
        } else if (layer && layer.type === "line") {
          normalizedLayers.push(normalizeLine(layer, i, usedIds));
        } else if (layer && layer.type === "text") {
          var textLayer = normalizeTextLayer(layer, i, usedIds, scene.fonts);
          if (textLayer) normalizedLayers.push(textLayer);
        } else if (layer && layer.type === "bitmap") {
          var bitmapLayer = normalizeBitmapLayer(layer, i, usedIds);
          if (bitmapLayer) normalizedLayers.push(bitmapLayer);
        }
      }
    }
    scene.layers = normalizedLayers;
    scene.parameters = Array.isArray(scene.parameters) ? scene.parameters : [];
    if (scene.target && typeof scene.target === "object") {
      scene.target = {
        profileId: typeof scene.target.profileId === "string" ?
            scene.target.profileId.substring(0, 100) : null,
        label: typeof scene.target.label === "string" ?
            scene.target.label.substring(0, 120) : dimensions.width + "×" + dimensions.height,
        source: typeof scene.target.source === "string" ?
            scene.target.source.substring(0, 40) : "scene"
      };
    }
    updateAdaptiveExtension(scene);
    if (!options || options.activate !== true) {
      WIDTH = previousWidth;
      HEIGHT = previousHeight;
    }
    return scene;
  }

  function buildDom() {
    if (elements) return;

    var overlay = document.createElement("div");
    overlay.className = "espide-display-designer-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "espide-display-designer-title");
    overlay.setAttribute("tabindex", "-1");
    overlay.setAttribute("data-testid", "display-designer-dialog");
    overlay.innerHTML =
      '<div class="espide-display-designer-dialog">' +
        '<header class="espide-display-designer-header">' +
          '<div class="espide-display-designer-header-title">' +
            '<h2 id="espide-display-designer-title"></h2>' +
            '<div class="espide-display-designer-header-meta">' +
              '<p id="espide-display-designer-subtitle"></p>' +
              '<div class="espide-display-designer-resolution">' +
                '<button type="button" class="espide-display-designer-resolution-toggle" ' +
                    'data-action="toggle-resolution" aria-expanded="false" ' +
                    'aria-controls="espide-display-designer-resolution-popover">' +
                  '<span class="espide-display-designer-resolution-icon" aria-hidden="true"></span>' +
                  '<span data-resolution-button-value></span>' +
                  '<span class="espide-display-designer-resolution-chevron" aria-hidden="true">⌄</span>' +
                '</button>' +
                '<section id="espide-display-designer-resolution-popover" ' +
                    'class="espide-display-designer-resolution-popover" hidden>' +
                  '<span class="espide-display-designer-resolution-target" ' +
                      'data-display-target></span>' +
                  '<div class="espide-display-designer-resolution-fields">' +
                    '<label><span data-label="resolution-width"></span>' +
                      '<input type="number" min="1" max="1024" ' +
                          'inputmode="numeric" data-resolution="width"></label>' +
                    '<span aria-hidden="true">×</span>' +
                    '<label><span data-label="resolution-height"></span>' +
                      '<input type="number" min="1" max="1024" ' +
                          'inputmode="numeric" data-resolution="height"></label>' +
                  '</div>' +
                  '<div class="espide-display-designer-resolution-actions">' +
                    '<button type="button" data-action="use-target-resolution" hidden></button>' +
                    '<button type="button" class="espide-display-designer-resolution-apply" ' +
                        'data-action="apply-resolution"></button>' +
                  '</div>' +
                '</section>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="espide-display-designer-header-actions">' +
            '<button type="button" class="espide-display-designer-history" ' +
                'data-action="undo"><span aria-hidden="true">↶</span></button>' +
            '<button type="button" class="espide-display-designer-history" ' +
                'data-action="redo"><span aria-hidden="true">↷</span></button>' +
            '<button type="button" class="espide-display-designer-size" ' +
                'data-action="toggle-size"><span data-size-icon aria-hidden="true">⛶</span></button>' +
            '<button type="button" class="espide-display-designer-close" ' +
                'data-action="cancel" aria-label="Close">&times;</button>' +
          '</div>' +
        '</header>' +
        '<main class="espide-display-designer-main">' +
          '<section class="espide-display-designer-preview-panel">' +
            '<div class="espide-display-designer-toolbar" role="toolbar">' +
              '<button type="button" data-tool="select" aria-pressed="true">' +
                '<span aria-hidden="true">↖</span><span data-tool-label="select"></span>' +
              '</button>' +
              '<button type="button" data-tool="rect" aria-pressed="false">' +
                '<span aria-hidden="true">▭</span><span data-tool-label="rect"></span>' +
              '</button>' +
              '<button type="button" data-tool="line" aria-pressed="false">' +
                '<span aria-hidden="true">╱</span><span data-tool-label="line"></span>' +
              '</button>' +
              '<button type="button" data-tool="ellipse" aria-pressed="false">' +
                '<span aria-hidden="true">◯</span><span data-tool-label="ellipse"></span>' +
              '</button>' +
              '<button type="button" data-tool="drawing" aria-pressed="false">' +
                '<span class="espide-display-designer-tool-icon ' +
                    'is-brush" aria-hidden="true"></span>' +
                '<span data-tool-label="drawing"></span>' +
              '</button>' +
              '<button type="button" data-action="fonts" aria-expanded="false">' +
                '<span aria-hidden="true">A</span><span data-tool-label="fonts"></span>' +
              '</button>' +
              '<button type="button" data-action="bitmap">' +
                '<span aria-hidden="true">▧</span><span data-tool-label="bitmap"></span>' +
              '</button>' +
            '</div>' +
            '<section class="espide-display-designer-font-picker" hidden>' +
              '<header>' +
                '<div><h3 data-label="font-picker-title"></h3>' +
                  '<p data-label="font-picker-help"></p></div>' +
                '<button type="button" class="espide-display-designer-font-picker-close" ' +
                    'data-action="close-font-picker" aria-label="Close">&times;</button>' +
              '</header>' +
              '<label class="espide-display-designer-text-value">' +
                '<span data-label="text-value"></span>' +
                '<input type="text" maxlength="80" value="ABCabc123" data-field="new-text">' +
              '</label>' +
              '<div class="espide-display-designer-font-select">' +
                '<span class="espide-display-designer-font-select-label" data-label="font-choice"></span>' +
                '<button type="button" data-action="toggle-font-options" aria-expanded="true">' +
                  '<img alt="" data-selected-font-preview>' +
                  '<span><strong data-selected-font-name></strong>' +
                    '<small data-selected-font-size></small></span>' +
                  '<span aria-hidden="true">▾</span>' +
                '</button>' +
                '<div class="espide-display-designer-font-options" role="listbox" hidden></div>' +
              '</div>' +
              '<p class="espide-display-designer-font-status" role="status"></p>' +
              '<footer>' +
                '<button type="button" data-action="edit-fonts"></button>' +
                '<button type="button" class="espide-display-designer-add-text" ' +
                    'data-action="apply-font"></button>' +
              '</footer>' +
            '</section>' +
            /* The native file input is only a bridge to the system picker. It
             * must never become a second visible control in the designer. */
            '<input class="espide-display-designer-bitmap-file-input" type="file" ' +
                'accept="image/png,image/jpeg,image/bmp,image/webp" ' +
                'data-field="bitmap-file" tabindex="-1" aria-hidden="true" hidden>' +
            '<section class="espide-display-designer-bitmap-importer" hidden>' +
              '<header>' +
                '<div><h3 data-label="bitmap-title"></h3>' +
                  '<p data-label="bitmap-help"></p></div>' +
                '<button type="button" class="espide-display-designer-bitmap-close" ' +
                    'data-action="close-bitmap" aria-label="Close">&times;</button>' +
              '</header>' +
              '<div class="espide-display-designer-bitmap-content">' +
                '<div class="espide-display-designer-bitmap-preview-wrap">' +
                  '<canvas width="256" height="128" data-bitmap-preview></canvas>' +
                  '<p data-bitmap-status></p>' +
                '</div>' +
                '<div class="espide-display-designer-bitmap-controls">' +
                  '<div class="espide-display-designer-bitmap-size">' +
                    '<label><span data-label="bitmap-width"></span>' +
                      '<input type="number" min="1" max="128" data-bitmap-option="width"></label>' +
                    '<label><span data-label="bitmap-height"></span>' +
                      '<input type="number" min="1" max="64" data-bitmap-option="height"></label>' +
                  '</div>' +
                  '<label class="espide-display-designer-bitmap-threshold">' +
                    '<span data-label="bitmap-threshold"></span><output>128</output>' +
                    '<input type="range" min="0" max="255" value="128" ' +
                        'data-bitmap-option="threshold"></label>' +
                  '<label class="espide-display-designer-bitmap-check">' +
                    '<input type="checkbox" data-bitmap-option="invert">' +
                    '<span data-label="bitmap-invert"></span></label>' +
                  '<label class="espide-display-designer-bitmap-check">' +
                    '<input type="checkbox" data-bitmap-option="dither">' +
                    '<span data-label="bitmap-dither"></span></label>' +
                '</div>' +
              '</div>' +
              '<footer>' +
                '<button type="button" data-action="close-bitmap"></button>' +
                '<button type="button" class="espide-display-designer-add-bitmap" ' +
                    'data-action="apply-bitmap"></button>' +
              '</footer>' +
            '</section>' +
            '<div class="espide-display-designer-stage">' +
            '<div class="espide-display-designer-screen" data-tool="select" ' +
                'aria-label="128 by 64 monochrome preview">' +
              '<canvas class="espide-display-designer-scene-canvas" width="128" height="64" ' +
                  'data-testid="display-designer-canvas"></canvas>' +
              '<canvas class="espide-display-designer-grid-canvas" width="128" height="64" ' +
                  'aria-hidden="true"></canvas>' +
              '<canvas class="espide-display-designer-selection-canvas" width="128" height="64" ' +
                  'aria-hidden="true"></canvas>' +
            '</div>' +
            '</div>' +
            '<div class="espide-display-designer-context-controls">' +
            '<div class="espide-display-designer-layer-color-controls" hidden>' +
              '<span data-label="color"></span>' +
              '<div role="radiogroup" data-label-aria="color">' +
                '<button type="button" data-layer-color="1" aria-pressed="true">' +
                  '<span class="espide-display-designer-color-swatch is-white" ' +
                      'aria-hidden="true"></span><span data-label="color-white"></span>' +
                '</button>' +
                '<button type="button" data-layer-color="0" aria-pressed="false">' +
                  '<span class="espide-display-designer-color-swatch is-black" ' +
                      'aria-hidden="true"></span><span data-label="color-black"></span>' +
                '</button>' +
              '</div>' +
            '</div>' +
            '<div class="espide-display-designer-drawing-controls" hidden>' +
              '<button type="button" data-drawing-mode="brush" aria-pressed="true">' +
                '<span class="espide-display-designer-tool-icon ' +
                    'is-brush" aria-hidden="true"></span>' +
                '<span data-tool-label="brush"></span>' +
              '</button>' +
              '<button type="button" data-drawing-mode="eraser" aria-pressed="false">' +
                '<span class="espide-display-designer-tool-icon ' +
                    'is-eraser" aria-hidden="true"></span>' +
                '<span data-tool-label="eraser"></span>' +
              '</button>' +
              '<div class="espide-display-designer-brush-color">' +
                '<span data-label="color"></span>' +
                '<div role="radiogroup" data-label-aria="color">' +
                  '<button type="button" data-brush-color="1" aria-pressed="true">' +
                    '<span class="espide-display-designer-color-swatch is-white" ' +
                        'aria-hidden="true"></span><span data-label="color-white"></span>' +
                  '</button>' +
                  '<button type="button" data-brush-color="0" aria-pressed="false">' +
                    '<span class="espide-display-designer-color-swatch is-black" ' +
                        'aria-hidden="true"></span><span data-label="color-black"></span>' +
                  '</button>' +
                '</div>' +
              '</div>' +
              '<label class="espide-display-designer-brush-size">' +
                '<span data-tool-label="brush-size"></span>' +
                '<select data-brush-size aria-label="Brush size">' +
                  '<option value="1">1 px</option>' +
                  '<option value="2">2 px</option>' +
                  '<option value="3">3 px</option>' +
                  '<option value="5">5 px</option>' +
                '</select>' +
              '</label>' +
            '</div>' +
            '<p class="espide-display-designer-empty"></p>' +
            '</div>' +
          '</section>' +
          '<aside class="espide-display-designer-properties">' +
            '<section>' +
              '<label class="espide-display-designer-label" ' +
                  'for="espide-display-designer-name"></label>' +
              '<input id="espide-display-designer-name" type="text" maxlength="80" ' +
                  'data-testid="display-designer-name">' +
              '<p class="espide-display-designer-scene-summary">' +
                '<span data-value="resolution">128 &times; 64 px</span>' +
                '<span data-value="mode"></span><span>v1</span>' +
              '</p>' +
            '</section>' +
            '<section class="espide-display-designer-object-panel">' +
              '<h3 data-label="properties"></h3>' +
              '<p class="espide-display-designer-no-selection"></p>' +
              '<div class="espide-display-designer-object-fields" hidden>' +
                '<label class="espide-display-designer-layer-label">' +
                  '<span data-label="layer-label"></span>' +
                  '<input type="text" maxlength="40" data-property="label"></label>' +
                '<div class="espide-display-designer-coordinate-grid">' +
                  '<label><span data-coordinate-label="x"></span>' +
                    '<input type="number" min="-32768" max="32767" data-property="x"></label>' +
                  '<label><span data-coordinate-label="y"></span>' +
                    '<input type="number" min="-32768" max="32767" data-property="y"></label>' +
                  '<label><span data-coordinate-label="width"></span>' +
                    '<input type="number" min="1" max="128" data-property="width"></label>' +
                  '<label><span data-coordinate-label="height"></span>' +
                    '<input type="number" min="1" max="64" data-property="height"></label>' +
                '</div>' +
                '<div class="espide-display-designer-shape-options">' +
                  '<label class="espide-display-designer-line-width" hidden>' +
                    '<span data-label="line-width"></span>' +
                    '<select data-property="strokeWidth">' +
                      '<option value="1">1 px</option>' +
                      '<option value="2">2 px</option>' +
                      '<option value="3">3 px</option>' +
                      '<option value="5">5 px</option>' +
                    '</select>' +
                  '</label>' +
                  '<label class="espide-display-designer-corner-radius" hidden>' +
                    '<span data-label="corner-radius"></span>' +
                    '<input type="number" min="0" max="32" value="0" ' +
                        'data-property="radius">' +
                  '</label>' +
                '</div>' +
                '<label class="espide-display-designer-filled">' +
                  '<input type="checkbox" data-property="filled">' +
                  '<span data-label="filled"></span>' +
                '</label>' +
                '<label class="espide-display-designer-filled ' +
                    'espide-display-designer-bitmap-transparent" hidden>' +
                  '<input type="checkbox" data-property="transparent">' +
                  '<span data-label="bitmap-transparent"></span>' +
                '</label>' +
                '<div class="espide-display-designer-text-fields" hidden>' +
                  '<label><span data-label="text-content"></span>' +
                    '<input type="text" maxlength="80" data-property="text"></label>' +
                  '<div class="espide-display-designer-current-font">' +
                    '<span data-label="current-font"></span><strong data-value="current-font"></strong>' +
                  '</div>' +
                  '<button type="button" data-action="change-text-font"></button>' +
                '</div>' +
                '<fieldset class="espide-display-designer-dynamic-fields">' +
                  '<legend data-label="dynamic-inputs"></legend>' +
                  '<div>' +
                    '<label class="espide-display-designer-dynamic-text">' +
                      '<input type="checkbox" data-dynamic-property="text">' +
                      '<span data-label="dynamic-text"></span></label>' +
                    '<label><input type="checkbox" data-dynamic-property="x">' +
                      '<span data-label="dynamic-x"></span></label>' +
                    '<label><input type="checkbox" data-dynamic-property="y">' +
                      '<span data-label="dynamic-y"></span></label>' +
                    '<label><input type="checkbox" data-dynamic-property="visible">' +
                      '<span data-label="dynamic-visible"></span></label>' +
                  '</div>' +
                '</fieldset>' +
                '<fieldset class="espide-display-designer-arrange-fields" hidden>' +
                  '<legend data-label="arrange"></legend>' +
                  '<div>' +
                    '<button type="button" data-arrange="left">⇤</button>' +
                    '<button type="button" data-arrange="center-x">↔</button>' +
                    '<button type="button" data-arrange="right">⇥</button>' +
                    '<button type="button" data-arrange="distribute-x">⋯</button>' +
                    '<button type="button" data-arrange="top">⇡</button>' +
                    '<button type="button" data-arrange="center-y">↕</button>' +
                    '<button type="button" data-arrange="bottom">⇣</button>' +
                    '<button type="button" data-arrange="distribute-y">⋮</button>' +
                  '</div>' +
                '</fieldset>' +
                '<div class="espide-display-designer-object-actions">' +
                  '<button type="button" class="espide-display-designer-duplicate" ' +
                      'data-action="duplicate"></button>' +
                  '<button type="button" class="espide-display-designer-delete" ' +
                      'data-action="delete"></button>' +
                '</div>' +
              '</div>' +
            '</section>' +
            '<section class="espide-display-designer-layers-panel">' +
              '<div class="espide-display-designer-layers-heading">' +
                '<h3 data-label="layers"></h3>' +
                '<div class="espide-display-designer-layer-order" role="toolbar">' +
                  '<button type="button" data-layer-order="front">⇈</button>' +
                  '<button type="button" data-layer-order="up">↑</button>' +
                  '<button type="button" data-layer-order="down">↓</button>' +
                  '<button type="button" data-layer-order="back">⇊</button>' +
                '</div>' +
              '</div>' +
              '<p class="espide-display-designer-no-layers"></p>' +
              '<ol class="espide-display-designer-layer-list"></ol>' +
            '</section>' +
          '</aside>' +
        '</main>' +
        '<footer class="espide-display-designer-footer">' +
          '<div class="espide-display-designer-live-preview-controls">' +
            '<button type="button" class="espide-display-designer-live-preview" ' +
                'data-action="live-preview" aria-pressed="false">' +
              '<span aria-hidden="true">▣</span><span data-live-preview-label></span>' +
            '</button>' +
            '<span class="espide-display-designer-live-preview-status" ' +
                'role="status" aria-live="polite"></span>' +
          '</div>' +
          '<div class="espide-display-designer-footer-actions">' +
            '<button type="button" data-action="cancel"></button>' +
            '<button type="button" class="espide-display-designer-save" ' +
                'data-action="save" data-testid="display-designer-save"></button>' +
          '</div>' +
        '</footer>' +
        '<div class="espide-display-designer-unsaved-overlay" hidden>' +
          '<section class="espide-display-designer-unsaved-dialog" ' +
              'role="alertdialog" aria-modal="true" ' +
              'aria-labelledby="espide-display-designer-unsaved-title" ' +
              'aria-describedby="espide-display-designer-unsaved-message">' +
            '<h3 id="espide-display-designer-unsaved-title" ' +
                'data-label="unsaved-title"></h3>' +
            '<p id="espide-display-designer-unsaved-message" ' +
                'data-label="unsaved-message"></p>' +
            '<footer>' +
              '<button type="button" data-action="continue-editing"></button>' +
              '<button type="button" class="espide-display-designer-discard" ' +
                  'data-action="discard-changes"></button>' +
            '</footer>' +
          '</section>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    elements = {
      overlay: overlay,
      title: overlay.querySelector("#espide-display-designer-title"),
      subtitle: overlay.querySelector("#espide-display-designer-subtitle"),
      resolutionControl: overlay.querySelector(".espide-display-designer-resolution"),
      resolutionToggleButton: overlay.querySelector('[data-action="toggle-resolution"]'),
      resolutionButtonValue: overlay.querySelector("[data-resolution-button-value]"),
      resolutionPopover:
          overlay.querySelector(".espide-display-designer-resolution-popover"),
      targetLabel: overlay.querySelector("[data-display-target]"),
      resolutionWidth: overlay.querySelector('[data-resolution="width"]'),
      resolutionHeight: overlay.querySelector('[data-resolution="height"]'),
      applyResolutionButton: overlay.querySelector('[data-action="apply-resolution"]'),
      useTargetResolutionButton:
          overlay.querySelector('[data-action="use-target-resolution"]'),
      resolutionSummary: overlay.querySelector('[data-value="resolution"]'),
      nameLabel: overlay.querySelector(".espide-display-designer-label"),
      nameInput: overlay.querySelector("#espide-display-designer-name"),
      empty: overlay.querySelector(".espide-display-designer-empty"),
      previewPanel: overlay.querySelector(".espide-display-designer-preview-panel"),
      displayStage: overlay.querySelector(".espide-display-designer-stage"),
      screen: overlay.querySelector(".espide-display-designer-screen"),
      canvas: overlay.querySelector(".espide-display-designer-scene-canvas"),
      gridCanvas: overlay.querySelector(".espide-display-designer-grid-canvas"),
      selectionCanvas: overlay.querySelector(".espide-display-designer-selection-canvas"),
      toolButtons: overlay.querySelectorAll(".espide-display-designer-toolbar [data-tool]"),
      drawingControls: overlay.querySelector(".espide-display-designer-drawing-controls"),
      drawingModeButtons: overlay.querySelectorAll("[data-drawing-mode]"),
      brushColorButtons: overlay.querySelectorAll("[data-brush-color]"),
      brushSizeSelect: overlay.querySelector("[data-brush-size]"),
      cancelButtons: overlay.querySelectorAll('[data-action="cancel"]'),
      unsavedOverlay: overlay.querySelector(".espide-display-designer-unsaved-overlay"),
      continueEditingButton: overlay.querySelector('[data-action="continue-editing"]'),
      discardChangesButton: overlay.querySelector('[data-action="discard-changes"]'),
      undoButton: overlay.querySelector('[data-action="undo"]'),
      redoButton: overlay.querySelector('[data-action="redo"]'),
      sizeButton: overlay.querySelector('[data-action="toggle-size"]'),
      fontButton: overlay.querySelector('[data-action="fonts"]'),
      fontPicker: overlay.querySelector(".espide-display-designer-font-picker"),
      fontPickerClose: overlay.querySelector('[data-action="close-font-picker"]'),
      fontOptionsButton: overlay.querySelector('[data-action="toggle-font-options"]'),
      fontOptions: overlay.querySelector(".espide-display-designer-font-options"),
      selectedFontPreview: overlay.querySelector("[data-selected-font-preview]"),
      selectedFontName: overlay.querySelector("[data-selected-font-name]"),
      selectedFontSize: overlay.querySelector("[data-selected-font-size]"),
      newTextInput: overlay.querySelector('[data-field="new-text"]'),
      applyFontButton: overlay.querySelector('[data-action="apply-font"]'),
      editFontsButton: overlay.querySelector('[data-action="edit-fonts"]'),
      fontStatus: overlay.querySelector(".espide-display-designer-font-status"),
      bitmapButton: overlay.querySelector('[data-action="bitmap"]'),
      bitmapFileInput: overlay.querySelector('[data-field="bitmap-file"]'),
      bitmapImporter: overlay.querySelector(".espide-display-designer-bitmap-importer"),
      bitmapCloseButtons: overlay.querySelectorAll('[data-action="close-bitmap"]'),
      bitmapApplyButton: overlay.querySelector('[data-action="apply-bitmap"]'),
      bitmapPreview: overlay.querySelector("[data-bitmap-preview]"),
      bitmapStatus: overlay.querySelector("[data-bitmap-status]"),
      bitmapWidth: overlay.querySelector('[data-bitmap-option="width"]'),
      bitmapHeight: overlay.querySelector('[data-bitmap-option="height"]'),
      bitmapThreshold: overlay.querySelector('[data-bitmap-option="threshold"]'),
      bitmapThresholdOutput: overlay.querySelector(".espide-display-designer-bitmap-threshold output"),
      bitmapInvert: overlay.querySelector('[data-bitmap-option="invert"]'),
      bitmapDither: overlay.querySelector('[data-bitmap-option="dither"]'),
      sizeIcon: overlay.querySelector("[data-size-icon]"),
      saveButton: overlay.querySelector('[data-action="save"]'),
      livePreviewButton: overlay.querySelector('[data-action="live-preview"]'),
      livePreviewLabel: overlay.querySelector("[data-live-preview-label]"),
      livePreviewStatus:
          overlay.querySelector(".espide-display-designer-live-preview-status"),
      duplicateButton: overlay.querySelector('[data-action="duplicate"]'),
      deleteButton: overlay.querySelector('[data-action="delete"]'),
      modeValue: overlay.querySelector('[data-value="mode"]'),
      propertiesLabel: overlay.querySelector('[data-label="properties"]'),
      noSelection: overlay.querySelector(".espide-display-designer-no-selection"),
      objectFields: overlay.querySelector(".espide-display-designer-object-fields"),
      layerLabelControl: overlay.querySelector(".espide-display-designer-layer-label"),
      layerLabelInput: overlay.querySelector('[data-property="label"]'),
      coordinateGrid: overlay.querySelector(".espide-display-designer-coordinate-grid"),
      propertyInputs: overlay.querySelectorAll("[data-property]"),
      coordinateInputs: overlay.querySelectorAll(".espide-display-designer-coordinate-grid [data-property]"),
      coordinateLabels: overlay.querySelectorAll("[data-coordinate-label]"),
      lineWidthControl: overlay.querySelector(".espide-display-designer-line-width"),
      lineWidthInput: overlay.querySelector('[data-property="strokeWidth"]'),
      cornerRadiusControl: overlay.querySelector(".espide-display-designer-corner-radius"),
      cornerRadiusInput: overlay.querySelector('[data-property="radius"]'),
      layerColorControl:
          overlay.querySelector(".espide-display-designer-layer-color-controls"),
      layerColorButtons: overlay.querySelectorAll("[data-layer-color]"),
      filledControl: overlay.querySelector(".espide-display-designer-filled"),
      filledInput: overlay.querySelector('[data-property="filled"]'),
      filledLabel: overlay.querySelector('[data-label="filled"]'),
      bitmapTransparentControl:
          overlay.querySelector(".espide-display-designer-bitmap-transparent"),
      bitmapTransparentInput: overlay.querySelector('[data-property="transparent"]'),
      bitmapTransparentLabel: overlay.querySelector('[data-label="bitmap-transparent"]'),
      textFields: overlay.querySelector(".espide-display-designer-text-fields"),
      textPropertyInput: overlay.querySelector('[data-property="text"]'),
      currentFontName: overlay.querySelector('[data-value="current-font"]'),
      changeTextFontButton: overlay.querySelector('[data-action="change-text-font"]'),
      dynamicFields: overlay.querySelector(".espide-display-designer-dynamic-fields"),
      dynamicTextControl: overlay.querySelector(".espide-display-designer-dynamic-text"),
      dynamicInputs: overlay.querySelectorAll("[data-dynamic-property]"),
      arrangeFields: overlay.querySelector(".espide-display-designer-arrange-fields"),
      arrangeButtons: overlay.querySelectorAll("[data-arrange]"),
      layersLabel: overlay.querySelector('[data-label="layers"]'),
      layerOrderButtons: overlay.querySelectorAll("[data-layer-order]"),
      noLayers: overlay.querySelector(".espide-display-designer-no-layers"),
      layerList: overlay.querySelector(".espide-display-designer-layer-list")
    };

    for (var i = 0; i < elements.cancelButtons.length; i++) {
      elements.cancelButtons[i].addEventListener("click", requestClose);
    }
    elements.continueEditingButton.addEventListener("click", hideUnsavedDialog);
    elements.discardChangesButton.addEventListener("click", discardChangesAndClose);
    elements.undoButton.addEventListener("click", undoHistory);
    elements.redoButton.addEventListener("click", redoHistory);
    elements.sizeButton.addEventListener("click", toggleDesignerSize);
    elements.resolutionToggleButton.addEventListener("click", toggleResolutionPopover);
    elements.applyResolutionButton.addEventListener("click", applyManualResolution);
    elements.useTargetResolutionButton.addEventListener("click", applyTargetResolution);
    elements.resolutionWidth.addEventListener("keydown", onResolutionInputKeyDown);
    elements.resolutionHeight.addEventListener("keydown", onResolutionInputKeyDown);
    elements.overlay.addEventListener("pointerdown", function(event) {
      if (!elements.resolutionControl.contains(event.target)) {
        setResolutionPopover(false);
      }
    });
    elements.livePreviewButton.addEventListener("click", toggleLivePreview);
    elements.fontButton.addEventListener("click", openFontPicker);
    elements.fontPickerClose.addEventListener("click", closeFontPicker);
    elements.fontOptionsButton.addEventListener("click", toggleFontOptions);
    elements.applyFontButton.addEventListener("click", applySelectedFont);
    elements.editFontsButton.addEventListener("click", openFontLibrary);
    elements.changeTextFontButton.addEventListener("click", openFontPickerForSelection);
    elements.bitmapButton.addEventListener("click", chooseBitmapFile);
    elements.bitmapFileInput.addEventListener("change", onBitmapFileSelected);
    for (var bitmapCloseIndex = 0; bitmapCloseIndex < elements.bitmapCloseButtons.length;
        bitmapCloseIndex++) {
      elements.bitmapCloseButtons[bitmapCloseIndex].addEventListener("click", closeBitmapImporter);
    }
    elements.bitmapApplyButton.addEventListener("click", applyBitmapImport);
    elements.bitmapWidth.addEventListener("change", renderBitmapImportPreview);
    elements.bitmapHeight.addEventListener("change", renderBitmapImportPreview);
    elements.bitmapThreshold.addEventListener("input", renderBitmapImportPreview);
    elements.bitmapInvert.addEventListener("change", renderBitmapImportPreview);
    elements.bitmapDither.addEventListener("change", renderBitmapImportPreview);
    for (var j = 0; j < elements.toolButtons.length; j++) {
      elements.toolButtons[j].addEventListener("click", onToolClick);
    }
    elements.brushSizeSelect.addEventListener("change", onBrushSizeChange);
    for (var brushColorIndex = 0;
        brushColorIndex < elements.brushColorButtons.length; brushColorIndex++) {
      elements.brushColorButtons[brushColorIndex].addEventListener(
          "click", onBrushColorClick);
    }
    for (var drawingModeIndex = 0;
        drawingModeIndex < elements.drawingModeButtons.length; drawingModeIndex++) {
      elements.drawingModeButtons[drawingModeIndex].addEventListener(
          "click", onDrawingModeClick);
    }
    for (var k = 0; k < elements.propertyInputs.length; k++) {
      /* Text must redraw while typing. Numeric fields keep change semantics so
       * partially entered values are not clamped before the user finishes. */
      elements.propertyInputs[k].addEventListener(
          elements.propertyInputs[k].dataset.property === "text" ? "input" : "change",
          onPropertyChange);
    }
    for (var layerColorIndex = 0;
        layerColorIndex < elements.layerColorButtons.length; layerColorIndex++) {
      elements.layerColorButtons[layerColorIndex].addEventListener(
          "click", onLayerColorClick);
    }
    for (var dynamicIndex = 0; dynamicIndex < elements.dynamicInputs.length;
        dynamicIndex++) {
      elements.dynamicInputs[dynamicIndex].addEventListener(
          "change", onDynamicBindingChange);
    }
    for (var arrangeIndex = 0; arrangeIndex < elements.arrangeButtons.length;
        arrangeIndex++) {
      elements.arrangeButtons[arrangeIndex].addEventListener(
          "click", onArrangeClick);
    }
    for (var orderIndex = 0; orderIndex < elements.layerOrderButtons.length;
        orderIndex++) {
      elements.layerOrderButtons[orderIndex].addEventListener(
          "click", onLayerOrderClick);
    }
    elements.duplicateButton.addEventListener("click", duplicateSelectedLayers);
    elements.deleteButton.addEventListener("click", deleteSelectedLayers);
    elements.nameInput.addEventListener("change", recordHistory);
    elements.textPropertyInput.addEventListener("change", recordHistory);
    elements.saveButton.addEventListener("click", save);
    elements.screen.addEventListener("pointerdown", onPointerDown);
    elements.screen.addEventListener("pointermove", onPointerMove);
    elements.screen.addEventListener("pointerup", onPointerUp);
    elements.screen.addEventListener("pointercancel", onPointerUp);
    elements.screen.addEventListener("pointerleave", onPointerLeave);
    /* Capture shortcuts before Blockly's document handlers can copy, paste or
     * delete the editor block behind this modal. */
    global.addEventListener("keydown", onKeyDown, true);
    global.addEventListener("espide-display-preview-stopped",
        onExternalLivePreviewStop);
    if (typeof global.ResizeObserver === "function") {
      gridResizeObserver = new global.ResizeObserver(scheduleGridRender);
      /* The stage is the only area allowed to influence preview scale. Context
       * controls live in their own fixed row, so selecting an object cannot
       * resize the display or toggle the pixel grid as a side effect. */
      gridResizeObserver.observe(elements.displayStage);
    } else {
      global.addEventListener("resize", scheduleGridRender);
    }
    /* Mobile ESP IDE uses a scaled visual viewport. Its scale can change
     * without changing the layout-stage dimensions observed above. */
    if (global.visualViewport &&
        typeof global.visualViewport.addEventListener === "function") {
      global.visualViewport.addEventListener("resize", scheduleGridRender);
    }
  }

  function applyTranslations() {
    elements.title.textContent = text("MPY_DISPLAY_DESIGNER_EDITOR_TITLE", "OLED Display Designer");
    elements.subtitle.textContent = WIDTH + "×" + HEIGHT + " " +
        text("MPY_DISPLAY_DESIGNER_MONO", "Monochrome").toLowerCase();
    overlayText('[data-label="resolution-width"]',
        "MPY_DISPLAY_DESIGNER_WIDTH", "Width");
    overlayText('[data-label="resolution-height"]',
        "MPY_DISPLAY_DESIGNER_HEIGHT", "Height");
    elements.applyResolutionButton.textContent = text(
        "MPY_DISPLAY_DESIGNER_APPLY_RESOLUTION", "Apply");
    elements.useTargetResolutionButton.textContent = text(
        "MPY_DISPLAY_DESIGNER_USE_TARGET_RESOLUTION", "Use display profile");
    var resolutionLabel = text("MPY_DISPLAY_DESIGNER_RESOLUTION", "Resolution");
    elements.resolutionToggleButton.setAttribute("aria-label", resolutionLabel);
    elements.resolutionToggleButton.title = resolutionLabel;
    elements.resolutionPopover.setAttribute("aria-label", resolutionLabel);
    elements.nameLabel.textContent = text("MPY_DISPLAY_DESIGNER_SCENE_NAME", "Scene name");
    elements.empty.textContent = text("MPY_DISPLAY_DESIGNER_EMPTY", "Choose Rectangle and drag on the display.");
    elements.modeValue.textContent = text("MPY_DISPLAY_DESIGNER_MONO", "Monochrome");
    elements.propertiesLabel.textContent = text("MPY_DISPLAY_DESIGNER_PROPERTIES", "Object properties");
    overlayText('[data-label="layer-label"]',
        "MPY_DISPLAY_DESIGNER_LAYER_LABEL", "Layer name");
    elements.layerLabelInput.placeholder = text(
        "MPY_DISPLAY_DESIGNER_LAYER_LABEL_AUTO", "Automatic");
    elements.noSelection.textContent = text("MPY_DISPLAY_DESIGNER_NO_SELECTION", "No object selected.");
    overlayText('[data-label="line-width"]',
        "MPY_DISPLAY_DESIGNER_LINE_WIDTH", "Line width");
    overlayText('[data-label="corner-radius"]',
        "MPY_DISPLAY_DESIGNER_CORNER_RADIUS", "Corner radius");
    elements.filledLabel.textContent = text("MPY_DISPLAY_DESIGNER_FILLED", "Filled");
    elements.bitmapTransparentLabel.textContent = text(
        "MPY_DISPLAY_DESIGNER_BITMAP_TRANSPARENT", "Black is transparent");
    elements.layersLabel.textContent = text("MPY_DISPLAY_DESIGNER_LAYERS", "Layers");
    elements.noLayers.textContent = text("MPY_DISPLAY_DESIGNER_NO_LAYERS", "No layers yet.");
    elements.duplicateButton.textContent = text("MPY_DISPLAY_DESIGNER_DUPLICATE", "Duplicate");
    elements.deleteButton.textContent = text("MPY_DISPLAY_DESIGNER_DELETE_SELECTED", "Delete selected");
    elements.saveButton.textContent = text("MPY_DISPLAY_DESIGNER_SAVE", "Save");
    updateLivePreviewUi();
    overlayText('[data-label="unsaved-title"]',
        "MPY_DISPLAY_DESIGNER_UNSAVED_TITLE", "Unsaved changes");
    overlayText('[data-label="unsaved-message"]',
        "MPY_DISPLAY_DESIGNER_UNSAVED_MESSAGE",
        "This design contains unsaved changes. Close and discard them?");
    overlayText('[data-action="continue-editing"]',
        "MPY_DISPLAY_DESIGNER_CONTINUE_EDITING", "Continue editing");
    overlayText('[data-action="discard-changes"]',
        "MPY_DISPLAY_DESIGNER_DISCARD_CHANGES", "Discard changes");
    var undoLabel = text("MPY_DISPLAY_DESIGNER_UNDO", "Undo");
    var redoLabel = text("MPY_DISPLAY_DESIGNER_REDO", "Redo");
    elements.undoButton.title = undoLabel + " (Ctrl+Z)";
    elements.undoButton.setAttribute("aria-label", elements.undoButton.title);
    elements.redoButton.title = redoLabel + " (Ctrl+Y)";
    elements.redoButton.setAttribute("aria-label", elements.redoButton.title);
    var orderLabels = {
      front: text("MPY_DISPLAY_DESIGNER_LAYER_FRONT", "Bring to front"),
      up: text("MPY_DISPLAY_DESIGNER_LAYER_UP", "Move up"),
      down: text("MPY_DISPLAY_DESIGNER_LAYER_DOWN", "Move down"),
      back: text("MPY_DISPLAY_DESIGNER_LAYER_BACK", "Send to back")
    };
    for (var orderIndex = 0; orderIndex < elements.layerOrderButtons.length;
        orderIndex++) {
      var orderButton = elements.layerOrderButtons[orderIndex];
      var orderLabel = orderLabels[orderButton.dataset.layerOrder];
      orderButton.title = orderLabel;
      orderButton.setAttribute("aria-label", orderLabel);
    }
    updateSizeButton();

    overlayText('[data-tool-label="select"]', "MPY_DISPLAY_DESIGNER_TOOL_SELECT", "Select");
    overlayText('[data-tool-label="rect"]', "MPY_DISPLAY_DESIGNER_TOOL_RECTANGLE", "Rectangle");
    overlayText('[data-tool-label="line"]', "MPY_DISPLAY_DESIGNER_TOOL_LINE", "Line");
    overlayText('[data-tool-label="ellipse"]', "MPY_DISPLAY_DESIGNER_TOOL_ELLIPSE", "Ellipse");
    overlayText('[data-tool-label="drawing"]',
        "MPY_DISPLAY_DESIGNER_DRAWING_LAYER", "Drawing");
    overlayText('[data-tool-label="brush"]', "MPY_DISPLAY_DESIGNER_TOOL_BRUSH", "Brush");
    overlayText('[data-tool-label="eraser"]', "MPY_DISPLAY_DESIGNER_TOOL_ERASER", "Eraser");
    overlayText('[data-tool-label="brush-size"]',
        "MPY_DISPLAY_DESIGNER_BRUSH_SIZE", "Size");
    overlayText('[data-label="color"]', "MPY_DISPLAY_DESIGNER_COLOR", "Colour");
    overlayText('[data-label="color-white"]',
        "MPY_DISPLAY_DESIGNER_COLOR_WHITE", "White");
    overlayText('[data-label="color-black"]',
        "MPY_DISPLAY_DESIGNER_COLOR_BLACK", "Black");
    var colorGroups = elements.overlay.querySelectorAll('[data-label-aria="color"]');
    for (var colorGroupIndex = 0; colorGroupIndex < colorGroups.length;
        colorGroupIndex++) {
      colorGroups[colorGroupIndex].setAttribute("aria-label",
          text("MPY_DISPLAY_DESIGNER_COLOR", "Colour"));
    }
    elements.brushSizeSelect.setAttribute("aria-label",
        text("MPY_DISPLAY_DESIGNER_BRUSH_SIZE", "Size"));
    overlayText('[data-tool-label="fonts"]', "MPY_DISPLAY_DESIGNER_TOOL_TEXT", "Text");
    overlayText('[data-tool-label="bitmap"]', "MPY_DISPLAY_DESIGNER_TOOL_BITMAP", "Bitmap");
    overlayText('[data-label="font-picker-title"]', "MPY_DISPLAY_DESIGNER_FONT_PICKER_TITLE", "Add text");
    overlayText('[data-label="font-picker-help"]', "MPY_DISPLAY_DESIGNER_FONT_PICKER_HELP",
        "Choose an integrated font. Its data are added to the project only when used.");
    overlayText('[data-label="text-value"]', "MPY_DISPLAY_DESIGNER_TEXT_VALUE", "Text");
    overlayText('[data-label="font-choice"]', "MPY_DISPLAY_DESIGNER_FONT_CHOICE", "Font");
    overlayText('[data-action="edit-fonts"]', "MPY_DISPLAY_DESIGNER_EDIT_FONTS", "Import or edit fonts");
    overlayText('[data-action="apply-font"]', "MPY_DISPLAY_DESIGNER_ADD_TEXT", "Add text");
    overlayText('[data-label="text-content"]', "MPY_DISPLAY_DESIGNER_TEXT_VALUE", "Text");
    overlayText('[data-label="current-font"]', "MPY_DISPLAY_DESIGNER_CURRENT_FONT", "Font");
    overlayText('[data-action="change-text-font"]', "MPY_DISPLAY_DESIGNER_CHANGE_FONT", "Change font");
    overlayText('[data-label="dynamic-inputs"]',
        "MPY_DISPLAY_DESIGNER_DYNAMIC_INPUTS", "Dynamic block inputs");
    overlayText('[data-label="dynamic-text"]',
        "MPY_DISPLAY_DESIGNER_DYNAMIC_TEXT", "Text");
    overlayText('[data-label="dynamic-x"]',
        "MPY_DISPLAY_DESIGNER_DYNAMIC_X", "X position");
    overlayText('[data-label="dynamic-y"]',
        "MPY_DISPLAY_DESIGNER_DYNAMIC_Y", "Y position");
    overlayText('[data-label="dynamic-visible"]',
        "MPY_DISPLAY_DESIGNER_DYNAMIC_VISIBLE", "Visibility");
    overlayText('[data-label="arrange"]',
        "MPY_DISPLAY_DESIGNER_ARRANGE", "Align and distribute");
    var arrangeLabels = {
      left: text("MPY_DISPLAY_DESIGNER_ALIGN_LEFT", "Align left"),
      "center-x": text("MPY_DISPLAY_DESIGNER_ALIGN_CENTER_X", "Center horizontally"),
      right: text("MPY_DISPLAY_DESIGNER_ALIGN_RIGHT", "Align right"),
      top: text("MPY_DISPLAY_DESIGNER_ALIGN_TOP", "Align top"),
      "center-y": text("MPY_DISPLAY_DESIGNER_ALIGN_CENTER_Y", "Center vertically"),
      bottom: text("MPY_DISPLAY_DESIGNER_ALIGN_BOTTOM", "Align bottom"),
      "distribute-x": text("MPY_DISPLAY_DESIGNER_DISTRIBUTE_X",
          "Distribute horizontally"),
      "distribute-y": text("MPY_DISPLAY_DESIGNER_DISTRIBUTE_Y",
          "Distribute vertically")
    };
    for (var arrangeIndex = 0; arrangeIndex < elements.arrangeButtons.length;
        arrangeIndex++) {
      var arrangeButton = elements.arrangeButtons[arrangeIndex];
      var arrangeLabel = arrangeLabels[arrangeButton.dataset.arrange];
      arrangeButton.title = arrangeLabel;
      arrangeButton.setAttribute("aria-label", arrangeLabel);
    }
    overlayText('[data-label="bitmap-title"]', "MPY_DISPLAY_DESIGNER_BITMAP_TITLE", "Import bitmap");
    overlayText('[data-label="bitmap-help"]', "MPY_DISPLAY_DESIGNER_BITMAP_HELP",
        "Resize and convert the image to monochrome display pixels.");
    overlayText('[data-label="bitmap-width"]', "MPY_DISPLAY_DESIGNER_WIDTH", "Width");
    overlayText('[data-label="bitmap-height"]', "MPY_DISPLAY_DESIGNER_HEIGHT", "Height");
    overlayText('[data-label="bitmap-threshold"]', "MPY_DISPLAY_DESIGNER_BITMAP_THRESHOLD", "Black threshold");
    overlayText('[data-label="bitmap-invert"]', "MPY_DISPLAY_DESIGNER_BITMAP_INVERT", "Invert");
    overlayText('[data-label="bitmap-dither"]', "MPY_DISPLAY_DESIGNER_BITMAP_DITHER", "Dithering");
    overlayText('.espide-display-designer-bitmap-importer [data-action="close-bitmap"]:not(.espide-display-designer-bitmap-close)',
        "MPY_DISPLAY_DESIGNER_CANCEL", "Cancel");
    overlayText('[data-action="apply-bitmap"]', "MPY_DISPLAY_DESIGNER_BITMAP_ADD", "Add bitmap");
    overlayText('[data-coordinate-label="x"]', "MPY_DISPLAY_DESIGNER_X", "X");
    overlayText('[data-coordinate-label="y"]', "MPY_DISPLAY_DESIGNER_Y", "Y");
    overlayText('[data-coordinate-label="width"]', "MPY_DISPLAY_DESIGNER_WIDTH", "Width");
    overlayText('[data-coordinate-label="height"]', "MPY_DISPLAY_DESIGNER_HEIGHT", "Height");
    elements.fontPickerClose.setAttribute("aria-label",
        text("MPY_DISPLAY_DESIGNER_CLOSE_FONT_PICKER", "Close font selection"));
    elements.bitmapImporter.querySelector(".espide-display-designer-bitmap-close")
        .setAttribute("aria-label", text("MPY_DISPLAY_DESIGNER_BITMAP_CLOSE", "Close bitmap import"));

    for (var i = 0; i < elements.cancelButtons.length; i++) {
      if (!elements.cancelButtons[i].classList.contains("espide-display-designer-close")) {
        elements.cancelButtons[i].textContent = text("MPY_DISPLAY_DESIGNER_CANCEL", "Cancel");
      }
      elements.cancelButtons[i].setAttribute("aria-label", text("MPY_DISPLAY_DESIGNER_CANCEL", "Cancel"));
    }
  }

  function overlayText(selector, key, fallback) {
    elements.overlay.querySelector(selector).textContent = text(key, fallback);
  }

  function updateSizeButton() {
    var maximized = elements.overlay.classList.contains("is-maximized");
    var label = maximized ?
        text("MPY_DISPLAY_DESIGNER_RESTORE", "Restore size") :
        text("MPY_DISPLAY_DESIGNER_MAXIMIZE", "Maximize designer");
    elements.sizeIcon.textContent = maximized ? "❐" : "⛶";
    elements.sizeButton.setAttribute("aria-label", label);
    elements.sizeButton.title = label;
  }

  function toggleDesignerSize() {
    elements.overlay.classList.toggle("is-maximized");
    updateSizeButton();
    scheduleGridRender();
  }

  function updateResolutionUi() {
    if (!elements) return;
    elements.resolutionWidth.value = WIDTH;
    elements.resolutionHeight.value = HEIGHT;
    elements.resolutionButtonValue.textContent = WIDTH + " × " + HEIGHT;
    elements.resolutionSummary.innerHTML = WIDTH + " &times; " + HEIGHT + " px";
    elements.subtitle.textContent = WIDTH + "×" + HEIGHT + " " +
        text("MPY_DISPLAY_DESIGNER_MONO", "Monochrome").toLowerCase();
    elements.screen.setAttribute("aria-label", WIDTH + " by " + HEIGHT +
        " monochrome preview");
    var targetLabel = currentTarget && currentTarget.label ? currentTarget.label :
        DEFAULT_WIDTH + "×" + DEFAULT_HEIGHT;
    elements.targetLabel.textContent = text(
        "MPY_DISPLAY_DESIGNER_ACTIVE_DISPLAY", "Display") + ": " + targetLabel;
    elements.useTargetResolutionButton.hidden = !currentTarget ||
        (currentTarget.width === WIDTH && currentTarget.height === HEIGHT);
  }

  function setResolutionPopover(open) {
    if (!elements) return;
    open = !!open;
    elements.resolutionPopover.hidden = !open;
    elements.resolutionToggleButton.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function toggleResolutionPopover() {
    setResolutionPopover(elements.resolutionPopover.hidden);
  }

  function onResolutionInputKeyDown(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applyManualResolution();
  }

  function setEditorDimensions(width, height) {
    WIDTH = validDimension(width, DEFAULT_WIDTH);
    HEIGHT = validDimension(height, DEFAULT_HEIGHT);
    if (WIDTH * Math.ceil(HEIGHT / 8) > 0xffff) {
      throw new RangeError("Display resolution requires more than 65535 bytes");
    }
    if (!elements) return;
    elements.canvas.width = WIDTH;
    elements.canvas.height = HEIGHT;
    elements.selectionCanvas.width = WIDTH;
    elements.selectionCanvas.height = HEIGHT;
    elements.bitmapWidth.max = WIDTH;
    elements.bitmapHeight.max = HEIGHT;
    var widthInputs = elements.overlay.querySelectorAll('[data-property="width"]');
    var heightInputs = elements.overlay.querySelectorAll('[data-property="height"]');
    for (var i = 0; i < widthInputs.length; i++) widthInputs[i].max = WIDTH;
    for (i = 0; i < heightInputs.length; i++) heightInputs[i].max = HEIGHT;
    updateResolutionUi();
  }

  function changeResolution(width, height, target) {
    if (!draftScene) return false;
    width = validDimension(width, WIDTH);
    height = validDimension(height, HEIGHT);
    if (width * Math.ceil(height / 8) > 0xffff) {
      global.alert(text("MPY_DISPLAY_DESIGNER_RESOLUTION_TOO_LARGE",
          "This resolution requires too much framebuffer memory."));
      updateResolutionUi();
      return false;
    }
    if (width === WIDTH && height === HEIGHT) {
      updateResolutionUi();
      return true;
    }
    if (livePreviewActive) stopLivePreview(true);
    setEditorDimensions(width, height);
    draftScene.width = width;
    draftScene.height = height;
    draftScene.target = {
      profileId: target && target.profileId || "manual-" + width + "x" + height,
      label: target && target.label || width + "×" + height,
      source: target && target.source || "manual"
    };
    draftScene = normalizeScene(draftScene, {
      width: width,
      height: height,
      activate: true
    });
    decodedBitmapCache = Object.create(null);
    renderEditor();
    recordHistory();
    scheduleGridRender();
    return true;
  }

  function applyManualResolution() {
    if (changeResolution(elements.resolutionWidth.value,
        elements.resolutionHeight.value, null)) setResolutionPopover(false);
  }

  function applyTargetResolution() {
    if (!currentTarget) return;
    if (changeResolution(currentTarget.width, currentTarget.height, currentTarget)) {
      setResolutionPopover(false);
    }
  }

  function scheduleGridRender() {
    if (!elements || elements.overlay.hidden || gridRenderFrame) return;
    gridRenderFrame = global.requestAnimationFrame(function() {
      gridRenderFrame = 0;
      renderPixelGrid();
    });
  }

  /** Choose a predictable integer CSS zoom when it uses the stage well.
   *
   * CSS multiples give useful sizes such as 320x240 -> 640x480 regardless of
   * operating-system DPI. A fluid scale is still preferable when snapping
   * would waste substantial room, notably 400x300 at about 1.9x and large
   * targets in full-screen mode.
   */
  function calculatePreviewScale(maximumScale, devicePixelRatio) {
    maximumScale = Number(maximumScale);
    if (!Number.isFinite(maximumScale) || maximumScale <= 0) {
      return {cssScale: 0, physicalScale: 0, snapped: false};
    }
    var ratio = Math.max(1, Number(devicePixelRatio) || 1);
    var integerScale = Math.floor(maximumScale);
    var minimumUse = integerScale >= 2 ? 0.82 : 0.9;
    var snapped = integerScale >= 1 && integerScale / maximumScale >= minimumUse;
    var cssScale = snapped ? integerScale : maximumScale;
    return {
      cssScale: cssScale,
      physicalScale: cssScale * ratio,
      snapped: snapped
    };
  }

  /** Return the most detailed grid that remains readable at this CSS scale. */
  function gridModeForScale(cssScale) {
    cssScale = Number(cssScale) || 0;
    if (cssScale >= 1.5) return "pixel";
    if (cssScale >= 0.45) return "major";
    return "none";
  }

  /** Match the canvas backing store to the final on-screen device pixels.
   *
   * devicePixelRatio alone is insufficient when the mobile meta viewport
   * scales the complete layout. Without the visual-viewport factor a
   * one-device-pixel grid line is resampled below one pixel and may vanish.
   */
  function calculateGridBackingSize(cssWidth, cssHeight, devicePixelRatio,
      visualViewportScale) {
    var ratio = Number(devicePixelRatio);
    if (!Number.isFinite(ratio) || ratio <= 0) ratio = 1;
    var viewportScale = Number(visualViewportScale);
    if (!Number.isFinite(viewportScale) || viewportScale <= 0) viewportScale = 1;
    var rasterScale = ratio * viewportScale;
    return {
      width: Math.max(1, Math.round((Number(cssWidth) || 0) * rasterScale)),
      height: Math.max(1, Math.round((Number(cssHeight) || 0) * rasterScale)),
      rasterScale: rasterScale
    };
  }

  /** Fit the target surface to the available preview panel.
   *
   * Merely preserving the 2:1 aspect ratio is insufficient: a 908px wide
   * canvas gives each OLED pixel 7.09375 CSS pixels and inevitably produces
   * uneven grid cells. Device pixel ratio is included here so the same rule
   * also holds at 125%, 150% and Retina display scaling.
   */
  function fitScreenToAvailableStage() {
    var availableWidth = elements.displayStage.clientWidth - 20;
    if (!elements.overlay.classList.contains("is-maximized")) {
      availableWidth = Math.min(960, availableWidth);
    }
    var availableHeight = Math.max(80, elements.displayStage.clientHeight - 20);
    if (availableWidth <= 0 || availableHeight <= 0) return;
    var ratio = Math.max(1, Number(global.devicePixelRatio) || 1);
    var maximumScale = Math.min(availableWidth / WIDTH, availableHeight / HEIGHT);
    var previewScale = calculatePreviewScale(maximumScale, ratio);
    elements.screen.style.width = (WIDTH * previewScale.cssScale) + "px";
    elements.screen.style.height = (HEIGHT * previewScale.cssScale) + "px";
    elements.screen.dataset.pixelScale = String(previewScale.physicalScale);
    elements.screen.dataset.gridMode = gridModeForScale(previewScale.cssScale);
    elements.screen.dataset.snappedScale = previewScale.snapped ? "true" : "false";
  }

  /** Draw the editor grid on the exact physical OLED-pixel boundaries. */
  function renderPixelGrid() {
    if (!elements || elements.overlay.hidden) return;
    fitScreenToAvailableStage();
    var canvas = elements.gridCanvas;
    /* Measure the canvas itself, not the bordered screen container. Including
     * the two-pixel frame would make the browser scale the backing store by a
     * few pixels and reintroduce the very antialiasing this layer avoids. */
    var bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    var viewportScale = global.visualViewport ?
        Number(global.visualViewport.scale) || 1 : 1;
    var backingSize = calculateGridBackingSize(
        bounds.width, bounds.height, global.devicePixelRatio, viewportScale);
    var physicalWidth = backingSize.width;
    var physicalHeight = backingSize.height;
    if (canvas.width !== physicalWidth) canvas.width = physicalWidth;
    if (canvas.height !== physicalHeight) canvas.height = physicalHeight;
    var context = canvas.getContext("2d");
    context.clearRect(0, 0, physicalWidth, physicalHeight);
    var gridMode = elements.screen.dataset.gridMode || "none";
    if (gridMode === "none") return;
    /* One physical screen pixel stays sharp and unobtrusive on HiDPI panels. */
    var thickness = 1;

    function drawLines(count, physicalSize, vertical) {
      var step = gridMode === "pixel" ? 1 : 8;
      for (var index = step; index < count; index += step) {
        var position = Math.round(index * physicalSize / count);
        var start = position - Math.floor(thickness / 2);
        context.fillStyle = gridMode === "major" || index % 8 === 0 ?
            "rgba(255, 255, 255, 0.30)" : "rgba(255, 255, 255, 0.12)";
        if (vertical) context.fillRect(start, 0, thickness, physicalHeight);
        else context.fillRect(0, start, physicalWidth, thickness);
      }
    }

    drawLines(WIDTH, physicalWidth, true);
    drawLines(HEIGHT, physicalHeight, false);
  }

  function versionedAssetUrl(path) {
    var resolved = typeof global.resolveAppUrl === "function" ? global.resolveAppUrl(path) : path;
    return typeof global.withAppVersion === "function" ? global.withAppVersion(resolved) : resolved;
  }

  function defaultFontCatalog() {
    return Array.isArray(global.ESPIDE_DEFAULT_FONTS) ? global.ESPIDE_DEFAULT_FONTS : [];
  }

  function catalogEntry(id) {
    var catalog = defaultFontCatalog();
    for (var i = 0; i < catalog.length; i++) if (catalog[i].id === id) return catalog[i];
    return null;
  }

  function fontChoiceKey(choice) {
    return choice ? choice.kind + ":" + choice.id : "";
  }

  function fontChoices() {
    var choices = defaultFontCatalog().map(function(entry) {
      return {kind: "builtin", id: entry.id, name: entry.name, entry: entry};
    });
    /* Project fonts are intentionally appended without sorting. Importing a
     * personal font must never disturb the fixed production catalog order. */
    for (var i = 0; i < draftScene.fonts.length; i++) {
      var asset = draftScene.fonts[i];
      /* Built-ins already have their permanent catalog entry and preview. */
      if (asset.source === "builtin" && catalogEntry(asset.catalogId)) continue;
      var font = decodeFontAsset(asset);
      if (font) {
        choices.push({kind: "project", id: asset.id, name: asset.name, asset: asset,
          width: font.width, height: font.height});
      }
    }
    return choices;
  }

  function choiceDimensions(choice) {
    if (!choice) return {width: 0, height: 0};
    return choice.kind === "builtin" ? choice.entry : choice;
  }

  function drawFontSample(context, font, sample, originX, originY, scale, gap) {
    var cursorX = originX;
    gap = Math.max(0, Number(gap) || 0);
    var characters = Array.from(String(sample || ""));
    for (var i = 0; i < characters.length; i++) {
      var glyphIndex = global.ESPIDE_MFNT.glyphIndexForCharacter(characters[i]);
      var glyph = font.glyphs[glyphIndex];
      for (var y = 0; y < font.height; y++) {
        for (var x = 0; x < font.width; x++) {
          if (glyph[y * font.width + x]) {
            context.fillRect(cursorX + x * scale, originY + y * scale, scale, scale);
          }
        }
      }
      cursorX += (font.width + gap) * scale;
    }
  }

  function projectFontPreview(asset) {
    var font = decodeFontAsset(asset);
    if (!font) return "";
    var cache = decodedFontCache[asset.id];
    if (cache.preview) return cache.preview;
    var canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 80;
    var context = canvas.getContext("2d");
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    var sample = "ABCabc123";
    var sourceWidth = font.width * sample.length + sample.length - 1;
    var scale = Math.max(1, Math.min(5,
        Math.floor((canvas.width - 12) / sourceWidth),
        Math.floor((canvas.height - 12) / font.height)));
    var x = Math.floor((canvas.width - sourceWidth * scale) / 2);
    var y = Math.floor((canvas.height - font.height * scale) / 2);
    context.fillStyle = "#fff";
    drawFontSample(context, font, sample, x, y, scale, 1);
    cache.preview = canvas.toDataURL("image/png");
    return cache.preview;
  }

  function choicePreview(choice) {
    return choice.kind === "builtin" ? versionedAssetUrl(choice.entry.preview) :
        projectFontPreview(choice.asset);
  }

  function updateSelectedFontDisplay() {
    if (!selectedFontChoice) return;
    var dimensions = choiceDimensions(selectedFontChoice);
    var sample = selectedFontChoice.kind === "builtin" ?
        selectedFontChoice.entry.sample : "ABCabc123";
    elements.selectedFontPreview.src = choicePreview(selectedFontChoice);
    elements.selectedFontPreview.alt = sample + " – " + selectedFontChoice.name;
    elements.selectedFontName.textContent = selectedFontChoice.name;
    elements.selectedFontSize.textContent = dimensions.width + " × " + dimensions.height + " px";
    var options = elements.fontOptions.querySelectorAll('[role="option"]');
    for (var i = 0; i < options.length; i++) {
      var selected = options[i].dataset.choiceKey === fontChoiceKey(selectedFontChoice);
      options[i].classList.toggle("is-selected", selected);
      options[i].setAttribute("aria-selected", selected ? "true" : "false");
    }
  }

  function selectFontChoice(choice) {
    selectedFontChoice = choice;
    updateSelectedFontDisplay();
    elements.fontOptions.hidden = true;
    elements.fontOptionsButton.setAttribute("aria-expanded", "false");
    elements.fontPicker.classList.remove("is-options-open");
  }

  function addFontChoiceButton(choice) {
    var dimensions = choiceDimensions(choice);
    var button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "option");
    button.dataset.choiceKey = fontChoiceKey(choice);
    var image = document.createElement("img");
    image.src = choicePreview(choice);
    image.alt = "";
    var description = document.createElement("span");
    var name = document.createElement("strong");
    var size = document.createElement("small");
    name.textContent = choice.name;
    size.textContent = dimensions.width + " × " + dimensions.height + " px";
    description.appendChild(name);
    description.appendChild(size);
    button.appendChild(image);
    button.appendChild(description);
    button.addEventListener("click", function() { selectFontChoice(choice); });
    elements.fontOptions.appendChild(button);
  }

  function renderFontChoices(preferredKey) {
    var choices = fontChoices();
    elements.fontOptions.textContent = "";
    for (var i = 0; i < choices.length; i++) addFontChoiceButton(choices[i]);
    var wanted = preferredKey || fontChoiceKey(selectedFontChoice);
    selectedFontChoice = choices.find(function(choice) {
      return fontChoiceKey(choice) === wanted;
    }) || choices.find(function(choice) {
      return choice.kind === "builtin" && choice.id === "font-5x8";
    }) || choices[0] || null;
    updateSelectedFontDisplay();
  }

  function setFontPickerStatus(value, error) {
    elements.fontStatus.textContent = value || "";
    elements.fontStatus.classList.toggle("is-error", error === true);
  }

  function showFontPicker() {
    closeBitmapImporter();
    elements.fontPicker.hidden = false;
    elements.fontButton.classList.add("is-active");
    elements.fontButton.setAttribute("aria-expanded", "true");
    /* The compact 5x8 choice is sufficient for the common path. Keep the
     * expensive catalog list collapsed until the user explicitly opens it. */
    elements.fontOptions.hidden = true;
    elements.fontOptionsButton.setAttribute("aria-expanded", "false");
    elements.fontPicker.classList.remove("is-options-open");
    setFontPickerStatus("");
  }

  function openFontPicker() {
    fontPickerLayerId = null;
    selectedFontChoice = null;
    elements.newTextInput.value = elements.newTextInput.value || "ABCabc123";
    elements.applyFontButton.textContent = text("MPY_DISPLAY_DESIGNER_ADD_TEXT", "Add text");
    renderFontChoices("builtin:font-5x8");
    showFontPicker();
  }

  function openFontPickerForSelection() {
    var layer = getLayer(selectedLayerId);
    if (!layer || layer.type !== "text") return;
    fontPickerLayerId = layer.id;
    elements.newTextInput.value = layer.text;
    var asset = findFontAsset(draftScene.fonts, layer.fontId);
    var preferred = asset && asset.source === "builtin" && catalogEntry(asset.catalogId) ?
        "builtin:" + asset.catalogId : "project:" + layer.fontId;
    elements.applyFontButton.textContent = text("MPY_DISPLAY_DESIGNER_APPLY_FONT", "Apply font");
    renderFontChoices(preferred);
    showFontPicker();
  }

  function closeFontPicker() {
    elements.fontPicker.hidden = true;
    elements.fontButton.classList.remove("is-active");
    elements.fontButton.setAttribute("aria-expanded", "false");
    elements.fontPicker.classList.remove("is-options-open");
    fontPickerLayerId = null;
    setFontPickerStatus("");
  }

  function closeBitmapImporter() {
    if (!elements) return;
    elements.bitmapImporter.hidden = true;
    elements.bitmapButton.classList.remove("is-active");
    bitmapImportBytes = null;
    if (bitmapImportSource && typeof bitmapImportSource.close === "function") {
      bitmapImportSource.close();
    }
    bitmapImportSource = null;
  }

  function chooseBitmapFile() {
    if (!global.ESPIDE_BITMAP) {
      global.alert(text("MPY_DISPLAY_DESIGNER_BITMAP_ERROR", "Bitmap import is unavailable."));
      return;
    }
    closeFontPicker();
    setActiveTool("select");
    elements.bitmapFileInput.value = "";
    elements.bitmapFileInput.click();
  }

  function decodeBitmapFile(file) {
    if (typeof global.createImageBitmap === "function") {
      return global.createImageBitmap(file).then(function(image) {
        return {
          image: image,
          width: image.width,
          height: image.height,
          close: function() { if (typeof image.close === "function") image.close(); }
        };
      });
    }
    return new Promise(function(resolve, reject) {
      var url = global.URL.createObjectURL(file);
      var image = new global.Image();
      image.onload = function() {
        resolve({
          image: image,
          width: image.naturalWidth,
          height: image.naturalHeight,
          close: function() { global.URL.revokeObjectURL(url); }
        });
      };
      image.onerror = function() {
        global.URL.revokeObjectURL(url);
        reject(new Error("Image decode failed"));
      };
      image.src = url;
    });
  }

  async function onBitmapFileSelected(event) {
    var file = event.currentTarget.files && event.currentTarget.files[0];
    if (!file) return;
    var supportedName = /\.(png|jpe?g|bmp|webp)$/i.test(file.name || "");
    if ((!/^image\//i.test(file.type || "") && !supportedName) || file.size > 16 * 1024 * 1024) {
      global.alert(text("MPY_DISPLAY_DESIGNER_BITMAP_ERROR",
          "Choose a PNG, JPG, BMP or WebP image up to 16 MB."));
      return;
    }
    try {
      closeBitmapImporter();
      bitmapImportSource = await decodeBitmapFile(file);
      bitmapImportSource.name = String(file.name || "Bitmap")
          .replace(/[\\/]+/g, "_").substring(0, 60);
      var fitted = global.ESPIDE_BITMAP.fitDimensions(bitmapImportSource.width,
          bitmapImportSource.height, WIDTH, HEIGHT);
      elements.bitmapWidth.value = fitted.width;
      elements.bitmapHeight.value = fitted.height;
      elements.bitmapThreshold.value = 128;
      elements.bitmapInvert.checked = false;
      elements.bitmapDither.checked = false;
      elements.bitmapImporter.hidden = false;
      elements.bitmapButton.classList.add("is-active");
      renderBitmapImportPreview();
    } catch (error) {
      closeBitmapImporter();
      global.alert(text("MPY_DISPLAY_DESIGNER_BITMAP_ERROR",
          "The image could not be imported:") + " " + (error.message || String(error)));
    }
  }

  function renderBitmapImportPreview() {
    if (!bitmapImportSource || !global.ESPIDE_BITMAP) return;
    var width = clamp(integer(elements.bitmapWidth.value, 1), 1, WIDTH);
    var height = clamp(integer(elements.bitmapHeight.value, 1), 1, HEIGHT);
    elements.bitmapWidth.value = width;
    elements.bitmapHeight.value = height;
    var threshold = clamp(integer(elements.bitmapThreshold.value, 128), 0, 255);
    elements.bitmapThresholdOutput.value = threshold;

    var sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    var sourceContext = sourceCanvas.getContext("2d", {willReadFrequently: true});
    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = "high";
    sourceContext.clearRect(0, 0, width, height);
    sourceContext.drawImage(bitmapImportSource.image, 0, 0, width, height);
    var rgba = sourceContext.getImageData(0, 0, width, height).data;
    bitmapImportBytes = global.ESPIDE_BITMAP.fromRgba(rgba, width, height, {
      threshold: threshold,
      invert: elements.bitmapInvert.checked,
      dither: elements.bitmapDither.checked
    });

    var preview = elements.bitmapPreview;
    var context = preview.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#000";
    context.fillRect(0, 0, preview.width, preview.height);
    var scale = Math.max(1, Math.floor(Math.min(preview.width / width, preview.height / height)));
    var originX = Math.floor((preview.width - width * scale) / 2);
    var originY = Math.floor((preview.height - height * scale) / 2);
    context.fillStyle = "#fff";
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        if (global.ESPIDE_BITMAP.getPixel(bitmapImportBytes, width, x, y)) {
          context.fillRect(originX + x * scale, originY + y * scale, scale, scale);
        }
      }
    }
    elements.bitmapStatus.textContent = bitmapImportSource.width + " × " +
        bitmapImportSource.height + " → " + width + " × " + height + " px · " +
        bitmapImportBytes.length + " B";
  }

  function applyBitmapImport() {
    if (!bitmapImportSource || !bitmapImportBytes) return;
    var width = clamp(integer(elements.bitmapWidth.value, 1), 1, WIDTH);
    var height = clamp(integer(elements.bitmapHeight.value, 1), 1, HEIGHT);
    var layer = {
      id: nextLayerId("bitmap"),
      type: "bitmap",
      x: Math.min(3, WIDTH - width),
      y: Math.min(3, HEIGHT - height),
      width: width,
      height: height,
      name: bitmapImportSource.name,
      format: global.ESPIDE_BITMAP.FORMAT,
      data: bytesToBase64(bitmapImportBytes),
      transparent: true,
      color: 1,
      visible: true
    };
    draftScene.layers.push(layer);
    setSelection([layer.id]);
    closeBitmapImporter();
    setActiveTool("select");
    renderEditor();
    recordHistory();
  }

  function toggleFontOptions() {
    elements.fontOptions.hidden = !elements.fontOptions.hidden;
    elements.fontOptionsButton.setAttribute("aria-expanded",
        elements.fontOptions.hidden ? "false" : "true");
    elements.fontPicker.classList.toggle("is-options-open", !elements.fontOptions.hidden);
  }

  function uniqueFontId(base) {
    var candidate = base;
    var suffix = 2;
    while (findFontAsset(draftScene.fonts, candidate)) {
      candidate = base + "-" + suffix;
      suffix++;
    }
    return candidate;
  }

  async function ensureFontAsset(choice) {
    if (choice.kind === "project") return findFontAsset(draftScene.fonts, choice.id);
    for (var i = 0; i < draftScene.fonts.length; i++) {
      if (draftScene.fonts[i].source === "builtin" &&
          draftScene.fonts[i].catalogId === choice.id) return draftScene.fonts[i];
    }
    var response = await global.fetch(versionedAssetUrl(choice.entry.path), {cache: "force-cache"});
    if (!response.ok) throw new Error("HTTP " + response.status);
    var bytes = new Uint8Array(await response.arrayBuffer());
    var validation = global.ESPIDE_MFNT.validate(bytes);
    if (!validation.valid) throw new Error(validation.errors.join("; "));
    var asset = {
      id: uniqueFontId("builtin-" + choice.id),
      name: choice.name,
      fileName: choice.entry.fileName,
      data: bytesToBase64(bytes),
      source: "builtin",
      catalogId: choice.id
    };
    draftScene.fonts.push(asset);
    return asset;
  }

  function updateTextLayerMetrics(layer) {
    var asset = findFontAsset(draftScene.fonts, layer.fontId);
    var font = decodeFontAsset(asset);
    if (!font) return false;
    var metrics = textLayerMetrics(font, layer.text);
    layer.width = metrics.width;
    layer.height = metrics.height;
    return true;
  }

  async function applySelectedFont() {
    if (!selectedFontChoice || fontPickerBusy) return;
    fontPickerBusy = true;
    elements.applyFontButton.disabled = true;
    setFontPickerStatus(text("MPY_DISPLAY_DESIGNER_FONT_LOADING", "Loading font…"));
    try {
      var asset = await ensureFontAsset(selectedFontChoice);
      if (!asset) throw new Error("Font is not available");
      var content = String(elements.newTextInput.value || "Text")
          .replace(/[\r\n]+/g, " ").substring(0, 80) || "Text";
      var layer = fontPickerLayerId ? getLayer(fontPickerLayerId) : null;
      if (layer && layer.type === "text") {
        layer.text = content;
        layer.fontId = asset.id;
        layer.parameterId = null;
        updateTextLayerMetrics(layer);
      } else {
        layer = {
          id: nextLayerId("text"),
          type: "text",
          x: 3,
          y: 3,
          width: 1,
          height: 1,
          text: content,
          fontId: asset.id,
          color: 1,
          parameterId: null
        };
        updateTextLayerMetrics(layer);
        draftScene.layers.push(layer);
      }
      setSelection([layer.id]);
      setActiveTool("select");
      closeFontPicker();
      renderEditor();
      recordHistory();
    } catch (error) {
      setFontPickerStatus(text("MPY_DISPLAY_DESIGNER_FONT_ERROR", "Font could not be loaded:") +
          " " + (error.message || String(error)), true);
    } finally {
      fontPickerBusy = false;
      elements.applyFontButton.disabled = false;
    }
  }

  function openFontLibrary() {
    if (!global.ESPIDE_FONT_EDITOR || !draftScene) {
      if (global.console) global.console.error("ESP IDE font editor is not available.");
      return;
    }
    global.ESPIDE_FONT_EDITOR.open({
      fonts: draftScene.fonts,
      onSave: function(fonts) {
        draftScene.fonts = normalizeFonts(fonts);
        draftScene = normalizeScene(draftScene);
        setSelection(selectedLayerIds);
        renderFontChoices();
        renderEditor();
        recordHistory();
      }
    });
  }

  function getLayer(id) {
    if (!draftScene) return null;
    for (var i = 0; i < draftScene.layers.length; i++) {
      if (draftScene.layers[i].id === id) return draftScene.layers[i];
    }
    return null;
  }

  function getSelectedLayers() {
    if (!draftScene) return [];
    return draftScene.layers.filter(function(layer) {
      return selectedLayerIds.indexOf(layer.id) !== -1;
    });
  }

  function isLayerSelected(id) {
    return selectedLayerIds.indexOf(id) !== -1;
  }

  function setSelection(ids) {
    var validIds = [];
    for (var i = 0; i < ids.length; i++) {
      if (getLayer(ids[i]) && validIds.indexOf(ids[i]) === -1) validIds.push(ids[i]);
    }
    selectedLayerIds = validIds;
    selectedLayerId = validIds.length ? validIds[validIds.length - 1] : null;
  }

  function toggleSelection(id) {
    var index = selectedLayerIds.indexOf(id);
    var next = selectedLayerIds.slice();
    if (index === -1) next.push(id);
    else next.splice(index, 1);
    setSelection(next);
  }

  function nextLayerId(type) {
    var prefix = type === "line" ? "line" : type === "ellipse" ? "ellipse" :
        type === "text" ? "text" : type === "bitmap" ? "bitmap" :
        type === "drawing" ? "drawing" : "rect";
    var number = 1;
    while (getLayer(prefix + "-" + number)) number++;
    return prefix + "-" + number;
  }

  function roundedRectangleContainsPixel(layer, x, y) {
    if (x < layer.x || y < layer.y ||
        x >= layer.x + layer.width || y >= layer.y + layer.height) return false;
    var radius = rectangleRadius(layer);
    if (!radius) return true;
    var pixelX = x + 0.5;
    var pixelY = y + 0.5;
    var innerLeft = layer.x + radius;
    var innerRight = layer.x + layer.width - radius;
    var innerTop = layer.y + radius;
    var innerBottom = layer.y + layer.height - radius;
    var nearestX = Math.max(innerLeft, Math.min(innerRight, pixelX));
    var nearestY = Math.max(innerTop, Math.min(innerBottom, pixelY));
    var dx = pixelX - nearestX;
    var dy = pixelY - nearestY;
    return dx * dx + dy * dy <= radius * radius;
  }

  function drawRectangle(context, layer) {
    if (rectangleRadius(layer)) {
      for (var y = layer.y; y < layer.y + layer.height; y++) {
        for (var x = layer.x; x < layer.x + layer.width; x++) {
          if (!roundedRectangleContainsPixel(layer, x, y)) continue;
          if (layer.filled ||
              !roundedRectangleContainsPixel(layer, x - 1, y) ||
              !roundedRectangleContainsPixel(layer, x + 1, y) ||
              !roundedRectangleContainsPixel(layer, x, y - 1) ||
              !roundedRectangleContainsPixel(layer, x, y + 1)) {
            context.fillRect(x, y, 1, 1);
          }
        }
      }
      return;
    }
    if (layer.filled) {
      context.fillRect(layer.x, layer.y, layer.width, layer.height);
      return;
    }
    context.fillRect(layer.x, layer.y, layer.width, 1);
    if (layer.height > 1) {
      context.fillRect(layer.x, layer.y + layer.height - 1, layer.width, 1);
    }
    if (layer.height > 2) {
      context.fillRect(layer.x, layer.y + 1, 1, layer.height - 2);
      if (layer.width > 1) {
        context.fillRect(layer.x + layer.width - 1, layer.y + 1, 1, layer.height - 2);
      }
    }
  }

  /** Bresenham line drawing keeps preview pixels deterministic and antialias-free. */
  function drawLine(context, layer) {
    var x = layer.x1;
    var y = layer.y1;
    var strokeWidth = lineStrokeWidth(layer);
    var stampStart = -Math.floor(strokeWidth / 2);
    var dx = Math.abs(layer.x2 - layer.x1);
    var sx = layer.x1 < layer.x2 ? 1 : -1;
    var dy = -Math.abs(layer.y2 - layer.y1);
    var sy = layer.y1 < layer.y2 ? 1 : -1;
    var error = dx + dy;
    while (true) {
      context.fillRect(x + stampStart, y + stampStart, strokeWidth, strokeWidth);
      if (x === layer.x2 && y === layer.y2) break;
      var doubled = 2 * error;
      if (doubled >= dy) {
        error += dy;
        x += sx;
      }
      if (doubled <= dx) {
        error += dx;
        y += sy;
      }
    }
  }

  function ellipseContainsPixel(layer, x, y) {
    if (x < layer.x || y < layer.y ||
        x >= layer.x + layer.width || y >= layer.y + layer.height) return false;
    var radiusX = layer.width / 2;
    var radiusY = layer.height / 2;
    var centerX = layer.x + radiusX;
    var centerY = layer.y + radiusY;
    var normalizedX = (x + 0.5 - centerX) / radiusX;
    var normalizedY = (y + 0.5 - centerY) / radiusY;
    return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
  }

  /** Rasterize a filled or one-pixel outline ellipse without antialiasing. */
  function drawEllipse(context, layer) {
    for (var y = layer.y; y < layer.y + layer.height; y++) {
      for (var x = layer.x; x < layer.x + layer.width; x++) {
        if (!ellipseContainsPixel(layer, x, y)) continue;
        if (layer.filled ||
            !ellipseContainsPixel(layer, x - 1, y) ||
            !ellipseContainsPixel(layer, x + 1, y) ||
            !ellipseContainsPixel(layer, x, y - 1) ||
            !ellipseContainsPixel(layer, x, y + 1)) {
          context.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  function drawText(context, layer) {
    var asset = findFontAsset(draftScene.fonts, layer.fontId);
    var font = decodeFontAsset(asset);
    if (!font) return;
    context.fillStyle = layerColor(layer) ? "#fff" : "#000";
    drawFontSample(context, font, layer.text, layer.x, layer.y, 1, 1);
    context.fillStyle = "#fff";
  }

  function decodedBitmap(layer) {
    if (!global.ESPIDE_BITMAP || !layer) return null;
    var cached = decodedBitmapCache[layer.id];
    if (cached && cached.data === layer.data && cached.width === layer.width &&
        cached.height === layer.height) return cached.bytes;
    try {
      var bytes = base64ToBytes(layer.data);
      if (!global.ESPIDE_BITMAP.validate(bytes, layer.width, layer.height).valid) return null;
      decodedBitmapCache[layer.id] = {
        data: layer.data,
        width: layer.width,
        height: layer.height,
        bytes: bytes
      };
      return bytes;
    } catch (error) {
      return null;
    }
  }

  function decodedDrawingBlackBitmap(layer) {
    if (!global.ESPIDE_BITMAP || !isDrawingLayer(layer)) return null;
    var cached = decodedBitmapCache[layer.id];
    if (cached && cached.blackData === layer.blackData &&
        cached.width === layer.width && cached.height === layer.height &&
        cached.blackBytes) return cached.blackBytes;
    try {
      var bytes = base64ToBytes(layer.blackData);
      if (!global.ESPIDE_BITMAP.validate(bytes, layer.width, layer.height).valid) {
        return null;
      }
      if (!cached || cached.data !== layer.data ||
          cached.width !== layer.width || cached.height !== layer.height) {
        decodedBitmap(layer);
        cached = decodedBitmapCache[layer.id];
      }
      cached.blackData = layer.blackData;
      cached.blackBytes = bytes;
      return bytes;
    } catch (error) {
      return null;
    }
  }

  /** Keep both serializable drawing masks and the decoded cache in sync. */
  function storeDrawingBytes(layer, whiteBytes, blackBytes) {
    layer.data = bytesToBase64(whiteBytes);
    layer.blackData = bytesToBase64(blackBytes);
    decodedBitmapCache[layer.id] = {
      data: layer.data,
      blackData: layer.blackData,
      width: layer.width,
      height: layer.height,
      bytes: whiteBytes,
      blackBytes: blackBytes
    };
  }

  /**
   * Return the smallest local rectangle containing drawing pixels.
   * The result is cached with the decoded bitmap and is invalidated naturally
   * whenever storeDrawingBytes() replaces that cache entry after painting.
   */
  function drawingLocalBounds(layer) {
    var bytes = decodedBitmap(layer);
    var blackBytes = decodedDrawingBlackBitmap(layer);
    var cached = decodedBitmapCache[layer.id];
    if (!bytes || !blackBytes || !cached) return null;
    if (Object.prototype.hasOwnProperty.call(cached, "contentBounds")) {
      return cached.contentBounds;
    }
    var left = layer.width;
    var top = layer.height;
    var right = -1;
    var bottom = -1;
    for (var y = 0; y < layer.height; y++) {
      for (var x = 0; x < layer.width; x++) {
        if (!global.ESPIDE_BITMAP.getPixel(bytes, layer.width, x, y) &&
            !global.ESPIDE_BITMAP.getPixel(
                blackBytes, layer.width, x, y)) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    cached.contentBounds = right < left ? null : {
      left: left,
      top: top,
      right: right,
      bottom: bottom
    };
    return cached.contentBounds;
  }

  function drawingNumber(layer) {
    var match = layer && /^drawing-(\d+)$/.exec(layer.id);
    return match ? Number(match[1]) : draftScene.layers.indexOf(layer) + 1;
  }

  /** Composite ordinary bitmap masks and three-state drawing pixels. */
  function drawBitmap(context, layer) {
    var bytes = decodedBitmap(layer);
    if (!bytes) return;
    if (isDrawingLayer(layer)) {
      var blackBytes = decodedDrawingBlackBitmap(layer);
      if (!blackBytes) return;
      for (var drawingY = 0; drawingY < layer.height; drawingY++) {
        for (var drawingX = 0; drawingX < layer.width; drawingX++) {
          var isWhite = global.ESPIDE_BITMAP.getPixel(
              bytes, layer.width, drawingX, drawingY);
          var isBlack = global.ESPIDE_BITMAP.getPixel(
              blackBytes, layer.width, drawingX, drawingY);
          if (!isWhite && !isBlack) continue;
          context.fillStyle = isBlack ? "#000" : "#fff";
          context.fillRect(
              layer.x + drawingX, layer.y + drawingY, 1, 1);
        }
      }
      return;
    }
    var color = layerColor(layer);
    if (layer.transparent === false) {
      context.fillStyle = color ? "#000" : "#fff";
      context.fillRect(layer.x, layer.y, layer.width, layer.height);
    }
    context.fillStyle = color ? "#fff" : "#000";
    for (var y = 0; y < layer.height; y++) {
      for (var x = 0; x < layer.width; x++) {
        if (global.ESPIDE_BITMAP.getPixel(bytes, layer.width, x, y)) {
          context.fillRect(layer.x + x, layer.y + y, 1, 1);
        }
      }
    }
  }

  function resizeBitmapLayer(layer, width, height, source) {
    if (!layer || layer.type !== "bitmap" || !global.ESPIDE_BITMAP) return;
    source = source || layer;
    width = clamp(integer(width, layer.width), 1, WIDTH);
    height = clamp(integer(height, layer.height), 1, HEIGHT);
    try {
      var bytes = global.ESPIDE_BITMAP.resize(base64ToBytes(source.data),
          source.width, source.height, width, height);
      layer.width = width;
      layer.height = height;
      layer.data = bytesToBase64(bytes);
      delete decodedBitmapCache[layer.id];
    } catch (error) {
      /* Normalized scene data should never fail. Keep the last valid bitmap if
       * a hand-edited project somehow reaches this path. */
    }
  }

  function splitLayerGroups() {
    var staticLayers = [];
    var dynamicLayers = [];
    for (var i = 0; i < draftScene.layers.length; i++) {
      (hasDynamicBindings(draftScene.layers[i]) ? dynamicLayers : staticLayers)
          .push(draftScene.layers[i]);
    }
    return {staticLayers: staticLayers, dynamicLayers: dynamicLayers};
  }

  function storeLayerGroups(groups) {
    draftScene.layers = groups.staticLayers.concat(groups.dynamicLayers);
  }

  /** Static layers are always below dynamic layers, matching device output. */
  function compositedLayers() {
    var groups = splitLayerGroups();
    return groups.staticLayers.concat(groups.dynamicLayers);
  }

  function moveSelectedInGroup(group, action) {
    var selected = group.filter(function(layer) {
      return isLayerSelected(layer.id);
    });
    if (!selected.length) return group;
    var unselected = group.filter(function(layer) {
      return !isLayerSelected(layer.id);
    });
    if (action === "front") return unselected.concat(selected);
    if (action === "back") return selected.concat(unselected);

    var result = group.slice();
    var i;
    if (action === "up") {
      for (i = result.length - 2; i >= 0; i--) {
        if (isLayerSelected(result[i].id) &&
            !isLayerSelected(result[i + 1].id)) {
          var above = result[i + 1];
          result[i + 1] = result[i];
          result[i] = above;
        }
      }
    } else if (action === "down") {
      for (i = 1; i < result.length; i++) {
        if (isLayerSelected(result[i].id) &&
            !isLayerSelected(result[i - 1].id)) {
          var below = result[i - 1];
          result[i - 1] = result[i];
          result[i] = below;
        }
      }
    }
    return result;
  }

  function reorderSelectedLayers(action) {
    if (!selectedLayerIds.length) return;
    var groups = splitLayerGroups();
    groups.staticLayers = moveSelectedInGroup(groups.staticLayers, action);
    groups.dynamicLayers = moveSelectedInGroup(groups.dynamicLayers, action);
    storeLayerGroups(groups);
    renderEditor();
    recordHistory();
  }

  /** Render only display pixels on the scene canvas. */
  function renderScene() {
    var context = elements.canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#000000";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "#ffffff";
    var layers = compositedLayers();
    for (var i = 0; i < layers.length; i++) {
      /* Visibility is persisted with the scene, so this same contract can be
       * respected by the MicroPython generator when framebuffer output is
       * introduced. Hidden layers remain editable through the layer list. */
      if (layers[i].visible === false) continue;
      context.fillStyle = layerColor(layers[i]) ? "#ffffff" : "#000000";
      if (layers[i].type === "rect") drawRectangle(context, layers[i]);
      else if (layers[i].type === "line") drawLine(context, layers[i]);
      else if (layers[i].type === "ellipse") drawEllipse(context, layers[i]);
      else if (layers[i].type === "text") drawText(context, layers[i]);
      else if (layers[i].type === "bitmap") drawBitmap(context, layers[i]);
    }
  }

  /** Render editor-only selection chrome on the transparent overlay canvas. */
  function renderSelection() {
    var context = elements.selectionCanvas.getContext("2d");
    var selected = getSelectedLayers();
    context.clearRect(0, 0, WIDTH, HEIGHT);
    for (var i = 0; i < selected.length; i++) {
      if (selected[i].visible === false) continue;
      renderLayerSelection(context, selected[i], selected.length === 1);
    }
    renderBrushCursor(context);
  }

  function brushFootprint(centerX, centerY) {
    var start = -Math.floor(brushSize / 2);
    return {
      left: Math.max(0, centerX + start),
      top: Math.max(0, centerY + start),
      right: Math.min(WIDTH, centerX + start + brushSize),
      bottom: Math.min(HEIGHT, centerY + start + brushSize)
    };
  }

  /** Show the exact affected pixel square without modifying the scene canvas. */
  function renderBrushCursor(context) {
    if (!brushCursorPoint ||
        (activeTool !== "brush" && activeTool !== "eraser")) return;
    var bounds = brushFootprint(brushCursorPoint.x, brushCursorPoint.y);
    var width = bounds.right - bounds.left;
    var height = bounds.bottom - bounds.top;
    if (width < 1 || height < 1) return;
    var erasing = activeTool === "eraser";
    context.fillStyle = erasing ? "rgba(255, 92, 92, 0.32)" :
        activeColor ? "rgba(255, 255, 255, 0.48)" : "rgba(0, 0, 0, 0.72)";
    context.fillRect(bounds.left, bounds.top, width, height);
    context.strokeStyle = erasing ? "#ff6868" : "#64b5ff";
    context.lineWidth = 0.4;
    context.setLineDash([]);
    context.strokeRect(bounds.left + 0.2, bounds.top + 0.2,
        Math.max(0.6, width - 0.4), Math.max(0.6, height - 0.4));
  }

  function renderLayerSelection(context, layer, showHandles) {
    /* A drawing keeps a full-screen backing bitmap, but its usable selection
     * box follows only the painted pixels. It deliberately has no resize
     * handles: dragging translates the packed bitmap without resampling it. */
    if (isDrawingLayer(layer)) {
      var drawingBounds = layerBounds(layer);
      context.strokeStyle = "#42a5ff";
      context.lineWidth = 1;
      context.setLineDash([2, 1]);
      context.strokeRect(drawingBounds.left - 0.5, drawingBounds.top - 0.5,
          drawingBounds.right - drawingBounds.left + 1,
          drawingBounds.bottom - drawingBounds.top + 1);
      context.setLineDash([]);
      return;
    }
    if (layer.type === "line") {
      context.fillStyle = "#42a5ff";
      drawLine(context, layer);
      if (showHandles) {
        drawSelectionHandle(context, layer.x1, layer.y1);
        drawSelectionHandle(context, layer.x2, layer.y2);
      }
      return;
    }
    context.strokeStyle = "#42a5ff";
    context.lineWidth = 1;
    context.setLineDash([2, 1]);
    context.strokeRect(layer.x + 0.5, layer.y + 0.5,
        Math.max(0, layer.width - 1), Math.max(0, layer.height - 1));
    context.setLineDash([]);
    if (!showHandles || layer.type === "text") return;
    context.fillStyle = "#42a5ff";
    drawSelectionHandle(context, layer.x, layer.y);
    drawSelectionHandle(context, layer.x + layer.width - 1, layer.y);
    drawSelectionHandle(context, layer.x, layer.y + layer.height - 1);
    drawSelectionHandle(context, layer.x + layer.width - 1,
        layer.y + layer.height - 1);
  }

  function drawSelectionHandle(context, x, y) {
    context.fillRect(x - 1, y - 1, 3, 3);
  }

  function renderLayerList() {
    elements.layerList.textContent = "";
    elements.layersLabel.textContent = text("MPY_DISPLAY_DESIGNER_LAYERS", "Layers") +
        " (" + draftScene.layers.length + ")";
    elements.noLayers.hidden = draftScene.layers.length > 0;
    for (var orderIndex = 0; orderIndex < elements.layerOrderButtons.length;
        orderIndex++) {
      elements.layerOrderButtons[orderIndex].disabled = !selectedLayerIds.length;
    }
    var layers = compositedLayers();
    for (var i = layers.length - 1; i >= 0; i--) {
      var layer = layers[i];
      var sourceIndex = draftScene.layers.indexOf(layer);
      var item = document.createElement("li");
      item.className = layer.visible === false ? "is-hidden" : "";
      item.dataset.layerId = layer.id;
      var button = document.createElement("button");
      button.type = "button";
      button.dataset.layerId = layer.id;
      button.className = "espide-display-designer-layer-name" +
          (isLayerSelected(layer.id) ? " is-selected" : "");
      button.setAttribute("aria-pressed", isLayerSelected(layer.id) ? "true" : "false");
      var typeLabel = isDrawingLayer(layer) ?
          text("MPY_DISPLAY_DESIGNER_DRAWING_LAYER", "Drawing") + " " +
              drawingNumber(layer) : layer.type === "line" ?
          text("MPY_DISPLAY_DESIGNER_LINE", "Line") : layer.type === "ellipse" ?
          text("MPY_DISPLAY_DESIGNER_ELLIPSE", "Ellipse") : layer.type === "text" ?
          text("MPY_DISPLAY_DESIGNER_TEXT_LAYER", "Text") + ': "' + layer.text + '"' :
          layer.type === "bitmap" ?
          text("MPY_DISPLAY_DESIGNER_BITMAP_LAYER", "Bitmap") + ': "' + layer.name + '"' :
          text("MPY_DISPLAY_DESIGNER_RECTANGLE", "Rectangle");
      var automaticName = layer.type === "text" || layer.type === "bitmap" ?
          typeLabel : typeLabel + " " + (sourceIndex + 1);
      var displayName = layer.label || automaticName;
      button.textContent = (hasDynamicBindings(layer) ? "⚡ " : "") + displayName;
      if (layer.label) button.title = automaticName;
      if (hasDynamicBindings(layer)) {
        button.title = text("MPY_DISPLAY_DESIGNER_DYNAMIC_LAYER",
            "Dynamic layer — rendered above static layers");
      }
      var visibility = document.createElement("input");
      visibility.type = "checkbox";
      visibility.checked = layer.visible !== false;
      visibility.dataset.layerId = layer.id;
      visibility.className = "espide-display-designer-layer-visibility";
      /* The layer name is a useful accessible label without adding another
       * visible caption to the deliberately compact list. */
      visibility.setAttribute("aria-label", button.textContent);
      visibility.addEventListener("change", onLayerVisibilityChange);
      button.addEventListener("click", onLayerClick);
      var remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.layerId = layer.id;
      remove.className = "espide-display-designer-layer-remove";
      remove.title = text("MPY_DISPLAY_DESIGNER_DELETE_LAYER", "Delete layer");
      remove.setAttribute("aria-label", remove.title);
      remove.addEventListener("click", onLayerDeleteClick);
      item.appendChild(visibility);
      item.appendChild(button);
      item.appendChild(remove);
      elements.layerList.appendChild(item);
    }
  }

  function renderProperties() {
    var selected = getSelectedLayers();
    var layer = selected.length === 1 ? selected[0] : null;
    elements.objectFields.hidden = selected.length === 0;
    elements.layerLabelControl.hidden = selected.length !== 1;
    elements.arrangeFields.hidden = selected.length < 2;
    for (var arrangeIndex = 0; arrangeIndex < elements.arrangeButtons.length;
        arrangeIndex++) {
      var arrangeAction = elements.arrangeButtons[arrangeIndex].dataset.arrange;
      elements.arrangeButtons[arrangeIndex].disabled =
          selected.length < 3 &&
          (arrangeAction === "distribute-x" || arrangeAction === "distribute-y");
    }
    if (selected.length === 0) {
      elements.noSelection.hidden = false;
      elements.noSelection.textContent = text("MPY_DISPLAY_DESIGNER_NO_SELECTION", "No object selected.");
      elements.textFields.hidden = true;
      elements.dynamicFields.hidden = true;
      elements.lineWidthControl.hidden = true;
      elements.cornerRadiusControl.hidden = true;
      elements.layerColorControl.hidden = true;
      return;
    }
    if (selected.length > 1) {
      elements.noSelection.hidden = false;
      elements.noSelection.textContent = text("MPY_DISPLAY_DESIGNER_SELECTED_COUNT", "Selected objects") +
          ": " + selected.length;
      elements.coordinateGrid.hidden = true;
      elements.lineWidthControl.hidden = true;
      elements.cornerRadiusControl.hidden = true;
      elements.layerColorControl.hidden = true;
      elements.filledControl.hidden = true;
      elements.bitmapTransparentControl.hidden = true;
      elements.textFields.hidden = true;
      elements.dynamicFields.hidden = true;
      return;
    }
    elements.noSelection.hidden = true;
    var drawing = isDrawingLayer(layer);
    elements.dynamicFields.hidden = false;
    elements.coordinateGrid.hidden = drawing;
    elements.layerLabelInput.value = layer.label || "";
    var definitions = drawing ? [
      {property: "x", label: text("MPY_DISPLAY_DESIGNER_X", "X"), max: MAX_COORDINATE},
      {property: "y", label: text("MPY_DISPLAY_DESIGNER_Y", "Y"), max: MAX_COORDINATE}
    ] : layer.type === "line" ? [
      {property: "x1", label: "X1", max: MAX_COORDINATE},
      {property: "y1", label: "Y1", max: MAX_COORDINATE},
      {property: "x2", label: "X2", max: MAX_COORDINATE},
      {property: "y2", label: "Y2", max: MAX_COORDINATE}
    ] : layer.type === "text" ? [
      {property: "x", label: text("MPY_DISPLAY_DESIGNER_X", "X"), max: MAX_COORDINATE},
      {property: "y", label: text("MPY_DISPLAY_DESIGNER_Y", "Y"), max: MAX_COORDINATE}
    ] : [
      {property: "x", label: text("MPY_DISPLAY_DESIGNER_X", "X"), max: MAX_COORDINATE},
      {property: "y", label: text("MPY_DISPLAY_DESIGNER_Y", "Y"), max: MAX_COORDINATE},
      {property: "width", label: text("MPY_DISPLAY_DESIGNER_WIDTH", "Width"), max: WIDTH},
      {property: "height", label: text("MPY_DISPLAY_DESIGNER_HEIGHT", "Height"), max: HEIGHT}
    ];
    for (var i = 0; i < elements.coordinateInputs.length; i++) {
      var input = elements.coordinateInputs[i];
      input.parentElement.hidden = i >= definitions.length;
      if (i >= definitions.length) continue;
      input.dataset.property = definitions[i].property;
      input.min = definitions[i].property === "width" ||
          definitions[i].property === "height" ? 1 : MIN_COORDINATE;
      input.max = definitions[i].max;
      input.value = layer[definitions[i].property];
      elements.coordinateLabels[i].textContent = definitions[i].label;
    }
    elements.filledControl.hidden = layer.type !== "rect" && layer.type !== "ellipse";
    elements.filledInput.checked = layer.filled === true;
    elements.lineWidthControl.hidden = layer.type !== "line";
    elements.lineWidthInput.value = String(lineStrokeWidth(layer));
    elements.cornerRadiusControl.hidden = layer.type !== "rect";
    elements.cornerRadiusInput.max =
        String(Math.floor(Math.min(layer.width || 1, layer.height || 1) / 2));
    elements.cornerRadiusInput.value = String(
        layer.type === "rect" ? rectangleRadius(layer) : 0);
    elements.layerColorControl.hidden = drawing || activeTool !== "select";
    if (!drawing) updateColorButtons(elements.layerColorButtons, layerColor(layer));
    elements.bitmapTransparentControl.hidden = layer.type !== "bitmap" || drawing;
    elements.bitmapTransparentInput.checked = layer.transparent !== false;
    elements.textFields.hidden = layer.type !== "text";
    elements.dynamicTextControl.hidden = layer.type !== "text";
    for (var dynamicIndex = 0; dynamicIndex < elements.dynamicInputs.length;
        dynamicIndex++) {
      var dynamicProperty =
          elements.dynamicInputs[dynamicIndex].dataset.dynamicProperty;
      elements.dynamicInputs[dynamicIndex].parentElement.hidden =
          dynamicProperty === "text" ? layer.type !== "text" :
          drawing && dynamicProperty !== "visible";
      elements.dynamicInputs[dynamicIndex].checked =
          !!(layer.bindings && layer.bindings[dynamicProperty] === true);
    }
    if (layer.type === "text") {
      elements.textPropertyInput.value = layer.text;
      var fontAsset = findFontAsset(draftScene.fonts, layer.fontId);
      elements.currentFontName.textContent = fontAsset ? fontAsset.name : "—";
    }
  }

  function previewDelay(milliseconds) {
    return new Promise(function(resolve) {
      global.setTimeout(resolve, milliseconds);
    });
  }

  function updateLivePreviewUi(statusText, isError) {
    if (!elements) return;
    var label = livePreviewActive ?
        text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_STOP", "Stop live preview") :
        text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_START", "Live preview");
    if (livePreviewBusy) {
      label = text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_CONNECTING", "Connecting...");
    }
    elements.livePreviewLabel.textContent = label;
    elements.livePreviewButton.disabled = livePreviewBusy;
    elements.livePreviewButton.classList.toggle("is-active", livePreviewActive);
    elements.livePreviewButton.setAttribute(
        "aria-pressed", livePreviewActive ? "true" : "false");
    if (typeof statusText === "string") {
      elements.livePreviewStatus.textContent = statusText;
      elements.livePreviewStatus.classList.toggle("is-error", !!isError);
    } else if (!livePreviewActive && !livePreviewBusy) {
      elements.livePreviewStatus.textContent =
          text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_OFF", "Preview is off");
      elements.livePreviewStatus.classList.remove("is-error");
    }
  }

  function livePreviewErrorMessage(error) {
    var code = String(error && (error.code || error.message) || "UNKNOWN");
    if (code === "NOT_CONNECTED") {
      return text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_NOT_CONNECTED",
          "Connect a board before starting live preview.");
    }
    if (code === "NO_FRAMEBUFFER") {
      return text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_NO_FRAMEBUFFER",
          "Framebuffer was not found. Run the project once so the display blocks can initialize it.");
    }
    if (code === "NO_SHOW") {
      return text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_NO_SHOW",
          "The display object or its show() function was not found.");
    }
    if (code === "INVALID_FRAMEBUFFER") {
      return text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_INVALID_FRAMEBUFFER",
          "The framebuffer does not support byte access.");
    }
    if (code.indexOf("SIZE:") === 0) {
      var parts = code.split(":");
      return text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_SIZE",
          "Framebuffer size does not match this design.") +
          " (" + (parts[1] || "?") + " / " + (parts[2] || "?") + " B)";
    }
    if (code === "ERROR:SHOW") {
      return text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_SHOW_ERROR",
          "The display show() function failed.");
    }
    if (code === "ERROR:DATA" || code === "ERROR:RANGE") {
      return text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_DATA_ERROR",
          "The board rejected a preview data block.");
    }
    if (code === "TIMEOUT") {
      return text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_TIMEOUT",
          "The board did not respond in time.");
    }
    if (code === "UNSUPPORTED") {
      return text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_UNSUPPORTED",
          "The active connection does not support the required REPL commands.");
    }
    if (code === "SESSION_ENDED") {
      return text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_SESSION_ENDED",
          "The live preview connection ended.");
    }
    return text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_GENERIC_ERROR",
        "Live preview could not be started or updated.");
  }

  function reportLivePreviewError(error, showDialog) {
    var message = livePreviewErrorMessage(error);
    updateLivePreviewUi(message, true);
    if (showDialog && typeof global.show_modal_message === "function") {
      global.show_modal_message(
          text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_ERROR_TITLE",
              "Live preview error"),
          message);
    }
  }

  function captureLivePreviewFrame() {
    var protocol = global.ESPIDE_DISPLAY_LIVE_PREVIEW;
    return protocol.canvasToMonoVlsb(
        elements.canvas, draftScene.width, draftScene.height);
  }

  function scheduleLivePreviewUpdate(immediate) {
    if (!livePreviewActive || !draftScene || !elements) return;
    livePreviewPendingFrame = captureLivePreviewFrame();
    if (livePreviewTimer) global.clearTimeout(livePreviewTimer);
    var protocol = global.ESPIDE_DISPLAY_LIVE_PREVIEW;
    var profile = livePreviewProfile ||
        protocol.profileForLink("usb");
    livePreviewTimer = global.setTimeout(function() {
      livePreviewTimer = 0;
      flushLivePreview();
    }, immediate ? 0 : profile.debounceMs);
  }

  function stopLivePreviewSafetyRefresh() {
    if (!livePreviewRefreshInterval) return;
    global.clearInterval(livePreviewRefreshInterval);
    livePreviewRefreshInterval = 0;
  }

  /**
   * Reconcile editor state once per second in case a future editing path omits
   * its explicit preview event. The normal diff and single-flight sender are
   * still used: an unchanged scene sends no REPL command, and an active
   * transfer receives only one replaceable pending frame.
   */
  function startLivePreviewSafetyRefresh() {
    stopLivePreviewSafetyRefresh();
    livePreviewRefreshInterval = global.setInterval(function() {
      if (!livePreviewActive || !draftScene || !elements ||
          elements.overlay.hidden) return;
      renderScene();
      scheduleLivePreviewUpdate(false);
    }, 1000);
  }

  async function flushLivePreview() {
    if (!livePreviewActive || livePreviewSending || !livePreviewPendingFrame) return;
    var protocol = global.ESPIDE_DISPLAY_LIVE_PREVIEW;
    var bridge = global.ESPIDE_DISPLAY_PREVIEW_REPL;
    var profile = livePreviewProfile || protocol.profileForLink("usb");
    var generation = livePreviewGeneration;
    var frame = livePreviewPendingFrame;
    livePreviewPendingFrame = null;
    var chunks = protocol.changedChunks(
        frame, livePreviewLastFrame, profile.framebufferChunkSize);
    if (!chunks.length) return;

    livePreviewSending = true;
    updateLivePreviewUi(
        text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_SENDING", "Sending preview..."),
        false);
    try {
      for (var i = 0; i < chunks.length; i++) {
        if (!livePreviewActive || generation !== livePreviewGeneration) return;
        await bridge.send(protocol.writeCommand(chunks[i].offset, chunks[i].bytes));
        await previewDelay(profile.commandDelayMs);
      }
      await previewDelay(profile.showDelayMs);
      if (!livePreviewActive || generation !== livePreviewGeneration) return;
      await bridge.show();
      livePreviewLastFrame = frame.slice();
      updateLivePreviewUi(
          text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_ACTIVE", "Live preview active"),
          false);
    } catch (error) {
      if (generation === livePreviewGeneration) {
        reportLivePreviewError(error, true);
        await stopLivePreview(true);
      }
    } finally {
      livePreviewSending = false;
      if (livePreviewActive && livePreviewPendingFrame &&
          generation === livePreviewGeneration) {
        scheduleLivePreviewUpdate(true);
      }
    }
  }

  async function startLivePreview() {
    if (livePreviewBusy || livePreviewActive) return;
    var protocol = global.ESPIDE_DISPLAY_LIVE_PREVIEW;
    var bridge = global.ESPIDE_DISPLAY_PREVIEW_REPL;
    if (!protocol || !bridge) {
      reportLivePreviewError({code: "UNSUPPORTED"}, true);
      return;
    }
    if (!bridge.isConnected()) {
      reportLivePreviewError({code: "NOT_CONNECTED"}, true);
      return;
    }

    livePreviewBusy = true;
    updateLivePreviewUi(
        text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_CONNECTING", "Connecting..."),
        false);
    try {
      renderScene();
      var frame = captureLivePreviewFrame();
      var profile = protocol.profileForLink(bridge.activeLink());
      await bridge.start(
          protocol.buildPythonInitializerCommands(frame.length), profile);
      livePreviewGeneration++;
      livePreviewActive = true;
      livePreviewProfile = profile;
      livePreviewLastFrame = null;
      livePreviewPendingFrame = frame;
      startLivePreviewSafetyRefresh();
      updateLivePreviewUi(
          text("MPY_DISPLAY_DESIGNER_LIVE_PREVIEW_ACTIVE", "Live preview active"),
          false);
      scheduleLivePreviewUpdate(true);
    } catch (error) {
      livePreviewActive = false;
      reportLivePreviewError(error, true);
    } finally {
      livePreviewBusy = false;
      updateLivePreviewUi(elements.livePreviewStatus.textContent,
          elements.livePreviewStatus.classList.contains("is-error"));
    }
  }

  async function stopLivePreview(silent) {
    livePreviewGeneration++;
    livePreviewActive = false;
    livePreviewPendingFrame = null;
    livePreviewLastFrame = null;
    stopLivePreviewSafetyRefresh();
    if (livePreviewTimer) {
      global.clearTimeout(livePreviewTimer);
      livePreviewTimer = 0;
    }
    var bridge = global.ESPIDE_DISPLAY_PREVIEW_REPL;
    if (bridge && bridge.isActive()) {
      try {
        await bridge.stop();
      } catch (error) {
        if (!silent) reportLivePreviewError(error, true);
      }
    }
    livePreviewProfile = null;
    if (!silent) updateLivePreviewUi();
  }

  function toggleLivePreview() {
    if (livePreviewActive) stopLivePreview(false);
    else startLivePreview();
  }

  function onExternalLivePreviewStop() {
    if (!livePreviewActive && !livePreviewBusy) return;
    livePreviewGeneration++;
    livePreviewActive = false;
    livePreviewBusy = false;
    livePreviewPendingFrame = null;
    livePreviewLastFrame = null;
    livePreviewProfile = null;
    stopLivePreviewSafetyRefresh();
    updateLivePreviewUi();
  }

  function renderEditor() {
    renderScene();
    renderSelection();
    renderProperties();
    renderLayerList();
    elements.empty.hidden = draftScene.layers.length > 0;
    scheduleLivePreviewUpdate(false);
  }

  function setActiveTool(tool) {
    activeTool = tool === "rect" || tool === "line" || tool === "ellipse" ||
        tool === "brush" || tool === "eraser" ? tool : "select";
    elements.screen.dataset.tool = activeTool;
    elements.screen.dataset.cursor = "";
    var drawingActive = activeTool === "brush" || activeTool === "eraser";
    if (!drawingActive) brushCursorPoint = null;
    elements.drawingControls.hidden = !drawingActive;
    for (var i = 0; i < elements.toolButtons.length; i++) {
      var buttonTool = elements.toolButtons[i].dataset.tool;
      var active = buttonTool === (drawingActive ? "drawing" : activeTool);
      elements.toolButtons[i].classList.toggle("is-active", active);
      elements.toolButtons[i].setAttribute("aria-pressed", active ? "true" : "false");
    }
    for (var modeIndex = 0; modeIndex < elements.drawingModeButtons.length;
        modeIndex++) {
      var modeActive =
          elements.drawingModeButtons[modeIndex].dataset.drawingMode === activeTool;
      elements.drawingModeButtons[modeIndex].classList.toggle("is-active", modeActive);
      elements.drawingModeButtons[modeIndex].setAttribute(
          "aria-pressed", modeActive ? "true" : "false");
    }
    updateColorButtons(elements.brushColorButtons, activeColor);
    if (draftScene && !elements.overlay.hidden) {
      renderSelection();
      renderProperties();
    }
  }

  function selectLayer(id, additive) {
    if (additive) toggleSelection(id);
    else setSelection(id ? [id] : []);
    renderSelection();
    renderProperties();
    renderLayerList();
  }

  function onToolClick(event) {
    var tool = event.currentTarget.dataset.tool;
    setActiveTool(tool === "drawing" ? "brush" : tool);
  }

  function onDrawingModeClick(event) {
    setActiveTool(event.currentTarget.dataset.drawingMode);
  }

  function onBrushSizeChange(event) {
    var value = integer(event.currentTarget.value, 1);
    brushSize = value === 2 || value === 3 || value === 5 ? value : 1;
    event.currentTarget.value = String(brushSize);
    renderSelection();
  }

  function updateColorButtons(buttons, color) {
    for (var i = 0; i < buttons.length; i++) {
      var stored = buttons[i].dataset.brushColor !== undefined ?
          buttons[i].dataset.brushColor : buttons[i].dataset.layerColor;
      var active = Number(stored) === color;
      buttons[i].classList.toggle("is-active", active);
      buttons[i].setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function onBrushColorClick(event) {
    activeColor = Number(event.currentTarget.dataset.brushColor) === 0 ? 0 : 1;
    updateColorButtons(elements.brushColorButtons, activeColor);
    renderSelection();
  }

  function onLayerColorClick(event) {
    var layer = getLayer(selectedLayerId);
    if (!layer || isDrawingLayer(layer)) return;
    layer.color = Number(event.currentTarget.dataset.layerColor) === 0 ? 0 : 1;
    /* Explicit colour supersedes the old text-only `inverted` property. */
    if (layer.type === "text") delete layer.inverted;
    updateColorButtons(elements.layerColorButtons, layer.color);
    renderEditor();
    recordHistory();
  }

  function onLayerClick(event) {
    setActiveTool("select");
    selectLayer(event.currentTarget.dataset.layerId,
        event.ctrlKey || event.metaKey || event.shiftKey);
  }

  function onLayerOrderClick(event) {
    reorderSelectedLayers(event.currentTarget.dataset.layerOrder);
  }

  function onArrangeClick(event) {
    arrangeSelectedLayers(event.currentTarget.dataset.arrange);
  }

  function onLayerVisibilityChange(event) {
    var layer = getLayer(event.currentTarget.dataset.layerId);
    if (!layer) return;
    layer.visible = event.currentTarget.checked;
    renderScene();
    renderSelection();
    renderLayerList();
    scheduleLivePreviewUpdate(false);
    recordHistory();
  }

  function onDynamicBindingChange(event) {
    var layer = getLayer(selectedLayerId);
    if (!layer) return;
    var property = event.currentTarget.dataset.dynamicProperty;
    layer.bindings = layer.bindings && typeof layer.bindings === "object" ?
        layer.bindings : {};
    if (event.currentTarget.checked) layer.bindings[property] = true;
    else delete layer.bindings[property];
    if (layer.type === "text" && property === "text") {
      layer.parameterId = event.currentTarget.checked ? layer.id + "-text" : null;
    }
    renderScene();
    renderSelection();
    renderLayerList();
    recordHistory();
  }

  function eventPoint(event, allowOutside) {
    var bounds = elements.canvas.getBoundingClientRect();
    var x = Math.floor((event.clientX - bounds.left) * WIDTH / bounds.width);
    var y = Math.floor((event.clientY - bounds.top) * HEIGHT / bounds.height);
    return {
      x: allowOutside ? clamp(x, MIN_COORDINATE, MAX_COORDINATE) :
          clamp(x, 0, WIDTH - 1),
      y: allowOutside ? clamp(y, MIN_COORDINATE, MAX_COORDINATE) :
          clamp(y, 0, HEIGHT - 1)
    };
  }

  function pointerInsideScreen(event) {
    var bounds = elements.canvas.getBoundingClientRect();
    return event.clientX >= bounds.left && event.clientX < bounds.right &&
        event.clientY >= bounds.top && event.clientY < bounds.bottom;
  }

  /**
   * Return a selected corner handle near the pointer. Tolerance is derived
   * from CSS size, giving touch users a larger target while keeping mouse
   * selection precise, even though the stored scene uses individual pixels.
   */
  function resizeHandleAt(point, pointerType) {
    if (selectedLayerIds.length !== 1) return null;
    var layer = getLayer(selectedLayerId);
    if (!layer || layer.visible === false || layer.type === "text" ||
        isDrawingLayer(layer) || activeTool !== "select") {
      return null;
    }
    var bounds = elements.canvas.getBoundingClientRect();
    var cssTolerance = pointerType === "touch" ? 14 : 7;
    var toleranceX = Math.max(1, Math.ceil(cssTolerance * WIDTH / bounds.width));
    var toleranceY = Math.max(1, Math.ceil(cssTolerance * HEIGHT / bounds.height));
    var corners = layer.type === "line" ? [
      {name: "end", x: layer.x2, y: layer.y2},
      {name: "start", x: layer.x1, y: layer.y1}
    ] : [
      /* South-east first makes a one-pixel rectangle grow in the natural
       * down/right direction when all four handles overlap. */
      {name: "se", x: layer.x + layer.width - 1, y: layer.y + layer.height - 1},
      {name: "sw", x: layer.x, y: layer.y + layer.height - 1},
      {name: "ne", x: layer.x + layer.width - 1, y: layer.y},
      {name: "nw", x: layer.x, y: layer.y}
    ];
    var best = null;
    var bestDistance = Infinity;
    for (var i = 0; i < corners.length; i++) {
      var dx = Math.abs(point.x - corners[i].x);
      var dy = Math.abs(point.y - corners[i].y);
      if (dx <= toleranceX && dy <= toleranceY) {
        var distance = dx / toleranceX + dy / toleranceY;
        if (distance < bestDistance) {
          best = corners[i].name;
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  function updatePointerCursor(point, pointerType) {
    var handle = resizeHandleAt(point, pointerType);
    if (handle === "nw" || handle === "se") {
      elements.screen.dataset.cursor = "nwse";
    } else if (handle === "ne" || handle === "sw") {
      elements.screen.dataset.cursor = "nesw";
    } else if (handle === "start" || handle === "end") {
      elements.screen.dataset.cursor = "line";
    } else {
      elements.screen.dataset.cursor = "";
    }
  }

  function hitTest(point) {
    var layers = compositedLayers();
    for (var i = layers.length - 1; i >= 0; i--) {
      var layer = layers[i];
      if (layer.visible === false) continue;
      if (layer.type === "line" &&
          distanceToLine(point, layer) <= Math.max(
              1.75, lineStrokeWidth(layer) / 2 + 0.75)) {
        return layer;
      }
      if (isDrawingLayer(layer)) {
        var drawingBounds = layerBounds(layer);
        if (point.x >= drawingBounds.left && point.x <= drawingBounds.right &&
            point.y >= drawingBounds.top && point.y <= drawingBounds.bottom) {
          return layer;
        }
        continue;
      }
      if ((layer.type === "rect" || layer.type === "ellipse" || layer.type === "text" ||
          layer.type === "bitmap") &&
          point.x >= layer.x && point.x < layer.x + layer.width &&
          point.y >= layer.y && point.y < layer.y + layer.height) {
        return layer;
      }
    }
    return null;
  }

  function distanceToLine(point, layer) {
    var dx = layer.x2 - layer.x1;
    var dy = layer.y2 - layer.y1;
    if (dx === 0 && dy === 0) {
      return Math.hypot(point.x - layer.x1, point.y - layer.y1);
    }
    var position = ((point.x - layer.x1) * dx + (point.y - layer.y1) * dy) /
        (dx * dx + dy * dy);
    position = clamp(position, 0, 1);
    return Math.hypot(point.x - (layer.x1 + position * dx),
        point.y - (layer.y1 + position * dy));
  }

  function layerBounds(layer) {
    if (layer.type === "line") {
      var strokeWidth = lineStrokeWidth(layer);
      var stampStart = -Math.floor(strokeWidth / 2);
      var stampEnd = stampStart + strokeWidth - 1;
      return {
        left: Math.min(layer.x1, layer.x2) + stampStart,
        top: Math.min(layer.y1, layer.y2) + stampStart,
        right: Math.max(layer.x1, layer.x2) + stampEnd,
        bottom: Math.max(layer.y1, layer.y2) + stampEnd
      };
    }
    if (isDrawingLayer(layer)) {
      var contentBounds = drawingLocalBounds(layer);
      if (contentBounds) {
        return {
          left: layer.x + contentBounds.left,
          top: layer.y + contentBounds.top,
          right: layer.x + contentBounds.right,
          bottom: layer.y + contentBounds.bottom
        };
      }
      /* An empty selected sketch still gets a small visible anchor. */
      return {
        left: layer.x,
        top: layer.y,
        right: layer.x,
        bottom: layer.y
      };
    }
    return {
      left: layer.x,
      top: layer.y,
      right: layer.x + layer.width - 1,
      bottom: layer.y + layer.height - 1
    };
  }

  function groupBounds(layers) {
    var result = {
      left: Infinity,
      top: Infinity,
      right: -Infinity,
      bottom: -Infinity
    };
    for (var i = 0; i < layers.length; i++) {
      var bounds = layerBounds(layers[i]);
      result.left = Math.min(result.left, bounds.left);
      result.top = Math.min(result.top, bounds.top);
      result.right = Math.max(result.right, bounds.right);
      result.bottom = Math.max(result.bottom, bounds.bottom);
    }
    return result;
  }

  function translateLayerBy(layer, offsetX, offsetY) {
    translateLayerFrom(layer, clone(layer), offsetX, offsetY);
  }

  function alignSelectedLayers(layers, action) {
    var bounds = groupBounds(layers);
    var centerX = (bounds.left + bounds.right) / 2;
    var centerY = (bounds.top + bounds.bottom) / 2;
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      var layerBox = layerBounds(layer);
      var offsetX = 0;
      var offsetY = 0;
      if (action === "left") offsetX = bounds.left - layerBox.left;
      else if (action === "center-x") {
        offsetX = Math.round(centerX - (layerBox.left + layerBox.right) / 2);
      } else if (action === "right") {
        offsetX = bounds.right - layerBox.right;
      } else if (action === "top") {
        offsetY = bounds.top - layerBox.top;
      } else if (action === "center-y") {
        offsetY = Math.round(centerY - (layerBox.top + layerBox.bottom) / 2);
      } else if (action === "bottom") {
        offsetY = bounds.bottom - layerBox.bottom;
      }
      translateLayerBy(layer, offsetX, offsetY);
    }
  }

  /**
   * Distribute equal free space between object bounds. First and last objects
   * stay fixed, which makes repeated use predictable even for mixed sizes.
   */
  function distributeSelectedLayers(layers, vertical) {
    var startProperty = vertical ? "top" : "left";
    var endProperty = vertical ? "bottom" : "right";
    var ordered = layers.slice().sort(function(left, right) {
      var leftBounds = layerBounds(left);
      var rightBounds = layerBounds(right);
      return leftBounds[startProperty] - rightBounds[startProperty] ||
          leftBounds[endProperty] - rightBounds[endProperty];
    });
    var firstBounds = layerBounds(ordered[0]);
    var lastBounds = layerBounds(ordered[ordered.length - 1]);
    var span = lastBounds[endProperty] - firstBounds[startProperty] + 1;
    var occupied = 0;
    for (var i = 0; i < ordered.length; i++) {
      var itemBounds = layerBounds(ordered[i]);
      occupied += itemBounds[endProperty] - itemBounds[startProperty] + 1;
    }
    var gap = (span - occupied) / (ordered.length - 1);
    var cursor = firstBounds[startProperty];
    for (var index = 0; index < ordered.length; index++) {
      var layer = ordered[index];
      var bounds = layerBounds(layer);
      var size = bounds[endProperty] - bounds[startProperty] + 1;
      if (index > 0 && index < ordered.length - 1) {
        var offset = Math.round(cursor) - bounds[startProperty];
        translateLayerBy(layer, vertical ? 0 : offset, vertical ? offset : 0);
      }
      cursor += size + gap;
    }
  }

  function arrangeSelectedLayers(action) {
    var selected = getSelectedLayers();
    if (selected.length < 2) return;
    if (action === "distribute-x" || action === "distribute-y") {
      if (selected.length < 3) return;
      distributeSelectedLayers(selected, action === "distribute-y");
    } else {
      alignSelectedLayers(selected, action);
    }
    renderEditor();
    recordHistory();
  }

  function translateLayerFrom(layer, original, offsetX, offsetY) {
    if (layer.type === "line") {
      layer.x1 = clamp(original.x1 + offsetX, MIN_COORDINATE, MAX_COORDINATE);
      layer.y1 = clamp(original.y1 + offsetY, MIN_COORDINATE, MAX_COORDINATE);
      layer.x2 = clamp(original.x2 + offsetX, MIN_COORDINATE, MAX_COORDINATE);
      layer.y2 = clamp(original.y2 + offsetY, MIN_COORDINATE, MAX_COORDINATE);
    } else {
      layer.x = clamp(original.x + offsetX, MIN_COORDINATE, MAX_COORDINATE);
      layer.y = clamp(original.y + offsetY, MIN_COORDINATE, MAX_COORDINATE);
    }
  }

  function createSelectionMove(point) {
    var selected = getSelectedLayers();
    return {
      type: "move-selection",
      startX: point.x,
      startY: point.y,
      bounds: groupBounds(selected),
      originals: selected.map(function(layer) {
        return {id: layer.id, data: clone(layer)};
      })
    };
  }

  function applySelectionMove(action, requestedX, requestedY) {
    for (var i = 0; i < action.originals.length; i++) {
      var layer = getLayer(action.originals[i].id);
      if (layer) {
        translateLayerFrom(
            layer, action.originals[i].data, requestedX, requestedY);
      }
    }
  }

  function nudgeSelection(offsetX, offsetY) {
    var selected = getSelectedLayers();
    if (!selected.length) return;
    var action = {
      bounds: groupBounds(selected),
      originals: selected.map(function(layer) {
        return {id: layer.id, data: clone(layer)};
      })
    };
    applySelectionMove(action, offsetX, offsetY);
    renderScene();
    renderSelection();
    renderProperties();
    /* Key-repeat may call this many times per second. Reuse the live-preview
     * debounce so held arrows update the board without flooding its REPL. */
    scheduleLivePreviewUpdate(false);
    recordHistory();
  }

  function createDrawingLayer() {
    var whiteBytes = new Uint8Array(
        global.ESPIDE_BITMAP.byteLength(WIDTH, HEIGHT));
    var blackBytes = new Uint8Array(whiteBytes.length);
    var layer = {
      id: nextLayerId("drawing"),
      type: "bitmap",
      kind: "drawing",
      label: "",
      x: 0,
      y: 0,
      width: WIDTH,
      height: HEIGHT,
      name: "Drawing",
      format: global.ESPIDE_BITMAP.FORMAT,
      data: bytesToBase64(whiteBytes),
      blackData: bytesToBase64(blackBytes),
      transparent: true,
      bindings: {},
      visible: true
    };
    draftScene.layers.push(layer);
    storeDrawingBytes(layer, whiteBytes, blackBytes);
    return layer;
  }

  function drawingLayerForPaint(createIfMissing) {
    var selected = getLayer(selectedLayerId);
    if (selectedLayerIds.length === 1 && isDrawingLayer(selected)) return selected;
    if (!createIfMissing) {
      var layers = compositedLayers();
      for (var i = layers.length - 1; i >= 0; i--) {
        if (isDrawingLayer(layers[i])) return layers[i];
      }
      return null;
    }
    return createDrawingLayer();
  }

  /** Apply one square brush stamp and report whether any stored bit changed. */
  function paintStamp(action, centerX, centerY) {
    var bounds = brushFootprint(centerX, centerY);
    var changed = false;
    for (var y = bounds.top; y < bounds.bottom; y++) {
      for (var x = bounds.left; x < bounds.right; x++) {
        var localX = x - action.offsetX;
        var localY = y - action.offsetY;
        if (localX < 0 || localY < 0 ||
            localX >= action.width || localY >= action.height) continue;
        var previousWhite = global.ESPIDE_BITMAP.getPixel(
            action.whiteBytes, action.width, localX, localY);
        var previousBlack = global.ESPIDE_BITMAP.getPixel(
            action.blackBytes, action.width, localX, localY);
        var nextWhite = action.color === 1 ? 1 : 0;
        var nextBlack = action.color === 0 ? 1 : 0;
        if (previousWhite === nextWhite && previousBlack === nextBlack) continue;
        global.ESPIDE_BITMAP.setPixel(
            action.whiteBytes, action.width, localX, localY, nextWhite);
        global.ESPIDE_BITMAP.setPixel(
            action.blackBytes, action.width, localX, localY, nextBlack);
        changed = true;
      }
    }
    return changed;
  }

  /** Bresenham interpolation prevents gaps when pointer events arrive slowly. */
  function paintSegment(action, targetX, targetY) {
    var x = action.lastX;
    var y = action.lastY;
    var dx = Math.abs(targetX - x);
    var sx = x < targetX ? 1 : -1;
    var dy = -Math.abs(targetY - y);
    var sy = y < targetY ? 1 : -1;
    var error = dx + dy;
    while (true) {
      if (paintStamp(action, x, y)) action.changed = true;
      if (x === targetX && y === targetY) break;
      var doubled = 2 * error;
      if (doubled >= dy) {
        error += dy;
        x += sx;
      }
      if (doubled <= dx) {
        error += dx;
        y += sy;
      }
    }
    action.lastX = targetX;
    action.lastY = targetY;
    if (action.changed) {
      storeDrawingBytes(
          getLayer(action.layerId), action.whiteBytes, action.blackBytes);
    }
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    var point = eventPoint(event);
    var layer;
    var resizeHandle;
    event.preventDefault();
    elements.screen.setPointerCapture(event.pointerId);

    if (activeTool === "brush" || activeTool === "eraser") {
      brushCursorPoint = point;
      layer = drawingLayerForPaint(activeTool === "brush");
      if (!layer) {
        elements.screen.releasePointerCapture(event.pointerId);
        return;
      }
      layer.visible = true;
      setSelection([layer.id]);
      pointerAction = {
        type: "paint",
        layerId: layer.id,
        whiteBytes: decodedBitmap(layer),
        blackBytes: decodedDrawingBlackBitmap(layer),
        width: layer.width,
        height: layer.height,
        offsetX: layer.x,
        offsetY: layer.y,
        lastX: point.x,
        lastY: point.y,
        color: activeTool === "eraser" ? null : activeColor,
        changed: false
      };
      paintSegment(pointerAction, point.x, point.y);
      renderEditor();
      return;
    }

    if (activeTool === "rect" || activeTool === "ellipse") {
      layer = {
        id: nextLayerId(activeTool),
        type: activeTool,
        x: point.x,
        y: point.y,
        width: 1,
        height: 1,
        filled: false,
        color: 1
      };
      if (activeTool === "rect") layer.radius = 0;
      draftScene.layers.push(layer);
      setSelection([layer.id]);
      pointerAction = {type: "draw", layerId: layer.id, startX: point.x, startY: point.y};
      renderEditor();
      return;
    }

    if (activeTool === "line") {
      layer = {
        id: nextLayerId("line"),
        type: "line",
        x1: point.x,
        y1: point.y,
        x2: point.x,
        y2: point.y,
        strokeWidth: 1,
        color: 1
      };
      draftScene.layers.push(layer);
      setSelection([layer.id]);
      pointerAction = {type: "draw-line", layerId: layer.id};
      renderEditor();
      return;
    }

    resizeHandle = resizeHandleAt(point, event.pointerType);
    if (resizeHandle) {
      layer = getLayer(selectedLayerId);
      pointerAction = layer.type === "line" ? {
        type: "resize-line",
        layerId: layer.id,
        handle: resizeHandle
      } : {
        type: "resize",
        layerId: layer.id,
        handle: resizeHandle,
        left: layer.x,
        top: layer.y,
        right: layer.x + layer.width - 1,
        bottom: layer.y + layer.height - 1,
        bitmapSource: layer.type === "bitmap" ? clone(layer) : null
      };
      return;
    }

    layer = hitTest(point);
    var additive = event.ctrlKey || event.metaKey || event.shiftKey;
    if (additive) {
      if (layer) toggleSelection(layer.id);
      pointerAction = null;
    } else if (!layer) {
      setSelection([]);
      pointerAction = null;
    } else {
      if (!isLayerSelected(layer.id)) setSelection([layer.id]);
      pointerAction = createSelectionMove(point);
    }
    renderEditor();
  }

  function onPointerMove(event) {
    var allowOutside = pointerAction && (
      pointerAction.type === "move-selection" ||
      pointerAction.type === "resize" ||
      pointerAction.type === "resize-line"
    );
    var point = eventPoint(event, allowOutside);
    if (activeTool === "brush" || activeTool === "eraser") {
      brushCursorPoint = pointerInsideScreen(event) ? point : null;
    }
    if (!pointerAction) {
      updatePointerCursor(point, event.pointerType);
      if (activeTool === "brush" || activeTool === "eraser") renderSelection();
      return;
    }
    var layer = pointerAction.layerId ? getLayer(pointerAction.layerId) : null;
    if (pointerAction.type !== "move-selection" && !layer) return;
    event.preventDefault();

    if (pointerAction.type === "draw") {
      layer.x = Math.min(pointerAction.startX, point.x);
      layer.y = Math.min(pointerAction.startY, point.y);
      layer.width = Math.abs(point.x - pointerAction.startX) + 1;
      layer.height = Math.abs(point.y - pointerAction.startY) + 1;
    } else if (pointerAction.type === "draw-line") {
      layer.x2 = point.x;
      layer.y2 = point.y;
    } else if (pointerAction.type === "paint") {
      paintSegment(pointerAction, point.x, point.y);
    } else if (pointerAction.type === "move-selection") {
      applySelectionMove(pointerAction, point.x - pointerAction.startX,
          point.y - pointerAction.startY);
    } else if (pointerAction.type === "resize") {
      var left = pointerAction.left;
      var top = pointerAction.top;
      var right = pointerAction.right;
      var bottom = pointerAction.bottom;
      if (pointerAction.handle.indexOf("w") !== -1) {
        left = clamp(point.x, right - WIDTH + 1, right);
      }
      if (pointerAction.handle.indexOf("e") !== -1) {
        right = clamp(point.x, left, left + WIDTH - 1);
      }
      if (pointerAction.handle.indexOf("n") !== -1) {
        top = clamp(point.y, bottom - HEIGHT + 1, bottom);
      }
      if (pointerAction.handle.indexOf("s") !== -1) {
        bottom = clamp(point.y, top, top + HEIGHT - 1);
      }
      layer.x = left;
      layer.y = top;
      if (layer.type === "bitmap") {
        resizeBitmapLayer(layer, right - left + 1, bottom - top + 1,
            pointerAction.bitmapSource);
      } else {
        layer.width = right - left + 1;
        layer.height = bottom - top + 1;
        if (layer.type === "rect") layer.radius = rectangleRadius(layer);
      }
    } else if (pointerAction.type === "resize-line") {
      if (pointerAction.handle === "start") {
        layer.x1 = point.x;
        layer.y1 = point.y;
      } else {
        layer.x2 = point.x;
        layer.y2 = point.y;
      }
    }
    /* The layer list does not change while dragging, so avoid rebuilding DOM
     * on every pointer event. This keeps touch interaction smooth on tablets. */
    renderScene();
    renderSelection();
    renderProperties();
  }

  function onPointerUp(event) {
    if (!pointerAction) return;
    var wasDrawing = pointerAction.type === "draw" || pointerAction.type === "draw-line";
    var changed = pointerAction.type !== "paint" || pointerAction.changed;
    brushCursorPoint = event.type === "pointercancel" || !pointerInsideScreen(event) ?
        null : eventPoint(event);
    pointerAction = null;
    if (elements.screen.hasPointerCapture(event.pointerId)) {
      elements.screen.releasePointerCapture(event.pointerId);
    }
    if (wasDrawing) setActiveTool("select");
    renderEditor();
    if (changed) recordHistory();
    updatePointerCursor(eventPoint(event), event.pointerType);
  }

  function onPointerLeave() {
    brushCursorPoint = null;
    if (!pointerAction) elements.screen.dataset.cursor = "";
    if (activeTool === "brush" || activeTool === "eraser") renderSelection();
  }

  function onPropertyChange() {
    var layer = getLayer(selectedLayerId);
    var property = this.dataset.property;
    if (!layer) return;
    if (property === "filled") {
      layer.filled = this.checked;
    } else if (property === "label") {
      layer.label = String(this.value || "").replace(/[\r\n]+/g, " ")
          .trim().substring(0, 40);
      this.value = layer.label;
    } else if (property === "transparent" && layer.type === "bitmap") {
      layer.transparent = this.checked;
    } else if (property === "strokeWidth" && layer.type === "line") {
      layer.strokeWidth = lineStrokeWidth(this.value);
      this.value = String(layer.strokeWidth);
    } else if (property === "radius" && layer.type === "rect") {
      layer.radius = rectangleRadius(this.value, layer.width, layer.height);
      this.value = String(layer.radius);
    } else if (property === "x") {
      layer.x = clamp(integer(this.value, layer.x), MIN_COORDINATE, MAX_COORDINATE);
    } else if (property === "y") {
      layer.y = clamp(integer(this.value, layer.y), MIN_COORDINATE, MAX_COORDINATE);
    } else if (property === "width") {
      var width = clamp(integer(this.value, layer.width), 1, WIDTH);
      if (layer.type === "bitmap") resizeBitmapLayer(layer, width, layer.height);
      else {
        layer.width = width;
        if (layer.type === "rect") layer.radius = rectangleRadius(layer);
      }
    } else if (property === "height") {
      var height = clamp(integer(this.value, layer.height), 1, HEIGHT);
      if (layer.type === "bitmap") resizeBitmapLayer(layer, layer.width, height);
      else {
        layer.height = height;
        if (layer.type === "rect") layer.radius = rectangleRadius(layer);
      }
    } else if (property === "text" && layer.type === "text") {
      layer.text = String(this.value || "Text").replace(/[\r\n]+/g, " ").substring(0, 80) || "Text";
      updateTextLayerMetrics(layer);
      /* Avoid rerendering the input itself: the caret must stay exactly where
       * the user is typing. Only visuals and dependent coordinate bounds need
       * a live refresh. */
      elements.coordinateInputs[0].value = layer.x;
      elements.coordinateInputs[0].max = MAX_COORDINATE;
      elements.coordinateInputs[1].value = layer.y;
      elements.coordinateInputs[1].max = MAX_COORDINATE;
      renderScene();
      renderSelection();
      renderLayerList();
      scheduleLivePreviewUpdate(false);
      return;
    } else if (property === "x1" || property === "x2") {
      layer[property] = clamp(integer(this.value, layer[property]),
          MIN_COORDINATE, MAX_COORDINATE);
    } else if (property === "y1" || property === "y2") {
      layer[property] = clamp(integer(this.value, layer[property]),
          MIN_COORDINATE, MAX_COORDINATE);
    }
    renderEditor();
    recordHistory();
  }

  function createLayerCopy(source, offsetX, offsetY) {
    var copy = clone(source);
    copy.id = nextLayerId(isDrawingLayer(copy) ? "drawing" : copy.type);
    translateLayerFrom(copy, source, offsetX, offsetY);
    return copy;
  }

  function insertLayerCopies(sources) {
    if (!draftScene || !Array.isArray(sources)) return [];
    var validSources = sources.filter(function(source) {
      return source && (source.type === "rect" || source.type === "line" ||
          source.type === "ellipse" || source.type === "text" || source.type === "bitmap");
    });
    if (!validSources.length) return [];
    var bounds = groupBounds(validSources);
    var groupWidth = bounds.right - bounds.left + 1;
    var groupHeight = bounds.bottom - bounds.top + 1;
    var targetLeft = (bounds.left + 3) % Math.max(1, WIDTH - groupWidth + 1);
    var targetTop = (bounds.top + 3) % Math.max(1, HEIGHT - groupHeight + 1);
    var offsetX = targetLeft - bounds.left;
    var offsetY = targetTop - bounds.top;
    var copies = [];
    for (var i = 0; i < validSources.length; i++) {
      var copy = createLayerCopy(validSources[i], offsetX, offsetY);
      draftScene.layers.push(copy);
      copies.push(copy);
    }
    setSelection(copies.map(function(layer) { return layer.id; }));
    setActiveTool("select");
    renderEditor();
    recordHistory();
    return copies;
  }

  function duplicateSelectedLayers() {
    insertLayerCopies(getSelectedLayers());
  }

  function copySelectedLayers() {
    var selected = getSelectedLayers();
    if (!selected.length) return false;
    objectClipboard = clone(selected);
    return true;
  }

  function pasteLayers() {
    if (!objectClipboard || !objectClipboard.length) return false;
    var pasted = insertLayerCopies(objectClipboard);
    if (!pasted.length) return false;
    /* Repeated Ctrl+V presses cascade copies instead of stacking them at the
     * same coordinates. */
    objectClipboard = clone(pasted);
    return true;
  }

  function deleteSelectedLayers() {
    if (!draftScene || !selectedLayerIds.length) return;
    draftScene.layers = draftScene.layers.filter(function(layer) {
      return !isLayerSelected(layer.id);
    });
    setSelection([]);
    renderEditor();
    recordHistory();
  }

  function onLayerDeleteClick(event) {
    event.preventDefault();
    event.stopPropagation();
    var id = this.dataset.layerId;
    if (!getLayer(id)) return;
    var message = text("MPY_DISPLAY_DESIGNER_DELETE_LAYER_CONFIRM",
        "Do you really want to delete this layer?");
    if (typeof global.confirm === "function" && !global.confirm(message)) return;
    draftScene.layers = draftScene.layers.filter(function(layer) {
      return layer.id !== id;
    });
    setSelection(selectedLayerIds.filter(function(selectedId) {
      return selectedId !== id;
    }));
    renderEditor();
    recordHistory();
  }

  function onKeyDown(event) {
    if (!elements || elements.overlay.hidden) return;
    if (!elements.unsavedOverlay.hidden) {
      if (event.key === "Escape") hideUnsavedDialog();
      stopKeyboardEvent(event);
      return;
    }
    if (event.key === "Escape") {
      stopKeyboardEvent(event);
      if (!elements.resolutionPopover.hidden) {
        setResolutionPopover(false);
        elements.resolutionToggleButton.focus();
        return;
      }
      if (!elements.fontPicker.hidden) {
        closeFontPicker();
        return;
      }
      requestClose();
      return;
    }
    var tag = event.target && event.target.tagName;
    var editingText = tag === "INPUT" || tag === "TEXTAREA" ||
        event.target && event.target.isContentEditable;
    var modifier = event.ctrlKey || event.metaKey;
    var key = String(event.key || "").toLowerCase();
    if (modifier && !editingText && !event.shiftKey && key === "z") {
      undoHistory();
      stopKeyboardEvent(event);
      return;
    }
    if (modifier && !editingText &&
        (key === "y" || event.shiftKey && key === "z")) {
      redoHistory();
      stopKeyboardEvent(event);
      return;
    }
    if (!editingText && key.indexOf("arrow") === 0) {
      var step = event.shiftKey ? 5 : 1;
      if (key === "arrowleft") nudgeSelection(-step, 0);
      else if (key === "arrowright") nudgeSelection(step, 0);
      else if (key === "arrowup") nudgeSelection(0, -step);
      else if (key === "arrowdown") nudgeSelection(0, step);
      stopKeyboardEvent(event);
      return;
    }
    if (modifier && !editingText && key === "c") {
      copySelectedLayers();
      stopKeyboardEvent(event);
      return;
    }
    if (modifier && !editingText && key === "v") {
      pasteLayers();
      stopKeyboardEvent(event);
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") &&
        !editingText) {
      stopKeyboardEvent(event);
      deleteSelectedLayers();
    }
  }

  function stopKeyboardEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  function currentSceneSnapshot() {
    if (!draftScene) return "";
    var snapshot = clone(draftScene);
    if (elements) snapshot.name = elements.nameInput.value;
    return JSON.stringify(snapshot);
  }

  function hasUnsavedChanges() {
    return !!draftScene && currentSceneSnapshot() !== initialSceneSnapshot;
  }

  function showUnsavedDialog() {
    if (!elements || !elements.unsavedOverlay.hidden) return;
    focusBeforeDiscardDialog = document.activeElement;
    elements.unsavedOverlay.hidden = false;
    elements.continueEditingButton.focus();
  }

  function hideUnsavedDialog() {
    if (!elements || elements.unsavedOverlay.hidden) return;
    elements.unsavedOverlay.hidden = true;
    if (focusBeforeDiscardDialog &&
        typeof focusBeforeDiscardDialog.focus === "function") {
      focusBeforeDiscardDialog.focus();
    }
    focusBeforeDiscardDialog = null;
  }

  function requestClose() {
    if (!elements || elements.overlay.hidden) return;
    if (hasUnsavedChanges()) {
      showUnsavedDialog();
      return;
    }
    close();
  }

  function discardChangesAndClose() {
    if (!elements) return;
    elements.unsavedOverlay.hidden = true;
    focusBeforeDiscardDialog = null;
    close();
  }

  function open(block, options) {
    if (!block || typeof block.getDisplayDesignerScene !== "function") {
      throw new Error("Display Designer requires an espide_display_designer block.");
    }
    options = options || {};
    buildDom();
    var storedScene = block.getDisplayDesignerScene();
    var storedDimensions = requestedDimensions(storedScene);
    var targetApi = global.ESPIDE_DISPLAY_TARGETS;
    currentTarget = options.target || (targetApi &&
        typeof targetApi.getActive === "function" ?
        targetApi.getActive(block.workspace) : null) || {
          profileId: "espide-mono-128x64",
          width: DEFAULT_WIDTH,
          height: DEFAULT_HEIGHT,
          mode: "mono",
          label: DEFAULT_WIDTH + "×" + DEFAULT_HEIGHT,
          source: "default"
        };
    var adaptive = storedScene && storedScene.extensions &&
        storedScene.extensions[ADAPTIVE_EXTENSION];
    var isUntouchedDefault = (!storedScene.layers || !storedScene.layers.length) &&
        storedDimensions.width === DEFAULT_WIDTH &&
        storedDimensions.height === DEFAULT_HEIGHT &&
        (!adaptive || adaptive.source !== "manual");
    var openWidth = isUntouchedDefault ? currentTarget.width : storedDimensions.width;
    var openHeight = isUntouchedDefault ? currentTarget.height : storedDimensions.height;
    setEditorDimensions(openWidth, openHeight);
    applyTranslations();
    /* Blockly keeps the clicked editor block selected and its document-level
     * Delete shortcut remains active. Deselect it before the modal takes
     * focus, in addition to the capture-phase keyboard isolation above. */
    if (global.Blockly && global.Blockly.selected &&
        typeof global.Blockly.selected.unselect === "function") {
      global.Blockly.selected.unselect();
    }
    currentBlock = block;
    activeColor = 1;
    draftScene = normalizeScene(storedScene, {
      width: openWidth,
      height: openHeight,
      activate: true
    });
    if (isUntouchedDefault) {
      draftScene.target = {
        profileId: currentTarget.profileId,
        label: currentTarget.label,
        source: currentTarget.source
      };
      updateAdaptiveExtension(draftScene);
    }
    selectedLayerId = null;
    selectedLayerIds = [];
    pointerAction = null;
    selectedFontChoice = null;
    fontPickerLayerId = null;
    closeBitmapImporter();
    setResolutionPopover(false);
    elements.fontPicker.hidden = true;
    elements.fontButton.classList.remove("is-active");
    elements.fontButton.setAttribute("aria-expanded", "false");
    elements.nameInput.value = draftScene.name;
    elements.unsavedOverlay.hidden = true;
    focusBeforeDiscardDialog = null;
    livePreviewActive = false;
    livePreviewBusy = false;
    livePreviewPendingFrame = null;
    livePreviewLastFrame = null;
    livePreviewProfile = null;
    stopLivePreviewSafetyRefresh();
    updateLivePreviewUi();
    setActiveTool("select");
    renderEditor();
    resetHistory();
    initialSceneSnapshot = currentSceneSnapshot();
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    elements.overlay.hidden = false;
    if (typeof elements.overlay.focus === "function") {
      try {
        elements.overlay.focus({preventScroll: true});
      } catch (error) {
        elements.overlay.focus();
      }
    }
    scheduleGridRender();
  }

  function close() {
    if (!elements || elements.overlay.hidden) return;
    stopLivePreview(true);
    closeBitmapImporter();
    setResolutionPopover(false);
    elements.unsavedOverlay.hidden = true;
    elements.overlay.hidden = true;
    document.body.style.overflow = previousBodyOverflow;
    currentBlock = null;
    currentTarget = null;
    draftScene = null;
    selectedLayerId = null;
    selectedLayerIds = [];
    pointerAction = null;
    selectedFontChoice = null;
    fontPickerLayerId = null;
    historyEntries = [];
    historyIndex = -1;
    initialSceneSnapshot = "";
    focusBeforeDiscardDialog = null;
    updateHistoryButtons();
  }

  function discardUnusedBuiltinFonts() {
    var used = Object.create(null);
    for (var i = 0; i < draftScene.layers.length; i++) {
      if (draftScene.layers[i].type === "text") used[draftScene.layers[i].fontId] = true;
    }
    draftScene.fonts = draftScene.fonts.filter(function(asset) {
      return asset.source !== "builtin" || used[asset.id];
    });
  }

  function save() {
    if (!currentBlock || !draftScene) return;
    draftScene.name = elements.nameInput.value;
    discardUnusedBuiltinFonts();
    draftScene = normalizeScene(draftScene);

    if (global.Blockly && global.Blockly.Events) {
      global.Blockly.Events.setGroup(true);
    }
    try {
      currentBlock.setDisplayDesignerScene(draftScene, true);
    } finally {
      if (global.Blockly && global.Blockly.Events) {
        global.Blockly.Events.setGroup(false);
      }
    }
    close();
  }

  /**
   * Return designer blocks in a stable order shared by Python generation and
   * /gfx/scene.dat creation. Blockly block IDs survive project save/load.
   */
  function collectWorkspaceScenes(workspace) {
    if (!workspace || typeof workspace.getAllBlocks !== "function") return [];
    return workspace.getAllBlocks(false)
        .filter(function(block) {
          return block && block.type === "espide_display_designer" &&
              typeof block.getDisplayDesignerScene === "function";
        })
        .sort(function(a, b) {
          var left = String(a.id || "");
          var right = String(b.id || "");
          return left < right ? -1 : left > right ? 1 : 0;
        })
        .map(function(block) {
          return {block: block, scene: block.getDisplayDesignerScene()};
        });
  }

  function workspaceUsesSceneFile(workspace) {
    var entries = collectWorkspaceScenes(workspace);
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].block.getFieldValue("STORE_SCENE_FILE") === "TRUE") return true;
    }
    return false;
  }

  /**
   * Build binary files needed immediately before run_code(). This function is
   * synchronous because all editable scene and MFNT data live in Blockly XML.
   */
  function buildRunAssets(workspace) {
    var entries = collectWorkspaceScenes(workspace);
    if (!entries.length) {
      return {enabled: false, files: [], entries: entries};
    }
    var compiler = global.ESPIDE_DISPLAY_COMPILER;
    if (!compiler || typeof compiler.buildScenePack !== "function") {
      throw new Error("Display scene compiler is unavailable");
    }
    var scenes = entries.map(function(entry) { return entry.scene; });
    var sceneFileEnabled = workspaceUsesSceneFile(workspace);
    var pack = sceneFileEnabled ? compiler.buildScenePack(scenes) : null;
    var files = [];
    /* A project containing only dynamic/empty scenes needs no scene.dat. */
    if (pack && pack.sceneCount > 0) {
      files.push({
        path: "/gfx/scene.dat",
        bytes: pack.bytes,
        fingerprint: "scene-" + pack.buildId.toString(16).padStart(8, "0") +
            "-" + pack.sceneCount
      });
    }
    var fonts = compiler.collectRuntimeFonts(scenes);
    for (var i = 0; i < fonts.length; i++) files.push(fonts[i]);
    return {
      enabled: files.length > 0,
      files: files,
      entries: entries,
      pack: pack,
      runtimeFonts: fonts,
      sceneFileEnabled: sceneFileEnabled
    };
  }

  global["ESPIDE_DISPLAY_DESIGNER"] = {
    DEFAULT_WIDTH: DEFAULT_WIDTH,
    DEFAULT_HEIGHT: DEFAULT_HEIGHT,
    ADAPTIVE_EXTENSION: ADAPTIVE_EXTENSION,
    createEmptyScene: createEmptyScene,
    normalizeScene: normalizeScene,
    calculatePreviewScale: calculatePreviewScale,
    gridModeForScale: gridModeForScale,
    calculateGridBackingSize: calculateGridBackingSize,
    getDimensions: function() { return {width: WIDTH, height: HEIGHT}; },
    setResolution: changeResolution,
    collectWorkspaceScenes: collectWorkspaceScenes,
    workspaceUsesSceneFile: workspaceUsesSceneFile,
    buildRunAssets: buildRunAssets,
    open: open,
    close: close
  };
})(window);
