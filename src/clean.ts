// Pure helpers: shrink emails to what an agent actually needs (token budget).

export interface Hit {
  id: string; // "<accountId>:<uid>"
  account: string;
  messageId?: string;
  date: string; // ISO
  from: string;
  subject: string;
  alsoIn?: string[]; // other accounts holding the same Message-ID
}

// Lines where a quoted previous REPLY starts (EN/ES/PT/DE/FR clients).
// Forwards ("---------- Forwarded message ---------") are deliberately kept: that content is the point.
const QUOTE_START = [
  /^On .+ wrote:\s*$/,
  /^El .+ escribió:\s*$/,
  /^Em .+ escreveu:\s*$/,
  /^Am .+ schrieb .+:\s*$/,
  /^Le .+ a écrit\s*:\s*$/,
  /^-{2,}\s*(Original Message|Mensaje original)\s*-{2,}/i,
];
// Outlook pastes the old message under a header block: "From: ..." followed by Sent/To/Subject lines.
// A lone "From: " line in normal prose does not count.
const HEADER_START = /^(From|De):\s.+/;
const HEADER_NEXT = /^(Sent|Date|To|Subject|Enviado|Fecha|Para|Asunto|Enviado el):\s/;
const SIGNATURE = /^--\s?$/;
const FORWARD = /^(-{2,}\s*(Forwarded message|Mensaje reenviado|Mensagem encaminhada)\s*-{2,}|Begin forwarded message:|Inicio del mensaje reenviado:)/i;

// Newsletters ship a useless text/plain part ("your client does not support HTML") with the real
// content only in HTML. These phrases, or a text part much shorter than the HTML, mean: use the HTML.
const PLACEHOLDER_TEXT =
  /(no soporta (mensajes en )?(formato )?html|does(n't| not) support html|view (this|it) in (your|a) (web )?browser|ver (este|el) (correo|mail|mensaje) en (tu|su|el) navegador)/i;

/** Picks the body that actually carries the content: plain text, or text rendered from HTML. */
export function pickBody(text: string, htmlText: string): string {
  const plain = text.trim();
  if (!plain) return htmlText;
  if (!htmlText.trim()) return plain;
  return PLACEHOLDER_TEXT.test(plain) || htmlText.length > plain.length * 3 ? htmlText : plain;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
const MAX_URL = 80;

// ponytail: long tracking URLs are cut to origin + start of path. An agent that needs an exact
// long link (unsubscribe, magic login) cannot get it; add a `full_links` flag if that comes up.
export const shortenUrls = (text: string): string =>
  text.replace(URL_RE, (url) => {
    if (url.length <= MAX_URL) return url;
    try {
      const { origin, pathname } = new URL(url);
      return `${origin}${pathname.slice(0, 30)}…`;
    } catch {
      return `${url.slice(0, MAX_URL)}…`;
    }
  });

export function cleanBody(text: string, maxChars = 4000): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  let inForward = false; // a forward's own From/Date block is content, not an old reply
  for (const [i, line] of lines.entries()) {
    const t = line.trim();
    if (FORWARD.test(t)) inForward = true;
    const headerBlock =
      !inForward && HEADER_START.test(t) && lines.slice(i + 1, i + 4).some((l) => HEADER_NEXT.test(l.trim()));
    if (SIGNATURE.test(line) || headerBlock || QUOTE_START.some((re) => re.test(t))) break;
    if (line.trimStart().startsWith('>')) continue;
    kept.push(line.trimEnd());
  }
  const body = shortenUrls(kept.join('\n'))
    .replace(/\n_{10,}\s*$/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return body.length > maxChars
    ? `${body.slice(0, maxChars)}\n[... truncated ${body.length - maxChars} chars]`
    : body;
}

/** Merge per-account results: drop duplicate Message-IDs, newest first. */
export function mergeHits(perAccount: Hit[][], limit: number): Hit[] {
  const byKey = new Map<string, Hit>();
  for (const hit of perAccount.flat()) {
    const key = hit.messageId ?? hit.id;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { ...hit });
    } else if (seen.account !== hit.account) {
      byKey.set(key, { ...seen, alsoIn: [...new Set([...(seen.alsoIn ?? []), hit.account])] });
    }
  }
  return [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

/** "RE: Fwd: [2] Presupuesto" -> "Presupuesto" (EN/ES/PT/DE prefixes). */
export const normalizeSubject = (subject: string): string =>
  subject.replace(/^(\s*((re|fw|fwd|rv|res|enc|aw|wg)(\[\d+\])?\s*:)\s*)+/i, '').trim();

// Sender names and subjects are attacker-controlled: one line each, no control characters, bounded.
const oneLine = (s: string, max = 200) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

export function formatHits(hits: Hit[]): string {
  if (!hits.length) return 'No messages found.';
  return hits
    .map((h) => {
      const also = h.alsoIn?.length ? ` (also in ${h.alsoIn.join(', ')})` : '';
      return `${h.id} | ${h.date.slice(0, 16).replace('T', ' ')} | ${oneLine(h.from)} | ${oneLine(h.subject)}${also}`;
    })
    .join('\n');
}
