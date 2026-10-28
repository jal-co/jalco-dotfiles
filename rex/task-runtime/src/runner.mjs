import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, watch } from 'node:fs';
import { join } from 'node:path';
import { Store, readJson, writeJson } from './store.mjs';
import { processIdentity } from './process.mjs';
import { programStatus } from './status.mjs';

export async function run(root, id) {
  const store = new Store(root);
  const request = store.request(id);
  const directory = store.directory(id);
  mkdirSync(join(directory, 'runner.claim'), { mode: 0o700 });
  const runtime = { id, state: 'running', identity: processIdentity(process.pid), startedAt: new Date().toISOString() };
  assert.ok(runtime.identity, 'Runner identity unavailable');
  writeJson(store.file(id, 'runtime'), runtime);
  const report = (state, message) => process.stdout.write(programStatus({ state, title: request.name, message }));
  let child;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    const directive = readJson(store.file(id, 'stop'));
    if (!directive || directive.id !== id) return;
    stopping = true;
    runtime.state = 'stopping';
    writeJson(store.file(id, 'runtime'), runtime);
    if (child?.pid) child.kill('SIGTERM');
  };
  const signal = () => {
    writeJson(store.file(id, 'stop'), { id, requestedAt: new Date().toISOString(), source: 'runner-signal' });
    stop();
  };
  const watcher = watch(directory, (_event, name) => {
    if (String(name) !== 'stop.json') return;
    try { stop(); } catch (error) { process.stderr.write(`Stop request could not be read: ${error.message}\n`); }
  });
  watcher.on('error', (error) => { process.stderr.write(`Stop watcher failed: ${error.message}\n`); signal(); });
  process.on('SIGTERM', signal);
  process.on('SIGINT', signal);
  const logs = [];
  try {
    stop();
    if (stopping) { runtime.state = 'stopped'; return; }
    report('working', 'Process running');
    const [command, ...args] = request.command.argv;
    child = spawn(command, args, { cwd: request.cwd, shell: false, stdio: request.command.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    if (child.pid) runtime.child = processIdentity(child.pid);
    writeJson(store.file(id, 'runtime'), runtime);
    if (request.command.capture) {
      for (const [stream, filename, output] of [[child.stdout, 'stdout.log', process.stdout], [child.stderr, 'stderr.log', process.stderr]]) {
        const log = createWriteStream(join(directory, filename), { flags: 'wx', mode: 0o600 });
        log.on('error', (error) => { runtime.logError = error.message; signal(); });
        stream.pipe(log);
        stream.pipe(output, { end: false });
        logs.push(log);
      }
    }
    const result = await new Promise((resolve) => {
      child.once('error', (error) => resolve({ code: null, signal: null, error: error.message }));
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    Object.assign(runtime, result, { state: stopping ? 'stopped' : result.code === 0 && !runtime.logError ? 'completed' : 'failed' });
    report(stopping ? 'idle' : runtime.state === 'completed' ? 'done' : 'error', stopping ? 'Process stopped' : `Process exited: ${result.code ?? result.error ?? result.signal}`);
  } catch (error) {
    runtime.state = 'failed';
    runtime.error = error.message;
    throw error;
  } finally {
    watcher.close();
    process.removeListener('SIGTERM', signal);
    process.removeListener('SIGINT', signal);
    for (const log of logs) if (!log.writableEnded) log.end();
    runtime.finishedAt = new Date().toISOString();
    writeJson(store.file(id, 'runtime'), runtime);
  }
}

if (import.meta.main) {
  const [flag, root, id] = process.argv.slice(2);
  assert.equal(flag, '--root');
  try { await run(root, id); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
