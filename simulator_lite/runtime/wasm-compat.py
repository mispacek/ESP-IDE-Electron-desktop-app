"""Only the WebAssembly compatibility shims that the real boot.py needs."""

import sys
import micropython as _real_micropython


if not hasattr(_real_micropython, "alloc_emergency_exception_buf"):
    class _MicroPythonCompat:
        def __getattr__(self, name):
            return getattr(_real_micropython, name)

        def alloc_emergency_exception_buf(self, size):
            return None

    sys.modules["micropython"] = _MicroPythonCompat()
