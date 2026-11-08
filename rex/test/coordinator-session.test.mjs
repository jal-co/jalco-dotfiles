import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCoordinator } from '../src/coordinator-session.mjs';

const process = { foreground: { argv0: 'pi', cwd: '/coordinator' } };
test('renamed coordinators are found without renaming or duplicating them', () => {
  const session = { session_id: 'session:a', label: '📌 my inbox' };
  assert.equal(findCoordinator([session], () => [process], '/coordinator'), session);
});
test('multiple coordinators and several stopped pinned sessions fail closed', () => {
  assert.throws(() => findCoordinator([{ label: 'a' }, { label: 'b' }], () => [process], '/coordinator'), /Multiple live/);
  assert.throws(() => findCoordinator([{ label: 'pinned' }, { label: 'pinned' }], () => [{}], '/coordinator'), /Several pinned sessions/);
});
test('one inspected pinned session without a coordinator is reported as stopped for restart', () => {
  assert.deepEqual(findCoordinator([{ session_id: 'session:p', label: 'pinned' }], () => [{ foreground: { argv0: '-zsh', cwd: '/coordinator' } }], '/coordinator'), { session_id: 'session:p', label: 'pinned', stopped: true });
  assert.throws(() => findCoordinator([{ session_id: 'session:p', label: 'pinned' }], () => { throw new Error('Unavailable'); }, '/coordinator'), /Unavailable/);
});
test('an unavailable process inspection never authorizes a replacement', () => {
  assert.throws(() => findCoordinator([{}], () => { throw new Error('Unavailable'); }, '/coordinator'), /Unavailable/);
  assert.equal(findCoordinator([], () => [], '/coordinator'), undefined);
});
