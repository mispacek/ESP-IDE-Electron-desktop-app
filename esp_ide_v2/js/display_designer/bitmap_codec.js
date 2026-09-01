/**
 * ESP IDE monochrome bitmap codec.
 *
 * Bitmap layers use MicroPython FrameBuffer MONO_HLSB layout: rows are packed
 * horizontally and the left-most pixel occupies the least-significant bit.
 * This module deliberately has no DOM dependency, so conversion, validation
 * and resizing can be regression-tested in Node.
 */
(function(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ESPIDE_BITMAP = api;
})(typeof window !== "undefined" ? window : this, function() {
  "use strict";

  var FORMAT = "mono-hlsb";
  /* Large enough for the current e-paper class while still bounding browser
   * allocations made from imported or hand-edited project data. */
  var MAX_WIDTH = 1024;
  var MAX_HEIGHT = 1024;

  function dimension(value, maximum, name) {
    var number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > maximum) {
      throw new RangeError(name + " must be an integer from 1 to " + maximum);
    }
    return number;
  }

  function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (Array.isArray(value)) return Uint8Array.from(value);
    throw new TypeError("Bitmap data must be bytes");
  }

  function stride(width) {
    width = dimension(width, MAX_WIDTH, "width");
    return Math.ceil(width / 8);
  }

  function byteLength(width, height) {
    height = dimension(height, MAX_HEIGHT, "height");
    return stride(width) * height;
  }

  function validate(bytes, width, height) {
    try {
      bytes = asBytes(bytes);
      var expected = byteLength(width, height);
      return {
        valid: bytes.length === expected,
        expectedLength: expected,
        actualLength: bytes.length
      };
    } catch (error) {
      return {valid: false, error: error.message || String(error)};
    }
  }

  /**
   * Return an exact, row-aligned copy with every bit outside the logical width
   * cleared. This canonicalizes old/imported data without rejecting the
   * otherwise valid bitmap.
   */
  function zeroPadding(bytes, width, height) {
    width = dimension(width, MAX_WIDTH, "width");
    height = dimension(height, MAX_HEIGHT, "height");
    if (!validate(bytes, width, height).valid) {
      throw new RangeError("Invalid bitmap byte length");
    }
    var result = new Uint8Array(asBytes(bytes));
    var remainder = width & 7;
    if (remainder === 0) return result;
    var rowStride = stride(width);
    var validMask = (1 << remainder) - 1;
    for (var y = 0; y < height; y++) {
      result[(y + 1) * rowStride - 1] &= validMask;
    }
    return result;
  }

  function getPixel(bytes, width, x, y) {
    bytes = asBytes(bytes);
    if (!Number.isInteger(x) || !Number.isInteger(y) ||
        x < 0 || x >= width || y < 0) return 0;
    var height = Math.floor(bytes.length / stride(width));
    if (y >= height) return 0;
    return (bytes[y * stride(width) + (x >> 3)] >> (x & 7)) & 1;
  }

  function setPixel(bytes, width, x, y, value) {
    bytes = asBytes(bytes);
    if (!Number.isInteger(x) || !Number.isInteger(y) ||
        x < 0 || x >= width || y < 0) return;
    var rowStride = stride(width);
    if (y >= Math.floor(bytes.length / rowStride)) return;
    var index = y * rowStride + (x >> 3);
    var mask = 1 << (x & 7);
    if (value) bytes[index] |= mask;
    else bytes[index] &= ~mask;
  }

  /** Pack one byte-valued pixel per cell into MONO_HLSB rows. */
  function pack(pixels, width, height) {
    width = dimension(width, MAX_WIDTH, "width");
    height = dimension(height, MAX_HEIGHT, "height");
    if (!pixels || pixels.length < width * height) {
      throw new RangeError("Not enough bitmap pixels");
    }
    var bytes = new Uint8Array(byteLength(width, height));
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        if (pixels[y * width + x]) setPixel(bytes, width, x, y, 1);
      }
    }
    return bytes;
  }

  function unpack(bytes, width, height) {
    width = dimension(width, MAX_WIDTH, "width");
    height = dimension(height, MAX_HEIGHT, "height");
    var check = validate(bytes, width, height);
    if (!check.valid) throw new RangeError("Invalid bitmap byte length");
    bytes = asBytes(bytes);
    var pixels = new Uint8Array(width * height);
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        pixels[y * width + x] = getPixel(bytes, width, x, y);
      }
    }
    return pixels;
  }

  /** Deterministic nearest-neighbour resize for already monochrome layers. */
  function resize(bytes, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    sourceWidth = dimension(sourceWidth, MAX_WIDTH, "sourceWidth");
    sourceHeight = dimension(sourceHeight, MAX_HEIGHT, "sourceHeight");
    targetWidth = dimension(targetWidth, MAX_WIDTH, "targetWidth");
    targetHeight = dimension(targetHeight, MAX_HEIGHT, "targetHeight");
    if (!validate(bytes, sourceWidth, sourceHeight).valid) {
      throw new RangeError("Invalid source bitmap byte length");
    }
    bytes = asBytes(bytes);
    var result = new Uint8Array(byteLength(targetWidth, targetHeight));
    for (var y = 0; y < targetHeight; y++) {
      var sourceY = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / targetHeight));
      for (var x = 0; x < targetWidth; x++) {
        var sourceX = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / targetWidth));
        if (getPixel(bytes, sourceWidth, sourceX, sourceY)) {
          setPixel(result, targetWidth, x, y, 1);
        }
      }
    }
    return result;
  }

  function fitDimensions(width, height, maximumWidth, maximumHeight) {
    width = Math.max(1, Number(width) || 1);
    height = Math.max(1, Number(height) || 1);
    maximumWidth = dimension(maximumWidth || MAX_WIDTH, MAX_WIDTH, "maximumWidth");
    maximumHeight = dimension(maximumHeight || MAX_HEIGHT, MAX_HEIGHT, "maximumHeight");
    var scale = Math.min(1, maximumWidth / width, maximumHeight / height);
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }

  function effectiveLuminance(rgba, offset) {
    var alpha = rgba[offset + 3] / 255;
    /* Transparent pixels are always display-off. Alpha also preserves smooth
     * icon edges before the explicit monochrome threshold is applied. */
    return alpha * (rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 +
        rgba[offset + 2] * 0.0722);
  }

  /**
   * Convert RGBA pixels to display-on pixels. Optional Floyd-Steinberg
   * dithering works on luminance only; alpha-zero pixels never become lit.
   */
  function fromRgba(rgba, width, height, options) {
    width = dimension(width, MAX_WIDTH, "width");
    height = dimension(height, MAX_HEIGHT, "height");
    if (!rgba || rgba.length < width * height * 4) {
      throw new RangeError("Not enough RGBA pixels");
    }
    options = options || {};
    var threshold = Math.max(0, Math.min(255, Math.round(Number(options.threshold) || 0)));
    if (options.threshold === undefined) threshold = 128;
    var invert = options.invert === true;
    var dither = options.dither === true;
    var values = new Float32Array(width * height);
    var opaque = new Uint8Array(width * height);
    var result = new Uint8Array(width * height);
    for (var i = 0; i < values.length; i++) {
      var offset = i * 4;
      opaque[i] = rgba[offset + 3] > 0 ? 1 : 0;
      var luminance = effectiveLuminance(rgba, offset);
      values[i] = invert && opaque[i] ? 255 - luminance : luminance;
    }
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var index = y * width + x;
        if (!opaque[index]) continue;
        var oldValue = Math.max(0, Math.min(255, values[index]));
        var newValue = oldValue >= threshold ? 255 : 0;
        result[index] = newValue ? 1 : 0;
        if (!dither) continue;
        var error = oldValue - newValue;
        if (x + 1 < width) values[index + 1] += error * 7 / 16;
        if (y + 1 < height) {
          if (x > 0) values[index + width - 1] += error * 3 / 16;
          values[index + width] += error * 5 / 16;
          if (x + 1 < width) values[index + width + 1] += error / 16;
        }
      }
    }
    return pack(result, width, height);
  }

  return Object.freeze({
    FORMAT: FORMAT,
    MAX_WIDTH: MAX_WIDTH,
    MAX_HEIGHT: MAX_HEIGHT,
    stride: stride,
    byteLength: byteLength,
    validate: validate,
    zeroPadding: zeroPadding,
    getPixel: getPixel,
    /* Exposed for the Display Designer's pixel brush. Keeping bit addressing
     * here prevents the editor and firmware formats from ever drifting. */
    setPixel: setPixel,
    pack: pack,
    unpack: unpack,
    resize: resize,
    fitDimensions: fitDimensions,
    fromRgba: fromRgba
  });
});
