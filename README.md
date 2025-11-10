# ESP IDE – Electron desktopová aplikace

ESP IDE je desktopový editor a učební prostředí pro MicroPython na deskách ESP a RP2. Nabízí vizuální programování v Blockly i textový Python editor, přímé připojení přes USB‑Serial nebo Bluetooth Low Energy, správu souborů na zařízení a průvodce instalací firmware i knihoven.

---

## Obsah
- [Funkce](#funkce)
- [Podporované desky](#podporované-desky)
- [Požadavky](#požadavky)
- [Rychlé spuštění z kódu](#rychlé-spuštění-z-kódu)
- [Build instalátorů](#build-instalátorů)
- [Jak s aplikací pracovat](#jak-s-aplikací-pracovat)
- [Poznámky k systému a bezpečnosti](#poznámky-k-systému-a-bezpečnosti)
- [FAQ](#faq)
- [Příspěvky a hlášení chyb](#příspěvky-a-hlášení-chyb)
- [O Autorovi](#autor)

---

## Funkce

- **Dva režimy práce**  
  - *Blockly* pro vizuální skládání programů.  
  - *Text* s ACE editorem, záložkami, Undo/Redo a indikací rozpracovanosti.
- **Správce souborů (File Manager):** prohlížení, upload/download, mazání a úpravy souborů na připojeném zařízení. Přenos respektuje limity USB/BLE.
- **Připojení k zařízení:**  
  - **USB (WebSerial)** – výběr portu přes vlastní *Port Picker*.  
  - **Bluetooth LE** – výběr zařízení přes vlastní *BT Picker*; volba je skryta tam, kde deska BLE nepodporuje.
- **Průvodci instalací:**  
  - flash firmware (ESP32/ESP8266) nebo zobrazení pokynů pro UF2 (RP2),  
  - následná instalace knihoven.
- **Rozšíření (Extensions):** přidání vlastních bloků a toolbox XML, uložení do `localStorage` a bezpečná integrace do UI.
- **Changelog a verze v UI:** rychlý přehled novinek přímo v aplikaci.
- **Vývojářské nástroje:** klávesa **F12** otevře/zavře DevTools.

---

## Podporované desky

- ESP32, ESP32‑C3, ESP32‑S3, ESP8266  
- RP2040 (vč. Pico/Pico:ed) a další RP2 kompatibilní desky

> BLE je dostupné na ESP32/C3/S3. U desek bez BLE je volba automaticky skryta.

---

## Požadavky

- **Node.js LTS** (doporučeno 18+) a **npm**
- **Git** (pro klonování repozitáře)
- OS: **Windows**, **Linux**, nebo **macOS**

---

## Rychlé spuštění z kódu

```bash
git clone https://github.com/mispacek/ESP-IDE-Electron-desktop-app.git
cd ESP-IDE-Electron-desktop-app
npm install
npm start
```

> `npm start` spouští Electron a načte hlavní okno s povolenými rozhraními pro WebSerial/BLE.

---

## Build instalátorů

Nejjednodušší je použít přednastavené skripty z `package.json`:

```bash
# vše podle host OS
npm run dist

# cílené buildy
npm run dist:win     # Windows (NSIS)
npm run dist:linux   # Linux (AppImage + DEB)
npm run dist:mac     # macOS (DMG/ZIP, hardened runtime)
```

Vnitřně se používá **electron‑builder**. Artefakty se pojmenovávají např.:  
`ESP_IDE_<verze>_<os>_<arch>.<ext>`

> Pozn.: U DEB probíhá `postinstall` krok. macOS build používá hardened runtime a entitlements včetně popisu pro Bluetooth.

---

## Jak s aplikací pracovat

1. **Volba procesoru při startu**  
   Zvolte cílovou desku (ESP32, ESP32C3, ESP32S3, ESP8266, RP2040, Pico:ed). Volba ovlivní toolbox a dostupnost BLE.

2. **Připojení k desce**  
   - **USB:** klikněte na tlačítko USB, otevře se *Port Picker* s výběrem sériového portu.  
   - **BLE:** u desek s BLE klikněte na tlačítko BLE, zobrazí se *BT Picker* a proběhne připojení k REPL.

3. **Blockly ↔ Text**  
   Přepínejte mezi vizuálním a textovým režimem. Textový editor používá ACE, pamatuje rozpracované soubory i otevřené záložky.

4. **Správa souborů**  
   Otevřete File Manager. Nahrávejte soubory do zařízení, stahujte je, mažte a editujte. Přenos je přizpůsoben USB/BLE kanálu.

5. **Instalace firmware a knihoven**  
   Spusťte průvodce v menu.  
   - ESP32/ESP8266: flash přímo z aplikace.  
   - RP2: zobrazení pokynů pro UF2; po potvrzení pokračuje instalace knihoven.

6. **Rozšíření (extensions)**  
   Nahrajte/zkopírujte JS a XML bloků, povolte je a nechte zaintegrovat do toolboxu. Stav se ukládá do `localStorage`.

---

## Poznámky k systému a bezpečnosti

- **WebSerial a oprávnění:** aplikace využívá experimentální webové funkce a vlastní výběr portu uvnitř aplikace.
- **BLE výběr:** události `select-bluetooth-device` a `bluetooth-device-added` jsou mapované na vlastní *BT Picker* a řízené zavírání okna.
- **Linux parametry:** pro spolehlivý přístup k USB se používá `--disable-serial-blocklist` a na některých distribucích může být nutné upravit udev pravidla.
- **Hlavní okno:** `contextIsolation: true`, renderer bez Node integrace. Splash okno je izolované.

---

## FAQ

**USB zařízení se nezobrazuje na Linuxu**  
Zkontrolujte udev pravidla pro USB‑serial adaptéry. Některá prostředí vyžadují spuštění s `--disable-serial-blocklist`. U DEB probíhá `postinstall`, AppImage může vyžadovat manuální úpravy.

**Nevidím BLE volbu**  
Zvolená deska BLE nepodporuje (např. ESP8266, RP2040). Změňte volbu procesoru v menu.

**Kde zapnu DevTools?**  
Klávesa **F12**.

**Jak vyčistit lokální data aplikace (cache, nastavení)**  
Smažte složku *userData* pro aplikaci „ESP IDE“:  
- Windows: `%APPDATA%/ESP IDE/`  
- Linux: `~/.config/ESP IDE/`  
- macOS: `~/Library/Application Support/ESP IDE/`

---

## Příspěvky a hlášení chyb

- Vytvořte **Issue** s jasným popisem problému a kroky k reprodukci.  
- U **pull requestů** popište záměr, dopad na uživatele a případné změny v build procesu nebo oprávněních.

---

## autor

- **Autor:** Milan Špaček, programátor a nadšenec do vzdělávání dětí.
- Celé prostředí tvoří ve svém volném čase pro děti na zájmovém kroužku Energie Jinak  https://www.energiejinak.cz/





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
