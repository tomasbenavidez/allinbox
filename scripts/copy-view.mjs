#!/usr/bin/env node
// tsc only emits .js: ship the MCP Apps views next to dist/view.js.
import { copyFileSync } from 'node:fs';
for (const f of ['view.html', 'setup.html']) copyFileSync(new URL(`../src/${f}`, import.meta.url), new URL(`../dist/${f}`, import.meta.url));
