#!/usr/bin/env node
// Every place that pins the allinbox version must agree. Run by the unit tests and, with the
// release tag as argument (vX.Y.Z), by the publish workflow before anything is published.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const json = (path) => JSON.parse(read(path));
const constant = (path) => read(path).match(/VERSION = '([^']+)'/)?.[1];

export function pinnedVersions() {
  const server = json('server.json');
  return {
    'package.json': json('package.json').version,
    'src/version.ts': constant('src/version.ts'),
    'plugins/allinbox/launch.mjs': constant('plugins/allinbox/launch.mjs'),
    'plugins/allinbox/.claude-plugin/plugin.json': json('plugins/allinbox/.claude-plugin/plugin.json').version,
    'gemini-extension.json': json('gemini-extension.json').version,
    'mcpb/manifest.json': json('mcpb/manifest.json').version,
    'server.json': server.version,
    'server.json packages[0]': server.packages[0].version,
  };
}

/** Returns a list of mismatches (empty when everything agrees). */
export function versionMismatches(tag) {
  const versions = pinnedVersions();
  const expected = tag ? tag.replace(/^v/, '') : versions['package.json'];
  const problems = Object.entries(versions)
    .filter(([, v]) => v !== expected)
    .map(([where, v]) => `${where} is ${v ?? 'missing'}, expected ${expected}`);
  if (tag && !/^v\d+\.\d+\.\d+$/.test(tag)) problems.unshift(`tag ${tag} is not vX.Y.Z`);
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = versionMismatches(process.argv[2]);
  if (problems.length) {
    console.error(`Version mismatch:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`All pinned versions are ${pinnedVersions()['package.json']}.`);
}
