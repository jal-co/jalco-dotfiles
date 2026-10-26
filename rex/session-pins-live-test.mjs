import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callRex } from './provider.mjs';
import { readPins } from './session-pins.mjs';

const service = spawnSync('/bin/launchctl', ['print', `gui/${process.getuid()}/com.jalco.rex-session-pins`]);
assert.notEqual(service.status, 0, 'Stop the production Rex pin service before running this isolated integration test');
const root = dirname(fileURLToPath(import.meta.url));
const report = join(homedir(), '.local/state/rex-session-pins', String(Date.now()));
mkdirSync(report, { recursive: true });
const file = join(report, 'pins.json');
const previousState = process.env.REX_PIN_STATE;
process.env.REX_PIN_STATE = file;
const owned = new Set();
const sessions = () => JSON.parse(callRex(['ls', '--json'])).sessions.map((entry) => entry.session_id);
const baseline = sessions();
let watcher;
let completed = false;

function startWatcher() {
  const child = spawn(process.execPath, [join(root, 'session-pins.mjs'), 'watch'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const events = new EventEmitter();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line) events.emit('message', JSON.parse(line));
    }
  });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return { child, events };
}

function expect(worker, predicate) {
  return new Promise((resolve, reject) => {
    const clear = () => {
      clearTimeout(timer);
      worker.events.removeListener('message', message);
      worker.child.removeListener('exit', exit);
    };
    const message = (value) => { if (predicate(value)) { clear(); resolve(value); } };
    const exit = (code) => { clear(); reject(new Error(`Pin watcher exited unexpectedly: ${code}`)); };
    const timer = setTimeout(() => { clear(); reject(new Error('Pin watcher did not deliver the expected event')); }, 20_000);
    worker.events.on('message', message);
    worker.child.once('exit', exit);
  });
}

async function stopWatcher() {
  if (!watcher || watcher.child.exitCode !== null) return;
  const exited = once(watcher.child, 'exit');
  watcher.child.kill('SIGTERM');
  await exited;
  watcher = undefined;
}

function create(label) {
  const id = JSON.parse(callRex(['new', label, '-c', report, '--json'])).session_id;
  owned.add(id);
  return id;
}

function action(id, name) {
  return JSON.parse(callRex(['do', '-s', id, join(root, 'session-pins.lua'), '--action', name]));
}

try {
  const first = create('pin-test-first');
  const second = create('pin-test-second');
  const ordinary = create('pin-test-ordinary');
  watcher = startWatcher();
  await expect(watcher, (event) => event.type === 'ready');
  assert.equal(action(first, 'pin_session').pinned, true);
  assert.equal(action(second, 'pin_session').pinned, true);
  assert.deepEqual(sessions().slice(0, 2), [first, second]);
  assert.deepEqual(readPins(file), [first, second]);

  const corrected = expect(watcher, (event) => event.type === 'reconciled' && event.moves > 0);
  callRex(['session', 'move', ordinary, '--index', '1']);
  await corrected;
  assert.deepEqual(sessions().slice(0, 2), [first, second]);

  const created = expect(watcher, (event) => event.type === 'reconciled');
  create('pin-test-new');
  await created;
  assert.deepEqual(sessions().slice(0, 2), [first, second]);
  assert.equal(action(first, 'unpin_session').pinned, false);
  assert.deepEqual(readPins(file), [second]);
  assert.equal(sessions()[0], second);

  await stopWatcher();
  callRex(['session', 'move', second, '--index', '999']);
  watcher = startWatcher();
  await expect(watcher, (event) => event.type === 'ready');
  assert.equal(sessions()[0], second);

  const destroyed = expect(watcher, (event) => event.type === 'reconciled');
  callRex(['kill', second]);
  owned.delete(second);
  await destroyed;
  action(first, 'pin_session');
  assert.deepEqual(readPins(file), [first]);
  action(first, 'unpin_session');
  assert.deepEqual(readPins(file), []);
  const unpinned = expect(watcher, (event) => event.type === 'reconciled');
  callRex(['session', 'move', first, '--index', '999']);
  await unpinned;
  assert.equal(sessions().at(-1), first);
  completed = true;
} finally {
  await stopWatcher();
  for (const id of owned) callRex(['kill', id]);
  if (previousState === undefined) delete process.env.REX_PIN_STATE;
  else process.env.REX_PIN_STATE = previousState;
  const remaining = sessions();
  assert.deepEqual(remaining.filter((id) => baseline.includes(id)), baseline.filter((id) => remaining.includes(id)));
  writeFileSync(join(report, 'result.json'), JSON.stringify({ completed, baselineOrderPreserved: true, fixtureState: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null }, null, 2));
  console.log(`Rex session pin integration: ${completed ? 'passed' : 'failed'}. Report: ${report}`);
}
