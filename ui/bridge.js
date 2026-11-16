// Minimal MCP Apps bridge (spec 2026-01-26), zero dependencies.
// The server inlines this file into each view (see src/ui.ts), so every view stays one self-contained HTML.
// Everything shown in the views comes from email: render it with textContent only, never as markup.
const bridge = (() => {
  let nextId = 1;
  const pending = new Map();
  const handlers = {};
  let hostContext = {};

  const post = (msg) => window.parent.postMessage({ jsonrpc: '2.0', ...msg }, '*');

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const m = event.data;
    if (!m || m.jsonrpc !== '2.0') return;

    if (m.id !== undefined && !m.method) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message ?? 'Host error')) : p.resolve(m.result);
      return;
    }
    if (m.method === 'ui/notifications/host-context-changed') {
      hostContext = { ...hostContext, ...m.params };
      applyHostStyles();
    }
    const handler = handlers[m.method];
    if (m.id === undefined) {
      handler?.(m.params ?? {});
      return;
    }
    if (m.method === 'ui/resource-teardown') {
      post({ id: m.id, result: {} });
      return;
    }
    if (!handler) {
      post({ id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } });
      return;
    }
    Promise.resolve()
      .then(() => handler(m.params ?? {}))
      .then(
        (result) => post({ id: m.id, result: result ?? {} }),
        (err) => post({ id: m.id, error: { code: -32000, message: String(err?.message ?? err) } }),
      );
  });

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      post({ id, method, params });
    });
  const notify = (method, params = {}) => post({ method, params });

  function applyHostStyles() {
    const root = document.documentElement;
    if (hostContext.theme) root.dataset.theme = hostContext.theme;
    for (const [name, value] of Object.entries(hostContext.styles?.variables ?? {})) {
      if (typeof value === 'string' && name.startsWith('--')) root.style.setProperty(name, value);
    }
  }

  async function connect(name) {
    const result = await request('ui/initialize', {
      protocolVersion: '2026-01-26',
      clientInfo: { name, version: '0.4.0' },
      appCapabilities: {},
    });
    hostContext = result?.hostContext ?? {};
    applyHostStyles();
    notify('ui/notifications/initialized');
    // The host sizes the frame to fit us, so any scroll offset is an accident (focus, scrollIntoView). Pin to the top
    // unless the content really is taller than the frame (a host that caps the height).
    window.addEventListener('scroll', () => {
      if (window.scrollY && document.body.getBoundingClientRect().height <= window.innerHeight + 2) window.scrollTo(0, 0);
    });
    let last = '';
    new ResizeObserver(() => {
      // Measure the content, not the document: scrollHeight never drops below the frame's current height,
      // so a card that collapses (closing an email, saving a draft) would never shrink back.
      const rect = document.body.getBoundingClientRect();
      const size = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
      const key = `${size.width}x${size.height}`;
      if (key !== last) {
        last = key;
        notify('ui/notifications/size-changed', size);
        // Content that grew before the host resized the frame can leave it scrolled; the host fits us, so reset.
        requestAnimationFrame(() => window.scrollTo(0, 0));
      }
    }).observe(document.body);
    return hostContext;
  }

  /** Call a tool on the allinbox server through the host. Throws on isError. */
  async function callTool(name, args) {
    const result = await request('tools/call', { name, arguments: args });
    if (result?.isError) throw new Error(textOf(result) || 'Tool failed');
    return result;
  }

  const textOf = (result) =>
    (result?.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

  /** Strip allinbox's <untrusted_email_NONCE> wrapper: the view shows plain text, never markup. */
  const unwrap = (text) =>
    text
      .split('\n')
      .filter((l) => !/^<\/?untrusted_email_[0-9a-f]+/.test(l) && !l.startsWith('Reminder: content above'))
      .join('\n')
      .trim();

  const es = () => String(hostContext.locale ?? navigator.language ?? 'en').toLowerCase().startsWith('es');

  return {
    connect,
    callTool,
    textOf,
    unwrap,
    es,
    on: (method, fn) => (handlers[method] = fn),
    sendMessage: (text) => request('ui/message', { role: 'user', content: { type: 'text', text } }),
    updateModelContext: (text) => request('ui/update-model-context', { content: [{ type: 'text', text }] }),
    get hostContext() {
      return hostContext;
    },
  };
})();
