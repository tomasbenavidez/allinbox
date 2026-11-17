// Microsoft sign-in (Outlook, Hotmail, Microsoft 365): OAuth device-code flow, then IMAP XOAUTH2.
// Microsoft no longer accepts passwords (or app passwords) over IMAP for these accounts.
// Only the IMAP scope is requested, never SMTP.Send: the token itself cannot send mail.
import { getPassword, setPassword, type Account } from './config.js';

type OAuth = NonNullable<Account['oauth']>;
type Fetch = typeof fetch;

/**
 * Public client id of the allinbox app registration (not a secret: device-code clients have none).
 * ALLINBOX_MS_CLIENT_ID overrides it, e.g. for an organization that registers its own app.
 * The id in use is saved on each account, because refresh tokens are bound to it.
 */
const DEFAULT_CLIENT_ID = '496eb94e-6eb7-4a0b-834b-f7c30da464e0';
export const msClientId = (): string => process.env.ALLINBOX_MS_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;
/** ALLINBOX_MS_TENANT overrides the tenant, for single-tenant app registrations. */
export const msTenant = (fallback: string): string => process.env.ALLINBOX_MS_TENANT?.trim() || fallback;

const SCOPE = 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access';
const HTTP_TIMEOUT_MS = 15_000;
const EXPIRY_MARGIN_MS = 60_000;

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post(oauth: OAuth, endpoint: 'devicecode' | 'token', params: Record<string, string>, fetchFn: Fetch) {
  const res = await fetchFn(`https://login.microsoftonline.com/${oauth.tenant}/oauth2/v2.0/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: oauth.clientId, ...params }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return body;
  // "AADSTS70016: ... Trace ID: ... Correlation ID: ... Timestamp: ...": keep the readable part.
  const description = String(body.error_description ?? `HTTP ${res.status}`).split(/\s+Trace ID:/)[0];
  throw new OAuthError(String(body.error ?? 'http_error'), description);
}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Step 1: get the short code the user types at `verification_uri`. */
export const startDeviceLogin = async (oauth: OAuth, fetchFn: Fetch = fetch): Promise<DeviceCode> =>
  (await post(oauth, 'devicecode', { scope: SCOPE }, fetchFn)) as unknown as DeviceCode;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Step 2: wait until the user finishes in the browser. Rejects if they decline or the code expires. */
export async function pollDeviceLogin(
  oauth: OAuth,
  device: DeviceCode,
  fetchFn: Fetch = fetch,
  sleep: (ms: number) => Promise<void> = realSleep,
): Promise<Tokens> {
  let interval = device.interval || 5;
  for (let waited = 0; waited < device.expires_in; waited += interval) {
    await sleep(interval * 1000);
    try {
      const tokens = (await post(
        oauth,
        'token',
        { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device.device_code },
        fetchFn,
      )) as unknown as Tokens;
      if (!tokens.refresh_token) throw new OAuthError('no_refresh_token', 'Microsoft did not return a refresh token');
      return tokens;
    } catch (e) {
      if (!(e instanceof OAuthError)) throw e;
      if (e.code === 'slow_down') interval += 5; // RFC 8628 §3.5
      else if (e.code !== 'authorization_pending') throw e;
    }
  }
  throw new OAuthError('expired_token', 'The code expired before the sign-in finished');
}

// Access tokens live about an hour; the MCP server lives for days. Cache per account, and share one
// refresh between parallel tool calls (agents routinely fire several read_email at once).
const cache = new Map<string, { token: string; expires: number }>();
const inflight = new Map<string, Promise<string>>();

export interface TokenStore {
  load: (id: string) => string;
  save: (id: string, refreshToken: string) => void;
}
const keychain: TokenStore = { load: getPassword, save: setPassword };

/** A valid access token for an OAuth account, refreshed when needed. */
export function accessToken(account: Account, fetchFn: Fetch = fetch, store: TokenStore = keychain): Promise<string> {
  const hit = cache.get(account.id);
  if (hit && hit.expires - Date.now() > EXPIRY_MARGIN_MS) return Promise.resolve(hit.token);
  let pending = inflight.get(account.id);
  if (!pending) {
    pending = refresh(account, fetchFn, store).finally(() => inflight.delete(account.id));
    inflight.set(account.id, pending);
  }
  return pending;
}

async function refresh(account: Account, fetchFn: Fetch, store: TokenStore): Promise<string> {
  if (!account.oauth) throw new Error(`${account.id} is not an OAuth account`);
  const current = store.load(account.id);
  let tokens: Tokens;
  try {
    tokens = (await post(
      account.oauth,
      'token',
      { grant_type: 'refresh_token', refresh_token: current, scope: SCOPE },
      fetchFn,
    )) as unknown as Tokens;
  } catch (e) {
    // Unused for months, password changed, or access revoked in the Microsoft account.
    if (e instanceof OAuthError && e.code === 'invalid_grant') {
      throw new OAuthError(
        e.code,
        `The Microsoft sign-in for ${account.id} expired or was revoked. Ask the user to run: npx allinbox login ${account.id}`,
      );
    }
    throw e;
  }
  // Microsoft rotates refresh tokens. The old one stays valid, so a failed save (no keychain: the
  // token came from the env override) is not fatal.
  if (tokens.refresh_token && tokens.refresh_token !== current) {
    try {
      store.save(account.id, tokens.refresh_token);
    } catch {
      /* keep using the current one */
    }
  }
  cache.set(account.id, { token: tokens.access_token, expires: Date.now() + tokens.expires_in * 1000 });
  return tokens.access_token;
}

/** Forget the cached access token (after a new sign-in, or in tests). */
export const forgetAccessToken = (id: string): boolean => cache.delete(id);
