import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { defaultRoot } from '../../src/store.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callRex, rexBinary } from '../../src/rex.mjs';

export const pinStateFile = () => process.env.REX_PLUGINS_PIN_STATE ?? join(defaultRoot(), 'session-pins.json');

export function readPins(file) {
  let source;
  try { source = readFileSync(file, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const value = JSON.parse(source);
  if (value?.version !== 1 || !Array.isArray(value.sessions)
    || new Set(value.sessions).size !== value.sessions.length) {
    throw new Error(`Invalid Rex session pin state: ${file}`);
  }
  for (const id of value.sessions) assert.match(id, /^session:[a-zA-Z0-9-]+$/, `Invalid session ID in ${file}`);
  return value.sessions;
}

export function pinOrder(current, pins) {
  const live = new Set(current);
  const pinned = pins.filter((id) => live.has(id));
  const selected = new Set(pinned);
  return [...pinned, ...current.filter((id) => !selected.has(id))];
}

export function reconcilePins(pins, call = callRex) {
  const current = (JSON.parse(call(['ls', '--json'])).sessions ?? []).map((session) => session.session_id);
  const desired = pinOrder(current, pins);
  let moves = 0;
  for (let index = 0; index < desired.length; index++) {
    if (current[index] === desired[index]) continue;
    call(['session', 'move', desired[index], '--before', current[index]]);
    current.splice(current.indexOf(desired[index]), 1);
    current.splice(index, 0, desired[index]);
    moves++;
  }
  return moves;
}

export function changePin(action, id, file = pinStateFile(), call = callRex) {
  if (!['pin', 'unpin'].includes(action)) throw new Error(`Unknown pin action: ${action}`);
  const sessions = JSON.parse(call(['ls', '--json'])).sessions ?? [];
  if (!sessions.some((session) => session.session_id === id)) throw new Error(`Session does not exist: ${id}`);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  try { mkdirSync(lock, { mode: 0o700 }); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another pin operation owns ${lock}. Inspect it before retrying.`);
    throw error;
  }
  const owner = join(lock, 'owner.json');
  try {
    writeFileSync(owner, JSON.stringify({ pid: process.pid }), { mode: 0o600 });
    const live = new Set(sessions.map((session) => session.session_id));
    let pins = readPins(file).filter((pin) => live.has(pin));
    if (action === 'pin' && !pins.includes(id)) pins.push(id);
    if (action === 'unpin') pins = pins.filter((pin) => pin !== id);
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ version: 1, sessions: pins }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
    reconcilePins(pins, call);
    return { session_id: id, pinned: action === 'pin' };
  } finally {
    if (existsSync(owner)) unlinkSync(owner);
    rmdirSync(lock);
  }
}

export function watchPins(file = pinStateFile()) {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'events.lua');
  const child = spawn(rexBinary(), ['--autostart=false', 'do', script, '--all', '--fail-fast', 'watch=true'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, REX_SESSION: '', REX_BLOCK: '' },
  });
  let buffer = '';
  let scheduled = false;
  let stopping = false;
  let ready = false;
  const stop = () => { stopping = true; child.kill('SIGTERM'); };
  const fail = (error) => { console.error(String(error)); process.exitCode = 1; stop(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.once('error', fail);
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch (error) { fail(error); return; }
      if (event.type === 'ready') ready = true;
      if (scheduled || stopping) continue;
      scheduled = true;
      setImmediate(() => {
        scheduled = false;
        if (stopping) return;
        try {
          const moves = reconcilePins(readPins(file));
          console.log(JSON.stringify({ type: ready ? 'ready' : 'reconciled', moves }));
          ready = false;
        } catch (error) { fail(error); }
      });
    }
  });
  child.once('close', (code) => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (!stopping) {
      console.error(`Rex pin event stream ended (${code}).`);
      process.exitCode = 1;
    }
  });
}

if (import.meta.main) {
  const [action, id] = process.argv.slice(2);
  if (action === 'watch') watchPins();
  else console.log(JSON.stringify(changePin(action, id)));
}
