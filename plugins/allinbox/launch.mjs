#!/usr/bin/env node
// Starts the pinned allinbox MCP server through npx. The Claude Code plugin, the Gemini CLI
// extension and the Claude Desktop bundle all run this file, so they share one pinned version
// and one Windows fix (npx is npx.cmd there, which only starts through a shell).
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const VERSION = '0.3.0';
const win = process.platform === 'win32';

// cwd = temp dir: run from inside a folder whose package.json is named "allinbox" (this repo),
// npx would resolve that local package instead of the pinned release.
const child = spawn('npx', ['-y', `allinbox@${VERSION}`, 'serve'], { stdio: 'inherit', shell: win, cwd: tmpdir() });

child.on('error', (err) => {
  console.error(`allinbox: could not start npx (${err.message}). Install Node.js 20.12 or newer from https://nodejs.org`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
