// Drafts are APPENDed to the Drafts folder. There is no SMTP code anywhere: allinbox cannot send.
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import type { Account } from './config.js';
import { findMailbox, withClient } from './imap.js';
import { normalizeSubject } from './clean.js';

/** Recipients outside the allowlist. "@x.com" = whole domain, "*" = anyone, empty = nobody (fail closed). */
export function blockedRecipients(recipients: string[], allow: string[]): string[] {
  const rules = allow.map((r) => r.trim().toLowerCase());
  if (rules.includes('*')) return [];
  return recipients.filter((raw) => {
    const r = raw.toLowerCase();
    return !rules.some((rule) => (rule.startsWith('@') ? r.endsWith(rule) : r === rule));
  });
}

export interface DraftInput {
  to: string[];
  cc?: string[];
  subject?: string;
  body: string;
  replyToUid?: number;
}

const build = (composer: MailComposer): Promise<Buffer> =>
  new Promise((resolve, reject) => composer.compile().build((err, msg) => (err ? reject(err) : resolve(msg))));

export async function createDraft(account: Account, input: DraftInput, allow: string[]): Promise<string> {
  const blocked = blockedRecipients([...input.to, ...(input.cc ?? [])], allow);
  if (blocked.length) throw new Error(`Recipients not in the user's allowlist: ${blocked.join(', ')}`);

  return withClient(account, async (c) => {
    let subject = input.subject;
    let inReplyTo: string | undefined;
    let references: string[] | undefined;

    if (input.replyToUid) {
      const lock = await c.getMailboxLock(await findMailbox(c, '\\All', 'INBOX'), { readOnly: true });
      try {
        const orig = await c.fetchOne(String(input.replyToUid), { envelope: true, headers: ['references'] }, { uid: true });
        if (!orig) throw new Error(`Message ${account.id}:${input.replyToUid} not found`);
        inReplyTo = orig.envelope?.messageId;
        const previous = orig.headers?.toString().match(/<[^>]+>/g) ?? [];
        references = inReplyTo ? [...previous, inReplyTo] : previous;
        subject ??= `Re: ${normalizeSubject(orig.envelope?.subject ?? '')}`;
      } finally {
        lock.release();
      }
    }
    if (!subject) throw new Error('subject is required for a new draft');

    const raw = await build(
      new MailComposer({ from: account.email, to: input.to, cc: input.cc, subject, text: input.body, inReplyTo, references }),
    );
    const folder = await findMailbox(c, '\\Drafts', 'Drafts');
    await c.append(folder, raw, ['\\Draft', '\\Seen']);
    return folder;
  });
}
