import { existsSync } from 'fs';
import * as path from 'path';

/** Where Chrome's installer puts chrome.exe on Windows: per-machine (64/32-bit) and per-user. */
export function windowsChromeCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const exe = ['Google', 'Chrome', 'Application', 'chrome.exe'];
  return [env['ProgramFiles'], env['ProgramFiles(x86)'], env['LOCALAPPDATA']]
    .filter((dir): dir is string => !!dir)
    .map((dir) => path.win32.join(dir, ...exe));
}

export function findWindowsChrome(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string | undefined {
  return windowsChromeCandidates(env).find((p) => exists(p));
}
