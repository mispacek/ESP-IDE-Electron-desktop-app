export const FS_OVERLAY_VERSION = 1;

export const DEFAULT_PERSISTENCE_EXCLUDES = Object.freeze([
  '/dev',
  '/proc',
  '/tmp',
  '/lib/machine.py',
  '/lib/_simulator_wasm_compat.py',
  '/lib/neopixel.py',
]);

export const HIDDEN_RUNTIME_ROOTS = Object.freeze(['/dev']);

/**
 * Emscripten creates POSIX convenience directories which are not part of a
 * normal MicroPython board filesystem. These trees are empty before project
 * files are loaded and can be removed safely. /dev must stay alive because
 * the WASM runtime uses its TTY devices for REPL input and output.
 */
export function pruneEmscriptenFilesystem(fs) {
  for (const path of ['/home/web_user', '/home', '/tmp', '/proc/self/fd', '/proc/self', '/proc']) {
    try {
      fs.rmdir(path);
    } catch (_) {
      // A different Emscripten build may omit a directory or keep it busy.
    }
  }
}

export function emptyOverlay() {
  return { version: FS_OVERLAY_VERSION, directories: [], deleted: [], files: [] };
}

export function normaliseFsPath(value) {
  const raw = String(value || '/').replaceAll('\\', '/');
  const absolute = raw.startsWith('/') ? raw : `/${raw}`;
  const parts = absolute.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..' || part.includes('\0'))) {
    throw new Error(`Neplatná cesta filesystému: ${value}`);
  }
  return parts.length ? `/${parts.join('/')}` : '/';
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  throw new TypeError('Obsah overlay souboru musí být binární.');
}

function pathExcluded(path, excludedPaths) {
  return excludedPaths.some((excluded) => path === excluded || path.startsWith(`${excluded}/`));
}

function uniqueSortedPaths(values) {
  return [...new Set((values || []).map(normaliseFsPath).filter((path) => path !== '/'))].sort();
}

export function normaliseOverlay(value) {
  if (value == null) return emptyOverlay();
  if (value.version !== FS_OVERLAY_VERSION) {
    throw new Error(`Nepodporovaná verze FS overlaye: ${value.version}.`);
  }
  const files = new Map();
  for (const entry of value.files || []) {
    const path = normaliseFsPath(entry?.path);
    if (path === '/') throw new Error('Kořen filesystému nemůže být soubor.');
    files.set(path, { path, data: asBytes(entry.data) });
  }
  return {
    version: FS_OVERLAY_VERSION,
    directories: uniqueSortedPaths(value.directories),
    deleted: uniqueSortedPaths(value.deleted),
    files: [...files.values()].sort((first, second) => first.path.localeCompare(second.path)),
  };
}

export function cloneOverlay(value) {
  return normaliseOverlay(value);
}

export function overlayForTransfer(value) {
  const overlay = cloneOverlay(value);
  return { overlay, transfer: overlay.files.map((file) => file.data.buffer) };
}

function bytesEqual(first, second) {
  if (first.byteLength !== second.byteLength) return false;
  for (let index = 0; index < first.byteLength; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

export function overlaysEqual(firstValue, secondValue) {
  const first = normaliseOverlay(firstValue);
  const second = normaliseOverlay(secondValue);
  if (first.directories.join('\0') !== second.directories.join('\0')) return false;
  if (first.deleted.join('\0') !== second.deleted.join('\0')) return false;
  if (first.files.length !== second.files.length) return false;
  return first.files.every((file, index) => (
    file.path === second.files[index].path && bytesEqual(file.data, second.files[index].data)
  ));
}

export function captureFilesystem(fs, { excludedPaths = DEFAULT_PERSISTENCE_EXCLUDES } = {}) {
  const directories = [];
  const files = [];
  const excluded = excludedPaths.map(normaliseFsPath);

  const visit = (directory) => {
    const names = [...fs.readdir(directory)].filter((name) => name !== '.' && name !== '..').sort();
    for (const name of names) {
      const child = normaliseFsPath(`${directory === '/' ? '' : directory}/${name}`);
      if (pathExcluded(child, excluded)) continue;
      const stat = fs.stat(child);
      if (fs.isDir(stat.mode)) {
        directories.push(child);
        visit(child);
      } else if (fs.isFile(stat.mode)) {
        files.push({ path: child, data: asBytes(fs.readFile(child)) });
      }
    }
  };

  visit('/');
  return { directories: directories.sort(), files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}

export function diffFilesystem(baseSnapshot, currentSnapshot) {
  const baseDirectories = new Set(baseSnapshot.directories || []);
  const currentDirectories = new Set(currentSnapshot.directories || []);
  const baseFiles = new Map((baseSnapshot.files || []).map((file) => [file.path, file.data]));
  const currentFiles = new Map((currentSnapshot.files || []).map((file) => [file.path, file.data]));
  const overlay = emptyOverlay();

  overlay.directories = [...currentDirectories].filter((path) => !baseDirectories.has(path)).sort();
  overlay.deleted = [
    ...[...baseFiles.keys()].filter((path) => !currentFiles.has(path)),
    ...[...baseDirectories].filter((path) => !currentDirectories.has(path)),
  ].sort();
  overlay.files = [...currentFiles.entries()]
    .filter(([path, data]) => !baseFiles.has(path) || !bytesEqual(baseFiles.get(path), data))
    .map(([path, data]) => ({ path, data: asBytes(data) }))
    .sort((first, second) => first.path.localeCompare(second.path));
  return overlay;
}

function removeTree(fs, path) {
  let stat;
  try {
    stat = fs.stat(path);
  } catch (_) {
    return;
  }
  if (fs.isDir(stat.mode)) {
    for (const name of fs.readdir(path)) {
      if (name === '.' || name === '..') continue;
      removeTree(fs, normaliseFsPath(`${path}/${name}`));
    }
    fs.rmdir(path);
  } else {
    fs.unlink(path);
  }
}

export function applyFilesystemOverlay(fs, value, {
  excludedPaths = DEFAULT_PERSISTENCE_EXCLUDES,
} = {}) {
  const overlay = normaliseOverlay(value);
  const excluded = excludedPaths.map(normaliseFsPath);
  const assertAllowed = (path) => {
    if (pathExcluded(path, excluded)) throw new Error(`Overlay nesmí měnit runtime cestu ${path}.`);
  };

  for (const path of [...overlay.deleted].sort((a, b) => b.length - a.length)) {
    assertAllowed(path);
    removeTree(fs, path);
  }
  for (const path of [...overlay.directories].sort((a, b) => a.length - b.length)) {
    assertAllowed(path);
    fs.mkdirTree(path);
  }
  for (const file of overlay.files) {
    assertAllowed(file.path);
    const parent = file.path.slice(0, file.path.lastIndexOf('/')) || '/';
    fs.mkdirTree(parent);
    fs.writeFile(file.path, file.data);
  }
  return overlay;
}
