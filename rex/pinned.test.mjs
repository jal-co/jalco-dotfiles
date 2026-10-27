import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('pinned skips windowless sessions and reuses the running coordinator', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rex-pinned-test-'));
  const binary = join(directory, 'rex');
  const cwd = join(directory, 'rex-coord');
  mkdirSync(join(cwd, '.pi'), { recursive: true });
  symlinkSync(fileURLToPath(new URL('./coordinator/settings.json', import.meta.url)), join(cwd, '.pi/settings.json'));
  symlinkSync(fileURLToPath(new URL('./coordinator/AGENTS.md', import.meta.url)), join(cwd, 'AGENTS.md'));
  writeFileSync(binary, `#!/usr/bin/env node
const args = process.argv.slice(3);
let result;
if (args[0] === 'ls') result = { sessions: [
  { session_id: 'session:empty', label: 'empty' },
  { session_id: 'session:coordinator', label: 'inbox' },
] };
else if (args[0] === 'session') result = args[2] === 'session:empty'
  ? { session_id: 'session:empty' }
  : { windows: [{ layers: [{ blocks: [{ block_id: 'block:coordinator', creator_name: 'com.superlogical.terminal' }] }] }] };
else if (args[0] === 'block') result = { foreground: { argv0: 'pi', cwd: ${JSON.stringify(cwd)} } };
else throw new Error('Unexpected Rex call: ' + args.join(' '));
console.log(JSON.stringify(result));
`);
  chmodSync(binary, 0o700);
  try {
    const output = execFileSync(process.execPath, [new URL('./pinned.mjs', import.meta.url).pathname], {
      env: { ...process.env, HOME: directory, REX_BIN: binary },
      encoding: 'utf8',
    });
    assert.match(output, /coordinator already exists: session:coordinator/);
    assert.doesNotMatch(output, /Created pinned/);
  } finally {
    unlinkSync(binary);
    unlinkSync(join(cwd, '.pi/settings.json'));
    unlinkSync(join(cwd, 'AGENTS.md'));
    rmdirSync(join(cwd, '.pi'));
    rmdirSync(cwd);
    rmdirSync(directory);
  }
});
