import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

function runPinned(withCommandCenter) {
  const directory = mkdtempSync(join(tmpdir(), 'rex-pinned-test-'));
  const binary = join(directory, 'rex');
  const cwd = join(directory, 'rex-coord');
  mkdirSync(join(cwd, '.pi'), { recursive: true });
  symlinkSync(fileURLToPath(new URL('../coordinator/settings.json', import.meta.url)), join(cwd, '.pi/settings.json'));
  symlinkSync(fileURLToPath(new URL('../coordinator/AGENTS.md', import.meta.url)), join(cwd, 'AGENTS.md'));
  writeFileSync(binary, `#!/usr/bin/env node
const args = process.argv.slice(3);
let result;
if (args[0] === 'ls') result = { sessions: [
  { session_id: 'session:empty', label: 'empty' },
  { session_id: 'session:coordinator', label: 'inbox' },
] };
else if (args[0] === 'session') result = args[2] === 'session:empty'
  ? { session_id: 'session:empty' }
  : { windows: [{ layers: [{ blocks: [
    { block_id: 'block:coordinator', creator_name: 'com.superlogical.terminal' },
    ...(${withCommandCenter} ? [{ block_id: 'block:center', label: 'command-center', creator_name: 'com.superlogical.terminal' }] : []),
  ] }] }] };
else if (args[0] === 'block') result = args[4] === 'block:center' ? { foreground: { argv0: 'node', cwd: ${JSON.stringify(cwd)} } } : { foreground: { argv0: 'pi', cwd: ${JSON.stringify(cwd)} } };
else if (args[0] === 'split') { require('node:fs').appendFileSync(${JSON.stringify(join(directory, 'splits.log'))}, args.join(' ') + '\\n'); result = { block_id: 'block:center' }; }
else throw new Error('Unexpected Rex call: ' + args.join(' '));
console.log(JSON.stringify(result));
`);
  chmodSync(binary, 0o700);
  try {
    const result = spawnSync(process.execPath, [new URL('../src/pinned.mjs', import.meta.url).pathname], {
      env: { ...process.env, HOME: directory, REX_BIN: binary },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const log = join(directory, 'splits.log');
    const splits = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    if (existsSync(log)) unlinkSync(log);
    return { output: result.stdout, splits };
  } finally {
    unlinkSync(binary);
    unlinkSync(join(cwd, '.pi/settings.json'));
    unlinkSync(join(cwd, 'AGENTS.md'));
    rmdirSync(join(cwd, '.pi'));
    rmdirSync(cwd);
    rmdirSync(directory);
  }
}

test('pinned reuses the running coordinator and adds the command center above it once', () => {
  const first = runPinned(false);
  assert.match(first.output, /coordinator already exists: session:coordinator\. Added the command center above it\./);
  assert.doesNotMatch(first.output, /Created pinned/);
  assert.equal(first.splits.length, 1);
  assert.match(first.splits[0], /^split -s session:coordinator -b block:coordinator --split above .*--focus=false --label command-center .*src\/linear-tui\.mjs$/);
  const again = runPinned(true);
  assert.doesNotMatch(again.output, /Added the command center/);
  assert.deepEqual(again.splits, []);
});
