// Integration: real IMAP against GreenMail in Docker. Skipped when no Linux-container Docker engine
// is available (macOS CI runners have no Docker; Windows runners only run Windows containers).
// REQUIRE_INTEGRATION=1 (set in CI on Linux) turns a skip into a failure, so it can't silently vanish.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { ImapFlow } from 'imapflow';
import { searchAll, readMessage, readThread } from '../src/imap.ts';
import { createDraft } from '../src/drafts.ts';
import type { Account } from '../src/config.ts';

const PORT = 3143;
const CONTAINER = 'allinbox-greenmail-test';
const hasDocker = (() => {
  try {
    return execSync('docker info --format "{{.OSType}}"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'linux';
  } catch {
    return false;
  }
})();
if (!hasDocker && process.env.REQUIRE_INTEGRATION === '1') {
  throw new Error('REQUIRE_INTEGRATION=1 but no Linux Docker engine is available');
}

const account = (id: string): Account => ({
  id, email: `${id}@test.local`, host: '127.0.0.1', port: PORT, secure: false, user: `${id}@test.local`,
});
const alice = account('alice');
const bob = account('bob');

const mail = (to: string, subject: string, body: string, messageId: string) =>
  [`From: Juan <juan@acme.com>`, `To: ${to}`, `Subject: ${subject}`, `Message-ID: ${messageId}`,
    `Date: ${new Date().toUTCString()}`, '', body].join('\r\n');

async function append(acc: Account, raw: string) {
  const c = new ImapFlow({ host: '127.0.0.1', port: PORT, secure: false, auth: { user: acc.user, pass: 'x' }, logger: false });
  await c.connect();
  await c.append('INBOX', raw);
  await c.logout();
}

async function waitForImap(deadline = Date.now() + 60_000) {
  while (Date.now() < deadline) {
    try {
      const c = new ImapFlow({ host: '127.0.0.1', port: PORT, secure: false, auth: { user: 'probe', pass: 'x' }, logger: false });
      await c.connect();
      await c.logout();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('GreenMail did not start');
}

before(async () => {
  if (!hasDocker) return;
  execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
  execSync(
    `docker run -d --rm --name ${CONTAINER} -p ${PORT}:3143 ` +
      `-e GREENMAIL_OPTS="-Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled" ` +
      'greenmail/standalone:2.1.5',
    { stdio: 'ignore' },
  );
  await waitForImap();
  process.env.ALLINBOX_PASS_ALICE = 'x';
  process.env.ALLINBOX_PASS_BOB = 'x';
  await append(alice, mail('alice@test.local', 'Presupuesto Q4', 'Va el presupuesto.\n-- \nJuan', '<shared@acme>'));
  await append(bob, mail('bob@test.local', 'Presupuesto Q4', 'Va el presupuesto.\n-- \nJuan', '<shared@acme>'));
  await append(bob, mail('bob@test.local', 'Cena', 'Nos vemos.\nOn Mon, Juan wrote:\n> viejo', '<cena@acme>'));
  await append(bob, mail('bob@test.local', 'RE: Cena', 'Llevo vino.\n> Nos vemos.', '<cena2@acme>'));
  const c = new ImapFlow({ host: '127.0.0.1', port: PORT, secure: false, auth: { user: bob.user, pass: 'x' }, logger: false });
  await c.connect();
  await c.mailboxCreate('Drafts');
  await c.logout();
});

after(() => {
  if (hasDocker) execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
});

test('search_all merges both accounts and dedupes the shared message', { skip: !hasDocker && 'no docker' }, async () => {
  const { hits, errors } = await searchAll([alice, bob], { sinceDays: 7, limit: 10 });
  assert.deepEqual(errors, []);
  assert.equal(hits.length, 3); // shared (deduped) + Cena + RE: Cena
  const shared = hits.find((h) => h.messageId === '<shared@acme>');
  assert.ok(shared?.alsoIn?.length === 1);

  const filtered = await searchAll([alice, bob], { query: 'Cena', sinceDays: 7, limit: 10 });
  assert.deepEqual(filtered.hits.map((h) => h.subject).sort(), ['Cena', 'RE: Cena']);
});

test('a broken account reports an error without sinking the search', { skip: !hasDocker && 'no docker' }, async () => {
  const broken: Account = { ...account('broken'), port: 1 };
  process.env.ALLINBOX_PASS_BROKEN = 'x';
  const { hits, errors } = await searchAll([alice, broken], { sinceDays: 7, limit: 10 });
  assert.equal(hits.length, 1);
  assert.equal(errors[0].account, 'broken');
});

test('read_email returns headers and a cleaned body', { skip: !hasDocker && 'no docker' }, async () => {
  const { hits } = await searchAll([bob], { query: 'Cena', sinceDays: 7, limit: 10 });
  const uid = Number(hits.find((h) => h.subject === 'Cena')!.id.split(':')[1]);
  const out = await readMessage(bob, uid, 4000);
  assert.match(out, /Subject: Cena/);
  assert.match(out, /Nos vemos\.$/);
  assert.doesNotMatch(out, /viejo/);
});

test('read_thread returns the whole conversation, cleaned, oldest first', { skip: !hasDocker && 'no docker' }, async () => {
  const { hits } = await searchAll([bob], { query: 'Cena', sinceDays: 7, limit: 10 });
  const first = hits.find((h) => h.subject === 'Cena')!;
  const out = await readThread(bob, Number(first.id.split(':')[1]), 8000);
  assert.ok(out.indexOf('Nos vemos.') < out.indexOf('Llevo vino.'));
  assert.doesNotMatch(out, /viejo|> Nos vemos/);
  assert.doesNotMatch(out, /Presupuesto/);
});

test('create_draft lands in Drafts as a threaded reply and never sends', { skip: !hasDocker && 'no docker' }, async () => {
  const { hits } = await searchAll([bob], { query: 'Cena', sinceDays: 7, limit: 10 });
  const orig = hits.find((h) => h.subject === 'Cena')!;
  const folder = await createDraft(bob, { to: ['juan@acme.com'], body: 'Perfecto, nos vemos.', replyToUid: Number(orig.id.split(':')[1]) }, ['@acme.com']);
  assert.equal(folder, 'Drafts');

  const c = new ImapFlow({ host: '127.0.0.1', port: PORT, secure: false, auth: { user: bob.user, pass: 'x' }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock('Drafts');
  try {
    const msg = await c.fetchOne('*', { source: true, flags: true });
    // GreenMail stores the flag with its escaping backslash; real servers report \Draft.
    assert.ok([...(msg ? msg.flags ?? [] : [])].some((f) => f.endsWith('Draft')));
    const raw = msg!.source!.toString();
    assert.match(raw, /^Subject: Re: Cena/m);
    assert.match(raw, /^In-Reply-To: <cena@acme>/m);
  } finally {
    lock.release();
    await c.logout();
  }

  await assert.rejects(createDraft(bob, { to: ['x@evil.com'], subject: 's', body: 'b' }, ['@acme.com']), /allowlist/);
});
