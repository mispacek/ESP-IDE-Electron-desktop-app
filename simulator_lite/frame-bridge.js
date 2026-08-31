// Small postMessage bridge for embedding Simulator Lite in ESP IDE.
// The simulator itself stays isolated in this document so its COOP/COEP
// headers and SharedArrayBuffer do not become a requirement for the IDE page.

const BRIDGE_SOURCE = 'esp-simulator-lite';
const FRAME_SESSION = new URLSearchParams(location.search).get('session') || '';

function parentOrigin() {
  try {
    return document.referrer ? new URL(document.referrer).origin : location.origin;
  } catch (_) {
    return location.origin;
  }
}

function transferableBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new TextEncoder().encode(String(value ?? ''));
}

/**
 * Install the optional iframe transport.  Standalone pages do not call this
 * function; that keeps the regular simulator entry point free of host code.
 */
export function installFrameBridge(controller) {
  if (window.parent === window) return null;

  const target = window.parent;
  const targetOrigin = parentOrigin();
  const post = (message, transfer = []) => target.postMessage({
    source: BRIDGE_SOURCE,
    session: FRAME_SESSION,
    ...message,
  }, targetOrigin, transfer);

  const respond = (requestId, ok, payload = {}) => {
    const { requestId: _ignored, type: _ignoredType, ok: _ignoredOk, transfer = [], ...rest } = payload;
    post({ type: 'response', requestId, ok, ...rest }, payload.data instanceof ArrayBuffer ? [payload.data] : transfer);
  };

  const onMessage = async (event) => {
    if (event.source !== target || event.origin !== targetOrigin) return;
    const message = event.data;
    if (!message || message.source !== BRIDGE_SOURCE ||
        message.session !== FRAME_SESSION || !message.type) return;

    const requestId = message.requestId;
    try {
      if (message.type === 'appearance') {
        controller.setAppearance(message.appearance || {});
        return;
      }
      if (message.type === 'joystick-keyboard') {
        controller.setJoystickKeyboardState(message.state || {});
        return;
      }
      if (message.type === 'run') {
        const source = message.code === undefined
          ? new TextDecoder().decode(await controller.readFile('/idecode'))
          : message.code;
        await controller.run(source);
        respond(requestId, true);
        return;
      }
      if (message.type === 'stop') {
        controller.stop();
        respond(requestId, true);
        return;
      }
      if (message.type === 'suspend') {
        controller.suspend();
        respond(requestId, true);
        return;
      }
      if (message.type === 'resume') {
        controller.resume();
        respond(requestId, true);
        return;
      }
      if (message.type === 'restart') {
        await controller.restart();
        respond(requestId, true);
        return;
      }
      if (message.type === 'prepare-frame-restart') {
        await controller.flushFilesystemPersistence();
        respond(requestId, true);
        return;
      }
      if (message.type === 'factory-reset-filesystem') {
        await controller.factoryResetFilesystem();
        respond(requestId, true);
        return;
      }
      if (message.type === 'preview-oled-frame') {
        controller.previewOledFrame(transferableBytes(message.data));
        respond(requestId, true);
        return;
      }
      if (message.type === 'exec') {
        await controller.exec(message.code);
        respond(requestId, true);
        return;
      }
      if (message.type === 'repl') {
        await controller.repl(message.data);
        respond(requestId, true);
        return;
      }
      if (message.type === 'write-file') {
        await controller.writeFile(message.path, transferableBytes(message.data));
        respond(requestId, true);
        return;
      }
      if (message.type === 'read-file') {
        const data = (await controller.readFile(message.path)).buffer;
        respond(requestId, true, { data });
        return;
      }
      if (message.type === 'list-files') {
        respond(requestId, true, { files: await controller.listFiles(message.path || '/') });
        return;
      }
      if (message.type === 'set-digital') {
        controller.setDigital(message.pin, message.value);
        respond(requestId, true);
        return;
      }
      if (message.type === 'set-adc') {
        controller.setAdc(message.pin, message.value);
        respond(requestId, true);
      }
    } catch (error) {
      respond(requestId, false, { error: error?.stack || error?.message || String(error) });
    }
  };

  window.addEventListener('message', onMessage);
  return {
    emit(detail) {
      post({ type: 'event', detail });
    },
    destroy() {
      window.removeEventListener('message', onMessage);
    },
  };
}
