#!/usr/bin/env python3
"""Convert one fixed-size monochrome OpenType Bitmap strike to MFNT v1.

This tool intentionally reads EBDT/EBLC bitmap data instead of rasterizing a
TrueType outline. The source pixels therefore reach ESP IDE unchanged, without
Canvas antialiasing, hinting differences, or threshold tuning.

The generated MFNT contains printable ASCII 32..126 plus a duplicate question
mark as the fallback glyph and always uses canonical MONO_HLSB addressing.
The output is a derivative of the source font: keep and follow its license.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

try:
    from fontTools.ttLib import TTFont
except ImportError as exc:  # pragma: no cover - environment-specific message
    raise SystemExit("Missing dependency. Install it with: python -m pip install fonttools") from exc


MAGIC = b"MFNT"
VERSION = 1
FORMAT_HLSB = 0
FIRST_CHAR = 32
LAST_CHAR = 126


def find_bitmap_strike(font: TTFont, strike_index: int):
    if "EBLC" not in font or "EBDT" not in font:
        raise ValueError("The input has no EBDT/EBLC bitmap strikes; use a Bm .otb file")
    strikes = font["EBLC"].strikes
    if not 0 <= strike_index < len(strikes):
        raise ValueError(f"Strike index {strike_index} is unavailable (found {len(strikes)})")

    strike = strikes[strike_index]
    cmap = font.getBestCmap() or {}
    if any(code not in cmap for code in range(FIRST_CHAR, LAST_CHAR + 1)):
        missing = next(code for code in range(FIRST_CHAR, LAST_CHAR + 1) if code not in cmap)
        raise ValueError(f"The selected strike has no ASCII U+{missing:04X} glyph")
    owners = {
        name: subtable
        for subtable in strike.indexSubTables
        for name in getattr(subtable, "names", ())
    }
    missing_name = next((cmap[code] for code in range(FIRST_CHAR, LAST_CHAR + 1)
                         if cmap[code] not in owners), None)
    if missing_name:
        raise ValueError(f"Bitmap data are missing for glyph {missing_name}")
    return strike, cmap, owners


def glyph_bitmap(strike_data, subtable, name: str):
    """Return packed pixels, dimensions and bearings for one EBDT glyph."""
    image_format = getattr(subtable, "imageFormat", None)
    glyph = strike_data[name]
    if image_format == 5:
        metrics = subtable.metrics
        return (bytes(glyph.data), int(metrics.width), int(metrics.height),
                int(metrics.horiBearingX), int(metrics.horiBearingY))
    if image_format == 2:
        # Format 2 stores small metrics inside every glyph record.
        glyph.ensureDecompiled()
        metrics = glyph.metrics
        return (bytes(glyph.imageData), int(metrics.width), int(metrics.height),
                int(metrics.BearingX), int(metrics.BearingY))
    raise ValueError(f"Glyph {name} uses unsupported EBDT image format {image_format}")


def unpack_bitmap(data: bytes, width: int, height: int):
    expected = math.ceil(width * height / 8)
    if len(data) != expected:
        raise ValueError(f"Bitmap has {len(data)} bytes, expected {expected}")
    return [
        1 if data[index // 8] & (0x80 >> (index % 8)) else 0
        for index in range(width * height)
    ]


def pack_bitmap(pixels: list[int]) -> bytes:
    data = bytearray(math.ceil(len(pixels) / 8))
    for index, value in enumerate(pixels):
        if value:
            data[index // 8] |= 0x80 >> (index % 8)
    return bytes(data)


def convert(source: Path, strike_index: int = 0) -> tuple[bytes, int, int]:
    font = TTFont(source, lazy=False)
    try:
        strike, cmap, owners = find_bitmap_strike(font, strike_index)
        if strike.bitmapSizeTable.bitDepth != 1:
            raise ValueError("Only 1-bit monochrome bitmap strikes are supported")

        strike_data = font["EBDT"].strikeData[strike_index]
        records = []
        for code in range(FIRST_CHAR, LAST_CHAR + 1):
            name = cmap[code]
            records.append(glyph_bitmap(strike_data, owners[name], name))

        metric_shapes = {(record[1], record[2], record[3], record[4]) for record in records}
        if len(metric_shapes) == 1:
            # The normal case: every glyph already occupies the same packed
            # cell. Keep that exact size (for example 8x14), including its
            # intentional internal blank rows.
            width, height, _bearing_x, _bearing_y = next(iter(metric_shapes))
            min_x = _bearing_x
            min_y = 0
            baseline = _bearing_y
        else:
            # Rare OTB fonts split ASCII across several metric groups. Compose
            # them on the strike baseline and expand only when a glyph would
            # otherwise be clipped.
            line = strike.bitmapSizeTable.hori
            baseline = int(line.ascender)
            nominal_height = max(1, int(line.ascender) - int(line.descender))
            min_x = min(0, min(record[3] for record in records))
            max_x = max(int(line.widthMax), max(record[3] + record[1] for record in records))
            min_y = min(0, min(baseline - record[4] for record in records))
            max_y = max(nominal_height,
                        max(baseline - record[4] + record[2] for record in records))
            width = max_x - min_x
            height = max_y - min_y
        if not (1 <= width <= 255 and 1 <= height <= 255):
            raise ValueError(f"Invalid bitmap cell size {width}x{height}")

        glyphs: list[bytes] = []
        for data, glyph_width, glyph_height, bearing_x, bearing_y in records:
            source_pixels = unpack_bitmap(data, glyph_width, glyph_height)
            destination = [0] * (width * height)
            target_x = bearing_x - min_x
            target_y = baseline - bearing_y - min_y
            for y in range(glyph_height):
                for x in range(glyph_width):
                    if source_pixels[y * glyph_width + x]:
                        destination[(target_y + y) * width + target_x + x] = 1
            glyphs.append(pack_bitmap(destination))

        # MFNT index 95 is the explicit fallback; '?' is a useful deterministic
        # choice and is already present in the printable ASCII payload.
        glyphs.append(glyphs[ord("?") - FIRST_CHAR])
        payload = b"".join(glyphs)
        header = MAGIC + bytes((VERSION, width, height, FORMAT_HLSB))
        return header + payload, width, height
    finally:
        font.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract exact 1-bit OTB pixels and write canonical MFNT v1/HLSB"
    )
    parser.add_argument("source", type=Path, help="source Bm .otb font")
    parser.add_argument("output", type=Path, help="output .mfnt file")
    parser.add_argument("--strike", type=int, default=0, help="bitmap strike index (default: 0)")
    args = parser.parse_args()

    if not args.source.is_file():
        parser.error(f"source does not exist: {args.source}")
    data, width, height = convert(args.source, args.strike)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(data)
    print(f"Wrote {args.output} ({width}x{height}, {len(data)} bytes, MFNT v1 MONO_HLSB)")
    print("Keep the source font's license and attribution with the converted file.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
