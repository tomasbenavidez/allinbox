#!/usr/bin/env node
// Not importing `stdin`: touching process.stdin opens a handle that kept `allinbox help` alive for a
// minute when stdin was a pipe. Only the code paths that need it read it.
import { argv, exit } from 'node:process';
import { loadConfig, saveConfig, deletePassword } from './config.js';
import { searchAccount } from './imap.js';
import { serveStdio } from './server.js';
import { onboarding, addAccount, connectAgents, friendlyError, closePrompts } from './onboarding.js';
import { tr } from './i18n.js';

const HELP = `allinbox — all your inboxes, one query, any agent.

  allinbox              guided setup (in a terminal) / MCP server (when an agent runs it)
  allinbox add          add one email account
  allinbox connect      connect allinbox to your installed agents
  allinbox list         list configured accounts
  allinbox remove ID    remove an account and its stored password
  allinbox test [ID]    check that accounts can connect
  allinbox serve        force MCP server mode (stdio)`;

async function add(): Promise<void> {
  const config = await loadConfig();
  const account = await addAccount(config.accounts);
  if (account) await saveConfig({ ...config, accounts: [...config.accounts, account] });
}

async function remove(id?: string): Promise<void> {
  if (!id) throw new Error('Usage: allinbox remove <id>');
  const config = await loadConfig();
  if (!config.accounts.some((a) => a.id === id)) throw new Error(`No account "${id}"`);
  await saveConfig({ ...config, accounts: config.accounts.filter((a) => a.id !== id) });
  deletePassword(id);
  console.log(`Removed ${id}.`);
}

async function test(id?: string): Promise<void> {
  const accounts = (await loadConfig()).accounts.filter((a) => !id || a.id === id);
  if (!accounts.length) throw new Error(id ? `No account "${id}"` : 'No accounts. Run: npx allinbox');
  let failed = false;
  for (const a of accounts) {
    try {
      await searchAccount(a, { sinceDays: 1, limit: 1 });
      console.log(`ok    ${a.id}`);
    } catch (e) {
      failed = true;
      console.log(`FAIL  ${a.id}: ${tr(friendlyError(e, a))}`);
    }
  }
  if (failed) exit(1);
}

async function main(): Promise<void> {
  const [cmd, arg] = argv.slice(2);
  switch (cmd) {
    case undefined:
      // Agents spawn us with piped stdio; a human runs us in a terminal.
      return process.stdin.isTTY ? onboarding() : serveStdio();
    case 'serve':
      return serveStdio();
    case 'setup':
      return onboarding();
    case 'add':
      return add();
    case 'connect':
      return connectAgents();
    case 'list': {
      const { accounts, drafts } = await loadConfig();
      console.log(accounts.length ? accounts.map((a) => `${a.id}  ${a.host}:${a.port}`).join('\n') : 'No accounts.');
      console.log(`drafts: ${drafts.enabled ? `on${drafts.allowRecipients.length ? ` (only ${drafts.allowRecipients.join(', ')})` : ''}` : 'off'}`);
      return;
    }
    case 'remove':
      return remove(arg);
    case 'test':
      return test(arg);
    default:
      console.log(HELP);
      if (!['help', '--help', '-h'].includes(cmd)) exit(1);
  }
}

main()
  .then(closePrompts) // interactive commands only; serve never opens a prompt
  .catch((e: unknown) => {
  closePrompts();
  console.error(`allinbox: ${e instanceof Error ? e.message : e}`);
  exit(1);
});
