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
  // Absent = app password. Present = sign in with Microsoft; the keychain then holds a refresh token.
  // Both values end up in a URL / form body, hence the strict shapes.
  oauth: z
    .object({
      provider: z.literal('microsoft'),
      clientId: z.string().regex(/^[0-9a-f-]{36}$/i),
      tenant: z.string().regex(/^[a-z0-9.-]+$/i),
    })
    .optional(),
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

/** Where secrets live. The OS keychain in real use; tests pass a Map-backed one. */
export interface SecretStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): boolean;
}
const keychain: SecretStore = {
  get: (key) => new Entry(KEYRING_SERVICE, key).getPassword(),
  set: (key, value) => new Entry(KEYRING_SERVICE, key).setPassword(value),
  delete: (key) => new Entry(KEYRING_SERVICE, key).deletePassword(),
};

// Windows Credential Manager caps one entry at 2560 bytes (1280 UTF-16 chars) and Microsoft refresh
// tokens can be longer, so long secrets spill into "<id>#1", "<id>#2", ... App passwords fit in one.
const CHUNK = 1000;
const chunkKey = (id: string, i: number): string => (i ? `${id}#${i}` : id);

export function readSecret(id: string, store: SecretStore = keychain): string | null {
  let secret = '';
  for (let i = 0; ; i++) {
    const part = store.get(chunkKey(id, i));
    if (!part) break;
    secret += part;
    if (part.length < CHUNK) break; // a short chunk is the last one: no extra lookup for passwords
  }
  return secret || null;
}

export function writeSecret(id: string, secret: string, store: SecretStore = keychain): void {
  const parts = Math.max(1, Math.ceil(secret.length / CHUNK));
  for (let i = 0; i < parts; i++) store.set(chunkKey(id, i), secret.slice(i * CHUNK, (i + 1) * CHUNK));
  for (let i = parts; store.delete(chunkKey(id, i)); i++); // a shorter secret must not keep an old tail
}

export function clearSecret(id: string, store: SecretStore = keychain): boolean {
  let removed = false;
  for (let i = 0; store.delete(chunkKey(id, i)); i++) removed = true;
  return removed;
}

/** The account's secret: an app password, or a refresh token for OAuth accounts. */
export function getPassword(id: string): string {
  const fromEnv = process.env[passwordEnvVar(id)];
  if (fromEnv) return fromEnv;
  const stored = readSecret(id);
  if (!stored) throw new Error(`No password stored for "${id}". Run: npx allinbox`);
  return stored;
}

export const setPassword = (id: string, password: string): void => writeSecret(id, password);

export const deletePassword = (id: string): boolean => clearSecret(id);
