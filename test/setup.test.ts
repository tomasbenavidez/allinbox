import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.ts';
import { demoConfig, demoMail, demoSetup } from '../src/demo.ts';
import { SETUP_URI } from '../src/view.ts';

async function setup() {
  const opened: string[] = [];
  const config = demoConfig();
  const server = await createServer(config, demoMail, true, demoSetup(config, (u) => opened.push(u)));
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    if (r.isError) throw new Error(r.content[0].text);
    return r.content[0].text;
  };
  return { client, call, opened };
}

/** POST a form like the browser would (same Origin). */
const post = (url: string, form: Record<string, string>, origin = new URL(url).origin) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin }, body: new URLSearchParams(form) });

test('setup tools: one model-facing tool with the view, the rest app-only', async () => {
  const { client } = await setup();
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.deepEqual(byName.setup_accounts._meta?.ui, { resourceUri: SETUP_URI });
  for (const n of ['setup_state', 'setup_detect', 'setup_open']) assert.deepEqual(byName[n]._meta?.ui, { visibility: ['app'] });
  const { contents } = await client.readResource({ uri: SETUP_URI });
  assert.doesNotMatch(String(contents[0].text), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  await client.close();
});

test('add account: password only on the local page, tested before saving, live in search', async () => {
  const { client, call, opened } = await setup();
  const info = JSON.parse(await call('setup_detect', { email: 'Ana@Gmail.com' }));
  assert.equal(info.label, 'Gmail');
  assert.match(info.appPassword.url, /apppasswords\?authuser=ana%40gmail\.com/);

  const { url } = JSON.parse(await call('setup_open', { mode: 'add', email: 'ana@gmail.com', lang: 'es' }));
  assert.deepEqual(opened, [url]);
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/add\?t=[\w-]{32}$/);
  const token = new URL(url).searchParams.get('t')!;
  const page = await (await fetch(url)).text();
  assert.match(page, /type="password"/);
  assert.match(page, /Probar y guardar/);

  // Wrong token, foreign Origin and a rebinding Host are all refused.
  assert.equal((await fetch(url.replace(token, 'x'.repeat(32)))).status, 410);
  assert.equal((await post(new URL('/add', url).href, { t: token, password: 'abcd' }, 'https://evil.example')).status, 403);
  assert.equal((await post(new URL('/add', url).href, { t: token, password: 'abcd' }, 'null')).status, 403);
  // Browsers only send a real Origin on same-origin form POSTs if the referrer policy allows it.
  assert.equal((await fetch(url)).headers.get('referrer-policy'), 'same-origin');
  const rebound = await new Promise<number>((resolve) =>
    request(url, { headers: { host: 'evil.example' } }, (r) => resolve(r.statusCode!)).end());
  assert.equal(rebound, 403);

  const bad = await (await post(new URL('/add', url).href, { t: token, password: 'wrong' })).text();
  assert.match(bad, /contraseña DE APLICACIÓN/);
  assert.equal(JSON.parse(await call('setup_state')).status.state, 'failed');
  assert.doesNotMatch(await call('list_accounts'), /ana@gmail\.com/); // nothing stored on failure

  const good = await (await post(new URL('/add', url).href, { t: token, password: 'abcd efgh ijkl mnop' })).text();
  assert.match(good, /ana@gmail\.com conectada/);
  const state = JSON.parse(await call('setup_state'));
  assert.equal(state.status.state, 'connected');
  assert.ok(state.accounts.includes('ana@gmail.com'));
  assert.match(await call('list_accounts'), /ana@gmail\.com/); // live, no restart
  // One-time link: after success the local server is gone (or answers 410 if another page opened).
  const after = await fetch(url).then((r) => r.status, () => 'closed');
  assert.ok(after === 'closed' || after === 410);
  await client.close();
});

test('manage page: drafts allowlist fails closed and create_draft appears live', async () => {
  const { client, call } = await setup();
  const { url } = JSON.parse(await call('setup_open', { mode: 'manage', lang: 'en' }));
  const token = new URL(url).searchParams.get('t')!;
  const drafts = new URL('/drafts', url).href;

  const refused = await post(drafts, { t: token, enabled: 'on', allow: ' ' });
  assert.equal(refused.status, 400);
  assert.ok(!(await client.listTools()).tools.some((t) => t.name === 'create_draft'));

  assert.equal((await post(drafts, { t: token, enabled: 'on', allow: '@example.com' })).status, 200);
  const tool = (await client.listTools()).tools.find((t) => t.name === 'create_draft');
  assert.match(tool!.description!, /Allowed recipients only: @example\.com/);

  assert.equal((await post(new URL('/remove', url).href, { t: token, id: 'studio' })).status, 200);
  assert.deepEqual(JSON.parse(await call('setup_state')).accounts, ['personal', 'work']);
  await client.close();
});

test('the model is told to use the assistant, never to ask for passwords', async () => {
  const { call } = await setup();
  assert.match(await call('setup_accounts', { email: 'x@y.com' }), /Do not ask for passwords in chat/);
});

test('setup_accounts with an email opens the secure page itself (hosts without tool proxying)', async () => {
  const { call, opened } = await setup();
  const out = await call('setup_accounts', { email: 'Bob@Gmail.com' });
  assert.match(out, /^Connected accounts: personal, work, studio$/m); // the view parses this line
  assert.match(out, /Opened a secure page in the user's browser to connect bob@gmail\.com:/);
  assert.equal(opened.length, 1);
  const page = await (await fetch(opened[0])).text();
  assert.match(page, /apppasswords\?authuser=bob%40gmail\.com/); // provider steps live on the page too
  assert.doesNotMatch(out, /127\.0\.0\.1|t=/); // the one-time URL never reaches the model
  assert.match(await call('setup_accounts', { email: 'work' }), /^Connected accounts:/);
  assert.match(await call('setup_accounts', { manage: true }), /manage accounts and drafts/);
});
