"""Small NeoPixel buffer compatible with the ESP IDE examples."""

import simhw as _hw


class NeoPixel:
    def __init__(self, pin, n, bpp=3, timing=1):
        self.pin = pin
        self.n = int(n)
        self.bpp = int(bpp)
        self.buf = bytearray(self.n * self.bpp)

    def __len__(self):
        return self.n

    def __getitem__(self, index):
        if isinstance(index, slice):
            return [self[i] for i in range(*index.indices(self.n))]
        offset = int(index) * self.bpp
        return tuple(self.buf[offset:offset + min(3, self.bpp)])

    def __setitem__(self, index, value):
        offset = int(index) * self.bpp
        values = tuple(int(part) & 255 for part in value)
        for channel in range(self.bpp):
            self.buf[offset + channel] = values[channel] if channel < len(values) else 0

    def fill(self, color):
        for index in range(self.n):
            self[index] = color

    def write(self):
        # A hex string crosses the WASM JS bridge reliably for this port.
        encoded = "".join(
            "".join("%02x" % channel for channel in self[index])
            for index in range(self.n)
        )
        _hw.neopixel_write(self.pin.id(), self.n, self.bpp, encoded)
