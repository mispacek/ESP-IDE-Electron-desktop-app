import framebuf, utime, machine

#1. Minimalisticky ovladac cipu IS31FL3731
class _IS31:
    _CFG_BANK   = 0x0B
    _BANK_REG   = 0xFD
    _SHUTDOWN   = 0x0A
    _MODE       = 0x00
    _FRAME      = 0x01
    _COLOR_OFFS = 0x24

    def __init__(self, i2c, addr=0x74):
        self.i2c, self.addr = i2c, addr
        self._wake()           # zapni cip
        self._enable_leds()    # povol vsechny LED

    # ── nizkourovnove pomocne ───────────────────────────────────────────
    def _bank(self, b):  self.i2c.writeto_mem(self.addr, self._BANK_REG, bytes([b]))
    def _wreg(self, b, r, v): self._bank(b); self.i2c.writeto_mem(self.addr, r, bytes([v]))

    # ── init ────────────────────────────────────────────────────────────
    def _wake(self):
        self._wreg(self._CFG_BANK, self._SHUTDOWN, 0x00)   # sleep
        utime.sleep_us(10)
        self._wreg(self._CFG_BANK, self._SHUTDOWN, 0x01)   # wake
        self._wreg(self._CFG_BANK, self._MODE, 0x00)       # picture mode, frame 0
        self._wreg(self._CFG_BANK, self._FRAME, 0x00)

    def _enable_leds(self):
        self._bank(0)                                      # frame-bank 0
        for col in range(18):                              # 18 enable registru
            self.i2c.writeto_mem(self.addr, col, b'\xFF')  # vsech 8 LED povolit

    # verejne API – zapis celeho frame (144 bajtu)
    def write_frame(self, buf):
        self._bank(0)
        self.i2c.writeto_mem(self.addr, self._COLOR_OFFS, buf)

# 2. Driver pro 17 × 7 vyrez vyuzivajici spolecny framebuffer
class LEDMatrix17x7:
    WIDTH, HEIGHT = 17, 7

    def __init__(self, i2c, framebuffer, x_off=0, y_off=0, bright=40, addr=0x74):
        self.fb, self.xo, self.yo, self.bright = framebuffer, x_off, y_off, bright
        self._chip = _IS31(i2c, addr)
        self._buf  = bytearray(144)          # pracovni buffer IS31
        
    def set_brightness(self, value, apply=True):
        try:
            v = int(value)
        except Exception:
            v = 0
        v = 0 if v < 0 else (255 if v > 255 else v)
        self.bright = v
        if apply:
            self.show()
    
    def set_brightness_percent(self, percent, apply=True, gamma=True):
        try:
            p = float(percent)
        except Exception:
            p = 0.0
        p = 0.0 if p < 0.0 else (100.0 if p > 100.0 else p)
        p /= 100.0
        if gamma:
            p = p ** 2.2  # perceptuálně příjemnější průběh
        self.set_brightness(int(round(p * 255)), apply=apply)
 
    def fade_to(self, target_percent, duration_ms=300):
        start = self.bright
        # Přepočti cílové % na 0..255 bez okamžité aplikace
        self.set_brightness_percent(target_percent, apply=False, gamma=True)
        target = self.bright
        self.bright = start
        
        if duration_ms < 10:
            duration_ms = 10
        
        steps = int(duration_ms / 10)

        if steps < 1:
            steps = 1
        delay = max(0, int(duration_ms // steps))

        for i in range(1, steps + 1):
            v = start + (target - start) * i // steps
            self.set_brightness(v, apply=True)
            utime.sleep_ms(delay)
    
    # prevod souradnic do pozice v _buf (schema Pico:ED) :contentReference[oaicite:3]{index=3}
    @staticmethod
    def _addr(x, y):
        if x > 8:            # prava polovina desky je zrcadlena
            x = 17 - x
            y += 8
        else:                # leva polovina je otocena
            y = 7 - y
        return x * 16 + y

    # pretazeni vyrezu z framebufferu do cipu
    def show(self):
        mv = memoryview(self._buf)
        mv[:] = b'\x00' * 144                 # vynuluj
        for x in range(self.WIDTH):
            for y in range(self.HEIGHT):
                if self.fb.pixel(self.xo + x, self.yo + y):
                    mv[self._addr(x, y)] = self.bright
        self._chip.write_frame(mv)
