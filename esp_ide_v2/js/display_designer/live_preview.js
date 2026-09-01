/**
 * ESP IDE Display Designer - safe REPL live-preview protocol.
 *
 * Only printable Python source is sent to the board. Framebuffer bytes are
 * split into small Base64 blocks, decoded by MicroPython and copied at the
 * supplied offset. No binary control characters travel through the REPL.
 */
(function(global) {
  "use strict";

  var DEFAULT_CHUNK_SIZE = 128;
  var UPDATE_DEBOUNCE_MS = 140;
  var COMMAND_DELAY_MS = 45;
  var SHOW_DELAY_MS = 65;

  function profileForLink(link) {
    if (link === "ble") {
      return {
        framebufferChunkSize: 96,
        debounceMs: 200,
        commandDelayMs: 80,
        showDelayMs: 100,
        wireChunkChars: 100,
        wireChunkGapMs: 80,
        rawCommandGapMs: 80,
        rawTimeoutMs: 10000,
        responseTimeoutMs: 10000
      };
    }
    if (link === "ws") {
      return {
        framebufferChunkSize: 128,
        debounceMs: 180,
        commandDelayMs: 55,
        showDelayMs: 80,
        wireChunkChars: 160,
        wireChunkGapMs: 8,
        rawCommandGapMs: 30,
        rawTimeoutMs: 6000,
        responseTimeoutMs: 6000
      };
    }
    return {
      framebufferChunkSize: DEFAULT_CHUNK_SIZE,
      debounceMs: UPDATE_DEBOUNCE_MS,
      commandDelayMs: COMMAND_DELAY_MS,
      showDelayMs: SHOW_DELAY_MS,
      wireChunkChars: 192,
      wireChunkGapMs: 5,
      rawCommandGapMs: 20,
      rawTimeoutMs: 8000,
      responseTimeoutMs: 8000
    };
  }

  function integer(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : fallback;
  }

  /**
   * Convert the exact black/white editor canvas into MicroPython MONO_VLSB.
   * Height is rounded up to a whole byte so future display sizes do not need
   * a protocol change.
   */
  function canvasToMonoVlsb(canvas, width, height) {
    width = Math.max(1, integer(width, canvas && canvas.width || 1));
    height = Math.max(1, integer(height, canvas && canvas.height || 1));
    var context = canvas.getContext("2d");
    var rgba = context.getImageData(0, 0, width, height).data;
    var bytes = new Uint8Array(width * Math.ceil(height / 8));
    for (var y = 0; y < height; y++) {
      var pageOffset = (y >> 3) * width;
      var bit = 1 << (y & 7);
      for (var x = 0; x < width; x++) {
        var pixel = (y * width + x) * 4;
        if (rgba[pixel] + rgba[pixel + 1] + rgba[pixel + 2] >= 384) {
          bytes[pageOffset + x] |= bit;
        }
      }
    }
    return bytes;
  }

  function bytesToBase64(bytes) {
    var binary = "";
    /* Preview chunks are deliberately small, so String.fromCharCode argument
     * limits and large intermediate strings cannot become a problem. */
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return global.btoa(binary);
  }

  function writeCommand(offset, bytes) {
    return "_espide_preview(" + integer(offset, 0) + ",'" +
        bytesToBase64(bytes) + "')";
  }

  function changedChunks(bytes, previous, chunkSize) {
    chunkSize = Math.max(1, integer(chunkSize, DEFAULT_CHUNK_SIZE));
    var chunks = [];
    for (var offset = 0; offset < bytes.length; offset += chunkSize) {
      var end = Math.min(bytes.length, offset + chunkSize);
      var changed = !previous || previous.length !== bytes.length;
      if (!changed) {
        for (var i = offset; i < end; i++) {
          if (bytes[i] !== previous[i]) {
            changed = true;
            break;
          }
        }
      }
      if (changed) chunks.push({offset: offset, bytes: bytes.slice(offset, end)});
    }
    return chunks;
  }

  /**
   * Python is installed only in RAM through raw REPL. It first looks for the
   * conventional ESP IDE globals `buffer` and `display`, then falls back to a
   * driver's `display.buffer`. Errors are reported as stable ASCII markers in
   * friendly REPL, where the browser can translate them for the user.
   */
  function buildPythonInitializerCommands(expectedSize) {
    expectedSize = Math.max(1, integer(expectedSize, 1));
    return [
      "import ubinascii as _espide_preview_b64",
      "_espide_preview_expected=" + expectedSize,
      "_espide_preview_display=globals().get('display',None)",
      "_espide_preview_buffer=globals().get('buffer',None)",
      [
        "if _espide_preview_buffer is None and _espide_preview_display is not None:",
        " _espide_preview_buffer=getattr(_espide_preview_display,'buffer',None)"
      ].join("\n"),
      "_espide_preview_show_fn=getattr(_espide_preview_display,'show',None) if _espide_preview_display is not None else None",
      "_espide_preview_state='READY'",
      [
        "if _espide_preview_buffer is None:",
        " _espide_preview_state='NO_FRAMEBUFFER'",
        "elif not callable(_espide_preview_show_fn):",
        " _espide_preview_state='NO_SHOW'",
        "else:",
        " try:",
        "  _espide_preview_actual=len(_espide_preview_buffer)",
        "  if _espide_preview_actual!=_espide_preview_expected:",
        "   _espide_preview_state='SIZE:%d:%d'%(_espide_preview_actual,_espide_preview_expected)",
        " except Exception:",
        "  _espide_preview_state='INVALID_FRAMEBUFFER'"
      ].join("\n"),
      "_espide_preview_error=None",
      [
        "def _espide_preview_status():",
        " print('@ESPIDE_PREVIEW:'+_espide_preview_state)"
      ].join("\n"),
      [
        "def _espide_preview(offset,data):",
        " global _espide_preview_error",
        " if _espide_preview_state!='READY' or _espide_preview_error is not None:",
        "  return",
        " try:",
        "  raw=_espide_preview_b64.a2b_base64(data)",
        "  end=offset+len(raw)",
        "  if offset<0 or end>_espide_preview_expected:",
        "   _espide_preview_error='RANGE'",
        "  else:",
        "   _espide_preview_buffer[offset:end]=raw",
        " except Exception:",
        "  _espide_preview_error='DATA'"
      ].join("\n"),
      [
        "def _espide_preview_show():",
        " global _espide_preview_error",
        " if _espide_preview_state!='READY':",
        "  print('@ESPIDE_PREVIEW:'+_espide_preview_state)",
        " elif _espide_preview_error is not None:",
        "  print('@ESPIDE_PREVIEW:ERROR:'+_espide_preview_error)",
        "  _espide_preview_error=None",
        " else:",
        "  try:",
        "   _espide_preview_show_fn()",
        "   print('@ESPIDE_PREVIEW:OK')",
        "  except Exception:",
        "   print('@ESPIDE_PREVIEW:ERROR:SHOW')"
      ].join("\n")
    ];
  }

  function buildPythonInitializer(expectedSize) {
    return buildPythonInitializerCommands(expectedSize).join("\n");
  }

  function parseStatus(buffer) {
    var matches = String(buffer || "").match(/@ESPIDE_PREVIEW:([^\r\n]+)/g);
    if (!matches || !matches.length) return null;
    return matches[matches.length - 1].slice("@ESPIDE_PREVIEW:".length);
  }

  global.ESPIDE_DISPLAY_LIVE_PREVIEW = {
    DEFAULT_CHUNK_SIZE: DEFAULT_CHUNK_SIZE,
    UPDATE_DEBOUNCE_MS: UPDATE_DEBOUNCE_MS,
    COMMAND_DELAY_MS: COMMAND_DELAY_MS,
    SHOW_DELAY_MS: SHOW_DELAY_MS,
    profileForLink: profileForLink,
    canvasToMonoVlsb: canvasToMonoVlsb,
    changedChunks: changedChunks,
    writeCommand: writeCommand,
    buildPythonInitializerCommands: buildPythonInitializerCommands,
    buildPythonInitializer: buildPythonInitializer,
    parseStatus: parseStatus
  };
})(window);
