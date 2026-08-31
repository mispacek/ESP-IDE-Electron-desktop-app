# ┌────────────────────────────────────────────┐
# │ ESP IDE  : FREE MicroPython WEB IDE        │
# │ AUTHOR   : Milan Spacek (2019–2026)        │
# │ WEB      : https://espide.eu               │
# │ LICENSE  : AGPL-3.0                        │
# │                                            │
# │ CODE IS OPEN — IMPROVEMENTS MUST STAY OPEN │
# │ Please contribute your improvements back   │
# └────────────────────────────────────────────┘
# Jednoduchy stop flag. BLE driver pri ^C nastavi flag. Knihovny ho respektuji.
_stop = 0

def request_stop():
    global _stop
    _stop = 1

def clear_stop():
    global _stop
    _stop = 0

def stop_requested():
    return _stop == 1

def raise_if_stop():
    if _stop:
        raise KeyboardInterrupt