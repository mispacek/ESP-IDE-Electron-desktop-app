#!/usr/bin/env python3
"""Build the ESP IDE MFNT catalog and its pre-rendered PNG previews.

The source of truth is ``../fonts/new_default`` next to the ESP IDE checkout.
Generated web assets live under ``js/display_designer/default_fonts``.  The
browser loads only the small catalog and PNG previews while the designer is
open; an MFNT binary is fetched and embedded in a Blockly scene only when the
user actually creates text with that font.

This script intentionally uses only Python's standard library so rebuilding
the catalog does not depend on Pillow or a browser canvas implementation.
"""

from __future__ import annotations

import json
import shutil
import struct
import zlib
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = APP_ROOT.parent / "fonts" / "new_default"
OUTPUT_DIR = APP_ROOT / "js" / "display_designer" / "default_fonts"
TEXT_SAMPLE = "ABCabc123"
NUMERIC_SAMPLE = "0123.456789"
PREVIEW_GAP = 1
PREVIEW_WIDTH = 320
PREVIEW_HEIGHT = 80

# Friendly names and a deliberate production order. Font size is displayed
# separately by the picker, so named families do not repeat "Normal" or their
# pixel height in the title. The additional generic 7×16 font remains included
# after the explicitly requested core sequence.
FONT_ORDER = [
    ("font_3x6.mfnt", "Font 3×6", "text", TEXT_SAMPLE),
    ("font_5x8.mfnt", "Font 5×8", "text", TEXT_SAMPLE),
    ("font_6x14_bold.mfnt", "Font 6×14 Bold", "text", TEXT_SAMPLE),
    ("font_12x24.mfnt", "Font 12×24", "text", TEXT_SAMPLE),
    ("font_16x28.mfnt", "Font 16×28", "text", TEXT_SAMPLE),
    ("font_7x16.mfnt", "Font 7×16", "text", TEXT_SAMPLE),
    *[
        (f"spleen_{size}.mfnt", "Spleen", "text", TEXT_SAMPLE)
        for size in (8, 12, 16, 24, 32, 64)
    ],
    *[
        (f"ter_{size}_narrow.mfnt", "Terminus Narrow", "text", TEXT_SAMPLE)
        for size in (14, 16, 20, 22, 24, 28, 32)
    ],
    *[
        (f"ter_{size}_bold.mfnt", "Terminus Bold", "text", TEXT_SAMPLE)
        for size in (12, 14, 16, 20, 22, 24, 32)
    ],
    *[
        (f"Tamzen_{size}.mfnt", "Tamzen", "text", TEXT_SAMPLE)
        for size in (8, 13, 16)
    ],
    *[
        (f"Tamzen_{size}_bold.mfnt", "Tamzen Bold", "text", TEXT_SAMPLE)
        for size in (8, 13, 16)
    ],
    ("7_Seg_33x19.mfnt", "7 Segment", "numeric", NUMERIC_SAMPLE),
]


def slug(filename: str) -> str:
    return "".join(character.lower() if character.isalnum() else "-" for character in Path(filename).stem).strip("-")


def parse_mfnt(data: bytes) -> tuple[int, int, int, int]:
    if len(data) < 8 or data[:4] != b"MFNT":
        raise ValueError("invalid MFNT header")
    version, width, height, format_id = data[4:8]
    if version != 1 or not width or not height or format_id not in (0, 1, 2):
        raise ValueError("unsupported MFNT header")
    glyph_size = width * ((height + 7) // 8) if format_id == 2 else (width * height + 7) // 8
    expected = 8 + 96 * glyph_size
    if len(data) != expected:
        raise ValueError(f"invalid MFNT size: expected {expected}, got {len(data)}")
    return width, height, format_id, glyph_size


def glyph_pixels(data: bytes, width: int, height: int, format_id: int, glyph_size: int, index: int) -> list[int]:
    start = 8 + index * glyph_size
    pixels = [0] * (width * height)
    for y in range(height):
        for x in range(width):
            if format_id == 2:  # MONO_VLSB
                byte_index = (y // 8) * width + x
                mask = 1 << (y % 8)
            else:
                pixel_index = y * width + x
                byte_index = pixel_index // 8
                mask = 1 << (7 - pixel_index % 8) if format_id == 0 else 1 << (pixel_index % 8)
            pixels[y * width + x] = 1 if data[start + byte_index] & mask else 0
    return pixels


def render_sample(
    data: bytes,
    width: int,
    height: int,
    format_id: int,
    glyph_size: int,
    sample: str,
) -> list[list[int]]:
    # The font cell itself has no mandatory side bearing. Keep a one-source-
    # pixel separator in catalog previews so adjacent edge pixels never merge
    # visually into one glyph. This gap is preview-only; MFNT data stay intact.
    source_width = width * len(sample) + PREVIEW_GAP * (len(sample) - 1)
    source = [[0 for _ in range(source_width)] for _ in range(height)]
    for character_index, character in enumerate(sample):
        code = ord(character)
        glyph_index = code - 32 if 32 <= code <= 126 else 95
        pixels = glyph_pixels(data, width, height, format_id, glyph_size, glyph_index)
        for y in range(height):
            for x in range(width):
                source[y][character_index * (width + PREVIEW_GAP) + x] = pixels[y * width + x]

    # Integer nearest-neighbour scaling keeps every bitmap pixel crisp.  Large
    # fonts remain at 1:1, while tiny fonts are enlarged up to five times.
    scale = max(1, min(5, (PREVIEW_WIDTH - 12) // source_width, (PREVIEW_HEIGHT - 12) // height))
    rendered_width = source_width * scale
    rendered_height = height * scale
    offset_x = (PREVIEW_WIDTH - rendered_width) // 2
    offset_y = (PREVIEW_HEIGHT - rendered_height) // 2
    target = [[0 for _ in range(PREVIEW_WIDTH)] for _ in range(PREVIEW_HEIGHT)]
    for y in range(height):
        for x in range(source_width):
            if not source[y][x]:
                continue
            for dy in range(scale):
                for dx in range(scale):
                    target[offset_y + y * scale + dy][offset_x + x * scale + dx] = 255
    return target


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def write_grayscale_png(path: Path, pixels: list[list[int]]) -> None:
    height = len(pixels)
    width = len(pixels[0]) if height else 0
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)
    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(raw, 9))
        + png_chunk(b"IEND", b"")
    )


def main() -> None:
    if not SOURCE_DIR.is_dir():
        raise SystemExit(f"MFNT source directory not found: {SOURCE_DIR}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    expected = {filename for filename, _, _, _ in FONT_ORDER}
    available = {path.name for path in SOURCE_DIR.glob("*.mfnt")}
    missing = sorted(expected - available)
    unexpected = sorted(available - expected)
    if missing or unexpected:
        details = []
        if missing:
            details.append("missing: " + ", ".join(missing))
        if unexpected:
            details.append("unexpected: " + ", ".join(unexpected))
        raise SystemExit("Default font collection does not match catalog: " + "; ".join(details))

    # MFNT and PNG files are generated artifacts. Remove only those two file
    # types from the exact output directory so stale fonts cannot survive a
    # collection replacement; keep README.md and other documentation intact.
    output_root = OUTPUT_DIR.resolve()
    for pattern in ("*.mfnt", "*.png"):
        for stale in OUTPUT_DIR.glob(pattern):
            if stale.resolve().parent != output_root:
                raise SystemExit(f"Refusing to remove unexpected path: {stale}")
            stale.unlink()

    catalog = []
    for filename, name, category, sample in FONT_ORDER:
        source = SOURCE_DIR / filename
        if not source.is_file():
            raise SystemExit(f"Catalog source font is missing: {source}")
        data = source.read_bytes()
        width, height, format_id, glyph_size = parse_mfnt(data)
        target = OUTPUT_DIR / filename
        shutil.copy2(source, target)
        preview_name = f"{Path(filename).stem}.png"
        write_grayscale_png(
            OUTPUT_DIR / preview_name,
            render_sample(data, width, height, format_id, glyph_size, sample),
        )
        font_id = slug(filename)
        catalog.append(
            {
                "id": font_id,
                "name": name,
                "fileName": filename,
                "width": width,
                "height": height,
                "category": category,
                "sample": sample,
                "path": f"js/display_designer/default_fonts/{filename}",
                "preview": f"js/display_designer/default_fonts/{preview_name}",
            }
        )

    catalog_json = json.dumps(catalog, ensure_ascii=False, indent=2)
    catalog_source = (
        "/** Generated by tools/build-default-font-catalog.py. Do not edit by hand. */\n"
        "(function(global) {\n"
        "  \"use strict\";\n"
        f"  global.ESPIDE_DEFAULT_FONTS = Object.freeze({catalog_json});\n"
        "})(window);\n"
    )
    (OUTPUT_DIR / "catalog.js").write_text(catalog_source, encoding="utf-8", newline="\n")
    print(f"Built {len(catalog)} fonts and previews in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
