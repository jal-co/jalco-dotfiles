import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCoordinator } from '../src/coordinator-session.mjs';

const process = { foreground: { argv0: 'pi', cwd: '/coordinator' } };
test('renamed coordinators are found without renaming or duplicating them', () => {
  const session = { session_id: 'session:a', label: '📌 my inbox' };
  assert.equal(findCoordinator([session], () => [process], '/coordinator'), session);
});
test('multiple coordinators and stopped named sessions fail closed', () => {
  assert.throws(() => findCoordinator([{ label: 'a' }, { label: 'b' }], () => [process], '/coordinator'), /Multiple live/);
  assert.throws(() => findCoordinator([{ label: 'pinned' }], () => [{}], '/coordinator'), /not running/);
});
test('an unavailable process inspection never authorizes a replacement', () => {
  assert.throws(() => findCoordinator([{}], () => { throw new Error('Unavailable'); }, '/coordinator'), /Unavailable/);
  assert.equal(findCoordinator([], () => [], '/coordinator'), undefined);
});
