#!/usr/bin/env node
// Builds dist-mcpb/allinbox.mcpb (Claude Desktop extension): the manifest plus the shared
// launcher, which runs the pinned npm release through npx. No server code is bundled.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const stage = `${root}dist-mcpb/stage`;
rmSync(`${root}dist-mcpb`, { recursive: true, force: true });
mkdirSync(`${stage}/server`, { recursive: true });
cpSync(`${root}mcpb/manifest.json`, `${stage}/manifest.json`);
cpSync(`${root}plugins/allinbox/launch.mjs`, `${stage}/server/launch.mjs`);
cpSync(`${root}LICENSE`, `${stage}/LICENSE`);

const mcpb = ['-y', '@anthropic-ai/mcpb@2.1.2'];
const opts = { stdio: 'inherit', shell: process.platform === 'win32' };
execFileSync('npx', [...mcpb, 'validate', `${stage}/manifest.json`], opts);
execFileSync('npx', [...mcpb, 'pack', stage, `${root}dist-mcpb/allinbox.mcpb`], opts);
