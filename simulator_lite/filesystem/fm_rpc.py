# ┌────────────────────────────────────────────┐
# │ ESP IDE  : FREE MicroPython WEB IDE        │
# │ AUTHOR   : Milan Spacek (2019–2026)        │
# │ WEB      : https://espide.eu               │
# │ LICENSE  : AGPL-3.0                        │
# │                                            │
# │ CODE IS OPEN — IMPROVEMENTS MUST STAY OPEN │
# │ Please contribute your improvements back   │
# └────────────────────────────────────────────┘
# fm_rpc.py — MicroPython helpers for REPL-based file management
# Place to /lib/fm_rpc.py (or anywhere on sys.path)

import os, sys

try:
    from ble_flag import request_stop, clear_stop
except Exception:
    def request_stop():
        pass
    def clear_stop():
        pass

try:
    import ujson as json
except Exception:
    import json  # type: ignore

try:
    import ubinascii as binascii
except Exception:
    import binascii  # type: ignore

BUF = 4096

FRAME_START = "<<FMF>>"
FRAME_END = "<<FMF_END>>"

try:
    _crc32_impl = binascii.crc32
except Exception:
    _crc32_impl = None

def _crc32_bytes(data):
    try:
        if _crc32_impl:
            return _crc32_impl(data) & 0xFFFFFFFF
    except Exception:
        pass
    crc = 0xFFFFFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xEDB88320
            else:
                crc >>= 1
    return (crc ^ 0xFFFFFFFF) & 0xFFFFFFFF

def _hex8(n):
    return "{:08X}".format(n & 0xFFFFFFFF)

def _pct_encode(s):
    if isinstance(s, bytes):
        b = s
    else:
        try:
            b = s.encode("utf-8")
        except Exception:
            b = str(s).encode("utf-8", "ignore")
    out = []
    for c in b:
        if (48 <= c <= 57) or (65 <= c <= 90) or (97 <= c <= 122) or c in (45, 46, 95, 47):
            out.append(chr(c))
        else:
            out.append("%{:02X}".format(c))
    return "".join(out)

def _frame_send(ftype, payload, payload_bytes=None):
    if payload is None:
        payload = ""
    if payload_bytes is None:
        if isinstance(payload, bytes):
            payload_bytes = payload
            try:
                payload = payload.decode("ascii")
            except Exception:
                payload = payload.decode("ascii", "ignore")
        else:
            if not isinstance(payload, str):
                payload = str(payload)
            try:
                payload_bytes = payload.encode("ascii")
            except Exception:
                payload_bytes = payload.encode("ascii", "ignore")
                payload = payload_bytes.decode("ascii", "ignore")
    ln = len(payload_bytes)
    crc = _crc32_bytes(payload_bytes)
    print(FRAME_START + ftype + "|" + _hex8(ln) + "|" + _hex8(crc))
    print(payload)
    print(FRAME_END)

# ---------- PATH HELPERS ----------

def _norm(path):
    if not path:
        return "/"
    p = path.replace("\\", "/")
    if not p.startswith("/"):
        p = "/" + p
    while '//' in p:
        p = p.replace('//', '/')
    if len(p) > 1 and p.endswith('/'):
        p = p[:-1]
    return p

def _join(a, b):
    if not a:
        a = "/"
    if b.startswith("/"):
        return _norm(b)
    if not a.endswith("/"):
        a = a + "/"
    return _norm(a + b)

def _exists(p):
    try:
        os.stat(p)
        return True
    except Exception:
        return False

# Prijima bitove "mode" *nebo* cestu; vraci True pokud je to adresar.
def _isdir(x):
    try:
        if isinstance(x, int):
            return (x & 0x4000) != 0
        st = os.stat(x)
        return (st[0] & 0x4000) != 0
    except Exception:
        return False

# ---------- PAGED LIST (JSON RPC) USED BY STATUS ----------

def statvfs():
    try:
        clear_stop()
    except Exception:
        pass
    try:
        s = os.statvfs("/")
        total = s[0] * s[2]
        free  = s[0] * s[3]
    except Exception:
        total = 0
        free = 0
    return {"memoryTotal": int(total), "memoryFree": int(free)}

def status():
    try:
        clear_stop()
    except Exception:
        pass
    r = {"progress": 0}
    r.update(statvfs())
    return r

# ---------- BASIC OPS USED BY FRONTEND ----------

def mkdir(path):
    try:
        clear_stop()
    except Exception:
        pass
    p = _norm(path)
    if _exists(p):
        return {"ok": False, "error": "exists"}
    try:
        os.mkdir(p)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def rename(src, dst):
    try:
        clear_stop()
    except Exception:
        pass
    s = _norm(src)
    d = _norm(dst)
    try:
        os.rename(s, d)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# ---------- COPY / MOVE (FIXED DIR SUPPORT) ----------

def _copy_file(src, dst):
    with open(src, "rb") as fsrc, open(dst, "wb") as fdst:
        while True:
            b = fsrc.read(BUF)
            if not b:
                break
            fdst.write(b)

def _copy_tree(src, dst):
    # vytvor cilovou slozku, pokud neexistuje
    try:
        os.mkdir(dst)
    except Exception:
        pass

    # ilistdir muze vracet ruzne tupliky dle portu
    try:
        it = os.ilistdir(src)
    except Exception:
        # fallback
        for name in os.listdir(src):
            s = _join(src, name)
            d = _join(dst, name)
            if _isdir(s):
                _copy_tree(s, d)
            else:
                _copy_file(s, d)
        return

    for ent in it:
        try:
            name = ent[0] if isinstance(ent, tuple) else ent
            typ  = ent[1] if isinstance(ent, tuple) and len(ent) > 1 else None
            s = _join(src, name)
            d = _join(dst, name)
            isd = _isdir(typ) if typ is not None else _isdir(s)
            if isd:
                _copy_tree(s, d)
            else:
                _copy_file(s, d)
        except Exception:
            # pokracuj dal, at jedna chyba nezastavi strom
            continue

def _is_subpath(parent, child):
    p = _norm(parent) + "/"
    c = _norm(child) + "/"
    return c.startswith(p)

def copy(src_list, dest_dir):
    try:
        clear_stop()
    except Exception:
        pass

    dest = _norm(dest_dir)
    if not _exists(dest):
        try:
            os.mkdir(dest)
        except Exception:
            return {"ok": False, "error": "dest not exists"}

    for s0 in src_list or []:
        s = _norm(s0)
        base = s.rsplit("/", 1)[-1]
        d = _join(dest, base)

        # ochrana: nezkopirovat adresar do sebe/pod sebe
        if _isdir(s) and _is_subpath(s, d):
            return {"ok": False, "error": "cannot copy dir into itself"}

        try:
            if _isdir(s):
                _copy_tree(s, d)
            else:
                _copy_file(s, d)
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return {"ok": True}

def move(src_list, dest_dir):
    try:
        clear_stop()
    except Exception:
        pass

    dest = _norm(dest_dir)
    if not _exists(dest):
        try:
            os.mkdir(dest)
        except Exception:
            return {"ok": False, "error": "dest not exists"}

    for s0 in src_list or []:
        s = _norm(s0)
        base = s.rsplit("/", 1)[-1]
        d = _join(dest, base)

        # ochrana: nepresouvat adresar do vlastniho podstromu
        if _isdir(s) and _is_subpath(s, d):
            return {"ok": False, "error": "cannot move dir into itself"}

        try:
            os.rename(s, d)
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return {"ok": True}

# ---------- DELETE TREE ----------

def _rmtree(path):
    if not _exists(path):
        return
    if _isdir(path):
        try:
            entries = os.ilistdir(path)
        except Exception:
            entries = [(n,) for n in os.listdir(path)]
        for e in entries:
            name = e[0] if isinstance(e, tuple) else e
            _rmtree(_join(path, name))
        try:
            os.rmdir(path)
        except Exception:
            pass
    else:
        try:
            os.remove(path)
        except Exception:
            pass

def delete_all(path):
    try:
        clear_stop()
    except Exception:
        pass
    try:
        delete_path(path)
    except AttributeError:
        _rmtree(path)

def delete_path(path):
    try:
        clear_stop()
    except Exception:
        pass

    import os
    try:
        p = _norm(path)
    except Exception:
        p = path or "/"

    if not p or p == "/":
        raise ValueError("refuse to delete root '/'")

    stack = [p]
    while stack:
        cur = stack.pop()
        try:
            mode = os.stat(cur)[0]
        except Exception:
            continue

        if (mode & 0x4000) == 0:
            try:
                os.remove(cur)
            except Exception:
                pass
            continue

        try:
            entries = list(os.ilistdir(cur))
        except Exception:
            try:
                entries = [(n,) for n in os.listdir(cur)]
            except Exception:
                entries = []

        if not entries:
            try:
                os.rmdir(cur)
            except Exception:
                pass
        else:
            stack.append(cur)
            bp = cur + ("" if cur.endswith("/") else "/")
            for e in entries:
                name = e[0] if isinstance(e, tuple) else e
                stack.append(bp + name)

# ---------- STREAMED DOWNLOAD + LIST (textove protokoly pro frontend) ----------

def fm_down(path, chunk_bytes, pause_ms):
    try:
        clear_stop()
    except Exception:
        pass

    try:
        import uos
        import ubinascii
        import utime
    except Exception:
        _frame_send("DLR", _pct_encode("import error"))
        return False

    try:
        chunk = int(chunk_bytes)
        pause = int(pause_ms)
        if chunk < 1:
            chunk = 1
        if pause < 0:
            pause = 0
    except Exception:
        _frame_send("DLR", _pct_encode("invalid params"))
        return False

    try:
        st = uos.stat(path)
        size = st[6]
        f = open(path, "rb")
    except Exception as e:
        _frame_send("DLR", _pct_encode("open error: " + str(e)))
        return False

    try:
        buf = bytearray(chunk)
        mv = memoryview(buf)
    except Exception as e:
        try:
            f.close()
        except Exception:
            pass
        _frame_send("DLR", _pct_encode("buffer error: " + str(e)))
        return False

    _frame_send("DLH", _pct_encode(path) + ";" + str(size))

    ok = True
    try:
        while True:
            n = f.readinto(buf)
            if not n:
                break
            b64 = ubinascii.b2a_base64(mv[:n])[:-1]
            try:
                payload = b64.decode("ascii")
            except Exception:
                payload = b64.decode("ascii", "ignore")
            _frame_send("DLC", payload, b64)
            if pause:
                utime.sleep_ms(pause)
    except Exception as e:
        ok = False
        _frame_send("DLR", _pct_encode("transfer error: " + str(e)))
    finally:
        try:
            f.close()
        except Exception:
            ok = False

    if ok:
        _frame_send("DLD", "OK")
        return True
    return False

def fm_list(path="/", pause_ms=0):
    try:
        clear_stop()
    except Exception:
        pass

    try:
        import os, utime
    except Exception:
        _frame_send("LSR", _pct_encode("import error"))
        return False

    try:
        p = path or "/"
        p = p.replace("\\", "/")
        if not p.startswith("/"):
            p = "/" + p
        while '//' in p:
            p = p.replace('//', '/')
        if len(p) > 1 and p.endswith('/'):
            p = p[:-1]
    except Exception:
        _frame_send("LSR", _pct_encode("path error"))
        return False

    try:
        it = os.ilistdir(p)
    except Exception as e:
        _frame_send("LSR", _pct_encode("list error: " + str(e)))
        return False

    _frame_send("LSTH", _pct_encode(p))

    ok = True

    def _isdir_mode(mode):
        try:
            return (mode & 0x4000) != 0
        except Exception:
            return False

    def _join2(a, b):
        if not a.endswith("/"):
            a = a + "/"
        return (a + b).replace("//", "/")

    try:
        for t in it:
            try:
                name = t[0] if isinstance(t, tuple) else t
                # /dev is required by the WASM REPL internally, but it is not
                # a user directory on a normal MicroPython board.
                if p == "/" and name == "dev":
                    continue
                typ  = t[1] if isinstance(t, tuple) and len(t) > 1 else None
                size = t[3] if isinstance(t, tuple) and len(t) > 3 else None

                full = _join2(p, name)

                if typ is None or size is None:
                    try:
                        st = os.stat(full)
                        mode = st[0]
                        sz   = st[6] if len(st) > 6 else 0
                    except Exception:
                        mode = 0
                        sz = 0
                else:
                    mode = typ
                    sz = 0 if _isdir_mode(mode) else (size or 0)

                is_dir = _isdir_mode(mode)
                kind = "D" if is_dir else "F"
                nm = _pct_encode(name)
                _frame_send("LSTE", "{};{};{}".format(nm, sz, kind))

                if pause_ms:
                    utime.sleep_ms(int(pause_ms))
            except Exception:
                ok = False
                continue
    except Exception:
        ok = False

    if ok:
        _frame_send("LSTD", "OK")
        return True
    _frame_send("LSR", _pct_encode("list error"))
    return False
