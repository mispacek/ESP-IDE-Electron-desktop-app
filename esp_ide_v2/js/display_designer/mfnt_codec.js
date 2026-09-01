/**
 * MFNT v1 codec shared by the browser font editor and its regression tests.
 *
 * The binary format is intentionally tiny and deterministic:
 *   - 8 byte header: "MFNT", version, width, height, format
 *   - 96 equally-sized glyphs: ASCII 32..126 and one fallback glyph
 *
 * No browser or Blockly APIs are used here. Keeping this module independent
 * makes it possible to validate every exported font in Node before the editor
 * UI or the MicroPython runtime is involved.
 */
(function(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ESPIDE_MFNT = api;
})(typeof window !== "undefined" ? window : this, function() {
  "use strict";

  var MAGIC = [77, 70, 78, 84]; // ASCII "MFNT"
  var VERSION = 1;
  var HEADER_SIZE = 8;
  var GLYPH_COUNT = 96;
  var FIRST_CHAR = 32;
  var LAST_CHAR = 126;
  var FALLBACK_INDEX = 95;
  var FORMAT_HLSB = 0;
  var FORMAT_HMSB = 1;
  var FORMAT_VLSB = 2;
  /*
   * ESP IDE writes new and edited fonts in the native vertical framebuffer
   * layout. Each glyph column therefore occupies complete 8-pixel pages and
   * can be passed directly to MicroPython FrameBuffer without row expansion.
   */
  var CANONICAL_FORMAT = FORMAT_VLSB;

  function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (Array.isArray(value)) return Uint8Array.from(value);
    throw new TypeError("MFNT data must be an ArrayBuffer or Uint8Array");
  }

  function integerDimension(value, name) {
    var number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 255) {
      throw new RangeError(name + " must be an integer from 1 to 255");
    }
    return number;
  }

  function checkedFormat(formatId) {
    var number = Number(formatId);
    if (number !== FORMAT_HLSB && number !== FORMAT_HMSB && number !== FORMAT_VLSB) {
      throw new RangeError("MFNT format must be 0 (HLSB), 1 (HMSB), or 2 (VLSB)");
    }
    return number;
  }

  function glyphSize(width, height, formatId) {
    width = integerDimension(width, "width");
    height = integerDimension(height, "height");
    formatId = checkedFormat(formatId);
    if (formatId === FORMAT_VLSB) return width * Math.ceil(height / 8);
    return Math.ceil(width * height / 8);
  }

  function glyphOffset(index, size) {
    if (!Number.isInteger(index) || index < 0 || index >= GLYPH_COUNT) {
      throw new RangeError("glyph index must be from 0 to 95");
    }
    if (!Number.isInteger(size) || size < 1) throw new RangeError("invalid glyph size");
    return HEADER_SIZE + index * size;
  }

  function glyphIndexForCharacter(character) {
    if (typeof character !== "string" || character.length === 0) return 0;
    var code = character.codePointAt(0);
    return code >= FIRST_CHAR && code <= LAST_CHAR ? code - FIRST_CHAR : 0;
  }

  /** Parse structural metadata. Semantic glyph checks are performed by validate(). */
  function parse(value) {
    var bytes = asBytes(value);
    if (bytes.length < HEADER_SIZE) throw new Error("Incomplete MFNT header");
    for (var i = 0; i < MAGIC.length; i++) {
      if (bytes[i] !== MAGIC[i]) throw new Error("Invalid MFNT magic");
    }
    if (bytes[4] !== VERSION) throw new Error("Unsupported MFNT version: " + bytes[4]);

    var width = integerDimension(bytes[5], "width");
    var height = integerDimension(bytes[6], "height");
    var formatId = checkedFormat(bytes[7]);
    var size = glyphSize(width, height, formatId);
    var expectedSize = HEADER_SIZE + GLYPH_COUNT * size;
    if (bytes.length !== expectedSize) {
      throw new Error("Invalid MFNT file size: expected " + expectedSize + ", got " + bytes.length);
    }

    return {
      bytes: bytes,
      version: VERSION,
      width: width,
      height: height,
      formatId: formatId,
      glyphSize: size,
      glyphCount: GLYPH_COUNT,
      dataOffset: HEADER_SIZE
    };
  }

  function bitLocation(width, height, formatId, x, y) {
    if (formatId === FORMAT_VLSB) {
      return {byteIndex: Math.floor(y / 8) * width + x, mask: 1 << (y % 8)};
    }
    var pixelIndex = y * width + x;
    return {
      byteIndex: Math.floor(pixelIndex / 8),
      mask: formatId === FORMAT_HLSB ? 1 << (7 - pixelIndex % 8) : 1 << (pixelIndex % 8)
    };
  }

  function decodeGlyph(fontOrBytes, index) {
    var font = fontOrBytes && fontOrBytes.bytes ? fontOrBytes : parse(fontOrBytes);
    var pixels = new Uint8Array(font.width * font.height);
    var start = glyphOffset(index, font.glyphSize);
    for (var y = 0; y < font.height; y++) {
      for (var x = 0; x < font.width; x++) {
        var location = bitLocation(font.width, font.height, font.formatId, x, y);
        pixels[y * font.width + x] = (font.bytes[start + location.byteIndex] & location.mask) ? 1 : 0;
      }
    }
    return pixels;
  }

  function encodeGlyph(pixels, width, height, formatId) {
    width = integerDimension(width, "width");
    height = integerDimension(height, "height");
    formatId = checkedFormat(formatId);
    if (!pixels || pixels.length !== width * height) {
      throw new RangeError("glyph pixel array must contain width * height values");
    }
    var data = new Uint8Array(glyphSize(width, height, formatId));
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        if (!pixels[y * width + x]) continue;
        var location = bitLocation(width, height, formatId, x, y);
        data[location.byteIndex] |= location.mask;
      }
    }
    return data;
  }

  function normalizeGlyphs(glyphs, width, height) {
    if (!Array.isArray(glyphs) || glyphs.length !== GLYPH_COUNT) {
      throw new RangeError("MFNT requires exactly 96 glyph pixel arrays");
    }
    return glyphs.map(function(pixels, index) {
      if (!pixels || pixels.length !== width * height) {
        throw new RangeError("glyph " + index + " must contain width * height pixels");
      }
      return pixels;
    });
  }

  function serialize(options) {
    options = options || {};
    var width = integerDimension(options.width, "width");
    var height = integerDimension(options.height, "height");
    var formatId = checkedFormat(options.formatId);
    var glyphs = normalizeGlyphs(options.glyphs, width, height);
    var size = glyphSize(width, height, formatId);
    var bytes = new Uint8Array(HEADER_SIZE + GLYPH_COUNT * size);
    bytes.set(MAGIC, 0);
    bytes[4] = VERSION;
    bytes[5] = width;
    bytes[6] = height;
    bytes[7] = formatId;
    for (var index = 0; index < GLYPH_COUNT; index++) {
      bytes.set(encodeGlyph(glyphs[index], width, height, formatId), glyphOffset(index, size));
    }
    return bytes;
  }

  function isGlyphEmpty(font, index) {
    var start = glyphOffset(index, font.glyphSize);
    var end = start + font.glyphSize;
    for (var i = start; i < end; i++) if (font.bytes[i] !== 0) return false;
    return true;
  }

  function unusedBitsAreZero(font, index) {
    var start = glyphOffset(index, font.glyphSize);
    if (font.formatId === FORMAT_VLSB) {
      var remainderY = font.height % 8;
      if (remainderY === 0) return true;
      var allowedMask = (1 << remainderY) - 1;
      var lastPage = Math.floor(font.height / 8) * font.width;
      for (var x = 0; x < font.width; x++) {
        if ((font.bytes[start + lastPage + x] & ~allowedMask) !== 0) return false;
      }
      return true;
    }

    var remainder = font.width * font.height % 8;
    if (remainder === 0) return true;
    var tail = font.bytes[start + font.glyphSize - 1];
    var validMask = font.formatId === FORMAT_HLSB ?
        (0xff << (8 - remainder)) & 0xff :
        (1 << remainder) - 1;
    return (tail & ~validMask) === 0;
  }

  /**
   * Validate a file without throwing. Structural defects are errors; an empty
   * fallback is a warning so a partially-created font remains editable.
   */
  function validate(value) {
    var result = {valid: false, errors: [], warnings: [], font: null};
    try {
      result.font = parse(value);
    } catch (error) {
      result.errors.push(error.message || String(error));
      return result;
    }

    if (!isGlyphEmpty(result.font, 0)) result.errors.push("Space glyph must be empty");
    if (isGlyphEmpty(result.font, FALLBACK_INDEX)) result.warnings.push("Fallback glyph is empty");
    for (var index = 0; index < GLYPH_COUNT; index++) {
      if (!unusedBitsAreZero(result.font, index)) {
        result.errors.push("Glyph " + index + " contains non-zero unused bits");
      }
    }
    result.valid = result.errors.length === 0;
    return result;
  }

  function blankGlyph(width, height) {
    return new Uint8Array(width * height);
  }

  /** Create a usable empty font whose fallback is a visible box with a cross. */
  function createBlankFont(width, height, formatId) {
    width = integerDimension(width, "width");
    height = integerDimension(height, "height");
    formatId = checkedFormat(formatId == null ? FORMAT_HLSB : formatId);
    var glyphs = [];
    for (var i = 0; i < GLYPH_COUNT; i++) glyphs.push(blankGlyph(width, height));
    var fallback = glyphs[FALLBACK_INDEX];
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
            x * (height - 1) === y * (width - 1) ||
            (width - 1 - x) * (height - 1) === y * (width - 1)) {
          fallback[y * width + x] = 1;
        }
      }
    }
    return serialize({width: width, height: height, formatId: formatId, glyphs: glyphs});
  }

  function decodeAllGlyphs(fontOrBytes) {
    var font = fontOrBytes && fontOrBytes.bytes ? fontOrBytes : parse(fontOrBytes);
    var glyphs = [];
    for (var i = 0; i < GLYPH_COUNT; i++) glyphs.push(decodeGlyph(font, i));
    return glyphs;
  }

  function checkedOffset(value, name) {
    var number = Number(value);
    if (!Number.isInteger(number) || number < -255 || number > 255) {
      throw new RangeError(name + " must be an integer from -255 to 255");
    }
    return number;
  }

  /** Shift one decoded glyph inside its unchanged cell and report lost pixels. */
  function shiftGlyph(pixels, width, height, offsetX, offsetY) {
    width = integerDimension(width, "width");
    height = integerDimension(height, "height");
    offsetX = checkedOffset(offsetX, "offsetX");
    offsetY = checkedOffset(offsetY, "offsetY");
    if (!pixels || pixels.length !== width * height) {
      throw new RangeError("glyph pixel array must contain width * height values");
    }
    var shifted = new Uint8Array(width * height);
    var clippedPixels = 0;
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        if (!pixels[y * width + x]) continue;
        var targetX = x + offsetX;
        var targetY = y + offsetY;
        if (targetX >= 0 && targetX < width && targetY >= 0 && targetY < height) {
          shifted[targetY * width + targetX] = 1;
        } else {
          clippedPixels++;
        }
      }
    }
    return {pixels: shifted, clippedPixels: clippedPixels};
  }

  /** Apply the same translation to all 96 glyphs without changing cell size. */
  function shiftGlyphs(glyphs, width, height, offsetX, offsetY) {
    glyphs = normalizeGlyphs(glyphs, width, height);
    var shifted = [];
    var clippedPixels = 0;
    for (var index = 0; index < glyphs.length; index++) {
      var result = shiftGlyph(glyphs[index], width, height, offsetX, offsetY);
      shifted.push(result.pixels);
      clippedPixels += result.clippedPixels;
    }
    return {glyphs: shifted, clippedPixels: clippedPixels};
  }

  return Object.freeze({
    VERSION: VERSION,
    HEADER_SIZE: HEADER_SIZE,
    GLYPH_COUNT: GLYPH_COUNT,
    FIRST_CHAR: FIRST_CHAR,
    LAST_CHAR: LAST_CHAR,
    FALLBACK_INDEX: FALLBACK_INDEX,
    FORMAT_HLSB: FORMAT_HLSB,
    FORMAT_HMSB: FORMAT_HMSB,
    FORMAT_VLSB: FORMAT_VLSB,
    CANONICAL_FORMAT: CANONICAL_FORMAT,
    glyphSize: glyphSize,
    glyphOffset: glyphOffset,
    glyphIndexForCharacter: glyphIndexForCharacter,
    parse: parse,
    validate: validate,
    encodeGlyph: encodeGlyph,
    decodeGlyph: decodeGlyph,
    decodeAllGlyphs: decodeAllGlyphs,
    shiftGlyph: shiftGlyph,
    shiftGlyphs: shiftGlyphs,
    serialize: serialize,
    createBlankFont: createBlankFont
  });
});
