from micropython import const

# Kompatibilita s ST7567S (LCD12864) pres I2C
# Definice prikazu podle lcd128_64.py
CMD_SET_PAGE     = const(0xB0)  # 0xB0–0xB7: adresovani stranek
CMD_SET_COL_HIGH = const(0x10)  # Vyssi ctyri bity sloupce
CMD_SET_COL_LOW  = const(0x00)  # Nizsi ctyri bity sloupce

class ST7567_I2C:
    def __init__(self, width, height, i2c, buffer, addr=0x3F):
        # Prijima stejnou signaturu jako SSD1306_I2C
        self.width = width  # sirka displeje
        self.height = height  # vyska displeje
        self.i2c = i2c  # instance I2C
        self.addr = addr  # I2C adresa
        self.buffer = buffer  # framebuffer (bytearray)
        self.pages = self.height // 8  # pocet stranek
        self._init_display()  # **Inicializace** displeje

    def write_cmd(self, cmd):
        # Prikazovy registr = 0x00
        self.i2c.writeto_mem(self.addr, 0x00, bytes([cmd]))

    def write_data(self, buf):
        # Datovy registr = 0x40
        self.i2c.writeto_mem(self.addr, 0x40, buf)

    def _init_display(self):
        # Sekvence inicializace podle ST7567S
        for cmd in (
            0xE2,  # system reset
            0xA2,  # 1/9 bias
            0xA0,  # SEG normal direction
            0xC8,  # COM normal direction
            0x25,  # internal VDD regulator
            0x81,  # set electronic volume mode
            0x20,  # set electronic volume value
            0x2C,  # booster on
            0x2E,  # regulator on
            0x2F,  # follower on
            0xAF,  # display on
        ):
            self.write_cmd(cmd)
        self.clear()
        self.show()  # **show** vykresli cisty buffer

    def clear(self):
        # Vymazani cele plochy displeje
        for page in range(self.pages):
            self.write_cmd(CMD_SET_PAGE | page)
            self.write_cmd(CMD_SET_COL_HIGH)
            self.write_cmd(CMD_SET_COL_LOW)
            # Zapis nul kazdy sloupec
            self.write_data(bytearray(self.width))

    def show(self):
        # **show**: vykresli framebuffer na vsech strankach
        for page in range(self.pages):
            self.write_cmd(CMD_SET_PAGE | page)
            self.write_cmd(CMD_SET_COL_HIGH | ((0 >> 4) & 0x0F))
            self.write_cmd(CMD_SET_COL_LOW  | (0 & 0x0F))
            start = page * self.width
            end = start + self.width
            self.write_data(self.buffer[start:end])

# Priklad pouziti:
# import st7567_mod
# disp = st7567_mod.ST7567_I2C(128, 64, globals()['i2c'], framebuf)
# disp.show()
