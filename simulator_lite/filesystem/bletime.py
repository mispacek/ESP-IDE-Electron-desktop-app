# ┌────────────────────────────────────────────┐
# │ ESP IDE  : FREE MicroPython WEB IDE        │
# │ AUTHOR   : Milan Spacek (2019–2026)        │
# │ WEB      : https://espide.eu               │
# │ LICENSE  : AGPL-3.0                        │
# │                                            │
# │ CODE IS OPEN — IMPROVEMENTS MUST STAY OPEN │
# │ Please contribute your improvements back   │
# └────────────────────────────────────────────┘
# Drop in nahrada za utime se stop flagem a presnou sleep_ms().
import utime as _u
from ble_flag import stop_requested, raise_if_stop, clear_stop

def sleep_ms(ms):
    """Presne cekani ms s yieldem a kontrolou stop‑flagu.
    Velke useky porcujeme po 1 ms, zbytek dojizdime pres sleep_us.
    """
    m = int(ms)
    if m <= 0:
        if stop_requested():
            clear_stop()
            raise KeyboardInterrupt
        _u.sleep_ms(0)
        return
    end_us = _u.ticks_add(_u.ticks_us(), m * 1000)
    while True:
        if stop_requested():
            clear_stop()
            raise KeyboardInterrupt
        rem_us = _u.ticks_diff(end_us, _u.ticks_us())
        if rem_us <= 0:
            return
        if rem_us >= 2000:
            _u.sleep_ms(1)
        else:
            _u.sleep_us(rem_us)
            return

def sleep(s):
    if s <= 0:
        if stop_requested():
            clear_stop()
            raise KeyboardInterrupt
        return
    ms = int(round(s * 1000.0))
    sleep_ms(ms)

def ticks_ms():
    raise_if_stop()
    return _u.ticks_ms()

def ticks_us():
    raise_if_stop()
    return _u.ticks_us()

def ticks_add(t, d):
    raise_if_stop()
    return _u.ticks_add(t, d)

def ticks_diff(a, b):
    return _u.ticks_diff(a, b)

# Reexport vybranych symbolu
time      = _u.time
localtime = _u.localtime
mktime    = _u.mktime