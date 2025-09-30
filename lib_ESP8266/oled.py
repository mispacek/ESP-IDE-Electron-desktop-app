from micropython import const
import framebuf

# ===== registry prikazu (z SSD1306 datasheetu) =====
SET_CONTRAST       = const(0x81)
SET_ENTIRE_ON      = const(0xA4)
SET_NORM_INV       = const(0xA6)
SET_DISP           = const(0xAE)
SET_MEM_ADDR       = const(0x20)
SET_DISP_START_LINE= const(0x40)
SET_SEG_REMAP      = const(0xA0)  # +1 premapuje SEG0 na col127
SET_MUX_RATIO      = const(0xA8)
SET_COM_OUT_DIR    = const(0xC0)  # scan from COM0 to COM[N]
SET_DISP_OFFSET    = const(0xD3)
SET_COM_PIN_CFG    = const(0xDA)
SET_DISP_CLK_DIV   = const(0xD5)
SET_PRECHARGE      = const(0xD9)
SET_VCOM_DESEL     = const(0xDB)
SET_CHARGE_PUMP    = const(0x8D)

class OLED128x64(framebuf.FrameBuffer):
    def __init__(self, width, height, i2c, buffer=None, addr=0x3C, rotate=False):
        self.width  = width
        self.height = height
        self.pages  = height // 8
        self.i2c    = i2c
        self.addr   = addr
        self.rotate = rotate

        # **buffer**: bud predany, nebo novy bytearray
        size = self.pages * self.width
        if buffer is None:
            self.buffer = bytearray(size)
        else:
            if len(buffer) != size:
                raise ValueError("Buffer musi mit delku %d" % size)
            self.buffer = buffer

        # inicializace FrameBuffer pro kreslici primitiva
        super().__init__(self.buffer, width, height, framebuf.MONO_VLSB)

        # po inicializaci FB prijde init displeje
        self.init_display()

    def write_cmd(self, cmd):
        # prefix 0x80 = Co=1, D/C#=0
        self.i2c.writeto(self.addr, bytes([0x80, cmd]))

    def write_data(self, buf):
        # prefix 0x40 = Co=0, D/C#=1
        self.i2c.writeto(self.addr, b'\x40' + buf)

    def init_display(self):
        for cmd in (
            SET_DISP | 0x00,        # display off
            SET_MEM_ADDR, 0x00,     # horizontal addressing
            SET_DISP_START_LINE | 0x00,
            SET_SEG_REMAP | 0x01,
            SET_MUX_RATIO, self.height - 1,
            SET_COM_OUT_DIR | 0x08,
            SET_DISP_OFFSET, 0x00,
            # tady je ta zmena:
            SET_COM_PIN_CFG, 0x12 if self.height == 64 else 0x02,
            SET_DISP_CLK_DIV, 0x80,
            SET_PRECHARGE, 0xF1,
            SET_VCOM_DESEL, 0x30,
            SET_CONTRAST, 0xFF,
            SET_ENTIRE_ON,
            SET_NORM_INV,
            SET_CHARGE_PUMP, 0x14,
            SET_DISP | 0x01        # display on
        ):
            self.write_cmd(cmd)
        self.fill(0)
        self.show()

    def show(self):
        # **vykresleni bufferu** po strankach (pages)
        for page in range(self.pages):
            # nastaveni cilove stranky
            self.write_cmd(0xB0 + page)  # SET_PAGE_ADDR  (0xB0..0xB7)
            self.write_cmd(0x00)         # lower column start = 0
            self.write_cmd(0x10)         # higher column start = 0

            start = page * self.width
            end   = start + self.width
            # zapis jedne rady dat
            self.write_data(self.buffer[start:end])
