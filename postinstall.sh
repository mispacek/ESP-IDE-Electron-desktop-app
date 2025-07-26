#!/bin/bash

echo "[ESP-IDE] Instalace pravidel pro USB zařízení..."
SCRIPT_DIR=$(dirname "$0")
RULES_FILE="/etc/udev/rules.d/99-espide-serial.rules"

# Zkopíruj pravidla (musí se spustit pod sudo z .deb balíčku)
install -m 644 "$SCRIPT_DIR/99-espide-serial.rules" "$RULES_FILE"

# Přidej uživatele do dialout, pokud ještě není
if ! groups "$USER" | grep -q dialout; then
  echo "[ESP-IDE] Přidávám uživatele '$USER' do skupiny 'dialout'"
  usermod -aG dialout "$USER"
  echo "[ESP-IDE] Projeví se po odhlášení/přihlášení."
fi

udevadm control --reload-rules
udevadm trigger

echo "[ESP-IDE] Nastavení sériových portů dokončeno."
