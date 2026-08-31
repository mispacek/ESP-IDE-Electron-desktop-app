"""Small machine API used by Simulator Lite.

The browser-side module is deliberately narrow.  Hardware values live in a
fixed SharedArrayBuffer and this file only translates the familiar
MicroPython Pin/PWM/ADC calls into that buffer and into worker events.
"""

import sys
import time as _time
import simhw as _hw


_irq_enabled = True


def disable_irq():
    """Disable simulated GPIO IRQ dispatch and return the previous state."""
    global _irq_enabled
    state = _irq_enabled
    _irq_enabled = False
    return state


def enable_irq(state):
    """Restore the IRQ state returned by disable_irq()."""
    global _irq_enabled
    _irq_enabled = bool(state)
    return None


class Pin:
    IN = 0
    OUT = 1
    OPEN_DRAIN = 2
    PULL_UP = 1
    PULL_DOWN = 2
    IRQ_RISING = 1
    IRQ_FALLING = 2
    IRQ_LOW_LEVEL = 4
    IRQ_HIGH_LEVEL = 8
    DRIVE_0 = 0
    DRIVE_1 = 1
    DRIVE_2 = 2
    DRIVE_3 = 3

    # MicroPython treats a GPIO as one hardware resource even when user code
    # constructs Pin(pin_no) repeatedly.  Keep one virtual object per GPIO so
    # helper functions such as ``Pin(pin, Pin.OUT).on()`` do not grow the IRQ
    # polling list on every loop iteration.
    _instances = []
    _registry = {}

    def __new__(cls, pin_id, *args, **kwargs):
        if isinstance(pin_id, Pin):
            pin_id = pin_id.id()
        key = int(pin_id)
        existing = cls._registry.get(key)
        if existing is not None:
            return existing
        instance = super().__new__(cls)
        cls._registry[key] = instance
        return instance

    def __init__(self, pin_id, mode=-1, pull=None, *, value=None,
                 drive=DRIVE_0, alt=-1, hold=False):
        if isinstance(pin_id, Pin):
            pin_id = pin_id.id()
        if getattr(self, '_constructed', False):
            # A repeated constructor call may update the hardware mode or an
            # explicit initial value, but it must not erase an IRQ callback
            # installed on the same GPIO by an earlier Pin object.
            if mode != -1:
                self._mode = mode
            if pull is not None and pull != -1:
                self._pull = pull
            if drive != self.DRIVE_0:
                self._drive = int(drive)
            if alt != -1:
                self._alt = alt
            if hold is not False:
                self._hold = bool(hold)
            _hw.pin_init(self._id, self._mode, self._pull, value)
            if value is not None:
                self.value(value)
            return
        self._id = int(pin_id)
        self._mode = mode
        self._pull = pull
        self._drive = int(drive)
        self._alt = alt
        self._hold = bool(hold)
        self._handler = None
        self._trigger = 0
        self._irq_hard = False
        self._irq_wake = None
        self._last = int(_hw.pin_read(self._id))
        Pin._instances.append(self)
        self._constructed = True
        _hw.pin_init(self._id, mode, pull, value)
        if value is not None:
            self.value(value)

    def id(self):
        return self._id

    def init(self, mode=-1, pull=-1, *, value=None, drive=-1, alt=-1,
             hold=None):
        if mode != -1:
            self._mode = mode
        if pull != -1:
            self._pull = pull
        if drive != -1:
            self._drive = int(drive)
        if alt != -1:
            self._alt = alt
        if hold is not None:
            self._hold = bool(hold)
        _hw.pin_init(self._id, self._mode, self._pull, value)
        if value is not None:
            self.value(value)
        return None

    def value(self, value=None):
        if value is None:
            return int(_hw.pin_read(self._id))
        _hw.pin_write(self._id, 1 if value else 0)
        return None

    def on(self):
        self.value(1)

    def off(self):
        self.value(0)

    low = off

    def high(self):
        self.value(1)

    def toggle(self):
        self.value(not self.value())

    def mode(self, value=None):
        if value is None:
            return self._mode
        self.init(mode=value)
        return None

    def pull(self, value=-1):
        if value == -1:
            return self._pull
        self.init(pull=value)
        return None

    def drive(self, value=None):
        if value is None:
            return self._drive
        self.init(drive=value)
        return None

    def hold(self, value=None):
        if value is None:
            return self._hold
        self._hold = bool(value)
        return None

    def irq(self, handler=None, trigger=IRQ_FALLING | IRQ_RISING,
            wake=None, hard=False, **kwargs):
        self._handler = handler
        self._trigger = int(trigger)
        self._irq_wake = wake
        self._irq_hard = bool(hard)
        self._last = self.value()
        return self

    @classmethod
    def _poll_all(cls):
        _hw.poll_interrupt()
        if not _irq_enabled:
            return
        for pin in cls._instances:
            if pin._handler is None:
                continue
            current = pin.value()
            previous = pin._last
            pin._last = current
            rising = previous == 0 and current == 1
            falling = previous == 1 and current == 0
            if ((rising and pin._trigger & pin.IRQ_RISING) or
                    (falling and pin._trigger & pin.IRQ_FALLING) or
                    (falling and pin._trigger & pin.IRQ_LOW_LEVEL) or
                    (rising and pin._trigger & pin.IRQ_HIGH_LEVEL)):
                try:
                    pin._handler(pin)
                except Exception as exc:
                    sys.print_exception(exc)


class PWM:
    _instances = []

    def __init__(self, pin, freq=5000, duty=0, duty_u16=None):
        self.pin = pin if isinstance(pin, Pin) else Pin(pin, Pin.OUT)
        self._freq = int(freq)
        self._duty = 0
        PWM._instances.append(self)
        if duty_u16 is not None:
            self.duty_u16(duty_u16)
        else:
            self.duty(duty)

    def freq(self, value=None):
        if value is None:
            return self._freq
        self._freq = int(value)
        _hw.pwm_write(self.pin.id(), self._duty, self._freq)

    def duty_u16(self, value=None):
        if value is None:
            return self._duty
        self._duty = max(0, min(65535, int(value)))
        _hw.pwm_write(self.pin.id(), self._duty, self._freq)

    def duty(self, value=None):
        if value is None:
            return round(self._duty * 1023 / 65535)
        self.duty_u16(int(value) * 65535 // 1023)

    def deinit(self):
        self.duty_u16(0)


def _reset_simulator_state():
    """Release handlers and output objects before a new user program run."""
    global _irq_enabled
    _irq_enabled = True
    for pin in Pin._instances:
        pin._handler = None
        pin._trigger = 0
    Pin._instances.clear()
    Pin._registry.clear()
    for pwm in PWM._instances:
        pwm.deinit()
    PWM._instances.clear()


class ADC:
    ATTN_0DB = 0
    ATTN_2_5DB = 1
    ATTN_6DB = 2
    ATTN_11DB = 3
    WIDTH_9BIT = 0
    WIDTH_10BIT = 1
    WIDTH_11BIT = 2
    WIDTH_12BIT = 3

    def __init__(self, pin, **kwargs):
        self.pin = pin if isinstance(pin, Pin) else Pin(pin, Pin.IN)
        self._atten = kwargs.get('atten', self.ATTN_0DB)
        self._width = kwargs.get('width', self.WIDTH_12BIT)

    def init(self, *, atten=None, **kwargs):
        if atten is not None:
            self._atten = atten
        if 'width' in kwargs:
            self._width = kwargs['width']
        return None

    def read_u16(self):
        Pin._poll_all()
        return int(_hw.adc_read(self.pin.id()))

    def read(self):
        return self.read_u16() * 4095 // 65535

    def read_uv(self):
        # Simulator controls expose the full ESP IDE teaching range where
        # 0..65535 corresponds linearly to 0..3.3 V.  Keep the millivolt
        # resolution documented by the ESP32 MicroPython port.
        millivolts = (self.read_u16() * 3300 + 32767) // 65535
        return millivolts * 1000

    def atten(self, value=None):
        if value is None:
            return self._atten
        self._atten = value
        return self

    def width(self, value=None):
        if value is None:
            return self._width
        self._width = value
        return self

    def deinit(self):
        return None


_rtc_offset_seconds = 0


class RTC:
    _memory = b''

    def __init__(self, id=0, *args, **kwargs):
        self.id = int(id)

    def datetime(self, value=None):
        global _rtc_offset_seconds
        if value is None:
            current = _time.localtime(_time.time() + _rtc_offset_seconds)
            return (
                current[0], current[1], current[2], current[6],
                current[3], current[4], current[5], 0,
            )
        if len(value) != 8:
            raise ValueError('RTC datetime must be an 8-tuple')
        desired = _time.mktime((
            int(value[0]), int(value[1]), int(value[2]),
            int(value[4]), int(value[5]), int(value[6]), 0, 0,
        ))
        _rtc_offset_seconds = desired - _time.time()
        return None

    def init(self, value):
        padded = tuple(value) + (0,) * max(0, 8 - len(value))
        rtc_value = (
            padded[0], padded[1], padded[2], 0,
            padded[3], padded[4], padded[5], 0,
        )
        return self.datetime(rtc_value)

    now = datetime

    def memory(self, value=None):
        if value is None:
            return self.__class__._memory
        self.__class__._memory = bytes(value)
        return None

    def deinit(self):
        return None


class I2C:
    def __init__(self, id=-1, scl=None, sda=None, freq=400000, **kwargs):
        self.id = int(id) if isinstance(id, int) else 0
        self.scl = scl
        self.sda = sda
        self.freq = int(freq)
        scl_id = scl.id() if isinstance(scl, Pin) else (-1 if scl is None else int(scl))
        sda_id = sda.id() if isinstance(sda, Pin) else (-1 if sda is None else int(sda))
        self._bus_key = _hw.i2c_init(self.id, scl_id, sda_id, self.freq)
        self._delay_remainder = 0.0

    def scan(self):
        return list(_hw.i2c_scan(self._bus_key))

    def writeto(self, addr, buf, stop=True):
        data = bytes(buf)
        written = int(_hw.i2c_writeto(self._bus_key, int(addr), data))
        self._delay_remainder = _i2c_transfer_wait(
            len(data), self.freq, self._delay_remainder
        )
        return written

    def writevto(self, addr, vector, stop=True):
        data = b''.join(bytes(part) for part in vector)
        return self.writeto(addr, data, stop)

    def readfrom(self, addr, nbytes, stop=True):
        data = bytes(_hw.i2c_readfrom(self._bus_key, int(addr), int(nbytes)))
        self._delay_remainder = _i2c_transfer_wait(
            int(nbytes), self.freq, self._delay_remainder
        )
        return data

    def readfrom_into(self, addr, buffer, stop=True):
        data = self.readfrom(addr, len(buffer), stop)
        buffer[:len(data)] = data
        return None

    def writeto_mem(self, addr, memaddr, buf, *, addrsize=8):
        data = bytes(buf)
        _hw.i2c_writeto_mem(self._bus_key, int(addr), int(memaddr), data, int(addrsize))
        self._delay_remainder = _i2c_transfer_wait(
            len(data) + max(1, (int(addrsize) + 7) // 8),
            self.freq,
            self._delay_remainder,
        )
        return None

    def readfrom_mem(self, addr, memaddr, nbytes, *, addrsize=8):
        data = bytes(_hw.i2c_readfrom_mem(
            self._bus_key, int(addr), int(memaddr), int(nbytes), int(addrsize)
        ))
        self._delay_remainder = _i2c_transfer_wait(
            int(nbytes) + max(1, (int(addrsize) + 7) // 8),
            self.freq,
            self._delay_remainder,
        )
        return data

    def readfrom_mem_into(self, addr, memaddr, buffer, *, addrsize=8):
        data = self.readfrom_mem(addr, memaddr, len(buffer), addrsize=addrsize)
        buffer[:len(data)] = data
        return None

    def deinit(self):
        return None


SoftI2C = I2C


class SPI:
    MSB = 0

    def __init__(self, id=0, **kwargs):
        self.id = int(id)

    def write(self, data):
        _hw.spi_write(self.id, bytes(data))
        return None


def reset():
    raise RuntimeError("Simulator reset requested")


_raw_sleep = _time.sleep
_POLL_QUANTUM_SECONDS = 0.002
_ZERO_SLEEP_SECONDS = 0.001
_I2C_SPEED_MULTIPLIER = 1.25


def _poll():
    Pin._poll_all()
    flush_output = getattr(_hw, 'flush_stdout', None)
    if flush_output is not None:
        flush_output()


def _cooperative_wait(seconds):
    remaining = max(0.0, float(seconds))
    while remaining > 0:
        part = min(_POLL_QUANTUM_SECONDS, remaining)
        _raw_sleep(part)
        remaining -= part
        _poll()


def _i2c_transfer_wait(byte_count, frequency, remainder=0.0):
    # I2C transfers one ACK bit with every byte. Including one address byte
    # prevents a 128x64 OLED refresh from running hundreds of times faster
    # than the configured virtual bus while keeping the model deterministic.
    bits = (max(0, int(byte_count)) + 1) * 9
    effective_frequency = max(1, int(frequency) * _I2C_SPEED_MULTIPLIER)
    total = max(0.0, float(remainder)) + bits / effective_frequency
    whole_milliseconds = int(total * 1000)
    if whole_milliseconds:
        _cooperative_wait(whole_milliseconds / 1000)
        total -= whole_milliseconds / 1000
    return total


def _sim_sleep(seconds):
    remaining = max(0.0, float(seconds))
    _poll()
    if remaining <= 0:
        # sleep_ms(0) is a cooperative checkpoint in MicroPython programs.
        # A short real wait prevents a busy infinite loop from monopolising the
        # Worker (especially with byte-accurate REPL output) while the SAB/IRQ
        # poll still makes Ctrl+C and inputs visible.
        _raw_sleep(_ZERO_SLEEP_SECONDS)
        _poll()
        return
    _cooperative_wait(remaining)
    _poll()


def _sim_sleep_ms(milliseconds):
    _sim_sleep(float(milliseconds) / 1000)


def _sim_sleep_us(microseconds):
    _sim_sleep(float(microseconds) / 1000000)


_time.sleep = _sim_sleep
_time.sleep_ms = _sim_sleep_ms
_time.sleep_us = _sim_sleep_us
sys.modules["utime"] = _time
