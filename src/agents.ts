// Detect installed agents and register allinbox in each one's MCP config.
import { existsSync } from 'node:fs';
import { readFile, writeFile, copyFile, mkdir, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from './version.js';
import type { L } from './i18n.js';

const isWin = platform() === 'win32';
const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
// Run through `npx allinbox`, the CLI lives in npm's _npx cache. Anything else is a local checkout or a
// global install, which must register itself directly (it may not even be published yet).
const viaNpx = /[\\/]_npx[\\/]/.test(cliPath);
// Pinned: agents must not silently run whatever version is published next. Re-run setup to upgrade.
const pkg = `allinbox@${VERSION}`;
// Explicit "serve": an agent that spawns us through a pty must never land in the interactive setup.
// On Windows, MCP clients spawn without a shell, so npx (a .cmd) needs cmd /c.
export const serverEntry = !viaNpx
  ? { command: process.execPath, args: [cliPath, 'serve'] }
  : isWin
    ? { command: 'cmd', args: ['/c', 'npx', '-y', pkg, 'serve'] }
    : { command: 'npx', args: ['-y', pkg, 'serve'] };

export type InstallResult = 'added' | 'updated' | 'unchanged';

export interface Agent {
  name: string;
  detected: () => boolean;
  /** Why installing now would not stick (shown instead of a ✓), or null. */
  blockedReason?: () => L | null;
  install: () => Promise<InstallResult>;
  manual: string;
}

// Claude Code's CLI is also "claude.exe", so on Windows only the desktop app's install path counts:
// ...\WindowsApps\Claude_*\app\claude.exe (MSIX) or ...\AnthropicClaude\app-<ver>\claude.exe.
const DESKTOP_EXE = /[\\/]app(-[\d.]+)?[\\/]claude\.exe$/i;

export function claudeDesktopRunning(paths?: string[]): boolean {
  try {
    if (!isWin && !paths) {
      // pgrep -x is case-sensitive: "Claude" is the macOS app, not the "claude" CLI. Exit 1 = no match.
      execFileSync('pgrep', ['-x', 'Claude'], { stdio: 'ignore' });
      return true;
    }
    const list =
      paths ??
      execFileSync(
        'powershell',
        ['-NoProfile', '-Command', '(Get-Process -Name Claude -ErrorAction SilentlyContinue).Path'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).split(/\r?\n/);
    return list.some((p) => DESKTOP_EXE.test(p.trim()));
  } catch {
    return false;
  }
}

const home = homedir();
const claudeDesktopConfig = isWin
  ? join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
  : platform() === 'darwin'
    ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : join(home, '.config', 'Claude', 'claude_desktop_config.json');

/** Absolute path of a binary on PATH, or null. Absolute = no cwd hijack, no shell. */
const which = (bin: string): string | null => {
  try {
    const out = execFileSync(isWin ? 'where' : 'which', [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\r?\n/).find(Boolean)?.trim() ?? null;
  } catch {
    return null;
  }
};

/** Timestamped backup (never overwrites an older one), then atomic replace via rename. */
async function safeWrite(file: string, content: string): Promise<void> {
  if (existsSync(file)) await copyFile(file, `${file}.allinbox-backup-${Date.now()}`);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.allinbox-tmp`;
  await writeFile(tmp, content);
  await rename(tmp, file);
}

/** Sets mcpServers.allinbox, keeping everything else. Refuses to touch unparseable files. */
async function addToJsonConfig(file: string): Promise<InstallResult> {
  const raw = existsSync(file) ? await readFile(file, 'utf8') : '{}';
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw.trim() || '{}');
  } catch {
    throw new Error(`${file} is not plain JSON (comments?). Add allinbox by hand.`);
  }
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  if (JSON.stringify(servers.allinbox) === JSON.stringify(serverEntry)) return 'unchanged';
  const next = { ...config, mcpServers: { ...servers, allinbox: serverEntry } };
  await safeWrite(file, JSON.stringify(next, null, 2) + '\n');
  return servers.allinbox ? 'updated' : 'added';
}

// Matches [mcp_servers.allinbox], [mcp_servers."allinbox"], [mcp_servers.allinbox.env], indented too.
const CODEX_TABLE = /^\s*\[\s*mcp_servers\s*\.\s*("?)allinbox\1\s*[\].]/m;

// The exact block this file writes. Only that shape is ever rewritten in place.
const OUR_CODEX_BLOCK = /^\[mcp_servers\.allinbox\]\ncommand = .*\nargs = \[.*\]\n/m;

async function addToCodexToml(file: string): Promise<InstallResult> {
  const raw = (existsSync(file) ? await readFile(file, 'utf8') : '').replace(/\r\n/g, '\n');
  const args = serverEntry.args.map((a) => JSON.stringify(a)).join(', ');
  const block = `[mcp_servers.allinbox]\ncommand = ${JSON.stringify(serverEntry.command)}\nargs = [${args}]\n`;
  if (raw.includes(block)) return 'unchanged';
  if (CODEX_TABLE.test(raw)) {
    if (!OUR_CODEX_BLOCK.test(raw)) throw new Error(`${file} has a hand-edited allinbox entry. Update it by hand.`);
    await safeWrite(file, raw.replace(OUR_CODEX_BLOCK, block));
    return 'updated';
  }
  await safeWrite(file, `${raw.replace(/\s*$/, '\n')}\n${block}`);
  return 'added';
}

function runClaude(args: string[]): string {
  const bin = which('claude');
  if (!bin) throw new Error('claude not found on PATH');
  // npm-installed shims are .cmd files, which Node can only start through a shell. Path is absolute & quoted.
  const viaShell = /\.(cmd|bat)$/i.test(bin);
  return execFileSync(viaShell ? `"${bin}"` : bin, args, { encoding: 'utf8', stdio: 'pipe', shell: viaShell, cwd: homedir() });
}

function installClaudeCode(): InstallResult {
  let current: string | null = null;
  try {
    current = runClaude(['mcp', 'get', 'allinbox']);
  } catch {
    // not registered yet
  }
  // `claude mcp get` prints "Command: ..." and "Args: ..." lines.
  const same =
    current?.includes(`Command: ${serverEntry.command}`) && current.includes(`Args: ${serverEntry.args.join(' ')}`);
  if (same) return 'unchanged';
  if (current !== null) runClaude(['mcp', 'remove', '--scope', 'user', 'allinbox']);
  runClaude(['mcp', 'add', '--scope', 'user', 'allinbox', '--', serverEntry.command, ...serverEntry.args]);
  return current === null ? 'added' : 'updated';
}

const jsonSnippet = JSON.stringify({ mcpServers: { allinbox: serverEntry } });

export const AGENTS: Agent[] = [
  {
    name: 'Claude Code',
    detected: () => which('claude') !== null,
    install: async () => installClaudeCode(),
    manual: `claude mcp add --scope user allinbox -- ${[serverEntry.command, ...serverEntry.args].join(' ')}`,
  },
  {
    name: 'Claude Desktop',
    detected: () => existsSync(dirname(claudeDesktopConfig)),
    // Claude Desktop rewrites its config while running and drops entries it did not write.
    // ponytail: the lasting fix is the .mcpb bundle (ROADMAP).
    blockedReason: () =>
      claudeDesktopRunning()
        ? {
            en: 'it is open and would overwrite the change. Quit it completely (tray icon too), then run "allinbox connect".',
            es: 'está abierto y pisaría el cambio. Cerralo del todo (también desde la bandeja) y corré "allinbox connect".',
          }
        : null,
    install: () => addToJsonConfig(claudeDesktopConfig),
    manual: `${claudeDesktopConfig}: ${jsonSnippet}`,
  },
  {
    name: 'Cursor',
    detected: () => existsSync(join(home, '.cursor')),
    install: () => addToJsonConfig(join(home, '.cursor', 'mcp.json')),
    manual: `~/.cursor/mcp.json: ${jsonSnippet}`,
  },
  {
    name: 'Gemini CLI',
    detected: () => existsSync(join(home, '.gemini')),
    install: () => addToJsonConfig(join(home, '.gemini', 'settings.json')),
    manual: `~/.gemini/settings.json: ${jsonSnippet}`,
  },
  {
    name: 'Codex',
    detected: () => existsSync(join(home, '.codex')),
    install: () => addToCodexToml(join(home, '.codex', 'config.toml')),
    manual: `~/.codex/config.toml: [mcp_servers.allinbox] command = "${serverEntry.command}"`,
  },
];

// Exported for tests.
export const _internal = { addToJsonConfig, addToCodexToml };
