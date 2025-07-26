# ESP-IDE-Electron-desktop-app
ESP-IDE-Offline-desktop-app

## Manual setup for serial port access

If you install the application manually or run it from sources, configure the
permissions for serial ports with the following commands:

```bash
sudo cp 99-espide-serial.rules /etc/udev/rules.d/
sudo chmod 644 /etc/udev/rules.d/99-espide-serial.rules
sudo usermod -aG dialout <username>
sudo udevadm control --reload-rules
sudo udevadm trigger
```

These steps are executed automatically by `postinstall.sh` when installing the
`.deb` package.
