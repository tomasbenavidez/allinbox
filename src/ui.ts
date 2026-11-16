// MCP Apps (io.modelcontextprotocol/ui): interactive views that hosts like Claude render next to a tool result.
// Hosts without MCP Apps ignore all of this and keep using the plain-text results.
import { readFile } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const UI_MIME = 'text/html;profile=mcp-app';
export const UI_EXTENSION = 'io.modelcontextprotocol/ui';
export const SEARCH_VIEW = 'ui://allinbox/search.html';
export const DRAFT_VIEW = 'ui://allinbox/draft.html';
/** Key of the view payload inside a tool result's _meta: the view reads it, the model never sees it. */
export const UI_META = 'allinbox/ui';

// ui/ sits next to src/ and dist/, so this resolves from both `tsx src/` and `node dist/`.
const UI_DIR = new URL('../ui/', import.meta.url);

// The views load nothing from the network: no remote images (tracking pixels), no fetch.
const VIEW_META = { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false } };

/** One self-contained HTML per view: shared CSS and the postMessage bridge are inlined. */
export async function renderView(name: 'search' | 'draft'): Promise<string> {
  const read = (file: string) => readFile(new URL(file, UI_DIR), 'utf8');
  const [html, base, bridge] = await Promise.all([read(`${name}.html`), read('base.css'), read('bridge.js')]);
  return html
    .replace('/* allinbox:base */', () => base)
    .replace('<!-- allinbox:bridge -->', () => `<script>\n${bridge}</script>`);
}

/**
 * Does the connected host render MCP Apps? `ALLINBOX_UI=on|off` overrides the negotiated capability.
 * Only matters for create_draft: with a UI the user saves the draft from the card, without one the tool saves it.
 */
export function clientSupportsUi(server: McpServer): boolean {
  const forced = process.env.ALLINBOX_UI?.toLowerCase();
  if (forced === 'on') return true;
  if (forced === 'off') return false;
  const caps = server.server.getClientCapabilities() as
    | { extensions?: Record<string, { mimeTypes?: string[] } | undefined> }
    | undefined;
  return caps?.extensions?.[UI_EXTENSION]?.mimeTypes?.includes(UI_MIME) ?? false;
}

export function registerViews(server: McpServer, drafts: boolean): void {
  const views: { name: 'search' | 'draft'; uri: string; title: string }[] = [
    { name: 'search', uri: SEARCH_VIEW, title: 'Unified inbox' },
  ];
  if (drafts) views.push({ name: 'draft', uri: DRAFT_VIEW, title: 'Draft review' });
  for (const view of views) {
    server.registerResource(
      `${view.name}-view`,
      view.uri,
      { title: view.title, mimeType: UI_MIME, _meta: VIEW_META },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: UI_MIME, text: await renderView(view.name), _meta: VIEW_META }] }),
    );
  }
}
