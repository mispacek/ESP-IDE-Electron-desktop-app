# ┌────────────────────────────────────────────┐
# │ ESP IDE  : FREE MicroPython WEB IDE        │
# │ AUTHOR   : Milan Spacek (2019–2026)        │
# │ WEB      : https://espide.eu               │
# │ LICENSE  : AGPL-3.0                        │
# │                                            │
# │ CODE IS OPEN — IMPROVEMENTS MUST STAY OPEN │
# │ Please contribute your improvements back   │
# └────────────────────────────────────────────┘

from micropython import const
import framebuf

# ST7567S (LCD12864) pres I2C – 128x64, 1bpp, stranky po 8 radcich
CMD_SET_PAGE     = const(0xB0)  # 0xB0–0xB7
CMD_SET_COL_HIGH = const(0x10)  # high nibble
CMD_SET_COL_LOW  = const(0x00)  # low nibble


class ST7567_I2C(framebuf.FrameBuffer):
    """
    Kompatibilni API s OLED128x64: FrameBuffer primitiva (blit/pixel/line/rect/text...)
    + show() pro vykresleni interniho bufferu na displej.

    Parametry:
      - buffer: bytearray(pages*width) nebo None (pak se alokuje)
      - col_offset: posun sloupcu (0 pro vetsinu modulu, nekdy 4)
    """
    def __init__(self, width, height, i2c, buffer=None, addr=0x3F, col_offset=0):
        self.width  = width
        self.height = height
        self.pages  = height // 8

        self.i2c   = i2c
        self.addr  = addr
        self.col_offset = int(col_offset) & 0xFF

        size = self.pages * self.width
        if buffer is None:
            self.buffer = bytearray(size)
        else:
            if len(buffer) != size:
                raise ValueError("Buffer musi mit delku %d" % size)
            self.buffer = buffer

        # Zaklad: stejne mapovani jako v oled.py (MONO_VLSB)
        super().__init__(self.buffer, self.width, self.height, framebuf.MONO_VLSB)

        self._init_display()
        self.fill(0)
        self.show()

    def write_cmd(self, cmd: int):
        # Control byte 0x00 = command
        self.i2c.writeto(self.addr, bytes((0x00, cmd & 0xFF)))

    def write_cmds(self, *cmds):
        # Posli vice prikazu v jednom I2C ramci (rychlejsi)
        if len(cmds) == 1 and isinstance(cmds[0], (list, tuple, bytes, bytearray)):
            seq = cmds[0]
        else:
            seq = cmds
        if not seq:
            return
        self.i2c.writeto(self.addr, bytes([0x00] + [c & 0xFF for c in seq]))

    def write_data(self, buf):
        # Control byte 0x40 = data
        self.i2c.writeto(self.addr, b"\x40" + buf)

    def _init_display(self):
        # Sekvence inicializace (ponechano z puvodniho st7567.py)
        self.write_cmds(
            0xE2,  # system reset
            0xA2,  # 1/9 bias
            0xA0,  # SEG normal direction
            0xC8,  # COM normal direction
            0x25,  # internal VDD regulator
            0x81,  # electronic volume mode
            0x20,  # electronic volume value (kontrast)
            0x2C,  # booster on
            0x2E,  # regulator on
            0x2F,  # follower on
            0xAF,  # display on
        )

    def contrast(self, value=0x20):
        # 0..0x3F (zalezi na modulu; 0x20 je rozumny default)
        v = int(value)
        if v < 0:
            v = 0
        elif v > 0x3F:
            v = 0x3F
        self.write_cmds(0x81, v)

    def clear(self):
        # Pro kompatibilitu: smaz buffer a vykresli
        self.fill(0)
        self.show()

    def show(self):
        # Vykresli buffer po strankach
        col = self.col_offset
        col_hi = CMD_SET_COL_HIGH | ((col >> 4) & 0x0F)
        col_lo = CMD_SET_COL_LOW  | (col & 0x0F)

        for page in range(self.pages):
            start = page * self.width
            end   = start + self.width

            self.write_cmds(
                CMD_SET_PAGE | page,
                col_hi,
                col_lo
            )
            self.write_data(self.buffer[start:end])
