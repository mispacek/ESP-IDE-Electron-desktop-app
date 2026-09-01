# Contributing to ESP IDE

Thank you for helping improve ESP IDE. Small, focused pull requests are easier
to review and safer to release.

## Before opening a pull request

1. Describe the user-visible problem or goal.
2. Check the existing issue list and avoid unrelated formatting changes.
3. Preserve the shared browser runtime: `esp_ide_v2/` is also used by the web
   IDE, while this repository adds only the Electron wrapper around it.
4. Never commit `node_modules/`, `dist/` or `.runtime/`.

For a desktop runtime update, replace the complete manually pinned
`esp_ide_v2/` and `simulator_lite/` directories and keep their names unchanged.
Do not introduce a second checkout or a network download into the build.

## Local checks

Use Node.js 20 or newer:

```bash
npm ci
npm run verify:runtime
npm run test:electron
npm --prefix simulator_lite test
```

When changing the Electron wrapper, also run the local Electron smoke test. On
Windows, verify an unpacked build with `verify:package` and
`test:packaged`. Report browser, packaged-app and physical-device results
separately; a test without a connected board is not proof of USB/Bluetooth
hardware compatibility.

## Code and documentation guidelines

- Keep paths in `electron/main/runtime-paths.js`; do not duplicate packaged and
  development path calculations.
- Keep preload bridges minimal, isolated and free of broad Node APIs.
- Preserve translation keys, placeholders, hardware names and relative runtime
  paths.
- Update the README or a relevant document when a build, permission or release
  behavior changes.
- Keep the GNU AGPL-3.0 license and credit third-party assets.

Open a draft pull request early when a change affects Web Serial, Web Bluetooth,
local storage, packaging or the simulator security headers. Those are runtime
contracts and benefit from early review.
