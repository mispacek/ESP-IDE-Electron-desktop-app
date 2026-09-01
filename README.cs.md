# ESP IDE — Electron desktopová aplikace

Tento repozitář balí aktuální webové ESP IDE a Simulator Lite do malé
platformně nezávislé vrstvy Electronu. Editor a simulátor zůstávají běžnými
webovými soubory; Electron poskytuje lokální server, nativní USB/Bluetooth
pickery, migraci nastavení a instalátory pro Windows, macOS a Linux.

Adresáře `esp_ide_v2/` a `simulator_lite/` jsou ručně vložené a verzované kopie.
Build nestahuje druhý repozitář ani jinou verzi runtime.

## Co aplikace obsahuje

- Blockly a textový editor MicroPythonu pro desky ESP a RP2.
- Připojení přes Web Serial USB a Web Bluetooth s lokalizovanými pickery.
- Simulator Lite spuštěný lokálně ve Workeru s WebAssembly a
  `SharedArrayBuffer` izolací.
- Angličtinu jako výchozí jazyk prvního spuštění bez uloženého nastavení;
  volba angličtiny, češtiny nebo němčiny se dále trvale ukládá.
- Jednorázovou migraci nastavení ze starších desktopových verzí `file://`.
- Instalátory Windows NSIS, Linux AppImage/DEB a macOS DMG/ZIP.

Základ IDE a simulátoru je lokální. Sdílení, firmware, katalog doplňků,
dokumentace a některé statistiky používají síťové služby `espide.eu`, pokud je
uživatel otevře. Nejde tedy o plně air-gapped distribuci.

## Struktura

```text
ESP-IDE-Electron-desktop-app/
├─ esp_ide_v2/             ručně připnuté webové IDE
├─ simulator_lite/         ručně připnutý Simulator Lite
├─ electron/               hlavní proces, preloady, splash a pickery
├─ packaging/              ikony a instalační soubory pro OS
├─ scripts/                kontroly runtime a balíku
├─ tests/                  Electron a packaging testy
├─ docs/                   komunitní, právní a vývojové dokumenty
├─ runtime-source.json
├─ package.json
└─ package-lock.json
```

`node_modules/`, `dist/` a `.runtime/` jsou ignorované lokální adresáře.
`.runtime/` slouží pouze pro dočasné kontrolní buildy a aplikace jej nepoužívá.

## Výměna runtime

Nahraďte celý obsah `esp_ide_v2/` a `simulator_lite/` požadovanými verzemi.
Zachovejte názvy adresářů a nekopírujte `node_modules`, `.git`, `.agents` ani
`.codex`. ESP IDE musí dál odkazovat na simulátor relativní cestou
`../simulator_lite/`.

```bash
npm ci
npm run verify:runtime
npm run test:electron
npm --prefix simulator_lite test
```

## Vývoj a build

Vyžadován je Node.js 20+ a npm:

```bash
npm start
npm run dist:win
npm run dist:linux
npm run dist:mac
```

Výstup je v `dist/`. GitHub Actions zachovávají jeden checkout, `npm ci` a
stávající `dist:*` skripty. Před vydáním změňte verzi v `package.json`, v
kořenovém záznamu `package-lock.json` a případně ve splash screenu
`electron/ui/splash/index.html`.

Wrapper je v `app.asar`; runtime kopie jsou v `resources/esp_ide_v2` a
`resources/simulator_lite`. Cesty jsou soustředěné v
`electron/main/runtime-paths.js`.

## Kontrola zabalené aplikace (Windows)

```bash
npm run verify:package -- "dist/win-unpacked/resources/app.asar"
npm run test:packaged -- "dist/win-unpacked/ESP IDE.exe"
```

## Připojení a oprávnění

Jazyk `en` se použije pouze při prvním desktopovém spuštění bez uloženého
nastavení. Pozdější volba se zachová a předá se i do USB/Bluetooth pickerů.

DEB instalátor vloží linuxová udev pravidla. Ručně nebo pro AppImage:

```bash
sudo install -m 644 packaging/linux/99-espide-serial.rules /etc/udev/rules.d/
sudo usermod -aG dialout "$USER"
sudo udevadm control --reload-rules
sudo udevadm trigger
```

Po změně skupiny `dialout` se odhlaste a znovu přihlaste. F12 otevírá DevTools.

## Vzhled comboboxů

Společný font UI je definován proměnnou `--ui-font-family` v runtime
`index.html`. Nativní `select` prvky ji používají výslovně, takže procesor,
jazyk, rozložení i dialogové volby mají v Electronu stejný font jako zbytek
stránky. Při výměně webového runtime zachovejte shodnou kopii
`esp_ide_v2/index.html` a kvůli service workeru zvedněte `APP_VERSION`.

Viz také [anglický README](README.md), [přispívání](docs/CONTRIBUTING.md) a
[licenci](LICENSE.md).
