import { ImapFlow, type MessageAddressObject } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import { convert as htmlToText } from 'html-to-text';
import { getPassword, type Account } from './config.js';
import { isGmailHost } from './providers.js';
import { cleanBody, mergeHits, normalizeSubject, pickBody, type Hit } from './clean.js';

const DAY_MS = 86_400_000;
const MAX_THREAD_MESSAGES = 20;
const MAX_THREAD_CANDIDATES = 200;
const THREAD_LOOKBACK_DAYS = 365;
const OPERATION_TIMEOUT_MS = 30_000;
const MAX_MESSAGE_BYTES = 5_000_000; // in threads, bigger messages are listed, not downloaded

/** Spam often carries unparseable Date headers: never let one sink a whole account. */
const isoDate = (d: Date | string | undefined): string => {
  const parsed = new Date(d ?? 0);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
};

const isLocalHost = (host: string) => host === '127.0.0.1' || host === 'localhost' || host === '::1';

/** `pass` overrides the keychain: onboarding tests a password before storing it. */
export async function withClient<T>(account: Account, fn: (c: ImapFlow) => Promise<T>, pass?: string): Promise<T> {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    // Non-TLS ports must upgrade with STARTTLS or fail: never send a password in clear over the network.
    // Localhost is exempt (Proton Bridge, test servers).
    ...(account.secure || isLocalHost(account.host) ? {} : { doSTARTTLS: true }),
    auth: { user: account.user, pass: pass ?? getPassword(account.id) },
    logger: false,
    connectionTimeout: 15_000,
    socketTimeout: 20_000,
  });
  // Socket errors after connect are emitted as events; unhandled, they would crash the MCP process.
  // In-flight commands still reject, so nothing is swallowed.
  client.on('error', () => {});
  // Hard deadline: a server that logs in and then stalls must not hold the agent's whole call
  // (MCP clients give up around 60 s). Closing the socket rejects whatever is pending.
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    client.close();
  }, OPERATION_TIMEOUT_MS);
  deadline.unref();
  try {
    await client.connect();
    return await fn(client);
  } catch (e) {
    throw timedOut ? new Error(`${account.id} timed out after ${OPERATION_TIMEOUT_MS / 1000}s`) : e;
  } finally {
    clearTimeout(deadline);
    if (client.usable) await client.logout().catch(() => client.close());
    else client.close();
  }
}

export async function findMailbox(c: ImapFlow, specialUse: '\\All' | '\\Drafts', fallback: string): Promise<string> {
  return (await c.list()).find((box) => box.specialUse === specialUse)?.path ?? fallback;
}

// Gmail exposes everything (inbox + sent + archive) under \All; others: INBOX.
// read-only lock = EXAMINE: we never touch \Seen or any flag.
async function inSearchable<T>(c: ImapFlow, fn: () => Promise<T>): Promise<T> {
  const lock = await c.getMailboxLock(await findMailbox(c, '\\All', 'INBOX'), { readOnly: true });
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

const fmtAddr = (list?: MessageAddressObject[]) =>
  (list ?? []).map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');

export interface SearchOptions {
  query?: string;
  sinceDays: number;
  limit: number;
}

export async function searchAccount(account: Account, opts: SearchOptions, pass?: string): Promise<Hit[]> {
  return withClient(account, (c) =>
    inSearchable(c, async () => {
      const criteria = isGmailHost(account.host)
        ? { gmraw: `${opts.query ?? ''} newer_than:${opts.sinceDays}d`.trim() }
        : { since: new Date(Date.now() - opts.sinceDays * DAY_MS), ...(opts.query ? { text: opts.query } : {}) };
      const uids = (await c.search(criteria, { uid: true })) || [];
      const newest = uids.slice(-opts.limit);
      if (!newest.length) return [];
      const hits: Hit[] = [];
      for await (const m of c.fetch(newest, { uid: true, envelope: true }, { uid: true })) {
        hits.push({
          id: `${account.id}:${m.uid}`,
          account: account.id,
          messageId: m.envelope?.messageId,
          date: isoDate(m.envelope?.date),
          from: fmtAddr(m.envelope?.from),
          subject: m.envelope?.subject ?? '(no subject)',
        });
      }
      return hits;
    }),
    pass,
  );
}

export interface SearchAllResult {
  hits: Hit[];
  errors: { account: string; error: string }[];
}

/** One slow or broken account must not sink the whole search. */
export async function searchAll(accounts: Account[], opts: SearchOptions): Promise<SearchAllResult> {
  const settled = await Promise.allSettled(accounts.map((a) => searchAccount(a, opts)));
  const errors = settled.flatMap((r, i) =>
    r.status === 'rejected' ? [{ account: accounts[i].id, error: String(r.reason?.message ?? r.reason) }] : [],
  );
  const perAccount = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  return { hits: mergeHits(perAccount, opts.limit), errors };
}

const fmtParsed = (a?: AddressObject | AddressObject[]) =>
  (Array.isArray(a) ? a : a ? [a] : []).map((x) => x.text).join(', ');

async function renderMessage(source: Buffer, maxChars: number): Promise<string> {
  const mail = await simpleParser(source);
  const htmlText =
    typeof mail.html === 'string'
      ? htmlToText(mail.html, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }] })
      : '';
  const text = pickBody(mail.text ?? '', htmlText);
  const attachments = mail.attachments.map((a) => `${a.filename ?? 'unnamed'} (${a.contentType}, ${a.size} B)`);
  const headers = [
    `From: ${fmtParsed(mail.from)}`,
    `To: ${fmtParsed(mail.to)}`,
    mail.cc ? `Cc: ${fmtParsed(mail.cc)}` : null,
    `Date: ${mail.date?.toISOString() ?? 'unknown'}`,
    `Subject: ${mail.subject ?? '(no subject)'}`,
    attachments.length ? `Attachments: ${attachments.join('; ')}` : null,
  ].filter((h): h is string => h !== null);
  return `${headers.join('\n')}\n\n${cleanBody(text, maxChars)}`;
}

export async function readMessage(account: Account, uid: number, maxChars: number): Promise<string> {
  return withClient(account, (c) =>
    inSearchable(c, async () => {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) throw new Error(`Message ${account.id}:${uid} not found`);
      return renderMessage(msg.source, maxChars);
    }),
  );
}

/** Whole conversation, oldest first, each message cleaned; the char budget is split across messages. */
export async function readThread(account: Account, uid: number, maxChars: number): Promise<string> {
  return withClient(account, (c) =>
    inSearchable(c, async () => {
      const first = await c.fetchOne(String(uid), { uid: true, envelope: true, threadId: true }, { uid: true });
      if (!first) throw new Error(`Message ${account.id}:${uid} not found`);

      let uids: number[];
      if (first.threadId) {
        uids = (await c.search({ threadId: first.threadId }, { uid: true })) || [uid]; // Gmail: exact thread
      } else {
        // ponytail: same-normalized-subject heuristic; unrelated mails with an identical subject can join.
        // Upgrade path: IMAP THREAD=REFERENCES where the server supports it.
        const base = normalizeSubject(first.envelope?.subject ?? '');
        const since = new Date(Date.now() - THREAD_LOOKBACK_DAYS * DAY_MS);
        // Generic subjects ("Hi", "Invoice") can match thousands: bound by date and count.
        const found = base ? (await c.search({ subject: base, since }, { uid: true })) || [] : [];
        const candidates = found.slice(-MAX_THREAD_CANDIDATES);
        uids = [];
        if (candidates.length) {
          for await (const m of c.fetch(candidates, { uid: true, envelope: true }, { uid: true })) {
            if (normalizeSubject(m.envelope?.subject ?? '') === base) uids.push(m.uid);
          }
        }
        if (!uids.includes(uid)) uids.push(uid);
      }

      const picked = [...uids].sort((a, b) => a - b).slice(-MAX_THREAD_MESSAGES);
      const perMessage = Math.max(200, Math.floor(maxChars / picked.length));
      // Size first, so a 25 MB attachment is never pulled into memory just to read one line of text.
      const sizes = new Map<number, number>();
      for await (const m of c.fetch(picked, { uid: true, size: true }, { uid: true })) sizes.set(m.uid, m.size ?? 0);
      const small = picked.filter((u) => (sizes.get(u) ?? 0) <= MAX_MESSAGE_BYTES);
      const rendered = new Map<number, string>();
      if (small.length) {
        for await (const m of c.fetch(small, { uid: true, source: true }, { uid: true })) {
          if (m.source) rendered.set(m.uid, await renderMessage(m.source, perMessage));
        }
      }
      const parts = picked.map((u) => {
        const body = rendered.get(u) ?? `[large message (${sizes.get(u)} B): use read_email with this id]`;
        return `--- ${account.id}:${u} ---\n${body}`;
      });
      const skipped = uids.length - picked.length;
      return (skipped > 0 ? `[${skipped} older messages omitted]\n` : '') + parts.join('\n\n');
    }),
  );
}
