#!/usr/bin/env node
// Local playground for the MCP Apps inbox view: a fake host page that embeds dist/view.html in a
// sandboxed iframe (like Claude does) and answers it with fictional mail run through the real
// formatting through the real server in demo mode. No accounts, no network. Usage: pnpm build && pnpm preview:ui
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer as createMcpServer } from '../dist/server.js';
import { demoConfig, demoMail } from '../dist/demo.js';

// The real MCP server in demo mode, reached through a real MCP client: the page shows exactly
// what an agent would get.
const mcp = await createMcpServer(demoConfig(), demoMail, true);
const client = new Client({ name: 'preview-host', version: '0' });
const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
await Promise.all([mcp.connect(serverSide), client.connect(clientSide)]);
const viewHtml = async () => String((await client.readResource({ uri: 'ui://allinbox/inbox.html' })).contents[0].text);
const VIEW_HTML = await viewHtml();

const page = `<!doctype html><html><head><meta charset="utf-8"><title>allinbox · MCP Apps preview</title>
<style>
  body{margin:0;font:14px system-ui,sans-serif;background:#f4f3ee;color:#222;transition:background .2s}
  body.dark{background:#141413;color:#eee}
  .bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 20px;border-bottom:1px solid #0002}
  .bar b{margin-right:8px} button,select{font:inherit;padding:4px 10px;border-radius:6px;border:1px solid #0003;background:#fff}
  main{max-width:760px;margin:24px auto;padding:0 16px}
  .bubble{background:#0000000a;border-radius:14px;padding:10px 14px;margin:10px 0 10px auto;max-width:70%}
  body.dark .bubble{background:#ffffff14}
  .frame{border:1px solid #0002;border-radius:14px;overflow:hidden}
  body.dark .frame{border-color:#fff2}
  body.fs main{max-width:none;margin:0;padding:0} body.fs .bubble,body.fs .bar{display:none} body.fs .frame{border:0;border-radius:0}
  iframe{display:block;width:100%;border:0;height:200px}
  #log{font:12px ui-monospace,monospace;white-space:pre-wrap;opacity:.75;margin-top:16px}
</style></head><body>
<div class="bar"><b>MCP Apps preview</b>
  <button id="theme">Toggle dark</button>
  <select id="locale"><option value="es-AR">es-AR</option><option value="en-US">en-US</option></select>
  <button id="q1">Ask: invoice</button><button id="q2">Ask: latest 30d</button><button id="q3">Ask: prize (hostile mail)</button>
</div>
<main>
  <div class="bubble" id="ask">Buscá en todos mis mails lo último</div>
  <div class="frame"><iframe id="view" sandbox="allow-scripts allow-forms" title="allinbox"></iframe></div>
  <div id="log"></div>
</main>
<script>
const VIEW = ${JSON.stringify(VIEW_HTML).replace(/</g, '\\u003c')};
const iframe = document.getElementById('view');
const log = (s) => { const l = document.getElementById('log'); l.textContent = s + '\\n' + l.textContent; };
let ctx = { theme: 'light', locale: 'es-AR', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'], platform: 'web' };
let args = {};
const send = (m) => iframe.contentWindow.postMessage({ jsonrpc: '2.0', ...m }, '*');
const call = (name, a) => fetch('/call', { method: 'POST', body: JSON.stringify({ name, arguments: a }) }).then((r) => r.json());
window.addEventListener('message', async (e) => {
  if (e.source !== iframe.contentWindow) return;
  const m = e.data; if (m?.jsonrpc !== '2.0') return;
  const reply = (result) => send({ id: m.id, result });
  switch (m.method) {
    case 'ui/initialize':
      return reply({ protocolVersion: '2026-01-26', hostInfo: { name: 'preview-host', version: '0' },
        hostCapabilities: { serverTools: {}, message: { text: {} }, openLinks: {} }, hostContext: ctx });
    case 'ui/notifications/initialized':
      send({ method: 'ui/notifications/tool-input', params: { arguments: args } });
      return setTimeout(async () => send({ method: 'ui/notifications/tool-result', params: await call('search_all', args) }), 700);
    case 'ui/notifications/size-changed':
      if (ctx.displayMode === 'inline') iframe.style.height = m.params.height + 'px'; return;
    case 'tools/call': log('view → tools/call ' + JSON.stringify(m.params)); return reply(await call(m.params.name, m.params.arguments));
    case 'ui/message': log('view → ui/message (Claude would get this as a user turn): ' + m.params.content[0].text); return reply({});
    case 'ui/request-display-mode':
      ctx.displayMode = m.params.mode; document.body.classList.toggle('fs', ctx.displayMode === 'fullscreen');
      iframe.style.height = ctx.displayMode === 'fullscreen' ? '100vh' : iframe.style.height;
      return reply({ mode: ctx.displayMode });
    default: if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'not supported' } });
  }
});
function run(a, label) { args = a; document.getElementById('ask').textContent = label; iframe.srcdoc = VIEW; }
const ctxChanged = () => send({ method: 'ui/notifications/host-context-changed', params: ctx });
document.getElementById('theme').onclick = () => { ctx.theme = ctx.theme === 'dark' ? 'light' : 'dark'; document.body.classList.toggle('dark', ctx.theme === 'dark'); ctxChanged(); };
document.getElementById('locale').onchange = (e) => { ctx.locale = e.target.value; ctxChanged(); };
document.getElementById('q1').onclick = () => run({ query: 'invoice', since_days: 30, limit: 25 }, 'Find my invoices this month');
document.getElementById('q2').onclick = () => run({ since_days: 30, limit: 25 }, 'Buscá en todos mis mails lo último');
document.getElementById('q3').onclick = () => run({ query: 'prize', since_days: 30, limit: 25 }, 'Search: prize (prompt-injection sample)');
const p = new URLSearchParams(location.search);
if (p.get('theme') === 'dark') { ctx.theme = 'dark'; document.body.classList.add('dark'); }
if (p.get('locale')) { ctx.locale = p.get('locale'); document.getElementById('locale').value = ctx.locale; }
run(p.get('q') ? { query: p.get('q'), since_days: 30, limit: 25 } : { since_days: 30, limit: 25 }, p.get('q') ? 'Search: ' + p.get('q') : 'Buscá en todos mis mails lo último');
</script></body></html>`;

const port = Number(process.env.PORT ?? 5180);
createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/call') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const { name, arguments: a } = JSON.parse(body);
      const out = await client.callTool({ name, arguments: a }).catch((e) => ({ isError: true, content: [{ type: 'text', text: e.message }] }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
}).listen(port, '127.0.0.1', () => console.log(`allinbox view preview: http://127.0.0.1:${port}`));
