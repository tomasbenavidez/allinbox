import { spawn } from 'node:child_process';
import { platform } from 'node:os';

// explorer.exe on Windows (not `cmd /c start`): the URL carries an email, and cmd would parse & ^ %.
// Callers always show the URL too, so a missing opener (headless Linux) only costs a copy-paste.
export function openUrl(url: string): void {
  const opener = platform() === 'win32' ? 'explorer.exe' : platform() === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(opener, [url], { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}
