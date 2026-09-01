#!/bin/bash

# Tento skript vyžaduje práva roota, zkontrolujme je hned na začátku
if [ "$EUID" -ne 0 ]; then
  echo "[ESP-IDE] Tento skript musí být spuštěn jako root." >&2
  exit 1
fi

echo "[ESP-IDE] Instalace pravidel pro USB zařízení..."
RULES_FILE="/etc/udev/rules.d/99-espide-serial.rules"

# DEB uloží tento soubor jako samostatný maintainer script. Pravidla proto
# musí být uvnitř skriptu a nesmí záviset na souboru ležícím vedle něj.
install -d -m 755 /etc/udev/rules.d
cat > "$RULES_FILE" <<'ESPIDE_UDEV_RULES'
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", MODE="0660", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="55d4", MODE="0660", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", MODE="0660", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", MODE="0660", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="067b", ATTRS{idProduct}=="2303", MODE="0660", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="04d8", ATTRS{idProduct}=="00dd", MODE="0660", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="303a", ATTRS{idProduct}=="1001", MODE="0660", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="2e8a", MODE="0660", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="2341", MODE="0660", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="0483", ATTRS{idProduct}=="5740", MODE="0660", GROUP="dialout"
ESPIDE_UDEV_RULES
chmod 644 "$RULES_FILE"

# Při ručním spuštění přes sudo známe uživatele. Při instalaci
# balíčku dpkg jej spolehlivě určit neumí, proto skupinu neměníme naslepo.
TARGET_USER=${SUDO_USER:-}
if [ -n "$TARGET_USER" ] && [ "$TARGET_USER" != "root" ] && ! id -nG "$TARGET_USER" | grep -qw dialout; then
  echo "[ESP-IDE] Přidávám uživatele '$TARGET_USER' do skupiny 'dialout'"
  usermod -aG dialout "$TARGET_USER"
  echo "[ESP-IDE] Projeví se po odhlášení/přihlášení."
fi

udevadm control --reload-rules
udevadm trigger

echo "[ESP-IDE] Nastavení sériových portů dokončeno."
