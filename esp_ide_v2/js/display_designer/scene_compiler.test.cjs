"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bitmap = require("./bitmap_codec.js");
const mfnt = require("./mfnt_codec.js");
const compiler = require("./scene_compiler.js");

function base64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function pixel(bytes, x, y, width = 128) {
  return (bytes[(y >> 3) * width + x] >> (y & 7)) & 1;
}

function testFont() {
  const blank = mfnt.createBlankFont(2, 3);
  const glyphs = mfnt.decodeAllGlyphs(blank);
  glyphs[mfnt.glyphIndexForCharacter("A")] = Uint8Array.from([
    1, 0,
    1, 1,
    1, 0
  ]);
  return base64(mfnt.serialize({width: 2, height: 3,
    formatId: mfnt.FORMAT_HLSB, glyphs}));
}

test("compiles ordered static layers into an exact MONO_VLSB framebuffer", () => {
  const sourceBitmap = bitmap.pack(Uint8Array.from([1, 0, 0, 1]), 2, 2);
  const scene = {
    fonts: [{id: "font-1", data: testFont()}],
    layers: [
      {id: "rect-1", type: "rect", x: 0, y: 0, width: 3, height: 3,
        filled: false, visible: true},
      {id: "line-1", type: "line", x1: 4, y1: 0, x2: 6, y2: 2, visible: true},
      {id: "ellipse-1", type: "ellipse", x: 8, y: 0, width: 4, height: 4,
        filled: true, visible: true},
      {id: "text-1", type: "text", x: 13, y: 0, text: "AA", fontId: "font-1",
        parameterId: null, visible: true},
      {id: "bitmap-1", type: "bitmap", x: 20, y: 0, width: 2, height: 2,
        data: base64(sourceBitmap), visible: true},
      {id: "hidden", type: "rect", x: 30, y: 0, width: 2, height: 2,
        filled: true, visible: false},
      {id: "dynamic", type: "text", x: 40, y: 0, text: "A", fontId: "font-1",
        parameterId: "temperature", visible: true}
    ]
  };
  const result = compiler.compileStaticFramebuffer(scene);

  assert.equal(result.bytes.length, 1024);
  assert.equal(pixel(result.bytes, 0, 0), 1);
  assert.equal(pixel(result.bytes, 1, 1), 0);
  assert.equal(pixel(result.bytes, 5, 1), 1);
  assert.equal(pixel(result.bytes, 9, 1), 1);
  assert.equal(pixel(result.bytes, 13, 0), 1);
  assert.equal(pixel(result.bytes, 16, 0), 1, "text keeps the mandatory 1px gap");
  assert.equal(pixel(result.bytes, 20, 0), 1);
  assert.equal(pixel(result.bytes, 21, 1), 1);
  assert.equal(pixel(result.bytes, 30, 0), 0);
  assert.equal(pixel(result.bytes, 40, 0), 0);
  assert.deepEqual(result.dynamicLayers.map(layer => layer.id), ["dynamic"]);
});

test("compiles a 400x300 scene using the same MONO_VLSB addressing", () => {
  const scene = {
    width: 400,
    height: 300,
    fonts: [],
    layers: [{id: "edge", type: "rect", x: 399, y: 299,
      width: 1, height: 1, filled: true, visible: true}]
  };
  const result = compiler.compileStaticFramebuffer(scene);
  assert.equal(result.bytes.length, 400 * Math.ceil(300 / 8));
  assert.equal(result.framebufferSize, 15200);
  assert.equal(pixel(result.bytes, 399, 299, 400), 1);
  assert.equal(result.bytes[(299 >> 3) * 400 + 399], 1 << (299 & 7));
});

test("clears glyph pixels for inverse static text", () => {
  const scene = {
    fonts: [{id: "font-1", data: testFont()}],
    layers: [
      {id: "background", type: "rect", x: 0, y: 0, width: 3, height: 3,
        filled: true, visible: true},
      {id: "inverse", type: "text", x: 0, y: 0, text: "A",
        fontId: "font-1", inverted: true, visible: true}
    ]
  };
  const result = compiler.compileStaticFramebuffer(scene);

  assert.equal(pixel(result.bytes, 0, 0), 0, "black glyph clears white background");
  assert.equal(pixel(result.bytes, 1, 0), 1, "transparent glyph background stays white");
  assert.equal(pixel(result.bytes, 1, 1), 0, "second black glyph pixel is cleared");
  assert.equal(pixel(result.bytes, 2, 1), 1, "pixels outside the glyph stay untouched");
});

test("composites explicit black shapes and bitmap masks over white layers", () => {
  const sourceBitmap = bitmap.pack(Uint8Array.from([1, 0]), 2, 1);
  const scene = {fonts: [], layers: [
    {id: "background", type: "rect", x: 0, y: 0, width: 8, height: 4,
      filled: true, color: 1, visible: true},
    {id: "black-rect", type: "rect", x: 1, y: 1, width: 2, height: 2,
      filled: true, color: 0, visible: true},
    {id: "black-mask", type: "bitmap", x: 5, y: 1, width: 2, height: 1,
      data: base64(sourceBitmap), color: 0, transparent: true, visible: true}
  ]};
  const result = compiler.compileStaticFramebuffer(scene);

  assert.equal(pixel(result.bytes, 0, 0), 1);
  assert.equal(pixel(result.bytes, 1, 1), 0);
  assert.equal(pixel(result.bytes, 2, 2), 0);
  assert.equal(pixel(result.bytes, 5, 1), 0, "set source bit is drawn black");
  assert.equal(pixel(result.bytes, 6, 1), 1, "clear source bit stays transparent");
});

test("keeps white, black and transparent pixels in one drawing layer", () => {
  const white = new Uint8Array(bitmap.byteLength(128, 64));
  const black = new Uint8Array(white.length);
  bitmap.setPixel(white, 128, 1, 1, 1);
  bitmap.setPixel(black, 128, 2, 1, 1);
  const drawing = {
    id: "drawing", type: "bitmap", kind: "drawing",
    x: 0, y: 0, width: 128, height: 64,
    data: base64(white), blackData: base64(black),
    transparent: true, bindings: {visible: true}, visible: true
  };
  const staticScene = {fonts: [], layers: [
    {id: "background", type: "rect", x: 0, y: 0, width: 4, height: 3,
      filled: true, color: 1, visible: true},
    Object.assign({}, drawing, {bindings: {}})
  ]};
  const result = compiler.compileStaticFramebuffer(staticScene);
  const plans = compiler.compileLayerRasterPlans(
      {fonts: [], layers: [drawing]}, drawing);

  assert.equal(pixel(result.bytes, 1, 1), 1);
  assert.equal(pixel(result.bytes, 2, 1), 0);
  assert.equal(pixel(result.bytes, 3, 1), 1, "untouched pixel stays transparent");
  assert.equal(plans.length, 2);
  assert.deepEqual(plans.map(plan => plan.key), [0, 1]);
});

test("clips negative and off-screen static objects only at the 128x64 target", () => {
  const scene = {fonts: [], layers: [
    {id: "partial", type: "rect", x: -2, y: -1, width: 4, height: 3,
      filled: true, visible: true},
    {id: "outside", type: "rect", x: 130, y: 10, width: 4, height: 4,
      filled: true, visible: true}
  ]};
  const result = compiler.compileStaticFramebuffer(scene);

  assert.equal(pixel(result.bytes, 0, 0), 1);
  assert.equal(pixel(result.bytes, 1, 0), 1);
  assert.equal(pixel(result.bytes, 2, 0), 0);
  assert.equal(pixel(result.bytes, 0, 1), 1);
  assert.equal(result.bytes.reduce((sum, value) => sum + value, 0), 6);
});

test("rasterizes rounded rectangles and thick lines without antialiasing", () => {
  const scene = {fonts: [], layers: [
    {id: "rounded", type: "rect", x: 0, y: 0, width: 8, height: 8,
      radius: 3, filled: false, visible: true},
    {id: "rounded-filled", type: "rect", x: 20, y: 0, width: 8, height: 8,
      radius: 3, filled: true, visible: true},
    {id: "thick", type: "line", x1: 12, y1: 2, x2: 14, y2: 2,
      strokeWidth: 3, visible: true}
  ]};
  const result = compiler.compileStaticFramebuffer(scene);

  assert.equal(pixel(result.bytes, 0, 0), 0, "rounded corner stays empty");
  assert.equal(pixel(result.bytes, 1, 0), 1, "rounded top edge starts after corner");
  assert.equal(pixel(result.bytes, 3, 3), 0, "outline does not fill the interior");
  assert.equal(pixel(result.bytes, 20, 0), 0, "filled rounded corner stays empty");
  assert.equal(pixel(result.bytes, 23, 3), 1, "filled rounded interior is lit");
  for (let y = 1; y <= 3; y++) {
    for (let x = 11; x <= 15; x++) {
      assert.equal(pixel(result.bytes, x, y), 1, `thick line pixel ${x},${y}`);
    }
  }
  assert.equal(pixel(result.bytes, 10, 2), 0);
  assert.equal(pixel(result.bytes, 16, 2), 0);
});

test("keeps the complete thick-line bitmap outside the display bounds", () => {
  const layer = {id: "wide", type: "line", x1: 0, y1: 10, x2: 127, y2: 10,
    strokeWidth: 5, visible: true};
  const raster = compiler.compileLayerBitmap({fonts: [], layers: [layer]}, layer);

  assert.deepEqual(
      {x: raster.x, y: raster.y, width: raster.width, height: raster.height},
      {x: -2, y: 8, width: 132, height: 5});
  assert.equal(raster.bytes.length, 132);
});

test("creates the default fast buffer-copy Python plan", () => {
  const scene = {fonts: [], layers: [
    {id: "rect-1", type: "rect", x: 0, y: 0, width: 2, height: 2,
      filled: true, visible: true}
  ]};
  const plan = compiler.createPythonPlan(scene, {
    suffix: "block-1", symbol: "s0", precompute: true
  });

  assert.equal(plan.definitions.length, 1);
  assert.match(plan.definitions[0].code, /^_espide_s0_scene = \(\n/);
  assert.equal(plan.code, "buffer[:] = _espide_s0_scene\n");
  assert.equal(plan.bytes.length, 1024);
});

test("clears dynamic-only scenes without embedding a zero framebuffer", () => {
  const scene = {fonts: [], layers: [
    {id: "dynamic", type: "rect", x: 1, y: 2, width: 3, height: 4,
      filled: true, bindings: {x: true}, visible: true}
  ]};
  const plan = compiler.createPythonPlan(scene, {
    suffix: "dynamic-only", symbol: "s0", precompute: true,
    dynamicValues: {dynamic: {x: "sensor_x"}}
  });

  assert.equal(plan.hasStaticPixels, false);
  assert.equal(plan.code,
      "fbuf.fill(0)\nfbuf.fill_rect(int(sensor_x), 2, 3, 4, 1)\n");
  assert.equal(plan.definitions.length, 0);
  assert.doesNotMatch(plan.code, /buffer\[:\]|_espide_load_scene/);
});

test("opaque bitmap black pixels clear lower static layers", () => {
  const sourceBitmap = bitmap.pack(Uint8Array.from([1, 0, 0, 1]), 2, 2);
  const scene = {fonts: [], layers: [
    {id: "background", type: "rect", x: 0, y: 0, width: 4, height: 2,
      filled: true, visible: true},
    {id: "transparent", type: "bitmap", x: 0, y: 0, width: 2, height: 2,
      data: base64(sourceBitmap), transparent: true, visible: true},
    {id: "opaque", type: "bitmap", x: 2, y: 0, width: 2, height: 2,
      data: base64(sourceBitmap), transparent: false, visible: true}
  ]};
  const result = compiler.compileStaticFramebuffer(scene);

  assert.equal(pixel(result.bytes, 0, 0), 1);
  assert.equal(pixel(result.bytes, 1, 0), 1, "transparent black keeps background");
  assert.equal(pixel(result.bytes, 0, 1), 1, "transparent black keeps background");
  assert.equal(pixel(result.bytes, 2, 0), 1);
  assert.equal(pixel(result.bytes, 3, 0), 0, "opaque black clears background");
  assert.equal(pixel(result.bytes, 2, 1), 0, "opaque black clears background");
  assert.equal(pixel(result.bytes, 3, 1), 1);
});

test("creates readable layer commands when precomputation is disabled", () => {
  const sourceBitmap = bitmap.pack(Uint8Array.from([1]), 1, 1);
  const scene = {fonts: [], layers: [
    {id: "rect-1", type: "rect", x: 1, y: 2, width: 3, height: 4,
      filled: false, color: 0, visible: true},
    {id: "line-1", type: "line", x1: 0, y1: 0, x2: 2, y2: 2, visible: true},
    {id: "bitmap-1", type: "bitmap", x: 5, y: 6, width: 1, height: 1,
      data: base64(sourceBitmap), transparent: true, visible: true},
    {id: "bitmap-2", type: "bitmap", x: 7, y: 8, width: 1, height: 1,
      data: base64(sourceBitmap), transparent: false, visible: true}
  ]};
  const plan = compiler.createPythonPlan(scene, {
    suffix: "block-2", symbol: "s1", precompute: false
  });

  assert.match(plan.code, /^fbuf\.fill\(0\)/);
  assert.match(plan.code, /fbuf\.rect\(1, 2, 3, 4, 0\)/);
  assert.match(plan.code, /fbuf\.line\(0, 0, 2, 2, 1\)/);
  assert.match(plan.code, /fbuf\.blit\(_espide_s1_l0, 5, 6, 0\)/);
  assert.match(plan.code, /fbuf\.blit\(_espide_s1_l1, 7, 8, -1\)/);
  assert.equal(plan.definitions[0].code, "import framebuf");
  assert.match(plan.definitions.map(item => item.code).join("\n"),
      /framebuf\.MONO_VLSB/);
});

test("uses raster blits for dynamic rounded rectangles and thick lines", () => {
  const scene = {fonts: [], layers: [
    {id: "rounded", type: "rect", x: 2, y: 3, width: 10, height: 8,
      radius: 3, filled: false, bindings: {x: true}, visible: true},
    {id: "thick", type: "line", x1: 10, y1: 20, x2: 12, y2: 20,
      strokeWidth: 5, bindings: {y: true}, visible: true}
  ]};
  const plan = compiler.createPythonPlan(scene, {
    suffix: "raster-dynamic", symbol: "s0", precompute: true,
    dynamicValues: {
      rounded: {x: "target_x"},
      thick: {y: "target_y"}
    }
  });
  const definitions = plan.definitions.map(item => item.code).join("\n");

  assert.match(definitions, /framebuf\.FrameBuffer\([^,]+, 10, 8, framebuf\.MONO_VLSB\)/);
  assert.match(definitions, /framebuf\.FrameBuffer\([^,]+, 7, 5, framebuf\.MONO_VLSB\)/);
  assert.match(plan.code, /fbuf\.blit\(_espide_s0_d0, int\(target_x\), 3, 0\)/);
  assert.match(plan.code, /fbuf\.blit\(_espide_s0_d1, 8, int\(target_y\) - 2, 0\)/);
  assert.doesNotMatch(plan.code, /fbuf\.(?:rect|fill_rect|line)\(/);
});

test("packs direct-mode text as a width-safe MONO_VLSB framebuffer", () => {
  const blank = mfnt.createBlankFont(5, 8);
  const glyphs = mfnt.decodeAllGlyphs(blank);
  const glyph = new Uint8Array(5 * 8);
  for (let y = 0; y < 8; y++) {
    glyph[y * 5 + (y % 5)] = 1;
  }
  glyphs[mfnt.glyphIndexForCharacter("A")] = glyph;
  const fontData = mfnt.serialize({
    width: 5, height: 8, formatId: mfnt.FORMAT_HLSB, glyphs
  });
  const scene = {
    fonts: [{id: "font-5x8", data: base64(fontData)}],
    layers: [{
      id: "text", type: "text", x: -7, y: -3, width: 53, height: 8,
      text: "AAAAAAAAA", fontId: "font-5x8", visible: true
    }]
  };

  const raster = compiler.compileLayerBitmap(scene, scene.layers[0]);
  const plan = compiler.createPythonPlan(scene, {
    suffix: "direct-text", symbol: "s2", precompute: false
  });

  assert.equal(raster.width, 53);
  assert.equal(raster.height, 8);
  assert.equal(raster.bytes.length, 53,
      "53x8 VLSB occupies 53 bytes without horizontal row padding");
  assert.equal((raster.bytes[0] >> 0) & 1, 1);
  assert.equal((raster.bytes[1] >> 1) & 1, 1);
  assert.equal((raster.bytes[5] >> 0) & 1, 0, "mandatory glyph gap stays blank");
  assert.match(plan.definitions.map(item => item.code).join("\n"),
      /FrameBuffer\(_espide_s2_l0_data, 53, 8, framebuf\.MONO_VLSB\)/);
  assert.match(plan.code, /fbuf\.blit\(_espide_s2_l0, -7, -3, 0\)/);
});

test("zero-fills the unused bits in a partial MONO_VLSB page", () => {
  const source = bitmap.pack(new Uint8Array(3 * 5).fill(1), 3, 5);
  const layer = {
    id: "partial-page",
    type: "bitmap",
    x: -1,
    y: 62,
    width: 3,
    height: 5,
    data: base64(source),
    transparent: true,
    visible: true
  };
  const raster = compiler.compileLayerBitmap(
      {fonts: [], layers: [layer]}, layer);

  assert.equal(raster.x, -1);
  assert.equal(raster.y, 62);
  assert.equal(raster.bytes.length, 3,
      "3x5 VLSB reserves one complete 8-pixel page");
  assert.deepEqual(Array.from(raster.bytes), [0x1f, 0x1f, 0x1f],
      "the three unused high bits in every column remain empty");
});

test("packs scenes as a 16-byte header followed by fixed raw framebuffers", () => {
  const scenes = [
    {fonts: [], layers: [
      {id: "left", type: "rect", x: 0, y: 0, width: 1, height: 1,
        filled: true, visible: true}
    ]},
    {fonts: [], layers: [
      {id: "right", type: "rect", x: 127, y: 63, width: 1, height: 1,
        filled: true, visible: true}
    ]}
  ];
  const pack = compiler.buildScenePack(scenes);
  const header = Buffer.from(pack.bytes.subarray(0, 16));

  assert.equal(pack.bytes.length, 16 + 2 * 1024);
  assert.equal(header.subarray(0, 4).toString("ascii"), "ESCN");
  assert.equal(header[4], 1);
  assert.equal(header[5], 1);
  assert.equal(header.readUInt16LE(6), 2);
  assert.equal(header.readUInt32LE(8), pack.buildId);
  assert.equal(header.readUInt16LE(12), 1024);
  assert.equal(header.readUInt16LE(14), 16);
  assert.equal(pack.bytes[16], 1, "scene 0 starts directly after the header");
  assert.equal(pack.bytes[16 + 1024 + 7 * 128 + 127], 0x80,
      "scene 1 starts at 16 + (1 << 10)");
  assert.equal(compiler.buildScenePack(scenes).buildId, pack.buildId);
});

test("omits empty static scenes from the raw scene pack", () => {
  const scenes = [
    {fonts: [], layers: []},
    {fonts: [], layers: [
      {id: "dynamic", type: "rect", x: 1, y: 1, width: 2, height: 2,
        filled: true, bindings: {x: true}, visible: true}
    ]},
    {fonts: [], layers: [
      {id: "static-a", type: "rect", x: 0, y: 0, width: 1, height: 1,
        filled: true, visible: true}
    ]},
    {fonts: [], layers: [
      {id: "off-screen", type: "rect", x: 200, y: 200, width: 2, height: 2,
        filled: true, visible: true}
    ]},
    {fonts: [], layers: [
      {id: "static-b", type: "rect", x: 127, y: 63, width: 1, height: 1,
        filled: true, visible: true}
    ]}
  ];
  const pack = compiler.buildScenePack(scenes);

  assert.equal(pack.sceneCount, 2);
  assert.deepEqual(pack.sceneRecordIndexes, [-1, -1, 0, -1, 1]);
  assert.equal(pack.bytes.length, 16 + 2 * 1024);
  assert.equal(pack.bytes[16], 1);
  assert.equal(pack.bytes[16 + 1024 + 7 * 128 + 127], 0x80);
});

test("packs adaptive scenes with their actual record size and rejects mixed sizes", () => {
  const scene = {width: 400, height: 300, fonts: [], layers: [
    {id: "edge", type: "rect", x: 399, y: 299, width: 1, height: 1,
      filled: true, visible: true}
  ]};
  const pack = compiler.buildScenePack([scene]);
  const header = Buffer.from(pack.bytes.subarray(0, 16));
  assert.equal(pack.framebufferSize, 15200);
  assert.equal(header.readUInt16LE(12), 15200);
  assert.equal(pack.bytes.length, 16 + 15200);
  assert.throws(() => compiler.buildScenePack([
    scene,
    {width: 128, height: 64, fonts: [], layers: []}
  ]), /same resolution/);
});

test("creates a direct readinto loader for file-backed scenes", () => {
  const scene = {fonts: [], layers: [
    {id: "static", type: "rect", x: 0, y: 0, width: 1, height: 1,
      filled: true, visible: true}
  ]};
  const plan = compiler.createPythonPlan(scene, {
    suffix: "block-file",
    sceneFileIndex: 1,
    fileStorage: true,
    sceneIndex: 3,
    sceneCount: 2,
    buildId: 0xfedcba98
  });

  assert.equal(plan.definitions.length, 1);
  assert.match(plan.definitions[0].code, /open\('\/gfx\/scene\.dat', 'rb'\)/);
  assert.match(plan.definitions[0].code, /seek\(16 \+ index \* 1024\)/);
  assert.match(plan.definitions[0].code, /readinto\(buffer\)/);
  assert.doesNotMatch(plan.definitions[0].code, /import struct/);
  assert.equal(plan.code, "_espide_load_scene(1)\n");
  assert.doesNotMatch(plan.code, /\\x/);
});

test("file loader uses the adaptive framebuffer record size", () => {
  const scene = {width: 400, height: 300, fonts: [], layers: [
    {id: "static", type: "rect", x: 0, y: 0, width: 1, height: 1,
      filled: true, visible: true}
  ]};
  const plan = compiler.createPythonPlan(scene, {
    fileStorage: true, sceneFileIndex: 0, sceneCount: 1, buildId: 1
  });
  assert.match(plan.definitions[0].code, /!= 15200/);
  assert.match(plan.definitions[0].code, /seek\(16 \+ index \* 15200\)/);
});

test("collects referenced non-default MFNT files once", () => {
  const data = testFont();
  const scene = {
    fonts: [
      {id: "default", fileName: "font_5x8.mfnt", data,
        source: "builtin", catalogId: "font-5x8"},
      {id: "large", fileName: "font_5x10.mfnt", data,
        source: "builtin", catalogId: "font-5x10"}
    ],
    layers: [
      {id: "default-text", type: "text", text: "A", fontId: "default", visible: true},
      {id: "large-text-1", type: "text", text: "A", fontId: "large",
        bindings: {text: true}, visible: true},
      {id: "large-text-2", type: "text", text: "B", fontId: "large",
        bindings: {text: true}, visible: true}
    ]
  };
  const files = compiler.collectRuntimeFonts([scene, scene]);

  assert.equal(files.length, 1);
  assert.equal(files[0].path, "/gfx/font_5x10.mfnt");
  const sourceFont = mfnt.parse(Buffer.from(data, "base64"));
  const runtimeFont = mfnt.parse(files[0].bytes);
  assert.equal(runtimeFont.formatId, mfnt.FORMAT_VLSB,
      "runtime fonts use a directly framebuf-compatible layout");
  assert.deepEqual(mfnt.decodeGlyph(runtimeFont,
      mfnt.glyphIndexForCharacter("A")), mfnt.decodeGlyph(sourceFont,
      mfnt.glyphIndexForCharacter("A")));
  assert.equal(files[0].references.length, 4);
  assert.equal(compiler.runtimeFontPath(files, 1, "large"), "/gfx/font_5x10.mfnt");
});

test("removes every bound layer from the static framebuffer", () => {
  const scene = {fonts: [], layers: [
    {id: "static", type: "rect", x: 0, y: 0, width: 1, height: 1,
      filled: true, visible: true},
    {id: "moving", type: "rect", x: 1, y: 0, width: 1, height: 1,
      filled: true, bindings: {x: true}, visible: true},
    {id: "hidden-dynamic", type: "rect", x: 2, y: 0, width: 1, height: 1,
      filled: true, bindings: {visible: true}, visible: false}
  ]};
  const compiled = compiler.compileStaticFramebuffer(scene);

  assert.equal(pixel(compiled.bytes, 0, 0), 1);
  assert.equal(pixel(compiled.bytes, 1, 0), 0);
  assert.equal(pixel(compiled.bytes, 2, 0), 0);
  assert.deepEqual(compiled.dynamicLayers.map(layer => layer.id),
      ["moving", "hidden-dynamic"]);
});

test("draws dynamic shapes after the static base with optional visibility", () => {
  const scene = {fonts: [], layers: [
    {id: "background", type: "rect", x: 0, y: 0, width: 2, height: 2,
      filled: true, visible: true},
    {id: "moving", type: "rect", x: 4, y: 5, width: 6, height: 7,
      filled: false, bindings: {x: true, y: true, visible: true}, visible: true}
  ]};
  const plan = compiler.createPythonPlan(scene, {
    suffix: "dynamic-shape",
    symbol: "s0",
    precompute: true,
    dynamicValues: {
      moving: {x: "target_x", y: "target_y", visible: "enabled"}
    }
  });

  assert.match(plan.code, /^buffer\[:\] = _espide_s0_scene/m);
  assert.doesNotMatch(plan.code, /_espide_(?:x|y)_/);
  assert.match(plan.code,
      /if bool\(enabled\):\n    fbuf\.rect\(int\(target_x\), int\(target_y\), 6, 7, 1\)/);
  assert.ok(plan.code.indexOf("buffer[:") < plan.code.indexOf("if bool(enabled)"));
});

test("emits both colour masks for a visible dynamic drawing", () => {
  const white = new Uint8Array(bitmap.byteLength(128, 64));
  const black = new Uint8Array(white.length);
  bitmap.setPixel(white, 128, 1, 1, 1);
  bitmap.setPixel(black, 128, 2, 1, 1);
  const scene = {fonts: [], layers: [{
    id: "drawing", type: "bitmap", kind: "drawing",
    x: 0, y: 0, width: 128, height: 64,
    data: base64(white), blackData: base64(black),
    transparent: true, bindings: {visible: true}, visible: true
  }]};
  const plan = compiler.createPythonPlan(scene, {
    symbol: "s0", precompute: true,
    dynamicValues: {drawing: {visible: "show_drawing"}}
  });

  assert.match(plan.code, /^fbuf\.fill\(0\)/);
  assert.match(plan.code, /if bool\(show_drawing\):/);
  assert.match(plan.code, /fbuf\.blit\(_espide_s0_d0_0, 0, 0, 0\)/);
  assert.match(plan.code, /fbuf\.blit\(_espide_s0_d0_1, 0, 0, 1\)/);
  assert.equal(plan.definitions.filter(item =>
    /framebuf\.FrameBuffer/.test(item.code)).length, 2);
});

test("renders a dynamic text value through MFNT and str conversion", () => {
  const scene = {
    fonts: [{id: "font-1", data: testFont()}],
    layers: [{
      id: "value", type: "text", x: 3, y: 4, text: "fallback",
      fontId: "font-1", inverted: true,
      bindings: {text: true, x: true}, visible: true
    }]
  };
  const plan = compiler.createPythonPlan(scene, {
    suffix: "dynamic-text",
    precompute: true,
    dynamicValues: {value: {text: "sensor_value", x: "text_x"}},
    fontPaths: {value: "/gfx/tiny.mfnt"}
  });

  assert.equal(pixel(plan.bytes, 3, 4), 0, "dynamic text is absent from static bytes");
  const definitions = plan.definitions.map(item => item.code).join("\n");
  assert.match(definitions, /from espide_monofont import MonoFont/);
  assert.doesNotMatch(definitions, /\/gfx\/monofont\.py/);
  assert.match(plan.code, /_espide_font\("\/gfx\/tiny\.mfnt"\)\.text\(fbuf, str\(sensor_value\),/);
  assert.match(plan.code, /True, invert=True\)/);
  assert.match(plan.code, /int\(text_x\)/);
});

test("draws a positioned inverse text mask with transparent white bits", () => {
  const scene = {
    fonts: [{id: "font-1", data: testFont()}],
    layers: [{
      id: "inverse", type: "text", x: 3, y: 4, width: 2, height: 3,
      text: "A", fontId: "font-1", inverted: true,
      bindings: {x: true}, visible: true
    }]
  };
  const plan = compiler.createPythonPlan(scene, {
    suffix: "inverse-position", symbol: "s3", precompute: true,
    dynamicValues: {inverse: {x: "text_x"}}
  });
  assert.match(plan.code,
      /fbuf\.blit\(_espide_s3_d0, int\(text_x\), 4, 1\)/);
  assert.doesNotMatch(
      plan.definitions.map(item => item.code).join("\n"), /palette/i);
});

test("uses opaque blit for a dynamically positioned opaque bitmap", () => {
  const sourceBitmap = bitmap.pack(Uint8Array.from([1, 0]), 2, 1);
  const scene = {fonts: [], layers: [{
    id: "logo", type: "bitmap", x: 4, y: 5, width: 2, height: 1,
    data: base64(sourceBitmap), transparent: false,
    bindings: {x: true}, visible: true
  }]};
  const plan = compiler.createPythonPlan(scene, {
    suffix: "opaque-bitmap",
    symbol: "s2",
    precompute: true,
    dynamicValues: {logo: {x: "logo_x"}}
  });

  assert.match(plan.code, /int\(logo_x\)/);
  assert.match(plan.code,
      /fbuf\.blit\(_espide_s2_d0, int\(logo_x\), 5, -1\)/);
  assert.match(plan.definitions.map(item => item.code).join("\n"),
      /_espide_s2_d0_data = bytearray/);
});

test("moves a dynamic line as one object while preserving endpoint offsets", () => {
  const scene = {fonts: [], layers: [{
    id: "line", type: "line", x1: 10, y1: 8, x2: 4, y2: 12,
    bindings: {x: true, y: true}, visible: true
  }]};
  const plan = compiler.createPythonPlan(scene, {
    suffix: "line",
    symbol: "s3",
    dynamicValues: {line: {x: "new_x", y: "new_y"}}
  });

  assert.match(plan.code, /_espide_s3_d0x = int\(new_x\)/);
  assert.match(plan.code, /_espide_s3_d0y = int\(new_y\)/);
  assert.match(plan.code, /fbuf\.line\(_espide_s3_d0x \+ 6, _espide_s3_d0y, _espide_s3_d0x, _espide_s3_d0y \+ 4, 1\)/);
  assert.equal((plan.code.match(/int\(new_x\)/g) || []).length, 1);
  assert.equal((plan.code.match(/int\(new_y\)/g) || []).length, 1);
});

test("keeps generated bitmap identifiers short even with long Blockly IDs", () => {
  const sourceBitmap = bitmap.pack(Uint8Array.from([1]), 1, 1);
  const scene = {fonts: [], layers: [{
    id: "bitmap-layer-with-a-very-long-random-identifier",
    type: "bitmap", x: 39, y: 25, width: 1, height: 1,
    data: base64(sourceBitmap), transparent: true,
    bindings: {x: true, y: true}, visible: true
  }]};
  const plan = compiler.createPythonPlan(scene, {
    suffix: "Wy4HB_5lvT_d66rM_PaX_and_more_random_block_data",
    symbol: "s4",
    dynamicValues: {}
  });
  const definitions = plan.definitions.map(item => item.code).join("\n");

  assert.match(plan.code,
      /fbuf\.blit\(_espide_s4_d0, int\(39\), int\(25\), 0\)/);
  assert.match(definitions, /_espide_s4_d0_data = bytearray/);
  assert.doesNotMatch(plan.code + definitions, /Wy4HB|bitmap-layer-with/);
});
