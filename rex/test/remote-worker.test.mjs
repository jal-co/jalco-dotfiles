import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startWorker, workerExit } from '../src/remote.mjs';

function fakeRex(context, { exited = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'rex-remote-worker-'));
  const log = join(home, 'calls.log');
  const binary = join(home, 'rex');
  writeFileSync(binary, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const [, ...rest] = args;
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (rest[0] === 'window' && rest[1] === 'new') console.log(JSON.stringify({ window_id: 'window:w', block_ids: ['block:w'] }));
else if (rest[0] === 'block' && rest[1] === 'call') console.log(JSON.stringify(${exited} ? { last_exit: { code: 1 } } : { foreground: { argv0: 'pi' } }));
else if (rest[0] === 'capture') console.log('\\nError: Failed to load extension: Load this extension inside a Rex terminal.\\n');
else if (rest[0] === 'block' && rest[1] === 'close') console.log('{}');
else throw new Error('Unexpected Rex call: ' + args.join(' '));
`);
  chmodSync(binary, 0o700);
  mkdirSync(join(home, '.pi/agent/rex-agents'), { recursive: true });
  writeFileSync(join(home, '.pi/agent/rex-agents/config.json'), JSON.stringify({ models: { default: 'provider/model' } }));
  const old = { HOME: process.env.HOME, REX_BIN: process.env.REX_BIN, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
  Object.assign(process.env, { HOME: home, REX_BIN: binary, PI_CODING_AGENT_DIR: join(home, '.pi/agent') });
  context.after(() => {
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  return { home, calls: () => readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) };
}

test('the worker coordinator starts in a background tab of the target session with that session in its environment', (context) => {
  const rex = fakeRex(context);
  assert.deepEqual(startWorker({ session: 'session:repo' }), { session: 'session:repo', block: 'block:w' });
  assert.deepEqual(rex.calls(), [[
    '--autostart=false', 'window', 'new', '-s', 'session:repo', 'coordinator', '-c', join(rex.home, 'rex-coord'), '--focus=false', '--keep-open', '--json', '--',
    '/usr/bin/env', 'REX_WORKER=1', 'REX_SESSION=session:repo', join(rex.home, '.pi/agent/bin/pi'), '--approve', '--model', 'provider/model',
  ]]);
});

test('a running worker is not reported as failed and its tab is left alone', (context) => {
  const rex = fakeRex(context);
  assert.equal(workerExit({ session: 'session:repo', block: 'block:w' }), undefined);
  assert.equal(workerExit({ session: 'session:repo' }), undefined);
  assert.deepEqual(rex.calls().map((args) => args.slice(1, 3)), [['block', 'call']]);
});

test('a worker that exits at startup is reported with its last output and its dead tab is closed', (context) => {
  const rex = fakeRex(context, { exited: true });
  const message = workerExit({ session: 'session:repo', block: 'block:w' });
  assert.match(message, /exited right after starting \(\{"code":1\}\); nothing was submitted/);
  assert.match(message, /Load this extension inside a Rex terminal/);
  assert.deepEqual(rex.calls().map((args) => args.slice(1, 3)), [['block', 'call'], ['capture', '-s'], ['block', 'close']]);
});
