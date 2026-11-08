import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CENTER = '\u{f0516} linear';

function runPinned({ stopped = false, center = false, oldPane = false, emptyCenter = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rex-pinned-test-'));
  const binary = join(directory, 'rex');
  const cwd = join(directory, 'rex-coord');
  const log = join(directory, 'calls.log');
  mkdirSync(join(cwd, '.pi'), { recursive: true });
  symlinkSync(fileURLToPath(new URL('../coordinator/settings.json', import.meta.url)), join(cwd, '.pi/settings.json'));
  symlinkSync(fileURLToPath(new URL('../coordinator/AGENTS.md', import.meta.url)), join(cwd, 'AGENTS.md'));
  const sessions = [
    { session_id: 'session:empty', label: 'empty' },
    { session_id: 'session:coordinator', label: stopped ? 'pinned' : 'inbox' },
    ...(center ? [{ session_id: 'session:center', label: CENTER }] : []),
  ];
  const blocks = {
    'session:empty': [],
    'session:coordinator': [
      { block_id: 'block:coordinator', creator_name: 'com.superlogical.terminal' },
      ...(oldPane ? [{ block_id: 'block:old', label: 'command-center', creator_name: 'com.superlogical.terminal' }] : []),
    ],
    'session:center': emptyCenter ? [] : [{ block_id: 'block:center', creator_name: 'com.superlogical.terminal' }],
  };
  writeFileSync(binary, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(3);
const blocks = ${JSON.stringify(blocks)};
let result;
if (args[0] === 'ls') result = { sessions: ${JSON.stringify(sessions)} };
else if (args[0] === 'session') result = { windows: [{ layers: [{ blocks: blocks[args[2]] }] }] };
else if (args[0] === 'block' && args[1] === 'call') result = { foreground: { argv0: args[5] === 'block:coordinator' ? ${JSON.stringify(stopped ? '-zsh' : 'pi')} : 'node', cwd: ${JSON.stringify(cwd)} } };
else if (args[0] === 'actions') result = { actions: [{ name: 'pin_session' }] };
else if (['new', 'window', 'block', 'do'].includes(args[0])) {
  fs.appendFileSync(${JSON.stringify(log)}, args.join(' ') + '\\n');
  result = args[0] === 'new' ? { session_id: 'session:created', initial_windows: [{ block_ids: ['block:created'] }] } : { window_id: 'window:new', block_ids: ['block:new'] };
}
else throw new Error('Unexpected Rex call: ' + args.join(' '));
console.log(JSON.stringify(result));
`);
  chmodSync(binary, 0o700);
  mkdirSync(join(directory, '.pi/agent/herdr-agents'), { recursive: true });
  mkdirSync(join(directory, '.pi/agent/bin'), { recursive: true });
  writeFileSync(join(directory, '.pi/agent/herdr-agents/config.json'), JSON.stringify({ models: { default: 'provider/model' } }));
  writeFileSync(join(directory, '.pi/agent/bin/pi'), '');
  try {
    const result = spawnSync(process.execPath, [new URL('../src/pinned.mjs', import.meta.url).pathname], {
      env: { ...process.env, HOME: directory, REX_BIN: binary, PI_CODING_AGENT_DIR: join(directory, '.pi/agent') },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const saved = join(directory, '.rex/command-center-session.json');
    return {
      output: result.stdout,
      calls: existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [],
      saved: existsSync(saved) ? JSON.parse(readFileSync(saved, 'utf8')) : undefined,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('pinned reuses the running coordinator and opens the command center as its own pinned session', () => {
  const { output, calls, saved } = runPinned();
  assert.match(output, /coordinator already exists: session:coordinator/);
  assert.match(output, /Opened the command center/);
  assert.equal(calls.length, 2);
  assert.match(calls[0], new RegExp(`^new ${CENTER} -c .*rex-coord --window command center --json --shell=none -- .*node .*src/linear-tui\\.mjs$`));
  assert.equal(calls[1], 'do -s session:created pin_session');
  assert.deepEqual(saved, { session_id: 'session:created' });
});

test('pinned leaves an open command center alone and moves an old in-session pane out', () => {
  assert.deepEqual(runPinned({ center: true }).calls, []);
  const moved = runPinned({ center: true, oldPane: true });
  assert.deepEqual(moved.calls, ['block close -s session:coordinator block:old']);
  assert.match(moved.output, /Moved the command center out of "inbox"/);
});

test('pinned reopens the command center when its session has no terminal', () => {
  const { calls, output } = runPinned({ center: true, emptyCenter: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^window new -s session:center command center -c .* -- .*src\/linear-tui\.mjs$/);
  assert.match(output, /Reopened the command center/);
});

test('pinned restarts a stopped coordinator in a new tab of its existing session', () => {
  const { output, calls } = runPinned({ stopped: true, center: true });
  assert.match(output, /Started the coordinator in a new tab of "pinned" \(session:coordinator\)/);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^window new -s session:coordinator coordinator -c .* --shell=none -- .*\/\.pi\/agent\/bin\/pi --approve --model provider\/model$/);
});
