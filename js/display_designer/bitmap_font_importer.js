/**
 * Lossless bitmap-font importers for the ESP IDE MFNT editor.
 *
 * Supported inputs:
 *   - Adobe BDF text fonts
 *   - Linux console PSF1 and PSF2 fonts, including Unicode tables
 *
 * Every parser returns the same fixed-cell, row-major 0/1 glyph arrays used by
 * mfnt_codec.js. Binary MFNT packing stays in the codec and is never duplicated
 * here. This module has no DOM dependency and is regression-testable in Node.
 */
(function(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ESPIDE_BITMAP_FONT_IMPORTER = api;
})(typeof window !== "undefined" ? window : this, function() {
  "use strict";

  var FIRST_CHAR = 32;
  var LAST_CHAR = 126;
  var GLYPH_COUNT = 96;
  var FALLBACK_INDEX = 95;
  var PSF1_MAGIC_0 = 0x36;
  var PSF1_MAGIC_1 = 0x04;
  var PSF2_MAGIC = [0x72, 0xb5, 0x4a, 0x86];

  function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError("Font data must be an ArrayBuffer or Uint8Array");
  }

  function checkedDimension(value, name) {
    var number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 64) {
      throw new RangeError(name + " must be an integer from 1 to 64");
    }
    return number;
  }

  function blankPixels(width, height) {
    return new Uint8Array(width * height);
  }

  function generatedFallback(width, height) {
    var pixels = blankPixels(width, height);
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

  function copyPixels(pixels) {
    return new Uint8Array(pixels);
  }

  /** Build printable ASCII plus one explicit fallback from a Unicode map. */
  function normalizeGlyphMap(glyphMap, width, height, warnings) {
    var fallback = glyphMap.get(0xfffd) || glyphMap.get(63) || generatedFallback(width, height);
    var glyphs = [];
    var missing = [];
    for (var code = FIRST_CHAR; code <= LAST_CHAR; code++) {
      if (code === 32) {
        glyphs.push(blankPixels(width, height));
      } else if (glyphMap.has(code)) {
        glyphs.push(copyPixels(glyphMap.get(code)));
      } else {
        glyphs.push(copyPixels(fallback));
        missing.push(code);
      }
    }
    glyphs.push(copyPixels(fallback));
    if (missing.length) {
      warnings.push("Missing " + missing.length + " printable ASCII glyphs; fallback substituted");
    }
    return glyphs;
  }

  function decodeText(value) {
    if (typeof value === "string") return value;
    return new TextDecoder("utf-8").decode(asBytes(value));
  }

  function parseIntegers(value) {
    return String(value || "").trim().split(/\s+/).filter(Boolean).map(Number);
  }

  function parseBdf(value) {
    var text = decodeText(value).replace(/\r\n?/g, "\n");
    if (!/^STARTFONT\s+/m.test(text)) throw new Error("Invalid BDF header");
    var lines = text.split("\n");
    var fontBox = null;
    var fontName = "BDF font";
    var records = [];
    var current = null;
    var readingBitmap = false;

    function finishGlyph() {
      if (!current) return;
      if (current.encoding != null && current.bbx) records.push(current);
      current = null;
      readingBitmap = false;
    }

    for (var index = 0; index < lines.length; index++) {
      var line = lines[index].trim();
      if (!line) continue;
      if (line.indexOf("FONTBOUNDINGBOX ") === 0 && !current) {
        var box = parseIntegers(line.substring(16));
        if (box.length >= 4) fontBox = box.slice(0, 4);
      } else if (line.indexOf("FAMILY_NAME ") === 0 && !current) {
        fontName = line.substring(12).trim().replace(/^"|"$/g, "") || fontName;
      } else if (line.indexOf("FONT ") === 0 && fontName === "BDF font") {
        fontName = line.substring(5).trim() || fontName;
      } else if (line.indexOf("STARTCHAR") === 0) {
        finishGlyph();
        current = {encoding: null, bbx: null, bitmap: [], dwidth: null};
      } else if (line === "ENDCHAR") {
        finishGlyph();
      } else if (current && line.indexOf("ENCODING ") === 0) {
        var encodings = parseIntegers(line.substring(9));
        current.encoding = encodings[0] >= 0 ? encodings[0] : encodings[1];
      } else if (current && line.indexOf("BBX ") === 0) {
        current.bbx = parseIntegers(line.substring(4)).slice(0, 4);
      } else if (current && line.indexOf("DWIDTH ") === 0) {
        current.dwidth = parseIntegers(line.substring(7))[0];
      } else if (current && line === "BITMAP") {
        readingBitmap = true;
      } else if (current && readingBitmap) {
        if (!/^[0-9a-fA-F]*$/.test(line)) throw new Error("Invalid BDF bitmap row");
        current.bitmap.push(line);
      }
    }
    finishGlyph();
    if (!fontBox || fontBox.length < 4) throw new Error("BDF FONTBOUNDINGBOX is missing");

    var width = checkedDimension(fontBox[0], "BDF width");
    var height = checkedDimension(fontBox[1], "BDF height");
    var fontX = Number(fontBox[2]) || 0;
    var fontY = Number(fontBox[3]) || 0;
    var glyphMap = new Map();
    var warnings = [];
    var clipped = 0;
    var advances = Object.create(null);

    records.forEach(function(record) {
      var glyphWidth = Number(record.bbx[0]) || 0;
      var glyphHeight = Number(record.bbx[1]) || 0;
      var glyphX = Number(record.bbx[2]) || 0;
      var glyphY = Number(record.bbx[3]) || 0;
      if (glyphWidth < 0 || glyphHeight < 0 || glyphWidth > 255 || glyphHeight > 255) {
        throw new Error("Invalid BDF BBX for encoding " + record.encoding);
      }
      if (record.dwidth != null) advances[record.dwidth] = true;
      var rowBytes = Math.ceil(glyphWidth / 8);
      if (record.bitmap.length < glyphHeight) {
        throw new Error("Incomplete BDF bitmap for encoding " + record.encoding);
      }
      var pixels = blankPixels(width, height);
      var targetX = glyphX - fontX;
      var targetY = fontY + height - glyphY - glyphHeight;
      for (var y = 0; y < glyphHeight; y++) {
        var hex = record.bitmap[y] || "";
        if (hex.length < rowBytes * 2) {
          throw new Error("Short BDF bitmap row for encoding " + record.encoding);
        }
        var row = [];
        for (var byteIndex = 0; byteIndex < rowBytes; byteIndex++) {
          row.push(parseInt(hex.substring(byteIndex * 2, byteIndex * 2 + 2), 16));
        }
        for (var x = 0; x < glyphWidth; x++) {
          if (!(row[Math.floor(x / 8)] & (0x80 >> (x % 8)))) continue;
          var destinationX = targetX + x;
          var destinationY = targetY + y;
          if (destinationX >= 0 && destinationX < width && destinationY >= 0 && destinationY < height) {
            pixels[destinationY * width + destinationX] = 1;
          } else {
            clipped++;
          }
        }
      }
      if (!glyphMap.has(record.encoding)) glyphMap.set(record.encoding, pixels);
    });

    if (Object.keys(advances).length > 1) {
      warnings.push("Proportional BDF advances were normalized to one fixed cell");
    }
    if (clipped) warnings.push(clipped + " BDF pixels outside FONTBOUNDINGBOX were clipped");
    return {
      sourceFormat: "BDF",
      name: fontName,
      width: width,
      height: height,
      glyphs: normalizeGlyphMap(glyphMap, width, height, warnings),
      warnings: warnings
    };
  }

  function directIndexMap(glyphPixels) {
    var map = new Map();
    for (var code = 0; code < glyphPixels.length; code++) map.set(code, glyphPixels[code]);
    return map;
  }

  function decodePsf1Unicode(bytes, offset, glyphCount, glyphPixels) {
    var map = new Map();
    var glyphIndex = 0;
    var sequence = false;
    while (glyphIndex < glyphCount && offset + 1 < bytes.length) {
      var value = bytes[offset] | (bytes[offset + 1] << 8);
      offset += 2;
      if (value === 0xffff) {
        glyphIndex++;
        sequence = false;
      } else if (value === 0xfffe) {
        sequence = true;
      } else if (!sequence && !map.has(value)) {
        map.set(value, glyphPixels[glyphIndex]);
      }
    }
    return map;
  }

  function parsePsf1(bytes) {
    if (bytes.length < 4 || bytes[0] !== PSF1_MAGIC_0 || bytes[1] !== PSF1_MAGIC_1) {
      throw new Error("Invalid PSF1 magic");
    }
    var mode = bytes[2];
    var height = checkedDimension(bytes[3], "PSF1 height");
    var width = 8;
    var glyphCount = mode & 0x01 ? 512 : 256;
    var dataEnd = 4 + glyphCount * height;
    if (dataEnd > bytes.length) throw new Error("Truncated PSF1 glyph data");
    var glyphPixels = [];
    for (var glyphIndex = 0; glyphIndex < glyphCount; glyphIndex++) {
      var pixels = blankPixels(width, height);
      var start = 4 + glyphIndex * height;
      for (var y = 0; y < height; y++) {
        var row = bytes[start + y];
        for (var x = 0; x < width; x++) pixels[y * width + x] = row & (0x80 >> x) ? 1 : 0;
      }
      glyphPixels.push(pixels);
    }
    var warnings = [];
    var glyphMap = mode & 0x02 ?
        decodePsf1Unicode(bytes, dataEnd, glyphCount, glyphPixels) : directIndexMap(glyphPixels);
    if (mode & 0x02 && glyphMap.size === 0) warnings.push("PSF1 Unicode table is empty");
    return {
      sourceFormat: "PSF1",
      name: "PSF1 font",
      width: width,
      height: height,
      glyphs: normalizeGlyphMap(glyphMap, width, height, warnings),
      warnings: warnings
    };
  }

  function readUint32(view, offset, name) {
    if (offset + 4 > view.byteLength) throw new Error("Truncated PSF2 " + name);
    return view.getUint32(offset, true);
  }

  function decodePsf2Unicode(bytes, offset, glyphCount, glyphPixels) {
    var map = new Map();
    var decoder = new TextDecoder("utf-8");
    for (var glyphIndex = 0; glyphIndex < glyphCount && offset < bytes.length; glyphIndex++) {
      var end = offset;
      while (end < bytes.length && bytes[end] !== 0xff) end++;
      var sequenceStart = offset;
      while (sequenceStart < end && bytes[sequenceStart] !== 0xfe) sequenceStart++;
      var direct = bytes.subarray(offset, sequenceStart);
      var characters = decoder.decode(direct);
      for (var character of characters) {
        var code = character.codePointAt(0);
        if (!map.has(code)) map.set(code, glyphPixels[glyphIndex]);
      }
      offset = end + 1;
    }
    return map;
  }

  function parsePsf2(bytes) {
    if (bytes.length < 32 || !PSF2_MAGIC.every(function(value, index) { return bytes[index] === value; })) {
      throw new Error("Invalid PSF2 magic");
    }
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var headerSize = readUint32(view, 8, "header size");
    var flags = readUint32(view, 12, "flags");
    var glyphCount = readUint32(view, 16, "glyph count");
    var glyphSize = readUint32(view, 20, "glyph size");
    var height = checkedDimension(readUint32(view, 24, "height"), "PSF2 height");
    var width = checkedDimension(readUint32(view, 28, "width"), "PSF2 width");
    if (headerSize < 32 || headerSize > bytes.length) throw new Error("Invalid PSF2 header size");
    if (!glyphCount || glyphCount > 0x100000) throw new Error("Invalid PSF2 glyph count");
    var rowBytes = Math.ceil(width / 8);
    if (glyphSize < rowBytes * height) throw new Error("PSF2 glyph size is too small");
    var dataEnd = headerSize + glyphCount * glyphSize;
    if (dataEnd > bytes.length) throw new Error("Truncated PSF2 glyph data");

    var glyphPixels = [];
    for (var glyphIndex = 0; glyphIndex < glyphCount; glyphIndex++) {
      var pixels = blankPixels(width, height);
      var start = headerSize + glyphIndex * glyphSize;
      for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
          pixels[y * width + x] = bytes[start + y * rowBytes + Math.floor(x / 8)] &
              (0x80 >> (x % 8)) ? 1 : 0;
        }
      }
      glyphPixels.push(pixels);
    }
    var warnings = [];
    var glyphMap = flags & 0x01 ?
        decodePsf2Unicode(bytes, dataEnd, glyphCount, glyphPixels) : directIndexMap(glyphPixels);
    if (flags & 0x01 && glyphMap.size === 0) warnings.push("PSF2 Unicode table is empty");
    return {
      sourceFormat: "PSF2",
      name: "PSF2 font",
      width: width,
      height: height,
      glyphs: normalizeGlyphMap(glyphMap, width, height, warnings),
      warnings: warnings
    };
  }

  function parsePsf(value) {
    var bytes = asBytes(value);
    if (bytes[0] === PSF1_MAGIC_0 && bytes[1] === PSF1_MAGIC_1) return parsePsf1(bytes);
    if (PSF2_MAGIC.every(function(magic, index) { return bytes[index] === magic; })) return parsePsf2(bytes);
    throw new Error("Unknown PSF version");
  }

  function parse(value, fileName) {
    var bytes = asBytes(value);
    var lowerName = String(fileName || "").toLowerCase();
    if (bytes[0] === PSF1_MAGIC_0 && bytes[1] === PSF1_MAGIC_1) return parsePsf1(bytes);
    if (PSF2_MAGIC.every(function(magic, index) { return bytes[index] === magic; })) return parsePsf2(bytes);
    var start = new TextDecoder("ascii").decode(bytes.subarray(0, Math.min(bytes.length, 80)));
    if (lowerName.endsWith(".bdf") || /^STARTFONT\s+/m.test(start)) return parseBdf(bytes);
    throw new Error("Unsupported bitmap font format");
  }

  return Object.freeze({
    parse: parse,
    parseBdf: parseBdf,
    parsePsf: parsePsf,
    parsePsf1: parsePsf1,
    parsePsf2: parsePsf2,
    generatedFallback: generatedFallback
  });
});
