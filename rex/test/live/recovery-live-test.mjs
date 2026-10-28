import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callRex } from '../../src/provider.mjs';
import { processBirth, TaskStore } from '../../src/tasks.ts';

const source = join(dirname(fileURLToPath(import.meta.url)), '../..');
const root = join(homedir(), '.local/state/rex-recovery-proof', String(Date.now()));
mkdirSync(join(root, '.pi'), { recursive: true });
writeFileSync(join(root, '.pi/settings.json'), JSON.stringify({ packages: [{ source: 'npm:pi-herdr-agents', extensions: [] }], extensions: [join(source, 'test/live/recovery-live-extension.ts')] }));
const config = join(root, 'modules.json');
writeFileSync(config, '{"recovery":true,"overview":true}');
const environment = { ...process.env, REX_RECOVERY_PROOF: root, REX_TASK_ROOT: join(root, 'tasks'), REX_MODULES_CONFIG: config };
const launchOverview = () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `import { openOverview } from ${JSON.stringify(join(source, 'src/overview-launcher.mjs'))}; console.log(JSON.stringify(openOverview(${JSON.stringify(`recovery-proof-overview-${Date.now()}`)})));`], { env: environment, encoding: 'utf8' }));
const owned = new Set();
const makeSession = (name, command = []) => {
  const value = JSON.parse(callRex(['new', name, '-c', root, '--json', ...(command.length ? ['--shell=none', '--', ...command] : [])]));
  owned.add(value.session_id); return value;
};
function wait(bus, predicate, history = []) {
  const found = history.find(predicate);
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); bus.removeListener('event', listener); };
    const listener = (event) => { if (predicate(event)) { cleanup(); resolve(event); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Recovery proof event timed out')); }, 30000);
    bus.on('event', listener);
  });
}
const parents = [];
function startParent(session) {
  const process = spawn(join(homedir(), '.pi/agent/bin/pi'), ['--mode', 'rpc', '--approve', '--no-mcp', '--no-skills', '--no-context-files'], {
    cwd: root, env: { ...environment, REX_SESSION: session.session_id }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  parents.push(process);
  const bus = new EventEmitter(); const events = []; let buffer = '';
  process.stdout.on('data', (chunk) => {
    buffer += chunk.toString(); let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      events.push(event); bus.emit('event', event);
    }
  });
  let stderr = '';
  process.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  process.on('exit', (code) => {
    writeFileSync(join(root, `parent-${process.pid}.json`), JSON.stringify({ code, stderr, events }, null, 2));
    bus.emit('event', { type: 'parent-exit', code });
  });
  const ready = async () => {
    process.stdin.write('{"type":"get_state","id":"ready"}\n');
    const result = await wait(bus, (event) => event.type === 'response' && event.id === 'ready', events);
    assert.equal(result.success, true);
  };
  const operation = async (name, params) => {
    const count = events.length;
    process.stdin.write(`${JSON.stringify({ type: 'prompt', message: `/rex-recovery-proof ${JSON.stringify({ name, params })}`, id: `op-${count}` })}\n`);
    const result = await wait(bus, (event) => (event.type === 'message_end' && event.message?.customType === 'rex-proof-operation') || (event.type === 'response' && event.id === `op-${count}` && !event.success) || event.type === 'extension_error', events.slice(count));
    assert.notEqual(result.success, false, JSON.stringify(result));
    assert.notEqual(result.type, 'extension_error', JSON.stringify(result));
    return result.message.details;
  };
  return { process, bus, events, ready, operation };
}
async function stopParent(parent) {
  if (parent.process.exitCode !== null) return;
  const stopped = once(parent.process, 'exit');
  parent.process.stdin.end(); await stopped;
}
const result = { finished: false };
let worker;
try {
  const seed = { id: 'recovery-fixture', name: 'Recovery proof worker', generationId: 'proof-generation', sessionFile: join(root, 'worker.jsonl'), activityFile: join(root, 'activity.json') };
  writeFileSync(join(root, 'worker-seed.json'), JSON.stringify(seed));
  const readyBus = new EventEmitter();
  const readyWatcher = watch(root, (_event, file) => { if (String(file) === 'worker-ready.json') readyBus.emit('event', true); });
  const workerReady = wait(readyBus, Boolean);
  worker = makeSession('recovery-proof-worker', ['/usr/bin/env', `REX_RECOVERY_PROOF=${root}`, process.execPath, join(source, 'test/live/recovery-fixture-worker.mjs')]);
  seed.surface = `${worker.session_id}/${worker.initial_windows[0].block_ids[0]}`;
  writeFileSync(join(root, 'worker-seed.json'), JSON.stringify(seed));
  await workerReady; readyWatcher.close();
  const published = JSON.parse(readFileSync(join(root, 'worker-ready.json'), 'utf8'));
  if (!published.surface) {
    published.surface = seed.surface;
    writeFileSync(join(root, 'worker-ready.json'), JSON.stringify(published));
  }
  const workerBirth = processBirth(published.pid);
  const coordinator = makeSession('recovery-proof-coordinator');
  const first = startParent(coordinator); await first.ready();
  const ack = await first.operation('subagent_send', { name: seed.name, message: 'RESTART_RECOVERY_FIRST_OK' });
  assert.equal(ack.status, 'dispatched');
  const store = new TaskStore(environment.REX_TASK_ROOT);
  const before = store.read(seed.id);
  await stopParent(first);
  assert.equal(processBirth(published.pid), workerBirth);
  const second = startParent(coordinator); await second.ready();
  const completion = wait(second.bus, (event) => event.type === 'message_end' && event.message?.customType === 'subagent_result', second.events);
  writeFileSync(join(root, 'finish'), 'finish');
  const firstResult = await completion;
  assert.match(firstResult.message.content, /RESTART_RECOVERY_FIRST_OK/);
  assert.equal(store.read(seed.id).owner.pid, second.process.pid);
  assert.equal(store.read(seed.id).identity.pid, before.identity.pid);
  const followup = wait(second.bus, (event) => event.type === 'message_end' && event.message?.customType === 'subagent_result' && event.message.content.includes('RESTART_RECOVERY_SECOND_OK'));
  await second.operation('subagent_send', { name: seed.name, message: 'RESTART_RECOVERY_SECOND_OK' });
  await followup;
  const native = JSON.parse(callRex(['block', 'call', '-s', worker.session_id, '-b', worker.initial_windows[0].block_ids[0], 'program_status']));
  assert.match(JSON.stringify(native), /done/);
  result.nativeStatus = true;

  const overview = launchOverview();
  owned.add(overview.session_id);
  result.overviewSession = overview.session_id;
  const stopped = wait(second.bus, (event) => event.type === 'message_end' && event.message?.customType === 'subagent_stop' && event.message.details?.status === 'stopped');
  await second.operation('subagent_stop', { name: seed.name });
  await stopped;
  assert.equal(store.read(seed.id).stopConfirmed, true);
  assert.equal(processBirth(published.pid), null);
  callRex(['session', 'rename', overview.session_id, 'recovery-proof-overview-renamed']);
  const reopened = launchOverview();
  assert.equal(reopened.session_id, overview.session_id);
  const screen = callRex(['capture', '-s', overview.session_id, '--trim', '--unwrap']);
  assert.match(screen, /STOPPED/);
  result.overviewLiveUpdate = true; result.renamedViewReused = true;
  await stopParent(second);
  result.sameAgent = true; result.automaticResults = 2; result.confirmedStop = true; result.finished = true;
} finally {
  for (const parent of parents) {
    if (parent.exitCode === null) { const exited = once(parent, 'exit'); parent.stdin.end(); await exited; }
  }
  const live = JSON.parse(callRex(['ls', '--json'])).sessions ?? [];
  for (const id of owned) {
    if (!live.some((session) => session.session_id === id)) continue;
    if (id === result.overviewSession) callRex(['do', '-s', id, 'unpin_session']);
    callRex(['kill', id]);
  }
  writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2));
  console.log(`Recovery proof ${result.finished ? 'passed' : 'failed'}: ${root}`);
}
