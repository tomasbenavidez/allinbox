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
  assert.ok(tools.filter((t) => t.name !== 'search_all').every((t) => !t._meta?.ui));
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
