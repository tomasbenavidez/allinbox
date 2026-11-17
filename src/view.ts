// MCP Apps (io.modelcontextprotocol/ui): the inbox view hosts like Claude and ChatGPT render inline.
// The view only shows what search_all/read_thread already return as text, so it adds no new
// data channel to the model, and it renders email text with textContent (never as HTML).
import { readFileSync } from 'node:fs';
import { VERSION } from './version.js';

export const VIEW_URI = 'ui://allinbox/inbox.html';
export const VIEW_MIME = 'text/html;profile=mcp-app';
/** Tool _meta linking a tool to the view (modern key + the legacy flat key older hosts read). */
export const VIEW_TOOL_META = { ui: { resourceUri: VIEW_URI }, 'ui/resourceUri': VIEW_URI };
/** No network, no external resources: the view is one self-contained file. */
export const VIEW_RESOURCE_META = { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } };

export const SETUP_URI = 'ui://allinbox/setup.html';
/** Tools only the views may call (hosts hide them from the model). */
export const APP_ONLY_META = { ui: { visibility: ['app'] } };
export const SETUP_TOOL_META = { ui: { resourceUri: SETUP_URI }, 'ui/resourceUri': SETUP_URI };

const cache = new Map<string, string>();
const load = (file: string) =>
  cache.get(file) ?? cache.set(file, readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').replace('__VERSION__', VERSION)).get(file)!;
export const viewHtml = (): string => load('view.html');
export const setupHtml = (): string => load('setup.html');
