import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { changePin, pinOrder, readPins, reconcilePins } from './session-pins.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'rex-pins-'));
  const file = join(directory, 'pins.json');
  const current = ['session:a', 'session:b', 'session:c'];
  const calls = [];
  const call = (args) => {
    calls.push(args);
    if (args[0] === 'ls') return JSON.stringify({ sessions: current.map((session_id) => ({ session_id })) });
    assert.deepEqual(args.slice(0, 2), ['session', 'move']);
    const id = args[2];
    const before = args[4];
    assert.notEqual(id, before);
    current.splice(current.indexOf(id), 1);
    current.splice(current.indexOf(before), 0, id);
    return '{}';
  };
  t.after(() => {
    if (existsSync(`${file}.lock`)) rmdirSync(`${file}.lock`);
    if (existsSync(file)) unlinkSync(file);
    rmdirSync(directory);
  });
  return { file, current, calls, call };
}

test('pins form a stable prefix without reordering ordinary sessions', () => {
  assert.deepEqual(pinOrder(['a', 'b', 'c', 'd'], ['c', 'missing', 'a']), ['c', 'a', 'b', 'd']);
  assert.deepEqual(pinOrder(['a', 'b'], []), ['a', 'b']);
});

test('pinning persists and repeated pinning is idempotent', (t) => {
  const { file, current, calls, call } = fixture(t);
  assert.deepEqual(changePin('pin', 'session:c', file, call), { session_id: 'session:c', pinned: true });
  assert.deepEqual(current, ['session:c', 'session:a', 'session:b']);
  assert.deepEqual(readPins(file), ['session:c']);
  const moves = calls.filter((args) => args[0] === 'session').length;
  changePin('pin', 'session:c', file, call);
  assert.equal(calls.filter((args) => args[0] === 'session').length, moves);
});

test('multiple pins retain their pinning order and unpin restores normal membership', (t) => {
  const { file, current, call } = fixture(t);
  changePin('pin', 'session:c', file, call);
  changePin('pin', 'session:b', file, call);
  assert.deepEqual(current, ['session:c', 'session:b', 'session:a']);
  changePin('unpin', 'session:c', file, call);
  assert.deepEqual(current, ['session:b', 'session:c', 'session:a']);
  assert.deepEqual(readPins(file), ['session:b']);
  changePin('unpin', 'session:b', file, call);
  current.reverse();
  assert.equal(reconcilePins(readPins(file), call), 0);
});

test('manual reordering is corrected and stale pins are ignored', (t) => {
  const { current, call } = fixture(t);
  assert.equal(reconcilePins(['session:gone', 'session:c'], call), 1);
  assert.deepEqual(current, ['session:c', 'session:a', 'session:b']);
  current.reverse();
  assert.equal(reconcilePins(['session:c'], call), 1);
  assert.deepEqual(current, ['session:c', 'session:b', 'session:a']);
  assert.equal(reconcilePins(['session:c'], call), 0);
});

test('the next action prunes destroyed session IDs', (t) => {
  const { file, call } = fixture(t);
  writeFileSync(file, JSON.stringify({ version: 1, sessions: ['session:gone'] }));
  changePin('pin', 'session:b', file, call);
  assert.deepEqual(readPins(file), ['session:b']);
});

test('corrupt state is rejected rather than silently overwritten', (t) => {
  const { file, call } = fixture(t);
  for (const value of ['{', JSON.stringify({ version: 2, sessions: [] }), JSON.stringify({ version: 1, sessions: [['session:a']] }), JSON.stringify({ version: 1, sessions: ['session:a', 'session:a'] })]) {
    writeFileSync(file, value);
    assert.throws(() => changePin('pin', 'session:b', file, call));
    assert.equal(readFileSync(file, 'utf8'), value);
    assert.equal(existsSync(`${file}.lock`), false);
  }
});

test('missing state is empty, but an unreadable state path is an error', (t) => {
  const { file } = fixture(t);
  assert.deepEqual(readPins(file), []);
  mkdirSync(file);
  assert.throws(() => readPins(file));
  rmdirSync(file);
});

test('concurrent writers are rejected without changing pin state', (t) => {
  const { file, call } = fixture(t);
  changePin('pin', 'session:a', file, call);
  mkdirSync(`${file}.lock`);
  assert.throws(() => changePin('pin', 'session:b', file, call), /Another pin operation/);
  assert.deepEqual(readPins(file), ['session:a']);
});

test('unknown actions and missing sessions cannot create state', (t) => {
  const { file, call } = fixture(t);
  assert.throws(() => changePin('delete', 'session:a', file, call), /Unknown pin action/);
  assert.throws(() => changePin('pin', 'session:gone', file, call), /does not exist/);
  assert.equal(existsSync(file), false);
});

test('move failures surface while preserving the requested pin for recovery', (t) => {
  const { file, call } = fixture(t);
  const failing = (args) => {
    if (args[0] === 'session') throw new Error('Server disconnected');
    return call(args);
  };
  assert.throws(() => changePin('pin', 'session:c', file, failing), /Server disconnected/);
  assert.deepEqual(readPins(file), ['session:c']);
  assert.equal(existsSync(`${file}.lock`), false);
});

test('an idle server with no sessions needs no moves', () => {
  assert.equal(reconcilePins(['session:gone'], () => '{"sessions":null}'), 0);
});
