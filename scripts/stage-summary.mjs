#!/usr/bin/env node
// Reads the `npm stage publish --json` output and prints (Markdown) the stage id and how to
// approve it. The publish workflow writes this to the job log and to the job summary.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Finds the first `stageId` anywhere in npm's JSON output (its shape nests by package name). */
export function findStage(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value.stageId === 'string') return { id: value.stageId, pkg: value.id ?? `${value.name}@${value.version}` };
  for (const child of Object.values(value)) {
    const found = findStage(child);
    if (found) return found;
  }
  return undefined;
}

export function summary(stage) {
  return [
    `## npm: ${stage.pkg} is staged, not live`,
    '',
    `Stage id: \`${stage.id}\``,
    '',
    'Approve it with 2FA to publish (npm 12+, Node ^22.22.2 || ^24.15.0 || >=26):',
    '',
    '```bash',
    `npm stage approve ${stage.id}`,
    '```',
    '',
    'Signed in as the owner, the package page on npmjs.com (https://www.npmjs.com/package/allinbox) also lists staged versions to approve.',
    '',
    `To discard it instead: \`npm stage reject ${stage.id}\``,
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stage = findStage(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  if (!stage) {
    console.error('No stageId in the npm output; was the package published or staged?');
    process.exit(1);
  }
  process.stdout.write(summary(stage));
}
