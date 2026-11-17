import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.ts';
import { VIEW_MIME, VIEW_URI } from '../src/view.ts';
import { VERSION } from '../src/version.ts';

async function connect() {
  const server = await createServer({ accounts: [], drafts: { enabled: false, allowRecipients: [] } } as never);
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

test('search_all links the MCP Apps inbox view; other tools stay plain', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const search = tools.find((t) => t.name === 'search_all')!;
  assert.deepEqual(search._meta?.ui, { resourceUri: VIEW_URI });
  assert.equal(search._meta?.['ui/resourceUri'], VIEW_URI);
  const plain = ['list_accounts', 'read_email', 'read_thread'];
  assert.ok(tools.filter((t) => plain.includes(t.name)).every((t) => !t._meta?.ui));
  assert.ok(!tools.some((t) => t.name === 'create_draft')); // drafts off: not listed at all
  await client.close();
});

test('the view resource is self-contained HTML that never injects email text as markup', async () => {
  const client = await connect();
  const { contents } = await client.readResource({ uri: VIEW_URI });
  const [c] = contents;
  assert.equal(c.mimeType, VIEW_MIME);
  const html = String(c.text);
  assert.match(html, /^<!doctype html>/i);
  assert.ok(html.includes(`version: '${VERSION}'`));
  assert.doesNotMatch(html, /<(script|link)[^>]+(src|href)=["']https?:/i); // no external resources
  assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.deepEqual((c._meta as { ui: { csp: unknown } }).ui.csp, { connectDomains: [], resourceDomains: [] });
  await client.close();
});

test('demo mode serves fictional mail through the real tools, dedupe and wrapper included', async () => {
  const { demoConfig, demoMail } = await import('../src/demo.ts');
  const server = await createServer(demoConfig(), demoMail, true);
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
  const search = text(await client.callTool({ name: 'search_all', arguments: { query: 'invoice' } }));
  assert.match(search, /^<untrusted_email_[0-9a-f]+ kind="search_results">/);
  assert.match(search, /Invoice #2291 \| November \(also in studio\)/); // same Message-ID in two accounts → one hit
  const thread = text(await client.callTool({ name: 'read_thread', arguments: { id: 'work:4407' } }));
  assert.equal(thread.match(/^--- work:\d+ ---$/gm)?.length, 2);
  await client.close();
});
