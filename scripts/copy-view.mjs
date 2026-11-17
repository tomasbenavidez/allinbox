#!/usr/bin/env node
// tsc only emits .js: ship the MCP Apps view next to dist/view.js.
import { copyFileSync } from 'node:fs';
copyFileSync(new URL('../src/view.html', import.meta.url), new URL('../dist/view.html', import.meta.url));
