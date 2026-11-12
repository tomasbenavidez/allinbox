import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanBody, mergeHits, pickBody, shortenUrls, type Hit } from '../src/clean.ts';

test('pickBody prefers the HTML when the text part is a placeholder or a stub', () => {
  const html = 'Biodrama 18/11: entradas, horarios y sala. '.repeat(5);
  assert.equal(pickBody('Su Cliente de Mail NO soporta mensajes en formato HTML', html), html);
  assert.equal(pickBody('Hi', html), html); // HTML > 3x longer
  assert.equal(pickBody('Plain reply with enough real content here.', 'Plain reply with enough real content here.'), 'Plain reply with enough real content here.');
  assert.equal(pickBody('', html), html);
  assert.equal(pickBody('only text', ''), 'only text');
});

test('shortenUrls trims long tracking links, keeps short ones intact', () => {
  const meet = 'https://meet.google.com/abc-defg-hij';
  assert.equal(shortenUrls(`join ${meet} now`), `join ${meet} now`);
  const long = `https://accounts.google.com/AccountChooser?Email=a@b.com&continue=${'x'.repeat(120)}`;
  assert.equal(shortenUrls(long), 'https://accounts.google.com/AccountChooser…');
});

test('cleanBody strips quoted replies, ">" lines and signatures', () => {
  const body = 'Hola Tomás,\n\nDale, el jueves.\n\n\n\nSaludos\n-- \nJuan Pérez\nCEO\n';
  assert.equal(cleanBody(body), 'Hola Tomás,\n\nDale, el jueves.\n\nSaludos');
  assert.equal(cleanBody('Ok!\nEl lun, 3 nov 2026 a las 10:00, Ana <a@x.com> escribió:\n> viejo'), 'Ok!');
  assert.equal(cleanBody('Sure\n> quoted\nthanks'), 'Sure\nthanks');
  assert.match(cleanBody('x'.repeat(50), 10), /truncated 40 chars/);
});

test('cleanBody keeps forwards and prose "From:" lines, cuts Outlook reply blocks', () => {
  const fwd = 'Mirá esto\n\n---------- Forwarded message ---------\nFrom: Ana <a@x.com>\nDate: Mon\n\nEl contrato';
  assert.match(cleanBody(fwd), /El contrato$/);
  assert.equal(cleanBody('From: the team we got great news.\nSee you.'), 'From: the team we got great news.\nSee you.');
  const outlook = 'Dale.\n________________________________\nDe: Ana <a@x.com>\nEnviado: lunes\nPara: yo\n\nviejo';
  assert.equal(cleanBody(outlook), 'Dale.');
});

test('mergeHits dedupes by Message-ID across accounts, newest first', () => {
  const hit = (account: string, uid: number, date: string, messageId?: string): Hit => ({
    id: `${account}:${uid}`, account, messageId, date, from: 'a', subject: 's',
  });
  const merged = mergeHits(
    [
      [hit('work', 1, '2026-11-01T00:00:00Z', '<same@x>'), hit('work', 2, '2026-11-03T00:00:00Z')],
      [hit('home', 9, '2026-11-01T00:00:00Z', '<same@x>'), hit('home', 8, '2026-11-02T00:00:00Z')],
    ],
    10,
  );
  assert.deepEqual(merged.map((h) => h.id), ['work:2', 'home:8', 'work:1']);
  assert.deepEqual(merged[2].alsoIn, ['home']);
  assert.equal(mergeHits([[hit('a', 1, '2026-01-01'), hit('a', 2, '2026-01-02')]], 1).length, 1);
});
