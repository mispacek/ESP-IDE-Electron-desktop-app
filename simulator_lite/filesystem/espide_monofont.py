"""ESP IDE MFNT v1 monospace font renderer for MicroPython ``framebuf``.

Install this module as ``/lib/espide_monofont.py`` in every supported firmware.
ESP IDE generated programs then use the normal
``from espide_monofont import MonoFont`` import.

The module is intentionally small. It validates the fixed-size font once,
allocates one reusable glyph framebuffer and opens the font file only once for
each complete text call. It never calls ``display.show()``.

MFNT v1 stores 96 glyphs: printable ASCII 32..126 followed by one fallback
glyph. See ``README.md`` in the same ESP IDE source directory for the format
and integration contract.
"""

import framebuf
import os
from micropython import const


__version__ = "1.4.1"
__all__ = ("MonoFont",)


_FIRST_CHAR = const(32)
_LAST_CHAR = const(126)
_GLYPH_COUNT = const(96)
_HEADER_SIZE = const(8)

_FORMAT_HLSB = const(0)
_FORMAT_HMSB = const(1)
_FORMAT_VLSB = const(2)


class MonoFont:
    """Load and render one fixed-cell, monochrome ASCII MFNT v1 font."""

    def __init__(self, filename):
        self.filename = filename

        font_file = open(filename, "rb")
        try:
            header = font_file.read(_HEADER_SIZE)
        finally:
            font_file.close()

        if len(header) != _HEADER_SIZE:
            raise ValueError("Incomplete MFNT header")
        if header[0:4] != b"MFNT":
            raise ValueError("Invalid MFNT file")
        if header[4] != 1:
            raise ValueError("Unsupported MFNT version")

        self.width = header[5]
        self.height = header[6]
        format_id = header[7]

        if self.width == 0 or self.height == 0:
            raise ValueError("Invalid glyph size")

        if format_id == _FORMAT_HLSB:
            self.format = framebuf.MONO_HLSB
            glyph_size = (self.width * self.height + 7) // 8
            framebuffer_size = ((self.width + 7) // 8) * self.height
        elif format_id == _FORMAT_HMSB:
            self.format = framebuf.MONO_HMSB
            glyph_size = (self.width * self.height + 7) // 8
            framebuffer_size = ((self.width + 7) // 8) * self.height
        elif format_id == _FORMAT_VLSB:
            self.format = framebuf.MONO_VLSB
            glyph_size = self.width * ((self.height + 7) // 8)
            framebuffer_size = glyph_size
        else:
            raise ValueError("Unknown bitmap format")

        self._format_id = format_id
        self.glyph_size = glyph_size
        self.data_offset = _HEADER_SIZE
        expected_size = self.data_offset + _GLYPH_COUNT * self.glyph_size
        actual_size = os.stat(filename)[6]
        if actual_size != expected_size:
            raise ValueError("Invalid MFNT file size")

        # Horizontal MFNT data are a compact continuous bitstream, while
        # MicroPython FrameBuffer pads each horizontal scanline to a full byte.
        # One larger bytearray is enough for both reading and in-place expansion;
        # the persistent memoryview prevents per-character allocations.
        self._horizontal_compact = framebuffer_size != self.glyph_size
        self._glyph_buffer = bytearray(framebuffer_size)
        self._read_buffer = (
            memoryview(self._glyph_buffer)[:self.glyph_size]
            if self._horizontal_compact
            else self._glyph_buffer
        )
        self._glyph_fb = framebuf.FrameBuffer(
            self._glyph_buffer,
            self.width,
            self.height,
            self.format,
        )

    def _expand_horizontal_glyph(self):
        """Expand compact HLSB/HMSB rows in place for MicroPython framebuf."""

        data = self._glyph_buffer
        width = self.width
        height = self.height
        row_bytes = (width + 7) // 8
        high_bit_left = self._format_id == _FORMAT_HLSB

        # Work backwards: destination offsets are never before their compact
        # source offsets, so already unread source bytes cannot be overwritten.
        for y in range(height - 1, -1, -1):
            source_row = y * width
            destination_row = y * row_bytes
            for byte_column in range(row_bytes - 1, -1, -1):
                first_x = byte_column * 8
                pixel_count = width - first_x
                if pixel_count > 8:
                    pixel_count = 8
                value = 0
                for local_x in range(pixel_count):
                    source_pixel = source_row + first_x + local_x
                    source_byte = data[source_pixel >> 3]
                    if high_bit_left:
                        source_mask = 0x80 >> (source_pixel & 7)
                        destination_mask = 0x80 >> local_x
                    else:
                        source_mask = 1 << (source_pixel & 7)
                        destination_mask = 1 << local_x
                    if source_byte & source_mask:
                        value |= destination_mask
                data[destination_row + byte_column] = value

    def text(self, target, text, x, y, transparent=False, spacing=0,
             line_spacing=0, invert=False):
        """Render text with a mandatory 1 px glyph gap.

        ``spacing`` adds optional extra pixels to that fixed separator; values
        below zero are clamped so adjacent glyph cells can never touch.
        ``invert`` renders glyph pixels as black by reversing the reusable mask
        and using its white background as the transparent blit key.
        """

        if not text:
            return x, y

        start_x = x
        width = self.width
        height = self.height
        extra_spacing = spacing if spacing > 0 else 0
        glyph_gap = 1 + extra_spacing
        advance = width + glyph_gap
        glyph_size = self.glyph_size
        data_offset = self.data_offset
        glyph_buffer = self._glyph_buffer
        read_buffer = self._read_buffer
        glyph_fb = self._glyph_fb
        expand_horizontal = (
            self._expand_horizontal_glyph if self._horizontal_compact else None
        )

        # Local bindings avoid repeated object attribute lookup in the hot loop.
        blit = target.blit
        fill_rect = target.fill_rect
        blit_key = 0 if transparent else -1
        last_index = -1
        current_file_position = -1

        font_file = open(self.filename, "rb")
        try:
            seek = font_file.seek
            readinto = font_file.readinto

            for character in text:
                code = ord(character)

                if code == 10:  # newline
                    x = start_x
                    y += height + line_spacing
                    continue
                if code == 13:  # ignore CR in CRLF input
                    continue

                # MFNT v1 contains printable ASCII only. Treat every other
                # code point exactly as a space so a malformed/unexpected
                # character can never produce a seek beyond glyph data.
                if code < _FIRST_CHAR or code > _LAST_CHAR:
                    code = _FIRST_CHAR

                # A space never needs a file read. Opaque rendering still
                # clears the complete cell to preserve normal blit semantics.
                if code == 32:
                    if not transparent:
                        fill_rect(x, y, advance, height, 1 if invert else 0)
                    x += advance
                    continue

                glyph_index = code - _FIRST_CHAR

                # Repeated characters reuse the glyph already in the buffer.
                if glyph_index != last_index:
                    offset = data_offset + glyph_index * glyph_size
                    if offset != current_file_position:
                        seek(offset)

                    bytes_read = readinto(read_buffer)
                    if bytes_read != glyph_size:
                        raise OSError("Unable to read glyph from MFNT file")
                    if expand_horizontal is not None:
                        expand_horizontal()
                    if invert:
                        # Turn glyph pixels into zeroes and its background into
                        # ones in the existing reusable buffer. blit key 1 then
                        # writes only black glyph pixels. No second buffer or
                        # palette is needed, and repeated glyphs reuse this
                        # already inverted data until the next file read.
                        for byte_index in range(len(glyph_buffer)):
                            glyph_buffer[byte_index] ^= 0xFF

                    current_file_position = offset + glyph_size
                    last_index = glyph_index

                if invert:
                    if not transparent:
                        fill_rect(x, y, width, height, 1)
                    blit(glyph_fb, x, y, 1)
                else:
                    blit(glyph_fb, x, y, blit_key)
                # Opaque text also clears the separator. Transparent text
                # deliberately leaves the target background untouched there.
                if not transparent:
                    fill_rect(
                        x + width, y, glyph_gap, height, 1 if invert else 0
                    )
                x += advance
        finally:
            font_file.close()

        return x, y
