import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCoordinator } from '../src/coordinator-session.mjs';

const process = { foreground: { argv0: 'pi', cwd: '/coordinator' } };
test('renamed coordinators are found without renaming or duplicating them', () => {
  const session = { session_id: 'session:a', label: '📌 my inbox' };
  assert.equal(findCoordinator([session], () => [process], '/coordinator'), session);
});
test('multiple coordinators and several stopped Command sessions fail closed', () => {
  assert.throws(() => findCoordinator([{ label: 'a' }, { label: 'b' }], () => [process], '/coordinator'), /Multiple live/);
  assert.throws(() => findCoordinator([{ label: 'pinned' }, { label: 'Command' }], () => [{}], '/coordinator'), /Several Command or pinned sessions/);
});
test('one inspected Command or legacy pinned session without a coordinator is reported as stopped for restart', () => {
  assert.equal(findCoordinator([{ session_id: 'session:c', label: 'Command' }], () => [{}], '/coordinator').stopped, true);
  assert.deepEqual(findCoordinator([{ session_id: 'session:p', label: 'pinned' }], () => [{ foreground: { argv0: '-zsh', cwd: '/coordinator' } }], '/coordinator'), { session_id: 'session:p', label: 'pinned', stopped: true });
  assert.throws(() => findCoordinator([{ session_id: 'session:p', label: 'pinned' }], () => { throw new Error('Unavailable'); }, '/coordinator'), /Unavailable/);
});
test('an unavailable process inspection never authorizes a replacement', () => {
  assert.throws(() => findCoordinator([{}], () => { throw new Error('Unavailable'); }, '/coordinator'), /Unavailable/);
  assert.equal(findCoordinator([], () => [], '/coordinator'), undefined);
});
