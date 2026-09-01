"""Host-side contract tests for espide_monofont.py with a fake framebuf."""

import importlib.util
import os
import sys
import tempfile
import types
import unittest


HERE = os.path.dirname(os.path.abspath(__file__))


class FakeFrameBuffer:
    def __init__(self, buffer, width, height, pixel_format):
        expected = (
            width * ((height + 7) // 8)
            if pixel_format == 2
            else ((width + 7) // 8) * height
        )
        if len(buffer) < expected:
            raise ValueError("buffer too small for MicroPython FrameBuffer")
        self.buffer = buffer
        self.width = width
        self.height = height
        self.format = pixel_format


def load_espide_monofont():
    framebuf = types.ModuleType("framebuf")
    framebuf.MONO_HLSB = 0
    framebuf.MONO_HMSB = 1
    framebuf.MONO_VLSB = 2
    framebuf.FrameBuffer = FakeFrameBuffer
    micropython = types.ModuleType("micropython")
    micropython.const = lambda value: value
    sys.modules["framebuf"] = framebuf
    sys.modules["micropython"] = micropython
    spec = importlib.util.spec_from_file_location(
        "espide_monofont_under_test", os.path.join(HERE, "espide_monofont.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_font(path, width=8, height=8, format_id=0):
    if format_id == 2:
        glyph_size = width * ((height + 7) // 8)
    else:
        glyph_size = (width * height + 7) // 8
    data = bytearray(b"MFNT" + bytes((1, width, height, format_id)))
    for index in range(96):
        data.extend(bytes(((index + 1) & 0xFF,)) * glyph_size)
    # Space is defined as empty even though runtime deliberately skips it.
    data[8:8 + glyph_size] = bytes(glyph_size)
    with open(path, "wb") as output:
        output.write(data)
    return glyph_size


def make_pattern_font(path, width, height, format_id, character, pixels):
    """Write one patterned glyph using the compact MFNT horizontal layout."""
    glyph_size = (width * height + 7) // 8
    glyph = bytearray(glyph_size)
    for y in range(height):
        for x in range(width):
            if not pixels[y * width + x]:
                continue
            pixel_index = y * width + x
            bit = 7 - (pixel_index & 7) if format_id == 0 else pixel_index & 7
            glyph[pixel_index >> 3] |= 1 << bit
    data = bytearray(b"MFNT" + bytes((1, width, height, format_id)))
    data.extend(bytes(96 * glyph_size))
    index = ord(character) - 32
    offset = 8 + index * glyph_size
    data[offset:offset + glyph_size] = glyph
    with open(path, "wb") as output:
        output.write(data)


def padded_pixels(buffer, width, height, format_id):
    """Decode the row-aligned buffer expected by the fake MicroPython API."""
    stride = (width + 7) // 8
    result = []
    for y in range(height):
        for x in range(width):
            byte = buffer[y * stride + (x >> 3)]
            bit = 7 - (x & 7) if format_id == 0 else x & 7
            result.append(1 if byte & (1 << bit) else 0)
    return result


class Target:
    def __init__(self):
        self.blits = []
        self.fills = []

    def blit(self, glyph, x, y, key, palette=None):
        self.blits.append((bytes(glyph.buffer), x, y, key, palette))

    def fill_rect(self, x, y, width, height, colour):
        self.fills.append((x, y, width, height, colour))


class MonoFontTests(unittest.TestCase):
    def setUp(self):
        self.module = load_espide_monofont()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.temp_dir.name, "test.mfnt")
        self.glyph_size = make_font(self.path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_firmware_module_contract(self):
        self.assertEqual(self.module.__version__, "1.4.1")
        self.assertEqual(self.module.__all__, ("MonoFont",))

    def test_loads_all_formats_and_reuses_one_buffer(self):
        for format_id in (0, 1, 2):
            make_font(self.path, width=7, height=9, format_id=format_id)
            font = self.module.MonoFont(self.path)
            buffer_id = id(font._glyph_buffer)
            font.text(Target(), "AB", 0, 0)
            self.assertEqual(id(font._glyph_buffer), buffer_id)
            self.assertEqual(font.width, 7)
            self.assertEqual(font.height, 9)
            expected_buffer_size = (
                7 * 2 if format_id == 2 else 9
            )
            self.assertEqual(len(font._glyph_buffer), expected_buffer_size)

    def test_expands_compact_horizontal_glyphs_without_changing_pixels(self):
        width = 5
        height = 8
        pixels = [
            1 if x == y % width or x == width - 1 else 0
            for y in range(height)
            for x in range(width)
        ]
        for format_id in (0, 1):
            make_pattern_font(
                self.path, width, height, format_id, "A", pixels
            )
            font = self.module.MonoFont(self.path)
            target = Target()
            font.text(target, "A", 0, 0, transparent=True)
            self.assertEqual(
                padded_pixels(
                    target.blits[0][0], width, height, format_id
                ),
                pixels,
            )

    def test_text_handles_space_newline_cr_and_out_of_range_as_space(self):
        font = self.module.MonoFont(self.path)
        target = Target()
        end = font.text(target, "A A\r\nŽ", 2, 3, spacing=1, line_spacing=2)
        self.assertEqual(end, (12, 13))
        self.assertEqual(target.fills, [
            (10, 3, 2, 8, 0),
            (12, 3, 10, 8, 0),
            (30, 3, 2, 8, 0),
            (2, 13, 10, 8, 0),
        ])
        self.assertEqual(len(target.blits), 2)

    def test_transparent_out_of_range_character_only_advances(self):
        font = self.module.MonoFont(self.path)
        target = Target()
        self.assertEqual(font.text(target, "Ž", 5, 6, transparent=True), (14, 6))
        self.assertEqual(target.fills, [])
        self.assertEqual(target.blits, [])

    def test_transparent_space_only_advances(self):
        font = self.module.MonoFont(self.path)
        target = Target()
        self.assertEqual(font.text(target, " ", 5, 6, transparent=True), (14, 6))
        self.assertEqual(target.fills, [])
        self.assertEqual(target.blits, [])

    def test_inverse_text_reuses_the_glyph_buffer_with_black_blit_key(self):
        font = self.module.MonoFont(self.path)
        target = Target()
        font.text(target, "A", 1, 2, transparent=True, invert=True)

        self.assertEqual(target.fills, [])
        self.assertEqual(target.blits[0][1:4], (1, 2, 1))
        self.assertIsNone(target.blits[0][4])
        inverse_bytes = target.blits[0][0]

        normal_target = Target()
        font.text(normal_target, "A", 1, 2, transparent=True)
        self.assertNotEqual(normal_target.blits[0][0], inverse_bytes)
        self.assertEqual(normal_target.blits[0][3], 0)

    def test_default_spacing_keeps_glyph_origins_one_pixel_apart(self):
        font = self.module.MonoFont(self.path)
        target = Target()
        self.assertEqual(font.text(target, "AB", 0, 0), (18, 0))
        self.assertEqual([call[1] for call in target.blits], [0, 9])
        self.assertEqual(target.fills, [
            (8, 0, 1, 8, 0),
            (17, 0, 1, 8, 0),
        ])

    def test_negative_extra_spacing_cannot_remove_mandatory_gap(self):
        font = self.module.MonoFont(self.path)
        target = Target()
        self.assertEqual(font.text(target, "AB", 0, 0, spacing=-4), (18, 0))
        self.assertEqual([call[1] for call in target.blits], [0, 9])

    def test_empty_text_does_not_open_font_again(self):
        font = self.module.MonoFont(self.path)
        os.unlink(self.path)
        self.assertEqual(font.text(Target(), "", 4, 5), (4, 5))

    def test_rejects_wrong_file_size(self):
        with open(self.path, "ab") as output:
            output.write(b"x")
        with self.assertRaisesRegex(ValueError, "file size"):
            self.module.MonoFont(self.path)


if __name__ == "__main__":
    unittest.main()
