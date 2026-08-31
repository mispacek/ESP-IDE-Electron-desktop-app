"""Virtual DHT11/DHT22 sensor API for Simulator Lite."""

import simhw as _hw
from machine import Pin


class _DHTBase:
    def __init__(self, pin):
        self.pin = pin if isinstance(pin, Pin) else Pin(pin)
        self._temperature = 0.0
        self._humidity = 0.0
        self.measure()

    def measure(self):
        values = list(_hw.dht_read(self.pin.id()))
        if values is None or len(values) < 2:
            raise OSError('DHT sensor is not connected')
        self._temperature = float(values[0]) / 1000
        self._humidity = float(values[1]) / 1000
        return None

    def temperature(self):
        return self._temperature

    def humidity(self):
        return self._humidity


class DHT11(_DHTBase):
    pass


class DHT22(_DHTBase):
    pass
