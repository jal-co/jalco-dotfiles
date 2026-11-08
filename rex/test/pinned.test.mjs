import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CENTER = '\u{f0516} linear';
const terminal = (block_id, label) => ({ block_id, label, creator_name: 'com.superlogical.terminal' });

function runPinned({ label = 'inbox', running = true, coordinator = true, centerTab = false, oldPane = false, legacy = false, windowLabel = 'coordinator' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rex-pinned-test-'));
  const binary = join(directory, 'rex');
  const cwd = join(directory, 'rex-coord');
  const log = join(directory, 'calls.log');
  mkdirSync(join(cwd, '.pi'), { recursive: true });
  mkdirSync(join(directory, '.rex'), { recursive: true });
  symlinkSync(fileURLToPath(new URL('../coordinator/settings.json', import.meta.url)), join(cwd, '.pi/settings.json'));
  symlinkSync(fileURLToPath(new URL('../coordinator/AGENTS.md', import.meta.url)), join(cwd, 'AGENTS.md'));
  if (legacy) writeFileSync(join(directory, '.rex/command-center-session.json'), JSON.stringify({ session_id: 'session:legacy' }));
  const sessions = [
    { session_id: 'session:other', label: 'dotfiles' },
    ...(coordinator ? [{ session_id: 'session:coordinator', label }] : []),
    ...(legacy ? [{ session_id: 'session:legacy', label: CENTER }] : []),
  ];
  const windows = {
    'session:other': [{ label: 'work', layers: [{ blocks: [terminal('block:other'), ...(oldPane ? [terminal('block:old', 'command-center')] : [])] }] }],
    'session:coordinator': [
      { window_id: 'window:coordinator', label: windowLabel, layers: [{ blocks: [terminal('block:coordinator')] }] },
      ...(centerTab ? [{ label: CENTER, layers: [{ blocks: [terminal('block:center')] }] }] : []),
    ],
    'session:legacy': [{ label: 'command center', layers: [{ blocks: [terminal('block:legacy')] }] }],
    'session:created': [{ label: 'coordinator', layers: [{ blocks: [terminal('block:created')] }] }],
  };
  writeFileSync(binary, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(3);
const windows = ${JSON.stringify(windows)};
const record = () => fs.appendFileSync(${JSON.stringify(log)}, args.join(' ') + '\\n');
let result;
if (args[0] === 'ls') result = { sessions: ${JSON.stringify(sessions)} };
else if (args[0] === 'session' && args[1] === 'inspect') result = { windows: windows[args[2]] };
else if (args[0] === 'block' && args[1] === 'call') result = { foreground: { argv0: args[5] === 'block:coordinator' && ${running} ? 'pi' : '-zsh', cwd: ${JSON.stringify(cwd)} } };
else if (args[0] === 'actions') result = { actions: [{ name: 'pin_session' }] };
else if (args[0] === 'new') { record(); result = { session_id: 'session:created', initial_windows: [{ block_ids: ['block:created'] }] }; }
else if (['window', 'block', 'do', 'kill', 'session'].includes(args[0])) { record(); result = { window_id: 'window:new', block_ids: ['block:new'] }; }
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
    return {
      output: result.stdout,
      calls: existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [],
      legacyFile: existsSync(join(directory, '.rex/command-center-session.json')),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const centerTab = (session) => new RegExp(`^window new -s ${session} ${CENTER} -c .*rex-coord --focus=false --json --shell=none -- .*node .*src/linear-tui\\.mjs$`);

test('pinned keeps a running coordinator and adds the command center as a second tab of its session', () => {
  const { output, calls } = runPinned();
  assert.match(output, /coordinator already runs in "inbox"/);
  assert.equal(calls.length, 2);
  assert.match(calls[0], centerTab('session:coordinator'));
  assert.equal(calls[1], 'do -s session:coordinator pin_session');
});

test('pinned renames the old default pinned session to Command and leaves an open command center tab alone', () => {
  const { calls } = runPinned({ label: 'pinned', centerTab: true });
  assert.deepEqual(calls, ['session rename session:coordinator Command', 'do -s session:coordinator pin_session']);
  assert.deepEqual(runPinned({ label: 'Command', centerTab: true }).calls, ['do -s session:coordinator pin_session']);
});

test('pinned folds an old split pane and the separate command center session into the Command session', () => {
  const { calls, legacyFile } = runPinned({ oldPane: true, legacy: true });
  assert.deepEqual(calls.slice(0, 2), ['block close -s session:other block:old', 'kill session:legacy']);
  assert.match(calls[2], centerTab('session:coordinator'));
  assert.equal(legacyFile, false);
});

test('pinned restarts a stopped coordinator in its existing session and creates Command when none exists', () => {
  const stopped = runPinned({ label: 'Command', running: false });
  assert.match(stopped.output, /Started the coordinator in a new tab of "Command"/);
  assert.match(stopped.calls[0], /^window new -s session:coordinator coordinator -c .* --shell=none -- .*\/\.pi\/agent\/bin\/pi --approve --model provider\/model$/);
  assert.match(stopped.calls[1], centerTab('session:coordinator'));
  const fresh = runPinned({ coordinator: false });
  assert.match(fresh.calls[0], /^new Command -c .*rex-coord --window coordinator --json --shell=none -- .*\/bin\/pi --approve/);
  assert.match(fresh.calls[1], centerTab('session:created'));
  assert.equal(fresh.calls[2], 'do -s session:created pin_session');
});

test('pinned names a coordinator tab that still has its default name', () => {
  const { calls } = runPinned({ centerTab: true, windowLabel: 'Window 80210310' });
  assert.deepEqual(calls, ['window rename -s session:coordinator window:coordinator coordinator', 'do -s session:coordinator pin_session']);
  assert.deepEqual(runPinned({ centerTab: true, windowLabel: 'my inbox' }).calls, ['do -s session:coordinator pin_session']);
});
