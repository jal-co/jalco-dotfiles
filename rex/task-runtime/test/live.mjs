import assert from 'node:assert/strict';
import { mkdtempSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Manager } from '../src/manager.mjs';
import { Store, readJson, writeJson } from '../src/store.mjs';
import { Rex, callRex } from '../src/rex.mjs';

const root = mkdtempSync(join(tmpdir(), 'rex-plugins-live-'));
const store = new Store(join(root, 'state'));
const rex = new Rex();
const manager = new Manager({ store, rex });
const original = rex.api('session.list').sessions ?? [];
const sessions = new Set();
const evidence = [];
let passed = false;

function started(id) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer); watcher.close();
      if (error) reject(error); else resolve();
    };
    const check = () => { if (readJson(store.file(id, 'runtime'))?.child) finish(); };
    const watcher = watch(store.directory(id), check);
    const timer = setTimeout(() => finish(new Error('Runner startup timed out')), 10000);
    watcher.on('error', finish);
    check();
  });
}

try {
  const complete = manager.launch({ name: 'rex-plugins-proof', adapter: 'command', cwd: root, panels: true, argv: [process.execPath, '-e', 'console.log("rex-plugins-live-ok")'] });
  sessions.add(complete.binding.session);
  callRex(['wait', complete.binding.block, '-s', complete.binding.session, '--for', '15s', '--json']);
  assert.equal(manager.status(complete.id).state, 'completed');
  const blocks = rex.api('session.list_blocks', { session_id: complete.binding.session }).blocks;
  assert.equal(blocks.length, 3);
  const capture = manager.capture(complete.id);
  assert.match(capture.text, /rex-plugins-live-ok/);
  const native = JSON.parse(callRex(['block', 'call', '-s', complete.binding.session, '-b', complete.binding.block, 'program_status']));
  assert.ok(native.records.some((record) => record.id === 'rex-task' && record.state === 'done' && record.app === 'rex-plugins'));
  evidence.push({ complete: manager.status(complete.id), capture, native });
  const stopping = manager.launch({ name: 'rex-plugins-stop-proof', adapter: 'command', cwd: root, argv: [process.execPath, '-e', 'setInterval(() => {}, 1000)'] });
  sessions.add(stopping.binding.session);
  await started(stopping.id);
  assert.equal(manager.stop(stopping.id).state, 'stopping');
  callRex(['wait', stopping.binding.block, '-s', stopping.binding.session, '--for', '15s', '--json']);
  assert.equal(new Manager({ store: new Store(store.root), rex }).status(stopping.id).state, 'stopped');
  evidence.push({ stopped: manager.status(stopping.id) });
  passed = true;
} finally {
  for (const row of manager.list()) {
    if (['running', 'stopping'].includes(row.state)) {
      manager.stop(row.id);
      callRex(['wait', row.binding.block, '-s', row.binding.session, '--for', '15s', '--json']);
    }
  }
  for (const session of sessions) rex.api('session.destroy', { session_id: session });
  const remaining = rex.api('session.list').sessions ?? [];
  for (const session of sessions) assert.ok(!remaining.some((row) => row.session_id === session));
  for (const row of original) assert.ok(remaining.some((session) => session.session_id === row.session_id), `Unrelated session disappeared: ${row.session_id}`);
  writeJson(join(root, 'result.json'), { passed, evidence, retainedState: store.root, disposableSessionsClosed: [...sessions] });
  console.log(JSON.stringify({ passed, evidence: join(root, 'result.json') }));
}
