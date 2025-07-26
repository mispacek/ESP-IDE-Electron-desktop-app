#!/bin/bash

# Tento skript vyžaduje práva roota, zkontrolujme je hned na začátku
if [ "$EUID" -ne 0 ]; then
  echo "[ESP-IDE] Tento skript musí být spuštěn jako root." >&2
  exit 1
fi

# Urči uživatele, který provádí instalaci
TARGET_USER=${SUDO_USER:-$USER}

echo "[ESP-IDE] Instalace pravidel pro USB zařízení..."
SCRIPT_DIR=$(dirname "$0")
RULES_FILE="/etc/udev/rules.d/99-espide-serial.rules"

# Zkopíruj pravidla (musí se spustit pod sudo z .deb balíčku)
install -m 644 "$SCRIPT_DIR/99-espide-serial.rules" "$RULES_FILE"

# Přidej uživatele do dialout, pokud ještě není
if ! groups "$TARGET_USER" | grep -q dialout; then
  echo "[ESP-IDE] Přidávám uživatele '$TARGET_USER' do skupiny 'dialout'"
  usermod -aG dialout "$TARGET_USER"
  echo "[ESP-IDE] Projeví se po odhlášení/přihlášení."
fi

udevadm control --reload-rules
udevadm trigger

echo "[ESP-IDE] Nastavení sériových portů dokončeno."
