import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Entry } from '@napi-rs/keyring';
import { z } from 'zod';

const AccountSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  host: z.string().min(1),
  port: z.number().int().positive(),
  secure: z.boolean(),
  user: z.string().min(1),
});
export type Account = z.infer<typeof AccountSchema>;

const ConfigSchema = z.object({
  accounts: z.array(AccountSchema).default([]),
  drafts: z
    .object({
      // Off by default: the agent can only read until the user opts in.
      enabled: z.boolean().default(false),
      // Empty = any recipient. Entries: "ana@x.com" or "@company.com".
      allowRecipients: z.array(z.string()).default([]),
    })
    .default({ enabled: false, allowRecipients: [] }),
});
export type Config = z.infer<typeof ConfigSchema>;

const KEYRING_SERVICE = 'allinbox';

export const configDir = (): string => process.env.ALLINBOX_HOME ?? join(homedir(), '.allinbox');
export const configFile = (): string => join(configDir(), 'config.json');

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(configFile(), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ConfigSchema.parse({});
    throw e;
  }
  const parsed = ConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`Invalid ${configFile()}: ${parsed.error.message}`);
  return parsed.data;
}

export const loadAccounts = async (): Promise<Account[]> => (await loadConfig()).accounts;

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  // No secrets here (passwords live in the OS keychain); 0600 anyway.
  await writeFile(configFile(), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

/** Env override for CI/headless boxes without a keychain: ALLINBOX_PASS_<ID>. */
export const passwordEnvVar = (id: string): string =>
  `ALLINBOX_PASS_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

export function getPassword(id: string): string {
  const fromEnv = process.env[passwordEnvVar(id)];
  if (fromEnv) return fromEnv;
  const stored = new Entry(KEYRING_SERVICE, id).getPassword();
  if (!stored) throw new Error(`No password stored for "${id}". Run: npx allinbox`);
  return stored;
}

export const setPassword = (id: string, password: string): void =>
  new Entry(KEYRING_SERVICE, id).setPassword(password);

export const deletePassword = (id: string): boolean => new Entry(KEYRING_SERVICE, id).deletePassword();
