/**
 * Deterministic Canvas-to-monochrome rasterizer for MFNT font generation.
 *
 * Canvas owns system-font shaping and antialiasing. This module only converts
 * the resulting RGBA pixels to 0/1 values using an explicit threshold and
 * creates the required visible fallback glyph. It has no DOM dependency and
 * is therefore regression-testable with a small fake Canvas context.
 */
(function(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ESPIDE_FONT_RASTERIZER = api;
})(typeof window !== "undefined" ? window : this, function() {
  "use strict";

  var FIRST_CHAR = 32;
  var LAST_CHAR = 126;
  var GLYPH_COUNT = 96;
  var FALLBACK_INDEX = 95;

  function boundedInteger(value, fallback, minimum, maximum) {
    var number = Number(value);
    if (!Number.isFinite(number)) number = fallback;
    return Math.max(minimum, Math.min(maximum, Math.round(number)));
  }

  /** Convert opaque or transparent Canvas pixels to one bit per pixel. */
  function rgbaToPixels(rgba, width, height, threshold) {
    if (!rgba || rgba.length !== width * height * 4) {
      throw new RangeError("RGBA data must contain width * height * 4 values");
    }
    threshold = boundedInteger(threshold, 128, 0, 255);
    var pixels = new Uint8Array(width * height);
    for (var i = 0; i < pixels.length; i++) {
      var offset = i * 4;
      /* Alpha is included so a transparent white pixel remains background.
       * Integer arithmetic avoids floating point in this conversion loop. */
      var luminance = (rgba[offset] * 77 + rgba[offset + 1] * 150 +
          rgba[offset + 2] * 29) >> 8;
      luminance = Math.floor((luminance * rgba[offset + 3] + 127) / 255);
      pixels[i] = luminance >= threshold ? 1 : 0;
    }
    return pixels;
  }

  function fallbackPixels(width, height) {
    var pixels = new Uint8Array(width * height);
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
            x * (height - 1) === y * (width - 1) ||
            (width - 1 - x) * (height - 1) === y * (width - 1)) {
          pixels[y * width + x] = 1;
        }
      }
    }
    return pixels;
  }

  /**
   * Rasterize printable ASCII through a configured 2D Canvas context.
   * Every character uses the same cell, origin and alphabetic baseline.
   */
  function rasterizeAscii(context, options) {
    options = options || {};
    var width = boundedInteger(options.width, 8, 1, 255);
    var height = boundedInteger(options.height, 8, 1, 255);
    var fontSize = boundedInteger(options.fontSize, height, 1, 512);
    var offsetX = boundedInteger(options.offsetX, 0, -255, 255);
    var baselineY = boundedInteger(options.baselineY, height - 1, -255, 510);
    var threshold = boundedInteger(options.threshold, 128, 0, 255);
    var family = String(options.family || "monospace").replace(/["\\]/g, "");
    var fontStyle = String(options.fontStyle || "normal");
    var fontWeight = String(options.fontWeight || "normal");
    var glyphs = [];

    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.direction = "ltr";
    if ("fontKerning" in context) context.fontKerning = "none";
    context.font = fontStyle + " " + fontWeight + " " + fontSize + "px \"" + family + "\"";

    for (var code = FIRST_CHAR; code <= LAST_CHAR; code++) {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#000000";
      context.fillRect(0, 0, width, height);
      if (code !== FIRST_CHAR) {
        context.fillStyle = "#ffffff";
        context.fillText(String.fromCharCode(code), offsetX, baselineY);
      }
      var image = context.getImageData(0, 0, width, height);
      glyphs.push(rgbaToPixels(image.data, width, height, threshold));
    }

    glyphs.push(fallbackPixels(width, height));
    if (glyphs.length !== GLYPH_COUNT || !glyphs[FALLBACK_INDEX]) {
      throw new Error("Rasterizer did not create the required 96 glyphs");
    }
    return glyphs;
  }

  return Object.freeze({
    rgbaToPixels: rgbaToPixels,
    fallbackPixels: fallbackPixels,
    rasterizeAscii: rasterizeAscii
  });
});
