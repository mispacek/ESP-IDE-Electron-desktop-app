const KEY_CODES = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

export function isJoystickKeyboardCode(code) {
  return KEY_CODES.has(String(code || ''));
}

export function joystickKeyboardState(keys = []) {
  const held = keys instanceof Set ? keys : new Set(keys);
  return {
    x: Number(held.has('ArrowRight')) - Number(held.has('ArrowLeft')),
    y: Number(held.has('ArrowDown')) - Number(held.has('ArrowUp')),
    pressed: held.has('Space'),
  };
}

export function normaliseJoystickKeyboardState(state = {}) {
  return {
    x: Math.max(-1, Math.min(1, Number(state.x) || 0)),
    y: Math.max(-1, Math.min(1, Number(state.y) || 0)),
    pressed: !!state.pressed,
  };
}

export function combineJoystickKeyboardStates(...states) {
  const normalised = states.map(normaliseJoystickKeyboardState);
  return {
    x: Math.max(-1, Math.min(1, normalised.reduce((sum, state) => sum + state.x, 0))),
    y: Math.max(-1, Math.min(1, normalised.reduce((sum, state) => sum + state.y, 0))),
    pressed: normalised.some((state) => state.pressed),
  };
}
