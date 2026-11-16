// End-to-end check of `allinbox demo` with the real MCP SDK client, like a host would do it.
// Usage: node dist/cli.js demo &   then   node scripts/demo-smoke.mjs [url]
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const url = new URL(process.argv[2] ?? 'http://localhost:3333/mcp');
const UI = 'io.modelcontextprotocol/ui';
const MIME = 'text/html;profile=mcp-app';

async function connect(withUi) {
  const capabilities = withUi ? { extensions: { [UI]: { mimeTypes: [MIME] } } } : {};
  const client = new Client({ name: withUi ? 'smoke-ui-host' : 'smoke-text-host', version: '1.0.0' }, { capabilities });
  await client.connect(new StreamableHTTPClientTransport(url));
  return client;
}
const textOf = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const step = (name) => console.log(`ok  ${name}`);

// ---- A host that renders MCP Apps
const ui = await connect(true);
const tools = await ui.listTools();
const byName = Object.fromEntries(tools.tools.map((t) => [t.name, t]));
assert.equal(byName.search_all?._meta?.ui?.resourceUri, 'ui://allinbox/search.html');
assert.equal(byName.create_draft?._meta?.ui?.resourceUri, 'ui://allinbox/draft.html');
assert.deepEqual(byName.save_draft?._meta?.ui?.visibility, ['app'], 'save_draft registered as app-only for a UI host');
step('tools/list: cards linked, save_draft app-only');

for (const uri of ['ui://allinbox/search.html', 'ui://allinbox/draft.html']) {
  const { contents } = await ui.readResource({ uri });
  assert.equal(contents[0].mimeType, MIME);
  assert.match(contents[0].text, /ui\/initialize/);
  assert.doesNotMatch(contents[0].text, /allinbox:bridge/);
}
step('resources/read: both views are self-contained mcp-app HTML');

const search = await ui.callTool({ name: 'search_all', arguments: {} });
const view = search._meta?.['allinbox/ui'];
assert.ok(view?.hits?.length >= 8, 'hits for the card');
assert.ok(view.hits.some((h) => h.alsoIn?.includes('personal')), 'cross-account duplicate merged');
assert.deepEqual(view.errors.map((e) => e.account), ['old']);
assert.match(textOf(search), /<untrusted_email_[0-9a-f]+ kind="search_results">/);
assert.doesNotMatch(textOf(search), /"hits"/, 'card data stays out of the model text');
step(`search_all: ${view.hits.length} hits, dedupe + failing account + wrapper`);

const filtered = await ui.callTool({ name: 'search_all', arguments: { query: 'from:martin' } });
assert.deepEqual(filtered._meta['allinbox/ui'].hits.map((h) => h.id), ['personal:3302']);
step('search_all: from: filter');

const email = await ui.callTool({ name: 'read_email', arguments: { id: 'work:88412' } });
assert.match(textOf(email), /slide 3/);
assert.doesNotMatch(textOf(email), /draft budget\./, 'quoted reply stripped');
const thread = await ui.callTool({ name: 'read_thread', arguments: { id: 'work:88412' } });
assert.match(textOf(thread), /--- work:88370 ---[\s\S]*--- work:88412 ---/);
step('read_email / read_thread');

const draftArgs = { account: 'personal', to: ['martin.flat@example.com'], body: 'Tuesday works, thanks!', reply_to_id: 'personal:3302' };
const preview = await ui.callTool({ name: 'create_draft', arguments: draftArgs });
assert.ok(!preview.isError, textOf(preview));
assert.equal(preview._meta['allinbox/ui'].mode, 'preview');
assert.match(textOf(preview), /NOT saved yet/);
step('create_draft on a UI host: preview only, nothing saved');

const blocked = await ui.callTool({ name: 'create_draft', arguments: { ...draftArgs, to: ['someone@gmail.com'] } });
assert.ok(blocked.isError && /allowlist/.test(textOf(blocked)));
const blockedSave = await ui.callTool({ name: 'save_draft', arguments: { ...draftArgs, cc: ['boss@other.test'] } });
assert.ok(blockedSave.isError && /allowlist/.test(textOf(blockedSave)), 'server re-checks the allowlist on save');
step('allowlist enforced on preview and on save');

const saved = await ui.callTool({ name: 'save_draft', arguments: draftArgs });
assert.ok(!saved.isError, textOf(saved));
assert.equal(saved._meta['allinbox/ui'].mode, 'saved');
step('save_draft (the card button): saved');
await ui.close();

// ---- A text-only host (Codex, Gemini CLI…): unchanged behavior. Needs the server started with ALLINBOX_UI=auto.
if (process.env.SMOKE_AUTO === '1') {
  const plain = await connect(false);
  const names = (await plain.listTools()).tools.map((t) => t.name);
  assert.ok(!names.includes('save_draft'), 'no save_draft without a UI host');
  const direct = await plain.callTool({ name: 'create_draft', arguments: draftArgs });
  assert.equal(direct._meta?.['allinbox/ui']?.mode, 'saved');
  assert.match(textOf(direct), /Draft saved/);
  step('text-only host: create_draft saves directly, no save_draft');
  await plain.close();
}
// ---- stdio, as `allinbox demo connect` registers it in Claude Desktop
{
  const client = new Client({ name: 'smoke-stdio-host', version: '1.0.0' }, { capabilities: { extensions: { [UI]: { mimeTypes: [MIME] } } } });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/cli.js', 'demo', '--stdio'], env: { ...process.env, ALLINBOX_UI: 'auto' } }));
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes('save_draft'), 'stdio + UI host: save_draft registered');
  const r = await client.callTool({ name: 'search_all', arguments: { query: 'slide' } });
  assert.ok(r._meta['allinbox/ui'].hits.length >= 1);
  step('stdio demo (Claude Desktop path): tools + search');
  await client.close();
}
console.log('demo smoke: all good');
