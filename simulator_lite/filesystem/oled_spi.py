# ESP IDE  : FREE MicroPython WEB IDE
# AUTHOR   : Milan Spacek (2019-2026)
# WEB      : https://espide.eu
# LICENSE  : AGPL-3.0
#
# Simple SPI OLED display driver for MicroPython
# Supports 4-wire SPI modules with SSD1306, SSD1309 and SH1106 controllers.

from micropython import const
from machine import Pin
import framebuf
import time

# ===== registry prikazu (SSD1306/SSD1309 compatible subset) =====
SET_CONTRAST        = const(0x81)
SET_ENTIRE_ON       = const(0xA4)
SET_NORM_INV        = const(0xA6)
SET_DISP            = const(0xAE)
SET_MEM_ADDR        = const(0x20)
SET_DISP_START_LINE = const(0x40)
SET_SEG_REMAP       = const(0xA0)  # +1 premapuje SEG0 na col127
SET_MUX_RATIO       = const(0xA8)
SET_COM_OUT_DIR     = const(0xC0)  # scan from COM0 to COM[N]
SET_DISP_OFFSET     = const(0xD3)
SET_COM_PIN_CFG     = const(0xDA)
SET_DISP_CLK_DIV    = const(0xD5)
SET_PRECHARGE       = const(0xD9)
SET_VCOM_DESEL      = const(0xDB)
SET_CHARGE_PUMP     = const(0x8D)


def _pin_out(pin, value):
    if pin is None:
        return None
    if hasattr(pin, "init"):
        pin.init(Pin.OUT)
        pin(value)
        return pin
    out = Pin(pin, Pin.OUT)
    out(value)
    return out


class OLED128x64_SPI(framebuf.FrameBuffer):
    """
    4-wire SPI OLED driver.

    Parametry:
      - spi: machine.SPI nebo machine.SoftSPI
      - dc:  Data/Command pin
      - res: Reset pin, muze byt None
      - cs:  Chip Select pin, muze byt None pokud je CS trvale pripojene na GND
      - controller: "ssd1306", "ssd1309" nebo "sh1106"
      - col_offset: rucni posun sloupcu, None pouzije default podle controlleru
    """
    def __init__(self, width, height, spi, dc, res=None, cs=None,
                 buffer=None, rotate=False, controller="ssd1306",
                 col_offset=None, external_vcc=False, rate=10000000):
        self.width = width
        self.height = height
        self.pages = height // 8
        self.spi = spi
        self.rate = rate
        self.rotate = rotate
        self.external_vcc = external_vcc
        self.controller = (controller or "ssd1306").lower().replace("_", "").replace("-", "")
        self.last_error = None

        if self.controller not in ("ssd1306", "ssd1309", "sh1106"):
            raise ValueError("controller musi byt ssd1306, ssd1309 nebo sh1106")
        if dc is None:
            raise ValueError("dc pin je povinny pro 4-wire SPI")

        if col_offset is None:
            col_offset = 2 if self.controller == "sh1106" else 0
        self.col_offset = int(col_offset) & 0xFF

        self.dc = _pin_out(dc, 0)
        self.res = _pin_out(res, 1)
        self.cs = _pin_out(cs, 1)

        self._cmd = bytearray(1)
        self._page_cmd = bytearray(3)

        size = self.pages * self.width
        if buffer is None:
            self.buffer = bytearray(size)
        else:
            if len(buffer) != size:
                raise ValueError("Buffer musi mit delku %d" % size)
            self.buffer = buffer
        self._buffer_view = memoryview(self.buffer)

        super().__init__(self.buffer, self.width, self.height, framebuf.MONO_VLSB)

        self._init_spi()
        self.reset()
        self.init_display()

    def _init_spi(self):
        if self.rate is None:
            return
        if not hasattr(self.spi, "init"):
            return
        try:
            self.spi.init(baudrate=self.rate, polarity=0, phase=0)
        except TypeError:
            self.spi.init(baudrate=self.rate)

    def _select(self):
        if self.cs is not None:
            self.cs(0)

    def _deselect(self):
        if self.cs is not None:
            self.cs(1)

    def reset(self):
        if self.res is None:
            return
        self.res(1)
        time.sleep_ms(1)
        self.res(0)
        time.sleep_ms(10)
        self.res(1)
        time.sleep_ms(10)

    def _write_cmd_buf(self, buf):
        self._deselect()
        self.dc(0)
        self._select()
        try:
            self.spi.write(buf)
        finally:
            self._deselect()

    def write_cmd(self, cmd):
        self._cmd[0] = cmd & 0xFF
        self._write_cmd_buf(self._cmd)

    def write_cmds(self, cmds):
        self._write_cmd_buf(cmds)

    def write_data(self, buf):
        self._deselect()
        self.dc(1)
        self._select()
        try:
            self.spi.write(buf)
        finally:
            self._deselect()

    def init_display(self):
        seg_remap = 0x00 if self.rotate else 0x01
        com_dir = 0x00 if self.rotate else 0x08

        for cmd in (
            SET_DISP | 0x00,        # display off
            SET_MEM_ADDR, 0x00,     # horizontal addressing (SH1106 ho vetsinou ignoruje)
            SET_DISP_START_LINE | 0x00,
            SET_SEG_REMAP | seg_remap,
            SET_MUX_RATIO, self.height - 1,
            SET_COM_OUT_DIR | com_dir,
            SET_DISP_OFFSET, 0x00,
            SET_COM_PIN_CFG, 0x12 if self.height == 64 else 0x02,
            SET_DISP_CLK_DIV, 0x80,
            SET_PRECHARGE, 0x22 if self.external_vcc else 0xF1,
            SET_VCOM_DESEL, 0x30,
            SET_CONTRAST, 0xFF,
            SET_ENTIRE_ON,
            SET_NORM_INV,
            SET_CHARGE_PUMP, 0x10 if self.external_vcc else 0x14,
            SET_DISP | 0x01        # display on
        ):
            self.write_cmd(cmd)
        self.fill(0)
        self.show()

    def poweroff(self):
        self.write_cmd(SET_DISP | 0x00)

    def poweron(self):
        self.write_cmd(SET_DISP | 0x01)

    def contrast(self, value):
        self.write_cmd(SET_CONTRAST)
        self.write_cmd(value & 0xFF)

    def invert(self, invert):
        self.write_cmd(SET_NORM_INV | (invert & 1))

    def clear(self):
        self.fill(0)
        return self.show()

    def show(self):
        try:
            col = self.col_offset
            lower_col = 0x00 | (col & 0x0F)
            higher_col = 0x10 | ((col >> 4) & 0x0F)

            for page in range(self.pages):
                self._page_cmd[0] = 0xB0 + page
                self._page_cmd[1] = lower_col
                self._page_cmd[2] = higher_col
                self.write_cmds(self._page_cmd)

                start = page * self.width
                end = start + self.width
                self.write_data(self._buffer_view[start:end])

            self.last_error = None
            return True
        except OSError as err:
            print("Chyba komunikace s OLED displejem:", err)
            self.last_error = err
            self._deselect()
            return False


class SSD1306_SPI(OLED128x64_SPI):
    def __init__(self, width, height, spi, dc, res=None, cs=None, **kwargs):
        kwargs["controller"] = "ssd1306"
        super().__init__(width, height, spi, dc, res, cs, **kwargs)


class SSD1309_SPI(OLED128x64_SPI):
    def __init__(self, width, height, spi, dc, res=None, cs=None, **kwargs):
        kwargs["controller"] = "ssd1309"
        super().__init__(width, height, spi, dc, res, cs, **kwargs)


class SH1106_SPI(OLED128x64_SPI):
    def __init__(self, width, height, spi, dc, res=None, cs=None, **kwargs):
        kwargs["controller"] = "sh1106"
        super().__init__(width, height, spi, dc, res, cs, **kwargs)
