export const CTRL_A = '\x01';
export const CTRL_B = '\x02';
export const CTRL_C = '\x03';
export const CTRL_D = '\x04';

export const RAW_REPL_ENTER_SEQUENCE = `\r${CTRL_C}${CTRL_C}\r${CTRL_B}\r${CTRL_A}`;

export function parseRawReplResponse(value) {
  const raw = String(value ?? '');
  // Raw REPL vždy zapisuje protokolové OK před stdout programu. Výstup sám
  // může obsahovat další text "OK", proto se nesmí hledat poslední výskyt.
  const ok = raw.indexOf('OK');
  if (ok < 0) return { complete: false, raw, stdout: '', stderr: '' };
  const stdoutEnd = raw.indexOf(CTRL_D, ok + 2);
  if (stdoutEnd < 0) return { complete: false, raw, stdout: '', stderr: '' };
  const stderrEnd = raw.indexOf(CTRL_D, stdoutEnd + 1);
  if (stderrEnd < 0) return { complete: false, raw, stdout: '', stderr: '' };
  return {
    complete: true,
    raw,
    stdout: raw.slice(ok + 2, stdoutEnd),
    stderr: raw.slice(stdoutEnd + 1, stderrEnd),
  };
}
