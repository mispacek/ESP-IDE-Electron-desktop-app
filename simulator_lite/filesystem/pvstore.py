
DEFAULT_SECTION = "settings"
_MISSING = object()
_TRUE = ("true", "1", "yes", "ano", "on")
_FALSE = ("false", "0", "no", "ne", "off")
_DENY = ("open", "print", "int", "float", "str", "bool", "None", "True", "False", "globals", "locals", "__builtins__")

def _bool(v):
    v = str(v).strip().lower()
    if v in _TRUE:
        return True
    if v in _FALSE:
        return False
    raise ValueError(v)

def _bt(v):
    return "true" if v else "false"

def _valid_name(n):
    if not n or n.startswith("__") or n in _DENY:
        return False
    c = n[0]
    if not (c == "_" or ("A" <= c <= "Z") or ("a" <= c <= "z")):
        return False
    for c in n[1:]:
        if not (c == "_" or ("A" <= c <= "Z") or ("a" <= c <= "z") or ("0" <= c <= "9")):
            return False
    return True

def _list(v, kind):
    v = str(v)
    if not v.strip():
        return []
    r = []
    add = r.append
    for x in v.split(","):
        x = x.strip()
        if kind == "int":
            x = int(x)
        elif kind == "float":
            x = float(x)
        elif kind == "bool":
            x = _bool(x)
        add(x)
    return r

def _list_kind(items):
    kind = ""
    for x in items:
        if isinstance(x, bool):
            k = "bool"
        elif isinstance(x, int):
            k = "int"
        elif isinstance(x, float):
            k = "float"
        elif isinstance(x, str):
            k = "str"
        else:
            return "str"
        if not kind:
            kind = k
        elif kind != k:
            return "str"
    return kind or "str"

class IniConfig:
    def __init__(self, filename, autoload=True):
        self.filename = str(filename)
        self.data = {}
        self.errors = []
        self.loaded = False
        if autoload:
            self.load()

    def _err(self, msg):
        self.errors.append(msg)
        print(msg)

    def _fallback(self, value, default):
        return default if default is not _MISSING else value

    def _decode_value(self, raw, section, key, default=_MISSING):
        raw = str(raw).strip()
        parts = raw.split(":", 1)
        name = section + "." + key
        if len(parts) != 2:
            self._err("Missing type prefix: " + name + " = " + raw)
            return self._fallback(raw, default)
        kind = parts[0].strip().lower()
        value = parts[1]
        try:
            if kind == "str":
                return value.strip()
            if kind == "bool":
                return _bool(value)
            if kind == "int":
                return int(value.strip())
            if kind == "float":
                return float(value.strip())
            if kind.startswith("list_"):
                item_kind = kind[5:]
                if item_kind in ("int", "float", "str", "bool"):
                    return _list(value, item_kind)
            self._err("Unknown type: " + name + " = " + raw)
            return raw
        except Exception:
            value = value.strip()
            self._err("Invalid " + kind + " value: " + name + " = " + value)
            return self._fallback(value, default)

    def _encode_value(self, value):
        if isinstance(value, bool):
            return "bool:" + _bt(value)
        if isinstance(value, int):
            return "int:" + str(value)
        if isinstance(value, float):
            return "float:" + repr(value)
        if isinstance(value, str):
            return "str:" + value.strip()
        if isinstance(value, list) or isinstance(value, tuple):
            kind = _list_kind(value)
            if kind == "bool":
                text = ",".join(_bt(x) for x in value)
            elif kind == "float":
                text = ",".join(repr(x) for x in value)
            else:
                text = ",".join(str(x) for x in value)
            return "list_" + kind + ":" + text
        self._err("Unsupported value type: " + str(type(value)))
        return "str:" + str(value)

    def load(self):
        data = {}
        section = DEFAULT_SECTION
        self.data = data
        self.loaded = False
        try:
            with open(self.filename, "r") as f:
                for raw in f:
                    line = raw.strip()
                    if not line or line[0] == "#" or line[0] == ";":
                        continue
                    if line[0] == "[":
                        end = line.find("]")
                        if end < 0:
                            self._err("Invalid section header: " + line)
                            continue
                        section = line[1:end].strip() or DEFAULT_SECTION
                        if data.get(section) is None:
                            data[section] = {}
                        continue
                    parts = line.split("=", 1)
                    if len(parts) != 2:
                        self._err("Skipped damaged line: " + line)
                        continue
                    key = parts[0].strip()
                    if not key:
                        self._err("Empty key in section: " + section)
                        continue
                    values = data.get(section)
                    if values is None:
                        values = {}
                        data[section] = values
                    values[key] = parts[1].strip()
            self.loaded = True
            return True
        except OSError:
            return False
        except Exception as e:
            self._err("Cannot load config: " + str(e))
            return False

    def save(self):
        try:
            with open(self.filename, "w") as f:
                first = True
                for section, values in self.data.items():
                    if not first:
                        f.write("\n")
                    first = False
                    f.write("[" + str(section).strip() + "]\n")
                    for key, value in values.items():
                        f.write(str(key).strip() + " = " + str(value) + "\n")
            return True
        except Exception as e:
            self._err("Cannot save config: " + str(e))
            return False

    def get(self, section, key, default=_MISSING):
        section = str(section).strip()
        key = str(key).strip()
        values = self.data.get(section)
        if values is None or key not in values:
            self._err("Missing value: " + section + "." + key)
            return None if default is _MISSING else default
        return self._decode_value(values[key], section, key, default)

    def set(self, section, key, value):
        section = str(section).strip() or DEFAULT_SECTION
        key = str(key).strip()
        if not key:
            self._err("Empty key")
            return False
        values = self.data.get(section)
        if values is None:
            values = {}
            self.data[section] = values
        values[key] = self._encode_value(value)
        return True

def save(filename, global_scope, local_scope, names):
    try:
        cfg = IniConfig(filename, False)
        for item in names:
            section = DEFAULT_SECTION
            name = item
            if isinstance(item, list) or isinstance(item, tuple):
                if len(item) != 2:
                    print("Preskocena neplatna polozka pro ulozeni:", item)
                    continue
                section = str(item[0]).strip() or DEFAULT_SECTION
                name = item[1]
            name = str(name)
            if not _valid_name(name):
                print("Preskocen neplatny nazev promenne:", name)
                continue
            if local_scope is not None and name in local_scope:
                value = local_scope[name]
            elif global_scope is not None and name in global_scope:
                value = global_scope[name]
            else:
                print("Promenna nenalezena:", name)
                continue
            cfg.set(section, name, value)
        return cfg.save()
    except Exception as e:
        print("Chyba pri ukladani promennych:", e)
        return False

def load(filename, global_scope):
    try:
        cfg = IniConfig(filename)
        if not cfg.loaded:
            print("Chyba pri nacitani promennych: soubor nenalezen")
            return False
        if not cfg.data:
            print("Chyba pri nacitani promennych: soubor neobsahuje zadne hodnoty")
            return False
        for section, values in cfg.data.items():
            for name in values:
                if not _valid_name(name):
                    print("Preskocen neplatny nazev promenne:", name)
                    continue
                global_scope[name] = cfg.get(section, name)
        return True
    except Exception as e:
        print("Chyba pri nacitani promennych:", e)
        return False
