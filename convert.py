#!/usr/bin/env python3
"""
convert_eol_to_lf.py
--------------------
Rekurzivně projde všechny soubory v aktuálním adresáři a nahradí
všechny konce řádků (CR, CRLF, LF) za čisté LF.

Použití:
    python convert_eol_to_lf.py
    # nebo
    python convert_eol_to_lf.py /cesta/ke/kořeni
"""

from pathlib import Path
import sys

# --- nastavení --------------------------------------------------------------

# Přípony, které se budou PŘESKAKOVAT (binární soubory, obrázky, archivy …)
SKIP_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico",
    ".zip", ".rar", ".7z", ".gz", ".tar", ".xz",
    ".pdf", ".exe", ".dll", ".so", ".a",
    ".class", ".jar", ".bin", ".dat",
}

# Binární soubor poznáme i podle výskytu NUL
NULL_BYTE = b"\x00"

# ---------------------------------------------------------------------------

def is_binary(data: bytes) -> bool:
    """Hrubá heuristika: pokud obsahuje NUL, považuj za binární."""
    return NULL_BYTE in data

def normalize_eol(content: bytes) -> bytes:
    """Převede CRLF → LF a CR → LF (v tomto pořadí!)."""
    content = content.replace(b"\r\n", b"\n")
    content = content.replace(b"\r",   b"\n")
    return content

def process_file(path: Path) -> None:
    try:
        raw = path.read_bytes()
    except Exception as e:
        print(f"✗ {path}: {e}")
        return

    if is_binary(raw) or path.suffix.lower() in SKIP_SUFFIXES:
        return  # přeskočit

    converted = normalize_eol(raw)
    if converted != raw:
        try:
            path.write_bytes(converted)
            print(f"✓ {path}")
        except Exception as e:
            print(f"✗ {path}: {e}")

def main(root: Path) -> None:
    for p in root.rglob("*"):
        if p.is_file():
            process_file(p)

if __name__ == "__main__":
    root_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    main(root_dir)