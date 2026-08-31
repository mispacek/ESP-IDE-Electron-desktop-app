/**
 * ESP IDE Display Designer scene compiler.
 *
 * This module turns visible, non-parameterized layers into an exact MONO_VLSB
 * framebuffer using the dimensions stored in the scene. It deliberately
 * has no DOM or Blockly dependency, so the generated pixels and Python plan
 * can be regression-tested in Node.
 */
(function(root, factory) {
  "use strict";
  var bitmap = root && root.ESPIDE_BITMAP;
  var mfnt = root && root.ESPIDE_MFNT;
  if (typeof module === "object" && module.exports) {
    bitmap = require("./bitmap_codec.js");
    mfnt = require("./mfnt_codec.js");
  }
  var api = factory(bitmap, mfnt);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ESPIDE_DISPLAY_COMPILER = api;
})(typeof window !== "undefined" ? window : this, function(bitmap, mfnt) {
  "use strict";

  var WIDTH = 128;
  var HEIGHT = 64;
  var FRAMEBUFFER_SIZE = WIDTH * Math.ceil(HEIGHT / 8);
  var SCENE_PACK_HEADER_SIZE = 16;
  var SCENE_PACK_VERSION = 1;
  var SCENE_PACK_FORMAT_MONO_VLSB = 1;
  var SCENE_PACK_MAGIC = [0x45, 0x53, 0x43, 0x4e]; // "ESCN"

  function positiveDimension(value, fallback) {
    var parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  function sceneDimensions(scene) {
    scene = scene && typeof scene === "object" ? scene : {};
    var width = positiveDimension(scene.width, WIDTH);
    var height = positiveDimension(scene.height, HEIGHT);
    var size = width * Math.ceil(height / 8);
    if (size > 0xffff) {
      throw new RangeError("Display framebuffer is too large for scene.dat");
    }
    return {width: width, height: height, size: size};
  }

  function base64ToBytes(value) {
    var source = String(value || "");
    if (typeof atob === "function") {
      var binary = atob(source);
      var browserBytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) browserBytes[i] = binary.charCodeAt(i);
      return browserBytes;
    }
    if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(source, "base64"));
    throw new Error("Base64 decoding is unavailable");
  }

  function putPixel(bytes, x, y, surfaceWidth, surfaceHeight) {
    surfaceWidth = surfaceWidth || WIDTH;
    surfaceHeight = surfaceHeight || HEIGHT;
    if (x < 0 || x >= surfaceWidth || y < 0 || y >= surfaceHeight) return;
    bytes[(y >> 3) * surfaceWidth + x] |= 1 << (y & 7);
  }

  function clearPixel(bytes, x, y, surfaceWidth, surfaceHeight) {
    surfaceWidth = surfaceWidth || WIDTH;
    surfaceHeight = surfaceHeight || HEIGHT;
    if (x < 0 || x >= surfaceWidth || y < 0 || y >= surfaceHeight) return;
    bytes[(y >> 3) * surfaceWidth + x] &= ~(1 << (y & 7));
  }

  function layerColor(layer) {
    if (layer && (layer.color === 0 || layer.color === "0")) return 0;
    if (layer && layer.type === "text" && layer.inverted === true &&
        layer.color === undefined) return 0;
    return 1;
  }

  function drawPixel(bytes, x, y, layer, surfaceWidth, surfaceHeight) {
    if (layerColor(layer)) {
      putPixel(bytes, x, y, surfaceWidth, surfaceHeight);
    } else {
      clearPixel(bytes, x, y, surfaceWidth, surfaceHeight);
    }
  }

  function rectangleRadius(layer) {
    return Math.max(0, Math.min(Number(layer.radius) || 0,
        Math.floor(layer.width / 2), Math.floor(layer.height / 2)));
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

  function drawRectangle(bytes, layer, surfaceWidth, surfaceHeight) {
    var x;
    var y;
    if (rectangleRadius(layer)) {
      for (y = layer.y; y < layer.y + layer.height; y++) {
        for (x = layer.x; x < layer.x + layer.width; x++) {
          if (!roundedRectangleContainsPixel(layer, x, y)) continue;
          if (layer.filled ||
              !roundedRectangleContainsPixel(layer, x - 1, y) ||
              !roundedRectangleContainsPixel(layer, x + 1, y) ||
              !roundedRectangleContainsPixel(layer, x, y - 1) ||
              !roundedRectangleContainsPixel(layer, x, y + 1)) {
            drawPixel(bytes, x, y, layer, surfaceWidth, surfaceHeight);
          }
        }
      }
      return;
    }
    if (layer.filled) {
      for (y = layer.y; y < layer.y + layer.height; y++) {
        for (x = layer.x; x < layer.x + layer.width; x++) {
          drawPixel(bytes, x, y, layer, surfaceWidth, surfaceHeight);
        }
      }
      return;
    }
    for (x = layer.x; x < layer.x + layer.width; x++) {
      drawPixel(bytes, x, layer.y, layer, surfaceWidth, surfaceHeight);
      if (layer.height > 1) {
        drawPixel(bytes, x, layer.y + layer.height - 1, layer,
            surfaceWidth, surfaceHeight);
      }
    }
    if (layer.height > 2) {
      for (y = layer.y + 1; y < layer.y + layer.height - 1; y++) {
        drawPixel(bytes, layer.x, y, layer, surfaceWidth, surfaceHeight);
        if (layer.width > 1) {
          drawPixel(bytes, layer.x + layer.width - 1, y, layer,
              surfaceWidth, surfaceHeight);
        }
      }
    }
  }

  function lineStrokeWidth(layer) {
    var width = Number(layer.strokeWidth) || 1;
    return width === 2 || width === 3 || width === 5 ? width : 1;
  }

  function drawLine(bytes, layer, surfaceWidth, surfaceHeight) {
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
      for (var stampY = 0; stampY < strokeWidth; stampY++) {
        for (var stampX = 0; stampX < strokeWidth; stampX++) {
          drawPixel(bytes, x + stampStart + stampX, y + stampStart + stampY,
              layer, surfaceWidth, surfaceHeight);
        }
      }
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
    var normalizedX = (x + 0.5 - layer.x - radiusX) / radiusX;
    var normalizedY = (y + 0.5 - layer.y - radiusY) / radiusY;
    return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
  }

  function drawEllipse(bytes, layer, surfaceWidth, surfaceHeight) {
    for (var y = layer.y; y < layer.y + layer.height; y++) {
      for (var x = layer.x; x < layer.x + layer.width; x++) {
        if (!ellipseContainsPixel(layer, x, y)) continue;
        if (layer.filled ||
            !ellipseContainsPixel(layer, x - 1, y) ||
            !ellipseContainsPixel(layer, x + 1, y) ||
            !ellipseContainsPixel(layer, x, y - 1) ||
            !ellipseContainsPixel(layer, x, y + 1)) {
          drawPixel(bytes, x, y, layer, surfaceWidth, surfaceHeight);
        }
      }
    }
  }

  function fontAsset(scene, id) {
    var fonts = Array.isArray(scene.fonts) ? scene.fonts : [];
    for (var i = 0; i < fonts.length; i++) {
      if (fonts[i] && fonts[i].id === id) return fonts[i];
    }
    return null;
  }

  function decodedFont(scene, layer) {
    if (!mfnt) throw new Error("MFNT codec is unavailable");
    var asset = fontAsset(scene, layer.fontId);
    if (!asset) throw new Error("Text layer font is missing: " + layer.fontId);
    var validation = mfnt.validate(base64ToBytes(asset.data));
    if (!validation.valid) throw new Error("Text layer font is invalid: " + layer.fontId);
    return {
      width: validation.font.width,
      height: validation.font.height,
      glyphs: mfnt.decodeAllGlyphs(validation.font)
    };
  }

  function drawText(bytes, layer, scene, surfaceWidth, surfaceHeight) {
    var font = decodedFont(scene, layer);
    var cursorX = layer.x;
    var characters = Array.from(String(layer.text || ""));
    for (var i = 0; i < characters.length; i++) {
      var glyph = font.glyphs[mfnt.glyphIndexForCharacter(characters[i])];
      for (var y = 0; y < font.height; y++) {
        for (var x = 0; x < font.width; x++) {
          if (glyph[y * font.width + x]) {
            drawPixel(bytes, cursorX + x, layer.y + y, layer,
                surfaceWidth, surfaceHeight);
          }
        }
      }
      cursorX += font.width + 1;
    }
  }

  function drawBitmap(bytes, layer, surfaceWidth, surfaceHeight) {
    if (!bitmap) throw new Error("Bitmap codec is unavailable");
    var source = base64ToBytes(layer.data);
    var validation = bitmap.validate(source, layer.width, layer.height);
    if (!validation.valid) throw new Error("Bitmap layer data are invalid: " + layer.id);
    var blackSource = null;
    if (layer.kind === "drawing") {
      blackSource = typeof layer.blackData === "string" ?
          base64ToBytes(layer.blackData) :
          new Uint8Array(bitmap.byteLength(layer.width, layer.height));
      var blackValidation = bitmap.validate(
          blackSource, layer.width, layer.height);
      if (!blackValidation.valid) {
        throw new Error("Drawing black data are invalid: " + layer.id);
      }
    }
    for (var y = 0; y < layer.height; y++) {
      for (var x = 0; x < layer.width; x++) {
        var whitePixel = bitmap.getPixel(source, layer.width, x, y);
        var blackPixel = blackSource ?
            bitmap.getPixel(blackSource, layer.width, x, y) : 0;
        if (blackPixel) {
          clearPixel(bytes, layer.x + x, layer.y + y,
              surfaceWidth, surfaceHeight);
        } else if (whitePixel) {
          if (layer.kind === "drawing") {
            putPixel(bytes, layer.x + x, layer.y + y,
                surfaceWidth, surfaceHeight);
          } else {
            drawPixel(bytes, layer.x + x, layer.y + y, layer,
                surfaceWidth, surfaceHeight);
          }
        } else if (layer.transparent === false) {
          if (layerColor(layer)) {
            clearPixel(bytes, layer.x + x, layer.y + y,
                surfaceWidth, surfaceHeight);
          } else {
            putPixel(bytes, layer.x + x, layer.y + y,
                surfaceWidth, surfaceHeight);
          }
        }
      }
    }
  }

  function layerBlitKey(layer) {
    if (layer.type === "bitmap" && layer.transparent === false) return -1;
    return layerColor(layer) ? 0 : 1;
  }

  function isDynamicLayer(layer) {
    if (!layer) return false;
    var bindings = layer.bindings && typeof layer.bindings === "object" ?
        layer.bindings : {};
    return bindings.text === true || bindings.x === true ||
        bindings.y === true || bindings.visible === true ||
        (layer.type === "text" && typeof layer.parameterId === "string" &&
            layer.parameterId.length > 0);
  }

  function hasDynamicProperty(layer, property) {
    return !!(layer && layer.bindings && layer.bindings[property] === true) ||
        (property === "text" && layer && layer.type === "text" &&
            typeof layer.parameterId === "string" && layer.parameterId.length > 0);
  }

  function drawLayer(bytes, layer, scene, surfaceWidth, surfaceHeight) {
    if (layer.type === "rect") {
      drawRectangle(bytes, layer, surfaceWidth, surfaceHeight);
    } else if (layer.type === "line") {
      drawLine(bytes, layer, surfaceWidth, surfaceHeight);
    } else if (layer.type === "ellipse") {
      drawEllipse(bytes, layer, surfaceWidth, surfaceHeight);
    } else if (layer.type === "text") {
      drawText(bytes, layer, scene, surfaceWidth, surfaceHeight);
    } else if (layer.type === "bitmap") {
      drawBitmap(bytes, layer, surfaceWidth, surfaceHeight);
    }
  }

  /** Compile all visible static layers, preserving their stored layer order. */
  function compileStaticFramebuffer(scene) {
    scene = scene && typeof scene === "object" ? scene : {};
    var dimensions = sceneDimensions(scene);
    var layers = Array.isArray(scene.layers) ? scene.layers : [];
    var bytes = new Uint8Array(dimensions.size);
    var staticLayerIds = [];
    var dynamicLayers = [];
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      if (!layer) continue;
      if (isDynamicLayer(layer)) {
        dynamicLayers.push(layer);
        continue;
      }
      if (layer.visible === false) continue;
      drawLayer(bytes, layer, scene, dimensions.width, dimensions.height);
      staticLayerIds.push(layer.id || String(i));
    }
    /*
     * A visible static layer may still produce an entirely black framebuffer
     * (for example when it lies outside the display). Clearing fbuf is then
     * equivalent and avoids storing or transferring 1024 zero bytes.
     */
    var hasStaticPixels = false;
    for (var byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
      if (bytes[byteIndex] !== 0) {
        hasStaticPixels = true;
        break;
      }
    }
    return {bytes: bytes, width: dimensions.width, height: dimensions.height,
      framebufferSize: dimensions.size, hasStaticPixels: hasStaticPixels,
      staticLayerIds: staticLayerIds, dynamicLayers: dynamicLayers};
  }

  function layerBounds(layer) {
    if (layer.type === "line") {
      var strokeWidth = lineStrokeWidth(layer);
      var stampStart = -Math.floor(strokeWidth / 2);
      var stampEnd = stampStart + strokeWidth - 1;
      var left = Math.min(layer.x1, layer.x2) + stampStart;
      var top = Math.min(layer.y1, layer.y2) + stampStart;
      var right = Math.max(layer.x1, layer.x2) + stampEnd;
      var bottom = Math.max(layer.y1, layer.y2) + stampEnd;
      return {x: left, y: top, width: right - left + 1,
        height: bottom - top + 1};
    }
    return {x: layer.x, y: layer.y, width: layer.width, height: layer.height};
  }

  /** Rasterize one layer into a native MONO_VLSB bitmap for direct mode. */
  function compileLayerBitmap(scene, layer) {
    var bounds = layerBounds(layer);
    /*
     * Rasterize in layer-local coordinates. Drawing at the stored global
     * coordinates would permanently discard pixels that currently lie outside
     * 128x64; a dynamically moved layer could then never bring them back.
     */
    var localLayer = Object.assign({}, layer);
    if (layer.type === "line") {
      localLayer.x1 = layer.x1 - bounds.x;
      localLayer.y1 = layer.y1 - bounds.y;
      localLayer.x2 = layer.x2 - bounds.x;
      localLayer.y2 = layer.y2 - bounds.y;
    } else {
      localLayer.x = 0;
      localLayer.y = 0;
    }
    /* Build a white mask first for transparent black layers. Inverting the
     * complete VLSB buffer makes object pixels 0 and background pixels 1, so
     * blit key 1 writes real black without disturbing lower layers. */
    var transparentBlack = layerColor(layer) === 0 &&
        !(layer.type === "bitmap" && layer.transparent === false);
    if (transparentBlack) {
      localLayer.color = 1;
      localLayer.inverted = false;
    }
    var bytes = new Uint8Array(bounds.width * Math.ceil(bounds.height / 8));
    drawLayer(bytes, localLayer, scene, bounds.width, bounds.height);
    if (transparentBlack) {
      for (var byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
        bytes[byteIndex] ^= 0xff;
      }
    }
    return {x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      bytes: bytes};
  }

  function bytesContainPixels(bytes) {
    for (var i = 0; i < bytes.length; i++) {
      if (bytes[i]) return true;
    }
    return false;
  }

  /**
   * Ordinary objects need one blit. A drawing may contain transparent, white
   * and black pixels, so it becomes at most two masks while keeping its scene
   * data compact and its static framebuffer path allocation-free.
   */
  function compileLayerRasterPlans(scene, layer) {
    if (layer.type !== "bitmap" || layer.kind !== "drawing") {
      return [{raster: compileLayerBitmap(scene, layer),
        key: layerBlitKey(layer)}];
    }
    var plans = [];
    var masks = [
      {data: layer.data, color: 1},
      {data: layer.blackData, color: 0}
    ];
    for (var i = 0; i < masks.length; i++) {
      if (typeof masks[i].data !== "string") continue;
      var source = base64ToBytes(masks[i].data);
      if (!bytesContainPixels(source)) continue;
      var maskLayer = Object.assign({}, layer, {
        kind: undefined,
        data: masks[i].data,
        color: masks[i].color,
        transparent: true
      });
      plans.push({
        raster: compileLayerBitmap(scene, maskLayer),
        key: masks[i].color ? 0 : 1
      });
    }
    return plans;
  }

  function pythonBytesLiteral(bytes) {
    var lines = [];
    for (var offset = 0; offset < bytes.length; offset += 64) {
      var line = "";
      for (var i = offset; i < Math.min(bytes.length, offset + 64); i++) {
        line += "\\x" + bytes[i].toString(16).padStart(2, "0");
      }
      lines.push("    b'" + line + "'");
    }
    return "(\n" + lines.join("\n") + "\n)";
  }

  function identifier(value) {
    var result = String(value || "scene").replace(/[^a-zA-Z0-9_]/g, "_");
    if (!/^[a-zA-Z_]/.test(result)) result = "scene_" + result;
    return result.substring(0, 48) || "scene";
  }

  /**
   * Keep generated MicroPython identifiers compact. Blockly passes a stable
   * workspace scene number (s0, s1, ...). The hash is only a standalone
   * compiler fallback for tests and integrations that do not provide it.
   */
  function compactSymbol(options) {
    var supplied = String(options && options.symbol || "");
    if (/^[a-zA-Z][a-zA-Z0-9_]{0,11}$/.test(supplied)) return supplied;
    var source = String(options && options.suffix || "scene");
    var hash = 0x811c9dc5;
    for (var i = 0; i < source.length; i++) {
      var code = source.charCodeAt(i);
      hash = Math.imul(hash ^ (code & 0xff), 0x01000193) >>> 0;
      hash = Math.imul(hash ^ (code >>> 8), 0x01000193) >>> 0;
    }
    return "s" + hash.toString(36);
  }

  function writeUint16LE(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
  }

  function writeUint32LE(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
  }

  /** Fast deterministic identifier used to detect mismatched code and assets. */
  function fnv1a32(byteGroups) {
    var hash = 0x811c9dc5;
    for (var groupIndex = 0; groupIndex < byteGroups.length; groupIndex++) {
      var bytes = byteGroups[groupIndex];
      for (var i = 0; i < bytes.length; i++) {
        hash = Math.imul(hash ^ bytes[i], 0x01000193) >>> 0;
      }
    }
    return hash >>> 0;
  }

  /**
   * Build /gfx/scene.dat.
   *
   * Header (16 bytes, little endian):
   *   0..3   "ESCN"
   *   4      format version (1)
   *   5      framebuffer format (1 = MONO_VLSB)
   *   6..7   stored framebuffer record count
   *   8..11  FNV-1a build identifier
   *   12..13 bytes per scene (width * ceil(height / 8))
   *   14..15 header size (16)
   *
   * Every following record is one uncompressed framebuffer. Empty
   * static scenes are omitted and mapped to -1 in sceneRecordIndexes; stored
   * record N starts at 16 + N * bytesPerScene. All scenes in one project must
   * use the same dimensions because the pack has one record size.
   */
  function buildScenePack(scenes) {
    scenes = Array.isArray(scenes) ? scenes : [];
    if (scenes.length > 0xffff) throw new RangeError("Too many display scenes");
    var framebuffers = [];
    var sceneRecordIndexes = [];
    var frameSize = scenes.length ? sceneDimensions(scenes[0]).size : FRAMEBUFFER_SIZE;
    for (var i = 0; i < scenes.length; i++) {
      var compiled = compileStaticFramebuffer(scenes[i]);
      if (compiled.framebufferSize !== frameSize) {
        throw new RangeError("All file-backed display scenes must use the same resolution");
      }
      if (compiled.hasStaticPixels) {
        sceneRecordIndexes.push(framebuffers.length);
        framebuffers.push(compiled.bytes);
      } else {
        sceneRecordIndexes.push(-1);
      }
    }
    var buildId = fnv1a32(framebuffers);
    var bytes = new Uint8Array(
        SCENE_PACK_HEADER_SIZE + framebuffers.length * frameSize);
    for (i = 0; i < SCENE_PACK_MAGIC.length; i++) bytes[i] = SCENE_PACK_MAGIC[i];
    bytes[4] = SCENE_PACK_VERSION;
    bytes[5] = SCENE_PACK_FORMAT_MONO_VLSB;
    writeUint16LE(bytes, 6, framebuffers.length);
    writeUint32LE(bytes, 8, buildId);
    writeUint16LE(bytes, 12, frameSize);
    writeUint16LE(bytes, 14, SCENE_PACK_HEADER_SIZE);
    for (i = 0; i < framebuffers.length; i++) {
      bytes.set(framebuffers[i], SCENE_PACK_HEADER_SIZE + i * frameSize);
    }
    return {
      bytes: bytes,
      buildId: buildId,
      sceneCount: framebuffers.length,
      framebufferSize: frameSize,
      framebuffers: framebuffers,
      sceneRecordIndexes: sceneRecordIndexes
    };
  }

  function safeFontFileName(asset) {
    var name = String(asset && asset.fileName || asset && asset.id || "font")
        .replace(/\.mfnt$/i, "")
        .replace(/[^a-zA-Z0-9_.-]/g, "_")
        .substring(0, 26) || "font";
    /* Keep "/gfx/" + name + optional "_12345678" suffix below the 48-byte
     * filename limit of ESP IDE's fast BLE transfer protocol. */
    return name + ".mfnt";
  }

  /**
   * MicroPython horizontal framebuffers pad every scanline to a whole byte.
   * MFNT v1 HLSB/HMSB files are intentionally a compact continuous bitstream,
   * so widths not divisible by eight cannot be passed to FrameBuffer directly.
   * Runtime assets are therefore converted once in the browser to VLSB, whose
   * byte layout is directly accepted for every 1..255 pixel cell width.
   */
  function runtimeFontBytes(asset) {
    var source = base64ToBytes(asset.data);
    var font = mfnt.parse(source);
    if (font.formatId === mfnt.FORMAT_VLSB) return source;
    return mfnt.serialize({
      width: font.width,
      height: font.height,
      formatId: mfnt.FORMAT_VLSB,
      glyphs: mfnt.decodeAllGlyphs(font)
    });
  }

  /**
   * Collect fonts needed by dynamically changing text. Static text is already
   * rasterized by the browser and needs no font on the device. Identical font
   * binaries are transferred only once even when several scenes use them.
   */
  function collectRuntimeFonts(scenes) {
    scenes = Array.isArray(scenes) ? scenes : [];
    var files = [];
    var contentFiles = Object.create(null);
    var occupiedPaths = Object.create(null);
    for (var sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
      var scene = scenes[sceneIndex] || {};
      var fonts = Array.isArray(scene.fonts) ? scene.fonts : [];
      var fontById = Object.create(null);
      for (var fontIndex = 0; fontIndex < fonts.length; fontIndex++) {
        if (fonts[fontIndex] && fonts[fontIndex].id) {
          fontById[fonts[fontIndex].id] = fonts[fontIndex];
        }
      }
      var layers = Array.isArray(scene.layers) ? scene.layers : [];
      for (var layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        var layer = layers[layerIndex];
        if (!layer || layer.type !== "text" ||
            !hasDynamicProperty(layer, "text")) continue;
        var asset = fontById[layer.fontId];
        if (!asset || !asset.data) continue;
        var bytes = runtimeFontBytes(asset);
        var contentId = fnv1a32([bytes]).toString(16).padStart(8, "0") +
            "-" + bytes.length;
        if (contentFiles[contentId]) {
          contentFiles[contentId].references.push({
            sceneIndex: sceneIndex,
            fontId: asset.id
          });
          continue;
        }
        var fileName = safeFontFileName(asset);
        var path = "/gfx/" + fileName;
        if (occupiedPaths[path] && occupiedPaths[path] !== contentId) {
          fileName = fileName.replace(/\.mfnt$/i, "_" + contentId.substring(0, 8) + ".mfnt");
          path = "/gfx/" + fileName;
        }
        occupiedPaths[path] = contentId;
        var file = {
          path: path,
          bytes: bytes,
          fingerprint: contentId,
          fontId: asset.id,
          catalogId: asset.catalogId || null,
          references: [{sceneIndex: sceneIndex, fontId: asset.id}]
        };
        contentFiles[contentId] = file;
        files.push(file);
      }
    }
    return files;
  }

  function runtimeFontPath(files, sceneIndex, fontId) {
    files = Array.isArray(files) ? files : [];
    for (var i = 0; i < files.length; i++) {
      var references = Array.isArray(files[i].references) ? files[i].references : [];
      for (var j = 0; j < references.length; j++) {
        if (references[j].sceneIndex === sceneIndex &&
            references[j].fontId === fontId) return files[i].path;
      }
    }
    return null;
  }

  function sceneFileLoaderPython(buildId, sceneCount, frameSize) {
    return "_espide_scene_file = open('/gfx/scene.dat', 'rb')\n" +
        "_espide_scene_header = _espide_scene_file.read(16)\n" +
        "if (len(_espide_scene_header) != 16 or " +
        "_espide_scene_header[:4] != b'ESCN' or " +
        "_espide_scene_header[4] != 1 or _espide_scene_header[5] != 1 or " +
        "(_espide_scene_header[6] | (_espide_scene_header[7] << 8)) != " +
        sceneCount + " or " +
        "(_espide_scene_header[8] | (_espide_scene_header[9] << 8) | " +
        "(_espide_scene_header[10] << 16) | (_espide_scene_header[11] << 24)) != " +
        (buildId >>> 0) + " or " +
        "(_espide_scene_header[12] | (_espide_scene_header[13] << 8)) != " +
        frameSize + "):\n" +
        "    _espide_scene_file.close()\n" +
        "    raise OSError('ESP IDE scene.dat does not match the program')\n" +
        "def _espide_load_scene(index):\n" +
        "    _espide_scene_file.seek(16 + index * " + frameSize + ")\n" +
        "    if _espide_scene_file.readinto(buffer) != " + frameSize + ":\n" +
        "        raise OSError('ESP IDE scene.dat is incomplete')";
  }

  function indentPython(code, spaces) {
    var indent = " ".repeat(spaces);
    return String(code || "").split("\n").filter(function(line, index, lines) {
      return line || index < lines.length - 1;
    }).map(function(line) {
      return indent + line;
    }).join("\n") + "\n";
  }

  function dynamicExpression(options, layer, property, fallback) {
    var values = options.dynamicValues && options.dynamicValues[layer.id];
    return values && typeof values[property] === "string" && values[property] ?
        values[property] : fallback;
  }

  function monoFontRuntimePython() {
    return "from espide_monofont import MonoFont\n" +
        "_espide_font_cache = {}\n" +
        "def _espide_font(path):\n" +
        "    font = _espide_font_cache.get(path)\n" +
        "    if font is None:\n" +
        "        font = MonoFont(path)\n" +
        "        _espide_font_cache[path] = font\n" +
        "    return font";
  }

  /** Generate one layer that is intentionally composited above all statics. */
  function createDynamicLayerPlan(scene, layer, options, dynamicIndex) {
    var symbol = compactSymbol(options);
    var layerSymbol = symbol + "_d" + (Number(dynamicIndex) || 0).toString(36);
    var definitions = [];
    var setup = "";
    var body = "";
    var bounds = layerBounds(layer);
    /* Dynamic line X/Y keeps its original contract: it addresses the minimum
     * endpoint, not the outer edge added by a thick rasterized stroke. */
    var positionX = layer.type === "line" ?
        Math.min(layer.x1, layer.x2) : bounds.x;
    var positionY = layer.type === "line" ?
        Math.min(layer.y1, layer.y2) : bounds.y;
    var xValue = String(positionX);
    var yValue = String(positionY);
    if (hasDynamicProperty(layer, "x")) {
      xValue = "int(" +
          dynamicExpression(options, layer, "x", String(positionX)) + ")";
    }
    if (hasDynamicProperty(layer, "y")) {
      yValue = "int(" +
          dynamicExpression(options, layer, "y", String(positionY)) + ")";
    }
    /*
     * A direct one-pixel line references its origin twice. Evaluate connected
     * Blockly values only once, but let rasterized thick lines inline X/Y in
     * their single blit call.
     */
    var directLine = layer.type === "line" && lineStrokeWidth(layer) === 1;
    if (directLine && hasDynamicProperty(layer, "x")) {
      var lineX = "_espide_" + layerSymbol + "x";
      setup += lineX + " = " + xValue + "\n";
      xValue = lineX;
    }
    if (directLine && hasDynamicProperty(layer, "y")) {
      var lineY = "_espide_" + layerSymbol + "y";
      setup += lineY + " = " + yValue + "\n";
      yValue = lineY;
    }

    if (layer.type === "text" && hasDynamicProperty(layer, "text")) {
      var fontPath = options.fontPaths && options.fontPaths[layer.id];
      if (!fontPath) throw new Error("Runtime font path is missing: " + layer.fontId);
      definitions.push({
        key: "espide_monofont_runtime",
        code: monoFontRuntimePython()
      });
      var textValue = dynamicExpression(
          options, layer, "text", JSON.stringify(String(layer.text || "")));
      body = "_espide_font(" + JSON.stringify(fontPath) + ").text(fbuf, str(" +
          textValue + "), " + xValue + ", " + yValue + ", True" +
          (layerColor(layer) ? "" : ", invert=True") + ")\n";
    } else if (layer.type === "rect" && rectangleRadius(layer) === 0) {
      body = "fbuf." + (layer.filled ? "fill_rect" : "rect") + "(" +
          [xValue, yValue, layer.width, layer.height, layerColor(layer)].join(", ") + ")\n";
    } else if (directLine) {
      var x1 = layer.x1 - positionX ?
          xValue + " + " + (layer.x1 - positionX) : xValue;
      var y1 = layer.y1 - positionY ?
          yValue + " + " + (layer.y1 - positionY) : yValue;
      var x2 = layer.x2 - positionX ?
          xValue + " + " + (layer.x2 - positionX) : xValue;
      var y2 = layer.y2 - positionY ?
          yValue + " + " + (layer.y2 - positionY) : yValue;
      body = "fbuf.line(" +
          [x1, y1, x2, y2, layerColor(layer)].join(", ") + ")\n";
    } else {
      var rasterPlans = compileLayerRasterPlans(scene, layer);
      for (var rasterIndex = 0; rasterIndex < rasterPlans.length; rasterIndex++) {
        var raster = rasterPlans[rasterIndex].raster;
        var bitmapName = "_espide_" + layerSymbol +
            (rasterPlans.length > 1 ? "_" + rasterIndex : "");
        definitions.push({key: "import_framebuf", code: "import framebuf"});
        definitions.push({
          key: "espide_dynamic_data_" + layerSymbol + "_" + rasterIndex,
          code: bitmapName + "_data = bytearray(" +
              pythonBytesLiteral(raster.bytes) + ")\n" +
              bitmapName + " = framebuf.FrameBuffer(" + bitmapName + "_data, " +
              raster.width + ", " + raster.height + ", framebuf.MONO_VLSB)"
        });
        var rasterX = hasDynamicProperty(layer, "x") ? (
          raster.x !== positionX ?
            xValue + (raster.x - positionX < 0 ? " - " : " + ") +
                Math.abs(raster.x - positionX) : xValue
        ) : String(raster.x);
        var rasterY = hasDynamicProperty(layer, "y") ? (
          raster.y !== positionY ?
            yValue + (raster.y - positionY < 0 ? " - " : " + ") +
                Math.abs(raster.y - positionY) : yValue
        ) : String(raster.y);
        body += "fbuf.blit(" + bitmapName + ", " + rasterX + ", " + rasterY +
            ", " + rasterPlans[rasterIndex].key + ")\n";
      }
    }

    if (!hasDynamicProperty(layer, "visible") && layer.visible === false) {
      return {definitions: definitions, code: ""};
    }
    if (body && hasDynamicProperty(layer, "visible")) {
      var visibility = dynamicExpression(
          options, layer, "visible", layer.visible === false ? "False" : "True");
      body = "if bool(" + visibility + "):\n" + indentPython(body, 4);
    }
    return {definitions: definitions, code: setup + body};
  }

  /**
   * Create definitions and executable code for the Blockly Python generator.
   * Every dynamic layer is intentionally composited after the static base.
   */
  function createPythonPlan(scene, options) {
    options = options || {};
    var symbol = compactSymbol(options);
    var precompute = options.precompute !== false;
    var fileStorage = options.fileStorage === true;
    var compiled = compileStaticFramebuffer(scene);
    var definitions = [];
    var code = "";
    if (!compiled.hasStaticPixels) {
      /*
       * Dynamic-only and visually empty scenes need no 1024-byte constant or
       * file read. Clear the existing display buffer before compositing the
       * dynamic layers below.
       */
      code = "fbuf.fill(0)\n";
    } else if (fileStorage) {
      var suppliedFileIndex = options.sceneFileIndex;
      var sceneIndex = Number(suppliedFileIndex === undefined ?
          options.sceneIndex : suppliedFileIndex);
      var sceneCount = Number(options.sceneCount);
      var buildId = Number(options.buildId) >>> 0;
      if (!Number.isInteger(sceneIndex) || sceneIndex < 0 ||
          !Number.isInteger(sceneCount) || sceneIndex >= sceneCount) {
        throw new RangeError("Invalid scene pack index");
      }
      definitions.push({
        key: "espide_scene_file_loader",
        code: sceneFileLoaderPython(buildId, sceneCount, compiled.framebufferSize)
      });
      code = "_espide_load_scene(" + sceneIndex + ")\n";
    } else if (precompute) {
      var sceneName = "_espide_" + symbol + "_scene";
      definitions.push({key: "espide_scene_data_" + symbol,
        code: sceneName + " = " + pythonBytesLiteral(compiled.bytes)});
      code = "buffer[:] = " + sceneName + "\n";
    } else {
      definitions.push({key: "import_framebuf", code: "import framebuf"});
      code = "fbuf.fill(0)\n";
      var layers = Array.isArray(scene.layers) ? scene.layers : [];
      var bitmapIndex = 0;
      for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (!layer || layer.visible === false || isDynamicLayer(layer)) continue;
        if (layer.type === "rect" && rectangleRadius(layer) === 0) {
          code += "fbuf." + (layer.filled ? "fill_rect" : "rect") + "(" +
              [layer.x, layer.y, layer.width, layer.height,
                layerColor(layer)].join(", ") + ")\n";
        } else if (layer.type === "line" && lineStrokeWidth(layer) === 1) {
          code += "fbuf.line(" +
              [layer.x1, layer.y1, layer.x2, layer.y2,
                layerColor(layer)].join(", ") + ")\n";
        } else {
          var rasterPlans = compileLayerRasterPlans(scene, layer);
          for (var rasterIndex = 0; rasterIndex < rasterPlans.length; rasterIndex++) {
            var raster = rasterPlans[rasterIndex].raster;
            var bitmapName = "_espide_" + symbol + "_l" + bitmapIndex++;
            definitions.push({key: "espide_layer_data_" + symbol + "_" + bitmapIndex,
              code: bitmapName + "_data = bytearray(" +
                  pythonBytesLiteral(raster.bytes) + ")\n" +
                  bitmapName + " = framebuf.FrameBuffer(" + bitmapName + "_data, " +
                  raster.width + ", " + raster.height + ", framebuf.MONO_VLSB)"});
            code += "fbuf.blit(" + bitmapName + ", " + raster.x + ", " +
                raster.y + ", " + rasterPlans[rasterIndex].key + ")\n";
          }
        }
      }
    }
    for (var dynamicIndex = 0; dynamicIndex < compiled.dynamicLayers.length;
        dynamicIndex++) {
      var dynamicPlan = createDynamicLayerPlan(
          scene, compiled.dynamicLayers[dynamicIndex], options, dynamicIndex);
      for (var definitionIndex = 0;
          definitionIndex < dynamicPlan.definitions.length; definitionIndex++) {
        definitions.push(dynamicPlan.definitions[definitionIndex]);
      }
      code += dynamicPlan.code;
    }
    return {definitions: definitions, code: code, bytes: compiled.bytes,
      hasStaticPixels: compiled.hasStaticPixels,
      staticLayerIds: compiled.staticLayerIds, dynamicLayers: compiled.dynamicLayers};
  }

  return Object.freeze({
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,
    FRAMEBUFFER_SIZE: FRAMEBUFFER_SIZE,
    SCENE_PACK_HEADER_SIZE: SCENE_PACK_HEADER_SIZE,
    SCENE_PACK_VERSION: SCENE_PACK_VERSION,
    SCENE_PACK_FORMAT_MONO_VLSB: SCENE_PACK_FORMAT_MONO_VLSB,
    sceneDimensions: sceneDimensions,
    isDynamicLayer: isDynamicLayer,
    hasDynamicProperty: hasDynamicProperty,
    compileStaticFramebuffer: compileStaticFramebuffer,
    compileLayerBitmap: compileLayerBitmap,
    compileLayerRasterPlans: compileLayerRasterPlans,
    buildScenePack: buildScenePack,
    collectRuntimeFonts: collectRuntimeFonts,
    runtimeFontPath: runtimeFontPath,
    createDynamicLayerPlan: createDynamicLayerPlan,
    pythonBytesLiteral: pythonBytesLiteral,
    createPythonPlan: createPythonPlan
  });
});
