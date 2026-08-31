"""Small virtual network module compatible with common ESP32 examples."""

STA_IF = 0
AP_IF = 1
STAT_IDLE = 0
STAT_CONNECTING = 1
STAT_WRONG_PASSWORD = -3
STAT_NO_AP_FOUND = -2
STAT_CONNECT_FAIL = -1
STAT_GOT_IP = 3
AUTH_OPEN = 0
AUTH_WEP = 1
AUTH_WPA_PSK = 2
AUTH_WPA2_PSK = 3
AUTH_WPA_WPA2_PSK = 4

_hostname = 'espide-simulator'
_country = 'XX'
_interfaces = {}


class WLAN:
    IF_STA = STA_IF
    IF_AP = AP_IF

    def __new__(cls, interface_id=STA_IF):
        key = int(interface_id)
        if key not in _interfaces:
            obj = super().__new__(cls)
            _interfaces[key] = obj
        return _interfaces[key]

    def __init__(self, interface_id=STA_IF):
        if getattr(self, '_constructed', False):
            return
        self.interface_id = int(interface_id)
        self._active = False
        self._connected = False
        self._ssid = ''
        self._key = ''
        self._config = {}
        self._ifconfig = ('192.168.4.2', '255.255.255.0', '192.168.4.1', '8.8.8.8')
        self._constructed = True

    def active(self, value=None):
        if value is None:
            return self._active
        self._active = bool(value)
        if not self._active:
            self._connected = False
        return None

    def connect(self, ssid=None, key=None, *, bssid=None):
        self._active = True
        self._ssid = '' if ssid is None else str(ssid)
        self._key = '' if key is None else str(key)
        self._connected = True
        return None

    def disconnect(self):
        self._connected = False
        return None

    def isconnected(self):
        return bool(self._active and self._connected)

    def status(self, param=None):
        if param == 'rssi':
            return -42
        return STAT_GOT_IP if self.isconnected() else STAT_IDLE

    def ifconfig(self, value=None):
        if value is None:
            return self._ifconfig
        if len(value) != 4:
            raise ValueError('ifconfig requires (ip, subnet, gateway, dns)')
        self._ifconfig = tuple(str(item) for item in value)
        return None

    def scan(self):
        ssid = (self._ssid or 'ESPIDE-Simulator').encode()
        return [(ssid, b'\x02\x00\x00\x00\x00\x01', 1, -42, AUTH_WPA2_PSK, 0)]

    def config(self, param=None, **kwargs):
        if kwargs:
            self._config.update(kwargs)
            if 'ssid' in kwargs:
                self._ssid = str(kwargs['ssid'])
            if 'essid' in kwargs:
                self._ssid = str(kwargs['essid'])
            return None
        if param == 'ssid' or param == 'essid':
            return self._ssid
        if param == 'mac':
            return b'\x02\x00\x00\x00\x00\x01'
        if param in self._config:
            return self._config[param]
        return None


def hostname(value=None):
    global _hostname
    if value is None:
        return _hostname
    _hostname = str(value)
    return None


def country(value=None):
    global _country
    if value is None:
        return _country
    _country = str(value)
    return None


def isconnected():
    return WLAN(STA_IF).isconnected()
