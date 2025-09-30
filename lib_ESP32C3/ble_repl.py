# REPL over BLE UART

import bluetooth
import io
import os
import micropython
import machine
import ble_nus

_MP_STREAM_POLL = micropython.const(3)
_MP_STREAM_POLL_RD = micropython.const(0x0001)


_timer = machine.Timer(0)



# Batch writes into 30ms intervals.
def schedule_in(handler, delay_ms):
    def _wrap(_arg):
        handler()

    if _timer:
        _timer.init(mode=machine.Timer.ONE_SHOT, period=delay_ms, callback=_wrap)
    else:
        micropython.schedule(_wrap, None)


# Simple buffering stream to support the dupterm requirements.
class BLEUARTStream(io.IOBase):
    def __init__(self, uart):
        self._uart = uart
        self._tx_buf = bytearray()
        self._uart.irq(self._on_rx)

    def _on_rx(self):
        # Needed for ESP32.
        if hasattr(os, "dupterm_notify"):
            os.dupterm_notify(None)

    def read(self, sz=None):
        return self._uart.read(sz)

    def readinto(self, buf):
        avail = self._uart.read(len(buf))
        if not avail:
            return None
        for i in range(len(avail)):
            buf[i] = avail[i]
        return len(avail)

    def ioctl(self, op, arg):
        if op == _MP_STREAM_POLL:
            if self._uart.any():
                return _MP_STREAM_POLL_RD
        return 0

    def _flush(self):
        data = self._tx_buf[0:200]
        self._tx_buf = self._tx_buf[200:]
        self._uart.write(data)
        if self._tx_buf:
            schedule_in(self._flush, 30)

    def write(self, buf):
        empty = not self._tx_buf
        self._tx_buf += buf
        if empty:
            schedule_in(self._flush, 30)


def start(ble_name="mpy-repl"):
    ble = bluetooth.BLE()
    uart = ble_nus.BLEUART(ble, name=ble_name)
    stream = BLEUARTStream(uart)

    os.dupterm(stream)
