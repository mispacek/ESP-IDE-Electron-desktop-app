# ESP IDE (AGPL-3.0) - Minimal BLE NUS REPL + Joystick
# Designed for low RAM usage, overwrite-on-full TX/RX buffers,
# and safe Ctrl-C handling (stops user code, not the driver).

import bluetooth, micropython, os, io, utime, gc
from micropython import const

try:
    from machine import Timer
except Exception:
    Timer = None

try:
    from ble_flag import request_stop, clear_stop
except Exception:
    def request_stop():
        pass
    def clear_stop():
        pass

# ===== Public joystick state =====
JOY_POS = [0, 0, 0, 0]
JOY_TS_MS = 0

def joy_read():
    try:
        return (JOY_POS, utime.ticks_ms() - JOY_TS_MS)
    except Exception:
        return ([0, 0, 0, 0], 0x7fffffff)

# ===== BLE / GATT constants =====
_IRQ_CENTRAL_CONNECT      = const(1)
_IRQ_CENTRAL_DISCONNECT   = const(2)
_IRQ_GATTS_WRITE          = const(3)
_IRQ_MTU_EXCHANGED        = const(21)

_FLAG_READ      = const(0x0002)
_FLAG_WRITE     = const(0x0008)
_FLAG_WRITE_NR  = const(0x0004)
_FLAG_NOTIFY    = const(0x0010)

# Nordic UART Service UUIDs (128-bit)
_UART_UUID = bluetooth.UUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
_UART_RX   = (bluetooth.UUID("6E400002-B5A3-F393-E0A9-E50E24DCCA9E"), _FLAG_WRITE | _FLAG_WRITE_NR)
_UART_TX   = (bluetooth.UUID("6E400003-B5A3-F393-E0A9-E50E24DCCA9E"), _FLAG_NOTIFY)
_UART_SERVICE = (_UART_UUID, (_UART_TX, _UART_RX))

# Optional joystick service (4 bytes write)
_JOY_UUID = bluetooth.UUID("23F10010-5F90-11EE-8C99-0242AC120002")
_JOY_CHAR = (bluetooth.UUID("23F10012-5F90-11EE-8C99-0242AC120002"), _FLAG_WRITE | _FLAG_WRITE_NR)
_JOY_SERVICE = (_JOY_UUID, (_JOY_CHAR,))

# ===== Advertising payload generator (fits in 31 bytes) =====
_ADV_TYPE_FLAGS            = const(0x01)
_ADV_TYPE_NAME             = const(0x09)
_ADV_TYPE_UUID128_COMPLETE = const(0x07)


def _adv_payload(name_b):
    out = bytearray()
    def add(t, v):
        if len(out) + 2 + len(v) > 31:
            return
        out.append(len(v) + 1)
        out.append(t)
        out.extend(v)
    add(_ADV_TYPE_FLAGS, b"\x06")
    if name_b:
        # Reserve space for UUID.
        room = 31 - (2 + 1 + 16)
        name_b = name_b[:max(0, room-2)]
        add(_ADV_TYPE_NAME, name_b)
    add(_ADV_TYPE_UUID128_COMPLETE, bytes(_UART_UUID))
    return bytes(out)


# ===== Overwrite-on-full ring buffer =====
class _Ring:
    __slots__ = ("_b", "_n", "_h", "_t", "_full")
    def __init__(self, n):
        s = 1
        while s < int(n):
            s <<= 1
        self._n = s
        self._b = bytearray(s)
        self._h = 0
        self._t = 0
        self._full = False

    def capacity(self):
        return self._n

    def empty(self):
        return (not self._full) and (self._h == self._t)

    def any(self):
        if self._full:
            return self._n
        return (self._h - self._t) & (self._n - 1)

    def reset(self):
        self._h = 0
        self._t = 0
        self._full = False

    def put_over(self, data):
        mv = data if isinstance(data, (bytes, bytearray, memoryview)) else memoryview(data)
        h = self._h
        t = self._t
        n = self._n
        b = self._b
        full = self._full
        dropped = 0
        for i in range(len(mv)):
            b[h] = mv[i]
            h = (h + 1) & (n - 1)
            if full:
                t = (t + 1) & (n - 1)
                dropped += 1
            full = (h == t)
        self._h = h
        self._t = t
        self._full = full
        return dropped

    def get_into(self, mv, nmax):
        if self.empty():
            return 0
        out = 0
        L = min(nmax, len(mv))
        b = self._b
        t = self._t
        h = self._h
        n = self._n
        full = self._full
        while out < L and (full or t != h):
            mv[out] = b[t]
            t = (t + 1) & (n - 1)
            full = False
            out += 1
        self._t = t
        self._full = full
        return out

    def peek_into(self, mv, nmax):
        if self.empty():
            return 0
        out = 0
        L = min(nmax, len(mv), self.any())
        b = self._b
        t = self._t
        h = self._h
        n = self._n
        full = self._full
        while out < L and (full or t != h):
            mv[out] = b[t]
            t = (t + 1) & (n - 1)
            full = False
            out += 1
        return out

    def advance(self, n):
        if n <= 0:
            return 0
        cnt = min(n, self.any())
        self._t = (self._t + cnt) & (self._n - 1)
        self._full = False
        return cnt


_ACTIVE = None

# ===== Minimal file transfer (stop-and-wait ACK per packet) =====
_FT_MAGIC = b"\xFA\xCE\xB0\x0C"
_FT_HDR_LEN = 8  # 4B magic + 1B name_len + 3B file_len (LE, 24-bit)
_FT_MAX_NAME = 48
_FT_ACK_OK = 0x06
_FT_ACK_ERR = 0x15


def _sum8(data):
    s = 0
    for b in data:
        s = (s + b) & 0xFF
    return s


class BLENUSRepl(io.IOBase):
    __slots__ = (
        "_ble", "_conn", "_conn_h", "_h_tx", "_h_rx", "_h_joy",
        "_rx", "_tx", "_tx_drop", "_mtu", "_chunk", "_mtu_pref",
        "_adv", "_name",
        "_use_timer", "_tmr", "_tmr_period",
        "_pump_pending", "_pumping",
        "_tx_ready", "_stats_pending",
        "_burst", "_burst_max", "_backoff_until_ms",
        "_tx_buf", "_tx_mv",
        "_debug",
        "_dupterm_slot", "_dupterm_on",
        "_rx_attr",
        "_ft_on", "_ft_stage", "_ft_pos",
        "_ft_name_len", "_ft_len", "_ft_rem", "_ft_seq",
        "_ft_buf", "_ft_ack_buf", "_ft_stat_buf", "_ft_stats_msg",
        "_ft_file", "_ft_err", "_ft_hello_tries", "_ft_hello_next_ms", "_ft_sink"
    )

    def __init__(self, *, name=b"MPY-REPL", rx_attr=240, rx_ring=1024, tx_ring=1024,
                 mtu_pref=240, use_timer=True, timer_period_ms=30, debug=False):
        self._debug = 1 if debug else 0

        self._rx_attr = int(rx_attr)
        self._ble = bluetooth.BLE()
        self._ble.active(True)
        self._ble.irq(self._irq)

        self._conn = False
        self._conn_h = 0
        self._tx_drop = 0
        self._pump_pending = 0
        self._pumping = 0
        self._tx_ready = 0
        self._stats_pending = 0
        self._mtu_pref = int(mtu_pref) if mtu_pref else 23
        self._mtu = 23
        self._chunk = 20
        self._rx = _Ring(rx_ring)
        self._tx = _Ring(tx_ring)

        self._use_timer = bool(use_timer and Timer is not None)
        self._tmr = None
        self._tmr_period = int(timer_period_ms) if timer_period_ms else 30

        # TX flow control window
        self._burst_max = 4
        self._burst = 1
        self._backoff_until_ms = 0

        # Dupterm state
        self._dupterm_slot = 0
        self._dupterm_on = 0

        # GATTS services
        try:
            ((self._h_tx, self._h_rx), (self._h_joy,)) = self._ble.gatts_register_services((_UART_SERVICE, _JOY_SERVICE))
        except Exception:
            ((self._h_tx, self._h_rx),) = self._ble.gatts_register_services((_UART_SERVICE,))
            self._h_joy = None

        try:
            self._ble.gatts_set_buffer(self._h_rx, int(rx_attr), True)
        except Exception:
            pass
        if self._h_joy is not None:
            try:
                self._ble.gatts_set_buffer(self._h_joy, 4, True)
            except Exception:
                pass

        # GAP name
        self._name = name if isinstance(name, (bytes, bytearray)) else str(name).encode()
        try:
            self._ble.config(gap_name=self._name.decode('ascii', 'ignore'))
        except Exception:
            pass

        # Preallocated TX buffer (avoid runtime allocation)
        max_chunk = max(20, min(244, self._mtu_pref - 3))
        self._tx_buf = bytearray(max_chunk)
        self._tx_mv = memoryview(self._tx_buf)

        # File transfer state (minimal)
        self._ft_on = 0
        self._ft_stage = 0
        self._ft_pos = 0
        self._ft_name_len = 0
        self._ft_len = 0
        self._ft_rem = 0
        self._ft_seq = 0
        self._ft_buf = bytearray(_FT_HDR_LEN + _FT_MAX_NAME)
        self._ft_ack_buf = bytearray(3)
        self._ft_stat_buf = bytearray(8)
        self._ft_stats_msg = b"BLE Config\n"
        self._ft_file = None
        self._ft_err = 0
        self._ft_hello_tries = 0
        self._ft_hello_next_ms = 0
        self._ft_sink = 0

        # MTU preference and initial chunk
        try:
            self._ble.config(mtu=self._mtu_pref)
        except Exception:
            pass
        self._refresh_mtu()

        # Advertising
        self._adv = _adv_payload(self._name)
        self._advertise()

        # Optional TX timer
        if self._use_timer:
            try:
                self._tmr = Timer(1)
                self._tmr.init(period=self._tmr_period, mode=Timer.PERIODIC, callback=self._tmr_isr)
            except Exception:
                self._tmr = None
                self._use_timer = False

    # ===== dupterm stream =====
    def readinto(self, b):
        mv = memoryview(b)
        n = self._rx.get_into(mv, len(mv))
        return None if n == 0 else n

    def write(self, buf):
        out_len = len(buf)
        if not self._conn:
            return out_len
        if not self._tx_ready:
            return out_len
        # If user code start message appears, clear stop flag
        try:
            if (isinstance(buf, (bytes, bytearray)) and (b"run_code(" in buf or b"run_code()" in buf)) or \
               (isinstance(buf, str) and ("run_code(" in buf)):
                clear_stop()
        except Exception:
            pass
        dropped = self._tx.put_over(buf)
        if dropped:
            self._tx_drop += dropped
        if self._use_timer:
            if self._tx.any() <= self._chunk:
                self._schedule_pump()
        else:
            self._schedule_pump()
        return out_len

    def ioctl(self, op, arg):
        # _MP_STREAM_POLL = 3, RD = 1
        return 1 if (op == 3 and self._rx.any()) else 0

    # ===== internals =====
    def _refresh_mtu(self):
        try:
            self._mtu = int(self._ble.config('mtu'))
        except Exception:
            self._mtu = 23
        self._chunk = 20 if self._mtu < 27 else min(len(self._tx_buf), self._mtu - 3)
        try:
            self._ft_stats_msg = b"BLE Config mtu=%d chunk=%d\n" % (self._mtu, self._chunk)
        except Exception:
            self._ft_stats_msg = b"BLE Config\n"
        try:
            self._ble.gatts_set_buffer(self._h_rx, max(64, self._chunk), True)
        except Exception:
            pass

    def _advertise(self, interval_us=200000):
        try:
            self._ble.gap_advertise(interval_us, adv_data=self._adv)
        except Exception:
            pass

    def _now(self):
        return utime.ticks_ms()

    def _backing_off(self):
        return utime.ticks_diff(self._backoff_until_ms, self._now()) > 0

    def _schedule_pump(self):
        if self._pump_pending or self._pumping:
            return
        self._pump_pending = 1
        try:
            micropython.schedule(self._pump, 0)
        except Exception:
            # allow next IRQ/timer to retry
            self._pump_pending = 0

    def _schedule_stats(self):
        if self._stats_pending:
            return
        self._stats_pending = 1
        try:
            micropython.schedule(self._send_stats_scheduled, 0)
        except Exception:
            self._stats_pending = 0

    def _send_stats_scheduled(self, _=0):
        self._stats_pending = 0
        self._ft_send_stats()

    def _enable_tx(self):
        if not self._conn:
            return
        if not self._tx_ready:
            self._tx_ready = 1
            self._tx.reset()
            self._burst = 1
            self._backoff_until_ms = 0
        try:
            if not self._dupterm_on:
                os.dupterm(self, self._dupterm_slot)
                self._dupterm_on = 1
                try:
                    os.dupterm_notify(None)
                except Exception:
                    pass
        except Exception:
            pass

    def _pump(self, _=0):
        if self._pumping:
            return
        self._pumping = 1
        try:
            if not self._conn or not self._tx_ready:
                return
            if self._use_timer and self._backing_off():
                return

            burst_left = self._burst if self._burst > 0 else 1
            sent_ok = 0

            while burst_left and not self._tx.empty():
                n = self._tx.peek_into(self._tx_mv, self._chunk)
                if not n:
                    break
                try:
                    self._ble.gatts_notify(self._conn_h, self._h_tx, self._tx_mv[:n])
                except Exception:
                    self._burst = 1 if self._burst <= 2 else self._burst // 2
                    self._backoff_until_ms = utime.ticks_add(self._now(), 15)
                    break
                else:
                    self._tx.advance(n)
                    sent_ok += 1
                    burst_left -= 1

            if sent_ok and self._burst < self._burst_max:
                self._burst += 1

            if not self._use_timer and not self._tx.empty():
                self._schedule_pump()
        finally:
            self._pumping = 0
            self._pump_pending = 0

    def _tmr_isr(self, _t):
        try:
            if self._conn and self._tx_ready and not self._tx.empty() and not self._pumping:
                if not self._backing_off():
                    self._schedule_pump()
            if self._conn and self._tx_ready and self._ft_hello_tries > 0:
                now = self._now()
                if utime.ticks_diff(now, self._ft_hello_next_ms) >= 0:
                    self._schedule_stats()
                    self._ft_hello_tries -= 1
                    self._ft_hello_next_ms = utime.ticks_add(now, 200)
        except Exception:
            pass

    # ===== minimal file transfer =====
    def _ft_reset(self):
        try:
            if self._ft_file is not None:
                self._ft_file.close()
        except Exception:
            pass
        self._ft_file = None
        self._ft_on = 0
        self._ft_stage = 0
        self._ft_pos = 0
        self._ft_name_len = 0
        self._ft_len = 0
        self._ft_rem = 0
        self._ft_seq = 0
        self._ft_err = 0
        self._ft_sink = 0

    def _ft_enter(self):
        # Stop user code and detach dupterm to avoid REPL noise.
        if self._ft_on:
            self._ft_reset()
        self._ft_hello_tries = 0
        try:
            request_stop()
        except Exception:
            pass
        try:
            if self._dupterm_on:
                os.dupterm(None, self._dupterm_slot)
                self._dupterm_on = 0
        except Exception:
            pass
        # Clear RX/TX rings to avoid mixing REPL and file data.
        self._rx.reset()
        self._tx.reset()
        self._ft_on = 1
        self._ft_stage = 1
        self._ft_pos = 0
        self._ft_err = 0
        self._ft_seq = 0
        self._ft_name_len = 0
        self._ft_len = 0
        self._ft_rem = 0
        self._ft_sink = 0

    def _ft_exit(self):
        try:
            if self._ft_file is not None:
                self._ft_file.close()
        except Exception:
            pass
        self._ft_file = None
        # Clear RX/TX rings to avoid feeding file bytes into REPL after exit.
        self._rx.reset()
        self._tx.reset()
        self._ft_reset()
        # Restore dupterm after transfer
        try:
            if self._conn and self._tx_ready and not self._dupterm_on:
                os.dupterm(self, self._dupterm_slot)
                self._dupterm_on = 1
                try:
                    os.dupterm_notify(None)
                except Exception:
                    pass
        except Exception:
            pass

    def _ft_ack(self, ok, seq):
        if not self._conn or not self._tx_ready:
            return
        try:
            b = self._ft_ack_buf
            b[0] = _FT_ACK_OK if ok else _FT_ACK_ERR
            b[1] = seq & 0xFF
            b[2] = (seq >> 8) & 0xFF
            self._ble.gatts_notify(self._conn_h, self._h_tx, b)
        except Exception:
            pass

    def _ft_send_stats(self):
        if not self._conn or not self._tx_ready:
            return
        try:
            self._ble.gatts_notify(self._conn_h, self._h_tx, self._ft_stats_msg)
        except Exception:
            pass

    def _ft_fail(self):
        self._ft_ack(False, 0xFFFF)
        self._ft_exit()

    def _ft_handle_data_pkt(self, pkt):
        if not pkt:
            return
        mv = pkt if isinstance(pkt, memoryview) else memoryview(pkt)
        if (not self._ft_file) and (not self._ft_sink):
            return
        if self._ft_rem <= 0:
            return
        if len(mv) < 4:
            self._ft_ack(False, self._ft_seq)
            return
        seq = mv[0] | (mv[1] << 8)
        n = mv[2]
        if n != (len(mv) - 4):
            self._ft_ack(False, self._ft_seq)
            return
        if seq != self._ft_seq:
            self._ft_ack(False, self._ft_seq)
            return
        if n > self._ft_rem:
            self._ft_ack(False, self._ft_seq)
            return
        if _sum8(mv[:-1]) != mv[-1]:
            self._ft_ack(False, self._ft_seq)
            return
        if not self._ft_sink:
            try:
                self._ft_file.write(mv[3:3 + n])
            except Exception:
                self._ft_fail()
                return
        self._ft_rem -= n
        if ((self._ft_seq & 3) == 3) or (self._ft_rem == 0):
            self._ft_ack(True, self._ft_seq)
        self._ft_seq = (self._ft_seq + 1) & 0xFFFF
        if self._ft_rem == 0:
            self._ft_exit()

    def _ft_handle_pkt(self, pkt):
        if self._ft_err:
            return
        pkt_mv = pkt if isinstance(pkt, memoryview) else memoryview(pkt)
        idx = 0
        # stage 1: header
        if self._ft_stage == 1:
            need = _FT_HDR_LEN - self._ft_pos
            take = min(need, len(pkt_mv))
            if take:
                self._ft_buf[self._ft_pos:self._ft_pos + take] = pkt_mv[:take]
                self._ft_pos += take
                idx += take
            if self._ft_pos < _FT_HDR_LEN:
                return
            if self._ft_buf[:4] != _FT_MAGIC:
                self._ft_fail()
                return
            raw_n = self._ft_buf[4]
            if raw_n == 0xFF:
                self._ft_send_stats()
                self._ft_exit()
                return
            if raw_n == 0xFE:
                self._ft_ack(False, 0xFFFF)
                self._ft_exit()
                return
            self._ft_sink = 1 if (raw_n & 0x80) else 0
            self._ft_name_len = raw_n & 0x7F
            if self._ft_name_len > _FT_MAX_NAME:
                self._ft_fail()
                return
            self._ft_len = (self._ft_buf[5] | (self._ft_buf[6] << 8) | (self._ft_buf[7] << 16))
            self._ft_rem = self._ft_len
            self._ft_stage = 2
            self._ft_pos = 0

        # stage 2: filename
        if self._ft_stage == 2:
            if self._ft_name_len:
                need = self._ft_name_len - self._ft_pos
                take = min(need, len(pkt_mv) - idx)
                if take:
                    self._ft_buf[self._ft_pos:self._ft_pos + take] = pkt_mv[idx:idx + take]
                    self._ft_pos += take
                    idx += take
                if self._ft_pos < self._ft_name_len:
                    return
            # open file
            try:
                if not self._ft_sink:
                    name_b = self._ft_buf[:self._ft_name_len] if self._ft_name_len else b"data.bin"
                    name = name_b.decode('utf-8', 'ignore')
                    self._ft_file = open(name, "wb")
            except Exception:
                self._ft_fail()
                return
            self._ft_stage = 3
            self._ft_ack(True, 0xFFFF)
            if self._ft_len == 0:
                self._ft_exit()
                return

        # stage 3: data packets (per BLE write)
        if self._ft_stage == 3:
            if idx < len(pkt_mv):
                self._ft_handle_data_pkt(pkt_mv[idx:])

    # ===== IRQ =====
    def _irq(self, event, data):
        global JOY_POS, JOY_TS_MS
        try:
            if event == _IRQ_CENTRAL_CONNECT:
                self._conn = True
                self._conn_h, _, _ = data
                self._tx_ready = 0
                self._stats_pending = 0
                self._rx.reset()
                self._tx.reset()
                self._burst = 1
                self._backoff_until_ms = 0
                try:
                    self._ble.config(mtu=self._mtu_pref)
                except Exception:
                    pass
                self._refresh_mtu()
                self._ft_hello_tries = 0
                self._ft_hello_next_ms = 0
                # Enable dupterm only after the client opens UART RX/TX.
                try:
                    if self._dupterm_on:
                        os.dupterm(None, self._dupterm_slot)
                        self._dupterm_on = 0
                except Exception:
                    pass
                return

            if event == _IRQ_CENTRAL_DISCONNECT:
                self._conn = False
                self._conn_h = 0
                self._tx_ready = 0
                self._stats_pending = 0
                self._rx.reset()
                self._tx.reset()
                if self._ft_on:
                    self._ft_reset()
                self._ft_hello_tries = 0
                self._ft_hello_next_ms = 0
                try:
                    if self._dupterm_on:
                        os.dupterm(None, self._dupterm_slot)
                        self._dupterm_on = 0
                except Exception:
                    pass
                self._advertise()
                return

            if event == _IRQ_MTU_EXCHANGED:
                try:
                    if data[0] == self._conn_h:
                        self._mtu = int(data[1])
                        self._refresh_mtu()
                        if self._tx_ready:
                            self._schedule_stats()
                            self._ft_hello_tries = 3
                            self._ft_hello_next_ms = self._now()
                except Exception:
                    self._refresh_mtu()
                return

            if event == _IRQ_GATTS_WRITE:
                ch, vh = data
                if ch != self._conn_h:
                    return
                if vh == self._h_rx:
                    pkt = self._ble.gatts_read(self._h_rx) or b""
                    if pkt:
                        if not self._tx_ready:
                            self._enable_tx()
                            self._schedule_stats()
                            self._ft_hello_tries = 3
                            self._ft_hello_next_ms = self._now()
                        # Stop repeating BLE Config once client starts sending data.
                        if self._ft_hello_tries:
                            self._ft_hello_tries = 0
                            self._ft_hello_next_ms = 0
                        # Control frames during transfer or idle.
                        if len(pkt) >= 5 and pkt[:4] == _FT_MAGIC:
                            t = pkt[4]
                            if t == 0xFD:
                                # Status request: reply with expected seq.
                                self._ft_ack(True, self._ft_seq)
                                return
                            if t == 0xFE:
                                # Cancel request.
                                self._ft_ack(False, 0xFFFF)
                                self._ft_exit()
                                return
                            if t == 0xFF:
                                # Config request.
                                self._schedule_stats()
                                return
                        # Minimal file transfer: start/resync on magic header.
                        if len(pkt) >= 4 and pkt[:4] == _FT_MAGIC:
                            self._ft_enter()
                            self._ft_handle_pkt(pkt)
                            return
                        if self._ft_on:
                            self._ft_handle_pkt(pkt)
                            return
                        # Clear stop flag when IDE triggers run_code()
                        try:
                            if b"run_code()\r\n" in pkt or b"run_code()\n" in pkt or b"run_code(" in pkt:
                                clear_stop()
                        except Exception:
                            pass
                        # Ctrl-C stops user code, not driver
                        if b"\x03" in pkt:
                            try:
                                request_stop()
                            except Exception:
                                pass
                            pkt_mv = memoryview(pkt)
                            start = 0
                            while True:
                                i = pkt.find(b"\x03", start)
                                if i == -1:
                                    if start < len(pkt):
                                        self._rx.put_over(pkt_mv[start:])
                                    break
                                if i > start:
                                    self._rx.put_over(pkt_mv[start:i])
                                start = i + 1
                        else:
                            self._rx.put_over(pkt)
                        try:
                            os.dupterm_notify(None)
                        except Exception:
                            pass
                        self._schedule_pump()
                    return
                if (self._h_joy is not None) and (vh == self._h_joy):
                    b = self._ble.gatts_read(self._h_joy) or b"\x00\x00\x00\x00"
                    if len(b) < 4:
                        b = (b + b"\x00\x00\x00\x00")[:4]
                    JOY_POS[0] = (b[0] - 256) if (b[0] & 0x80) else b[0]
                    JOY_POS[1] = (b[1] - 256) if (b[1] & 0x80) else b[1]
                    JOY_POS[2] = (b[2] - 256) if (b[2] & 0x80) else b[2]
                    JOY_POS[3] = (b[3] - 256) if (b[3] & 0x80) else b[3]
                    JOY_TS_MS = utime.ticks_ms()
                    return
                # Likely CCCD write for notifications; use it to enable TX.
                self._enable_tx()
                self._schedule_stats()
                self._ft_hello_tries = 3
                self._ft_hello_next_ms = self._now()
                return
        except Exception:
            # never raise from IRQ
            pass

    # ===== diagnostics =====
    def stats(self):
        return {
            'connected': bool(self._conn),
            'tx_ready': bool(self._tx_ready),
            'mtu': self._mtu,
            'notify_chunk': self._chunk,
            'rx_pending': self._rx.any(),
            'tx_pending': self._tx.any(),
            'tx_dropped': self._tx_drop,
        }

    def mem_usage(self):
        gc.collect()
        out = {
            'rx_ring': self._rx.capacity(),
            'tx_ring': self._tx.capacity(),
            'rx_attr': int(self._rx_attr),
            'tx_chunk_buf': len(self._tx_buf),
            'gc_free': gc.mem_free(),
            'gc_alloc': gc.mem_alloc(),
        }
        return out


# ===== Public API =====

def get_active():
    return _ACTIVE


def start_ble_repl_bletime(*, name=b"MPY-REPL", slot=0, rx_attr=240, rx_ring=1024, tx_ring=1024,
                            mtu_pref=240, use_timer=True, timer_period_ms=30, debug=False):
    """Start BLE NUS REPL and prepare dupterm for on-connect attach.
    Returns the driver instance.
    """
    global _ACTIVE
    dev = BLENUSRepl(name=name, rx_attr=rx_attr, rx_ring=rx_ring, tx_ring=tx_ring,
                     mtu_pref=mtu_pref, use_timer=use_timer, timer_period_ms=timer_period_ms, debug=debug)
    try:
        dev._dupterm_slot = int(slot)
    except Exception:
        dev._dupterm_slot = 0
    dev._dupterm_on = 0
    try:
        os.dupterm(None, dev._dupterm_slot)
    except Exception:
        pass
    _ACTIVE = dev
    return dev


if __name__ == '__main__':
    start_ble_repl_bletime(debug=True)
