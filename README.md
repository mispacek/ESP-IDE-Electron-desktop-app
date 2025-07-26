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

## Installation

Download the installer for your platform from the release page.  File names have
the following format:

```
ESP_IDE_<version>_<platform>.<extension>
```

Use the file that matches your operating system:

### Windows

Run the installer `ESP_IDE_<version>_win_<arch>.exe` and follow the prompts.
Select the `x64` file for 64‑bit systems or `ia32` for 32‑bit.

### Linux

On Debian‑based systems install the `.deb` package:

```bash
sudo dpkg -i ESP_IDE_<version>_amd64.deb
```

For other distributions use the AppImage. Make it executable and run it:

```bash
chmod +x ESP_IDE_<version>_linux_x64.AppImage
./ESP_IDE_<version>_linux_x64.AppImage
```

### macOS

Mount `ESP_IDE_<version>_mac_universal.dmg` and drag the application to the
Applications folder. Alternatively unpack the zip archive with the same prefix.
