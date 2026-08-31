const TEXT_ENCODER = new TextEncoder();

function normalisePath(value) {
  const path = String(value || '').replaceAll('\\', '/');
  return path.startsWith('/') ? path : `/${path}`;
}

export function parseFilesList(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf(';');
      if (separator < 1) throw new Error(`Neplatný řádek files.lst: ${line}`);
      const source = line.slice(0, separator).trim().replaceAll('\\', '/');
      const target = line.slice(separator + 1).trim() || '/';
      return { source, target: normalisePath(target) };
    });
}

function targetPath(entry) {
  const target = entry.target.endsWith('/') ? entry.target : `${entry.target}/`;
  return normalisePath(`${target}${entry.source.split('/').pop()}`);
}

function versionedUrl(value, cacheVersion) {
  const url = new URL(value);
  if (cacheVersion) url.searchParams.set('v', cacheVersion);
  return url.href;
}

async function fetchBytes(url) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadFilesList(mp, {
  baseUrl,
  filesListUrl = new URL('files.lst', baseUrl).href,
  cacheVersion = '',
  onFile = () => {},
} = {}) {
  const listResponse = await fetch(versionedUrl(filesListUrl, cacheVersion), { cache: 'force-cache' });
  if (!listResponse.ok) throw new Error(`Nelze načíst files.lst: ${listResponse.status}`);
  const entries = parseFilesList(await listResponse.text());
  let bytes = 0;
  for (const entry of entries) {
    const data = await fetchBytes(versionedUrl(new URL(entry.source, baseUrl).href, cacheVersion));
    const target = targetPath(entry);
    const parent = target.slice(0, target.lastIndexOf('/')) || '/';
    mp.FS.mkdirTree(parent);
    mp.FS.writeFile(target, data);
    bytes += data.byteLength;
    onFile({ ...entry, target, bytes: data.byteLength, total: entries.length });
  }
  return { entries, files: entries.length, bytes };
}

export function installTextModule(mp, path, source) {
  mp.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')) || '/');
  mp.FS.writeFile(path, TEXT_ENCODER.encode(source));
}
