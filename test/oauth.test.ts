import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OAuthError, accessToken, describeTokens, forgetAccessToken, pollDeviceLogin, signedInAs, startDeviceLogin } from '../src/oauth.ts';
import { clearSecret, loadConfig, readSecret, writeSecret, type Account, type SecretStore } from '../src/config.ts';
import { presetFor, presetForMx } from '../src/providers.ts';
import { friendlyError } from '../src/onboarding.ts';

const oauth = { provider: 'microsoft' as const, clientId: '11111111-2222-3333-4444-555555555555', tenant: 'consumers' };
const account: Account = {
  id: 'ana@outlook.com',
  email: 'ana@outlook.com',
  host: 'outlook.office365.com',
  port: 993,
  secure: true,
  user: 'ana@outlook.com',
  oauth,
};

/** A fetch that answers from a script and records what it was asked. */
function scripted(replies: [status: number, body: object][]) {
  const calls: { url: string; form: URLSearchParams }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), form: init!.body as URLSearchParams });
    const [status, body] = replies.shift() ?? [500, { error: 'script_exhausted' }];
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const pending = [400, { error: 'authorization_pending' }] as [number, object];

test('device login: asks only for IMAP, waits through pending and slow_down, returns the tokens', async () => {
  const { fetchFn, calls } = scripted([
    [200, { device_code: 'dev', user_code: 'ABCD1234', verification_uri: 'https://www.microsoft.com/link', expires_in: 900, interval: 5 }],
    pending,
    [400, { error: 'slow_down' }],
    [200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600 }],
  ]);
  const device = await startDeviceLogin(oauth, fetchFn);
  assert.equal(device.user_code, 'ABCD1234');
  assert.equal(calls[0].url, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode');
  assert.equal(calls[0].form.get('client_id'), oauth.clientId);
  // The only mail permission is IMAP. Never SMTP.Send or anything from Graph: the token must not be able to send.
  assert.deepEqual(calls[0].form.get('scope')!.split(' ').sort(), [
    'https://outlook.office.com/IMAP.AccessAsUser.All',
    'offline_access',
    'openid',
    'profile',
  ]);

  const sleeps: number[] = [];
  const tokens = await pollDeviceLogin(oauth, device, fetchFn, async (ms) => void sleeps.push(ms));
  assert.equal(tokens.refresh_token, 'rt');
  assert.deepEqual(sleeps, [5000, 5000, 10000]); // slow_down adds 5 s
  assert.equal(calls[1].form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code');
  assert.equal(calls[1].form.get('device_code'), 'dev');
});

test('device login: a declined or expired code rejects with its code and a trimmed message', async () => {
  const device = { device_code: 'dev', user_code: 'X', verification_uri: 'https://x', expires_in: 10, interval: 5 };
  const declined = scripted([
    [400, { error: 'authorization_declined', error_description: 'AADSTS70018: Declined. Trace ID: abc Correlation ID: def' }],
  ]);
  await assert.rejects(pollDeviceLogin(oauth, device, declined.fetchFn, async () => {}), (e: OAuthError) => {
    assert.equal(e.code, 'authorization_declined');
    assert.equal(e.message, 'AADSTS70018: Declined.');
    return true;
  });
  // Never answered: stop when expires_in is used up instead of polling forever.
  const silent = scripted([pending, pending, pending, pending]);
  await assert.rejects(pollDeviceLogin(oauth, device, silent.fetchFn, async () => {}), { code: 'expired_token' });
  assert.equal(silent.calls.length, 2);
});

test('accessToken: one refresh for parallel calls, cached after, rotated refresh token is saved', async () => {
  forgetAccessToken(account.id);
  const saved: string[] = [];
  const store = { load: () => 'rt-old', save: (_id: string, rt: string) => void saved.push(rt) };
  const { fetchFn, calls } = scripted([[200, { access_token: 'at-1', refresh_token: 'rt-new', expires_in: 3600 }]]);
  const tokens = await Promise.all([accessToken(account, fetchFn, store), accessToken(account, fetchFn, store)]);
  assert.deepEqual(tokens, ['at-1', 'at-1']);
  assert.equal(await accessToken(account, fetchFn, store), 'at-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].form.get('grant_type'), 'refresh_token');
  assert.equal(calls[0].form.get('refresh_token'), 'rt-old');
  assert.deepEqual(saved, ['rt-new']);

  // No keychain (token came from the env override): the save fails, the token still works.
  forgetAccessToken(account.id);
  const readOnly = { load: () => 'rt-old', save: () => { throw new Error('no keychain'); } };
  const again = scripted([[200, { access_token: 'at-2', refresh_token: 'rt-newer', expires_in: 3600 }]]);
  assert.equal(await accessToken(account, again.fetchFn, readOnly), 'at-2');
  forgetAccessToken(account.id);
});

test('accessToken: an expired sign-in tells the agent which command the user must run', async () => {
  forgetAccessToken(account.id);
  const store = { load: () => 'rt-dead', save: () => {} };
  const { fetchFn } = scripted([[400, { error: 'invalid_grant', error_description: 'AADSTS70000: expired' }]]);
  await assert.rejects(accessToken(account, fetchFn, store), /npx allinbox login ana@outlook\.com/);
  // A failed refresh is not cached: the next call tries again.
  const ok = scripted([[200, { access_token: 'at', refresh_token: 'rt-dead', expires_in: 3600 }]]);
  assert.equal(await accessToken(account, ok.fetchFn, store), 'at');
  forgetAccessToken(account.id);
});

test('long secrets are split across keychain entries and a shorter one leaves no tail', () => {
  const map = new Map<string, string>();
  let reads = 0;
  const store: SecretStore = {
    get: (k) => (reads++, map.get(k) ?? null),
    set: (k, v) => void map.set(k, v),
    delete: (k) => map.delete(k),
  };
  const long = 'x'.repeat(1000) + 'y'.repeat(1000) + 'z'.repeat(300); // a work-account refresh token
  writeSecret('a@x.com', long, store);
  assert.deepEqual([...map.keys()], ['a@x.com', 'a@x.com#1', 'a@x.com#2']);
  assert.ok([...map.values()].every((v) => v.length <= 1000)); // Windows caps an entry at 1280 chars
  assert.equal(readSecret('a@x.com', store), long);

  writeSecret('a@x.com', 'app-password', store);
  assert.deepEqual([...map.keys()], ['a@x.com']);
  reads = 0;
  assert.equal(readSecret('a@x.com', store), 'app-password');
  assert.equal(reads, 1); // passwords cost one keychain lookup, as before

  writeSecret('a@x.com', 'x'.repeat(2000), store); // exactly on the chunk boundary
  assert.equal(readSecret('a@x.com', store)?.length, 2000);
  assert.equal(clearSecret('a@x.com', store), true);
  assert.equal(map.size, 0);
  assert.equal(readSecret('a@x.com', store), null);
  assert.equal(clearSecret('a@x.com', store), false);
});

test('Microsoft presets sign in with OAuth; config accepts old accounts and rejects odd tenants', async () => {
  assert.deepEqual(presetFor('ana@hotmail.com')?.oauth, { provider: 'microsoft', tenant: 'consumers' });
  assert.deepEqual(presetFor('ana@outlook.com.ar')?.oauth, { provider: 'microsoft', tenant: 'consumers' });
  assert.equal(presetForMx(['acme-com.mail.protection.outlook.com'])?.oauth?.tenant, 'organizations');
  assert.equal(presetFor('ana@gmail.com')?.oauth, undefined);

  const home = await mkdtemp(join(tmpdir(), 'allinbox-'));
  const previous = process.env.ALLINBOX_HOME;
  process.env.ALLINBOX_HOME = home;
  try {
    const { oauth: _none, ...passwordAccount } = account;
    await writeFile(join(home, 'config.json'), JSON.stringify({ accounts: [passwordAccount, { ...account, id: 'b' }] }));
    const loaded = (await loadConfig()).accounts;
    assert.equal(loaded[0].oauth, undefined);
    assert.deepEqual(loaded[1].oauth, oauth);
    // The tenant goes into a URL path.
    await writeFile(join(home, 'config.json'), JSON.stringify({ accounts: [{ ...account, oauth: { ...oauth, tenant: 'x/../y' } }] }));
    await assert.rejects(loadConfig(), /Invalid/);
  } finally {
    if (previous === undefined) delete process.env.ALLINBOX_HOME;
    else process.env.ALLINBOX_HOME = previous;
  }
});

test('friendlyError: Microsoft failures point at the real cause, not at app passwords', () => {
  const refused = friendlyError({ responseText: 'NO AUTHENTICATE failed.' }, account);
  assert.match(refused.en, /signed in as ana@outlook\.com/);
  assert.doesNotMatch(refused.en, /APP password/);
  assert.match(friendlyError(new OAuthError('authorization_declined', 'x'), account).es, /canceló/);
  assert.match(friendlyError(new OAuthError('invalid_grant', 'x'), account).en, /allinbox login ana@outlook\.com/);
  // Password accounts keep the app-password hint.
  assert.match(friendlyError({ authenticationFailed: true }, { host: 'h', port: 993 }).en, /APP password/);
});

/**
 * Just enough IMAP for a login: GreenMail has no XOAUTH2, and this is the part Microsoft checks.
 * Tokens: "good-token" logs in; "flaky-token" is refused twice the way Outlook does, then logs in;
 * "stuck-token" is always refused that way; anything else is a plain refusal.
 */
async function fakeOutlook() {
  const { createServer } = await import('node:net');
  const seen: string[] = [];
  const bearer = (token: string) => `user=ana@outlook.com\x01auth=Bearer ${token}\x01\x01`;
  let flakyLeft = 2;
  const server = createServer((socket) => {
    socket.write('* OK ready\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (let end = buffer.indexOf('\r\n'); end >= 0; end = buffer.indexOf('\r\n')) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const [tag, command, ...args] = line.split(' ');
        seen.push([command, ...args].join(' '));
        if (/^CAPABILITY$/i.test(command)) socket.write('* CAPABILITY IMAP4rev1 AUTH=XOAUTH2 SASL-IR\r\n'); // what Outlook advertises
        if (/^AUTHENTICATE$/i.test(command)) {
          const sasl = Buffer.from(args[1] ?? '', 'base64').toString();
          const notConnected = sasl === bearer('stuck-token') || (sasl === bearer('flaky-token') && flakyLeft-- > 0);
          if (notConnected) socket.write(`${tag} NO User is authenticated but not connected.\r\n`);
          else if (sasl === bearer('good-token') || sasl === bearer('flaky-token')) socket.write(`${tag} OK AUTHENTICATE completed.\r\n`);
          else socket.write(`${tag} NO AUTHENTICATE failed.\r\n`);
        } else socket.write(`${tag} OK done\r\n`);
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const local: Account = { ...account, host: '127.0.0.1', port, secure: false };
  const logins = () => seen.filter((c) => c.startsWith('AUTHENTICATE XOAUTH2 ')).length;
  return { local, seen, logins, close: () => server.close() };
}

test('withClient logs in to an OAuth account with XOAUTH2 (user + bearer token), never LOGIN', async () => {
  const { withClient } = await import('../src/imap.ts');
  const { local, seen, logins, close } = await fakeOutlook();
  try {
    assert.equal(await withClient(local, async () => 'in', 'good-token'), 'in');
    assert.equal(logins(), 1);
    assert.ok(!seen.some((c) => /^LOGIN/i.test(c)));
    // A token for another mailbox: the server's refusal becomes the "signed in as someone else?" hint.
    const refused = await withClient(local, async () => 'in', 'other-token').catch((e: unknown) => e);
    assert.match(friendlyError(refused, local).en, /signed in as ana@outlook\.com/);
    assert.equal(logins(), 2); // a plain refusal is final: no retry
    // ...and carries what the server offered, for the details line of a bug report.
    assert.equal((refused as { serverAuth?: string }).serverAuth, 'AUTH=XOAUTH2 SASL-IR');
  } finally {
    close();
  }
});

test('withClient rides out Outlook\'s random "authenticated but not connected", and says so when it cannot', async () => {
  const { withClient } = await import('../src/imap.ts');
  const { local, logins, close } = await fakeOutlook();
  try {
    let ran = 0;
    assert.equal(await withClient(local, async () => ++ran, 'flaky-token'), 1);
    assert.equal(logins(), 3); // refused twice, third connection got in
    assert.equal(ran, 1); // the work itself ran once

    const stuck = await withClient(local, async () => ++ran, 'stuck-token').catch((e: unknown) => e);
    assert.equal(logins(), 3 + 8); // bounded
    assert.equal(ran, 1); // never reached the work
    assert.match((stuck as Error).message, /refused to open the mailbox 8 times in a row/);
    // The user is told it is Microsoft's fault, not sent to check their settings or app passwords.
    const hint = friendlyError(stuck, local);
    assert.match(hint.en, /fault on Microsoft's side/);
    assert.doesNotMatch(hint.en, /signed in as|APP password/);
  } finally {
    close();
  }
});

test('signedInAs / describeTokens: report who signed in and what was granted, never a token', () => {
  const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
  const personal = {
    access_token: 'EwBopaqueSECRET',
    refresh_token: 'M.C5refreshSECRET',
    expires_in: 3600,
    scope: 'https://outlook.office.com/IMAP.AccessAsUser.All',
    id_token: jwt({ preferred_username: 'Otra@Hotmail.com' }),
  };
  assert.equal(signedInAs(personal), 'Otra@Hotmail.com');
  const line = describeTokens(personal);
  assert.match(line, /granted="https:\/\/outlook\.office\.com\/IMAP\.AccessAsUser\.All"/);
  assert.match(line, /token=opaque\(15\)/); // personal-account tokens are not JWTs
  assert.match(line, /signed-in-as=Otra@Hotmail\.com/);
  assert.doesNotMatch(line, /SECRET/);

  const work = { access_token: jwt({ aud: 'https://outlook.office.com', scp: 'IMAP.AccessAsUser.All' }), refresh_token: 'r', expires_in: 1 };
  assert.match(describeTokens(work), /token=jwt aud=https:\/\/outlook\.office\.com scp="IMAP\.AccessAsUser\.All"/);
  assert.equal(signedInAs(work), undefined); // no id_token: say "?" instead of guessing
  assert.match(describeTokens(work), /signed-in-as=\?/);
});
