# ESP IDE - Electron desktop app

This repository packages the current browser ESP IDE and Simulator Lite in a
small cross-platform Electron shell. The editor and simulator remain ordinary
web assets; Electron provides a local server, native USB/Bluetooth pickers,
storage migration and installers for Windows, macOS and Linux.

The two runtime directories are deliberately committed as versioned manual
copies. A build never checks out or downloads a second ESP IDE repository.

## What is included

- Blockly and text-based MicroPython editing for ESP and RP2 boards.
- Web Serial USB and Web Bluetooth connections through localized native
  picker windows.
- Simulator Lite running locally in a Worker with WebAssembly and
  `SharedArrayBuffer` isolation.
- English as the first-run desktop default when no saved language exists;
  later English, Czech or German choices are persisted in local storage.
- One-time migration of settings from older `file://` desktop builds.
- Windows NSIS, Linux AppImage/DEB and macOS DMG/ZIP packaging.

The core editor and simulator assets are local. Sharing, the firmware and
add-on catalog, documentation links and some telemetry still use `espide.eu`
when those features are opened. This is therefore an offline-capable desktop
build, not a fully air-gapped distribution.

## Repository layout

```text
ESP-IDE-Electron-desktop-app/
├─ esp_ide_v2/             manually pinned browser IDE runtime
├─ simulator_lite/         manually pinned Simulator Lite runtime
├─ electron/
│  ├─ main/                main process, server, protocol and paths
│  ├─ preload/             isolated bridges for IDE and pickers
│  ├─ ui/                  splash and USB/Bluetooth picker pages
│  └─ migration/           legacy localStorage origin document
├─ packaging/              platform icons and installer files
├─ scripts/                runtime and package verification
├─ tests/                  Electron and packaging smoke tests
├─ docs/                   contributor, legal and development documents
├─ runtime-source.json     metadata for the pinned runtime copies
├─ package.json
└─ package-lock.json
```

`node_modules/`, `dist/` and `.runtime/` are generated or local-only and are
ignored by Git. `.runtime/` is used for temporary verification builds; it is
not read by the application and is not uploaded to GitHub.

## Updating the pinned runtimes

Replace the complete contents of `esp_ide_v2/` and `simulator_lite/` with the
versions that should ship. Keep the directory names unchanged. Do not copy
`node_modules`, `.git`, `.agents` or `.codex` into either runtime.

The browser IDE must continue to reference the simulator as
`../simulator_lite/`; this relative path is what keeps the web and desktop
runtime compatible. After copying, run:

```bash
npm ci
npm run verify:runtime
npm run test:electron
npm --prefix simulator_lite test
```

`verify:runtime` checks the required IDE, Worker/WASM, wrapper, icon and Linux
packaging files. It also checks that the standalone Linux udev rules match the
rules embedded in the DEB post-install script.

## Development

Requirements:

- Node.js 20 or newer and npm.
- Windows, Linux or macOS for running the desktop shell.
- A macOS runner for a real macOS build and a Linux runner for Linux packages.

Install dependencies and start the app:

```bash
npm ci
npm start
```

Useful checks:

```bash
npm run verify:runtime
npm run test:electron
npm --prefix simulator_lite test
```

On Windows, an unpacked package can be checked after a build with:

```bash
npm run verify:package -- "dist/win-unpacked/resources/app.asar"
npm run test:packaged -- "dist/win-unpacked/ESP IDE.exe"
```

The packaged smoke test starts only the executable passed to it, uses a
temporary profile and verifies that the protected local server starts.

## Building installers

```bash
npm run dist:win       # Windows NSIS, x64 and ia32
npm run dist:linux     # Linux AppImage and DEB, x64
npm run dist:mac       # macOS universal DMG and ZIP
```

All artifacts are written to `dist/` and use the form
`ESP_IDE_<version>_<platform>_<arch>.<extension>`.

GitHub Actions keeps the existing release flow: one checkout, `npm ci`, then
the matching `dist:*` script on each runner. The workflow does not download a
second source repository. Before publishing a tag, update the version in
`package.json`, the root package entry in `package-lock.json`, and the visible
version text in `electron/ui/splash/index.html` when applicable.

The wrapper is stored in `app.asar`; the two runtime copies are placed outside
the archive under the packaged app's `resources/` directory. This makes the
local server's file and Worker/WASM paths explicit and inspectable, following
electron-builder's app-content model.

## Runtime and security model

The main process serves the local IDE at `http://127.0.0.1:<port>/` and keeps a
random per-process token in memory. Requests without the exact host, token and
same-origin context are rejected. The renderer has context isolation and no
Node integration. COOP/COEP response headers provide the secure isolated
context required by Simulator Lite.

The protocol mapper in `electron/main/protocol-handler.js` only exposes the
`esp_ide_v2` and `simulator_lite` virtual roots and rejects traversal. The
browser IDE itself remains the same code path used by the web deployment.

## USB, Bluetooth and Linux permissions

Web Serial and Web Bluetooth support depends on the operating system and the
board. The repository contains localized picker windows and the macOS
Bluetooth entitlement. CI cannot prove a physical board connection.

The DEB post-install script installs udev rules for common USB-serial devices.
For a manual Linux/AppImage installation:

```bash
sudo install -m 644 packaging/linux/99-espide-serial.rules /etc/udev/rules.d/
sudo usermod -aG dialout "$USER"
sudo udevadm control --reload-rules
sudo udevadm trigger
```

Log out and in again after changing the `dialout` group.

## Language and picker behavior

The desktop preload seeds `userSettings.language` with `en` only when no saved
language is available. Existing settings are preserved, and the USB/Bluetooth
pickers receive the currently active IDE language with English fallback.

## UI consistency

The shared UI font is defined by `--ui-font-family` in the runtime
`index.html`. Native `select` controls explicitly use that same stack, including
the processor, language, layout and picker-related dialogs. If you update the
browser runtime, keep the byte-identical `esp_ide_v2/index.html` copy in this
repository synchronized and bump its `APP_VERSION` for the service worker.

## Documentation and license

- [Contributing](docs/CONTRIBUTING.md)
- [Code of Conduct](docs/CODE_OF_CONDUCT.md)
- [Contributor terms](docs/CLA.md)
- [Trademark policy](docs/TRADEMARK.md)
- [License](LICENSE.md)

Press F12 in the running app to open or close DevTools.
