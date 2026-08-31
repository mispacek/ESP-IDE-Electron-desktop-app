export const SIMULATOR_STYLES = `
:host {
  --ui-bg: #f6f6f6;
  --ui-bg-soft: #e6e6e6;
  --ui-bg-panel: #f6f6f6;
  --ui-bg-elevated: #ffffff;
  --ui-bg-input: #fafafa;
  --ui-border: #a8a8a8;
  --ui-border-soft: #d0d7de;
  --ui-text: #1f2328;
  --ui-text-muted: #4b5563;
  --ui-accent: #3f51b5;
  --ui-accent-contrast: #ffffff;
  --ui-hover: #e5e7eb;
  --ui-shadow: rgba(0, 0, 0, .22);
  --button-bg: #f6f6f6;
  --button-border: #a8a8a8;
  --button-hover: #e5e5e5;
  --button-text: #1f2328;
  --terminal-bg: #000000;
  --sim-canvas-bg: #eef2f7;
  --sim-component-bg: var(--ui-bg-elevated);
  --sim-danger: #b3261e;
  display: block;
  color: var(--ui-text);
  font: 14px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

:host([data-theme="dark"]) { --sim-canvas-bg: #141a23; }

* { box-sizing: border-box; }
button, textarea, input { font: inherit; }

.lite-shell {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  color: var(--ui-text);
  background: var(--ui-bg-panel);
  border: 1px solid var(--ui-border-soft);
  border-radius: 8px;
  box-shadow: 0 8px 24px var(--ui-shadow);
}

/* In the ESP IDE the surrounding panel owns the title, controls, editor and
   terminal.  Keep the iframe surface visually transparent so only the
   Wokwi-like board scene remains visible. */
.lite-shell.scene-only {
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
}

.lite-toolbar {
  display: flex;
  min-height: 46px;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  background: var(--ui-bg-elevated);
  border-bottom: 1px solid var(--ui-border-soft);
}

.lite-toolbar strong {
  overflow: hidden;
  flex: 0 1 auto;
  font-size: 14px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lite-status {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--ui-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lite-status.is-error { color: var(--sim-danger); }
.lite-actions { display: flex; flex: 0 0 auto; gap: 6px; }

button {
  min-height: 30px;
  padding: 5px 10px;
  color: var(--button-text);
  background: var(--button-bg);
  border: 1px solid var(--button-border);
  border-radius: 7px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .08);
  cursor: pointer;
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease,
    transform .08s ease;
}

button:hover { background: var(--button-hover); border-color: var(--ui-border); }
button:active { transform: translateY(1px); }
button:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 1px;
}

button[data-run] {
  color: var(--ui-accent-contrast);
  background: var(--ui-accent);
  border-color: var(--ui-accent);
}

button[data-run]:hover { filter: brightness(1.08); }

.lite-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(285px, 340px);
  min-height: 600px;
}

.lite-scene-host {
  min-width: 0;
  overflow: auto;
  background: transparent;
}

.lite-scene {
  position: relative;
  margin: 10px;
  overflow: hidden;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.lite-tools {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 9px;
  padding: 10px;
  background: var(--ui-bg-panel);
  border-left: 1px solid var(--ui-border-soft);
}

.lite-editor {
  display: flex;
  min-height: 0;
  flex: 1 1 58%;
  flex-direction: column;
  gap: 5px;
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.lite-editor textarea {
  width: 100%;
  min-height: 180px;
  flex: 1;
  resize: vertical;
  color: var(--ui-text);
  background: var(--ui-bg-input);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  padding: 8px;
  font: 12px/1.45 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  tab-size: 2;
}

.lite-console-wrap {
  display: flex;
  min-height: 190px;
  flex: 1 1 42%;
  flex-direction: column;
  gap: 5px;
}

.lite-console-title {
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.lite-console {
  min-height: 0;
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 9px;
  color: #e7edf5;
  background: var(--terminal-bg);
  border: 1px solid var(--ui-border);
  border-radius: 6px 6px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 12px/1.4 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.lite-console.has-error { border-color: var(--sim-danger); }

.lite-repl-input-row {
  display: flex;
  align-items: center;
  min-height: 30px;
  margin-top: -5px;
  padding: 0 8px;
  color: #d9e3ef;
  background: var(--terminal-bg);
  border: 1px solid var(--ui-border);
  border-top: 0;
  border-radius: 0 0 6px 6px;
  font: 12px/1.4 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.lite-repl-caret { margin-right: 5px; color: #7fa7ff; }

.lite-repl-input-row input {
  width: 100%;
  min-width: 0;
  padding: 4px 0;
  color: #d9e3ef;
  background: transparent;
  border: 0;
  outline: 0;
  font: inherit;
}

.lite-component {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--sim-component-bg);
  border: 1px solid var(--ui-border-soft);
  border-radius: 8px;
  box-shadow: 0 2px 6px var(--ui-shadow);
}

.lite-component-label {
  position: absolute;
  right: 3px;
  bottom: 2px;
  left: 3px;
  z-index: 4;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.lite-led {
  justify-content: flex-start;
  flex-direction: column;
  padding-top: 10px;
}
.lite-led-color-control { position: relative; width: 32px; height: 32px; cursor: pointer; }
.lite-led-dot {
  position: absolute;
  inset: 0;
  width: 32px;
  height: 32px;
  border: 2px solid var(--ui-border);
  border-radius: 50%;
  background: var(--led-color);
  opacity: .16;
  box-shadow: 0 0 4px var(--led-color);
}
.lite-led-dot.is-on { box-shadow: 0 0 24px var(--led-color); opacity: .9; }
.lite-led .lite-component-label { line-height: 1.1; white-space: pre-line; }
.lite-led-color-picker {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  padding: 0;
  opacity: 0;
  cursor: pointer;
}
.lite-button { flex-direction: column; gap: 8px; }
.lite-button button { min-width: 85px; }
.lite-button button.is-pressed { transform: translateY(2px); background: var(--ui-hover); }
.lite-adc { flex-direction: column; gap: 3px; padding: 8px; }
.lite-adc input { width: 90%; accent-color: var(--ui-accent); }
.lite-adc output { color: var(--ui-text-muted); font: 12px ui-monospace, monospace; }
.lite-joystick-art {
  position: absolute;
  inset: 5px 42px 20px 5px;
  cursor: grab;
  touch-action: none;
}
.lite-joystick-art.is-dragging { cursor: grabbing; }
.lite-joystick-art > img:first-child { width: 100%; height: 100%; object-fit: contain; user-select: none; pointer-events: none; }
.lite-joystick-knob {
  position: absolute;
  z-index: 2;
  width: 42%;
  height: 42%;
  transform: translate(-50%, -50%);
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}
.lite-joystick-button { position: absolute; right: 4px; bottom: 24px; z-index: 5; min-width: 38px; padding: 3px; font-size: 10px; }
.lite-joystick-button.is-pressed { transform: translateY(2px); background: var(--ui-hover); }
.lite-joystick .lite-component-state { right: 3px; left: auto; font-size: 9px; }
.lite-dht22 { justify-content: flex-start; padding: 5px 6px 20px; gap: 4px; }
.lite-dht22 > img { width: 42%; height: 100%; object-fit: contain; user-select: none; pointer-events: none; }
.lite-dht22-controls { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 5px; }
.lite-dht22-controls label { display: grid; min-width: 0; gap: 1px; color: var(--ui-text-muted); font-size: 9px; line-height: 1.1; }
.lite-dht22-controls input { width: 100%; accent-color: var(--ui-accent); }
.lite-dht22-controls output { color: var(--ui-text-muted); font: 10px ui-monospace, monospace; text-align: center; white-space: nowrap; }
.lite-layered-art { position: absolute; inset: 4px 4px 19px; }
.lite-layered-art img { position: absolute; inset: 0; width: 100%; height: 100%; user-select: none; pointer-events: none; object-fit: contain; }
.lite-layered-art img:first-child { z-index: 1; }
.lite-layered-art img:last-child { z-index: 2; transform-origin: 50% 50%; }
.lite-servo-mode {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 7;
  min-width: 38px;
  min-height: 22px;
  padding: 1px 5px;
  font: 600 10px/1.2 ui-monospace, monospace;
}
.lite-component-state {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 6;
  max-width: calc(100% - 8px);
  overflow: hidden;
  padding: 2px 5px;
  color: var(--ui-text);
  background: var(--ui-bg-panel);
  border: 1px solid var(--ui-border-soft);
  border-radius: 5px;
  font: 600 10px/1.2 ui-monospace, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}
.lite-motor .lite-layered-art { bottom: 7px; }
.lite-motor .lite-component-label { line-height: 1.12; white-space: pre-line; }
.lite-encoder .lite-layered-art { inset: 18px 20px 22px; cursor: grab; touch-action: none; }
.lite-encoder .lite-layered-art.is-dragging { cursor: grabbing; }
.lite-encoder-controls { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
.lite-encoder-step, .lite-encoder-button { min-width: 26px; min-height: 30px; padding: 3px 6px; font-size: 11px; }
.lite-encoder-step { position: absolute; top: 45%; z-index: 5; pointer-events: auto; transform: translateY(-50%); }
.lite-encoder-step.is-minus { left: 4px; }
.lite-encoder-step.is-plus { right: 4px; }
.lite-encoder-button { position: absolute; top: 72%; right: 4px; z-index: 5; transform: translateY(-50%); }
.lite-encoder-step:active, .lite-encoder-button:active { transform: translateY(calc(-50% + 1px)); }
.lite-servo .lite-component-label,
.lite-encoder .lite-component-label,
.lite-joystick .lite-component-label,
.lite-oled .lite-component-label { font-size: 9px; line-height: 1.05; white-space: pre-line; }
.lite-neopixel { flex-direction: column; }
.lite-neopixel-art {
  position: absolute;
  top: 2px;
  left: 50%;
  width: calc(100% - 12px);
  transform: translateX(-50%);
}
.lite-neopixel-art img { display: block; width: 100%; height: 100%; user-select: none; pointer-events: none; }
.lite-neopixel-cell {
  --pixel-color: #090d12;
  position: absolute;
  z-index: 2;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(255, 255, 255, .58);
  border-radius: 50%;
  background: var(--pixel-color);
  box-shadow: 0 0 5px var(--pixel-color);
}
.lite-oled-art {
  position: absolute;
  top: 4px;
  left: 50%;
  width: auto;
  height: calc(100% - 23px);
  aspect-ratio: 1;
  max-width: calc(100% - 8px);
  transform: translateX(-50%);
}
.lite-oled-screen-area { position: absolute; overflow: visible; }
.lite-oled-screen-slot { position: absolute; overflow: hidden; }
.lite-oled-screen { position: absolute; overflow: hidden; }
.lite-oled-art img { display: block; width: 100%; height: 100%; object-fit: contain; user-select: none; pointer-events: none; }
.lite-oled-art canvas {
  position: absolute;
  z-index: 2;
  background: #000;
  image-rendering: pixelated;
  pointer-events: none;
}
.lite-oled .lite-component-label { color: var(--ui-text-muted); }
.lite-unsupported { padding: 10px; color: #a15c00; text-align: center; }

:host([data-compact]) .lite-layout {
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
}

:host([data-compact]) .lite-scene-host {
  min-height: 295px;
  max-height: 42vh;
}

:host([data-compact]) .scene-only .lite-scene-host {
  min-height: 0;
  max-height: none;
}

:host([data-compact]) .lite-scene { margin: 8px; }
:host([data-compact]) .lite-tools {
  min-height: 430px;
  border-top: 1px solid var(--ui-border-soft);
  border-left: 0;
}

@media (max-width: 640px) {
  .lite-toolbar { flex-wrap: wrap; }
  .lite-status { order: 3; flex-basis: 100%; }
  .lite-actions { margin-left: auto; }
}
`;
