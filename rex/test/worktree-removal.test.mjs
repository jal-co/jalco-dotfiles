import assert from 'node:assert/strict';
import { test } from 'node:test';
import { removeContainedWorktree } from '../host/maestro/core/worktree-cleanup.ts';

function operations(paths) {
  const inspected = [];
  const removed = [];
  const ops = {
    scan: () => paths,
    managedRoot: () => '/w',
    realpath: (path) => path,
    resolveSource: () => '/repo',
    inspectGit: (path) => {
      inspected.push(path);
      return { branch: path.split('/').at(-1), headSha: 'abc', registered: true, locked: false, dirtyFiles: 0, untrackedFiles: 0, conflicts: 0, submodules: false };
    },
    listWorktrees: () => paths.map((path) => ({ path, branch: path.split('/').at(-1), isLinkedWorktree: true })),
    readManifests: () => [],
    holders: async () => ({ blockers: [], warnings: [] }),
    exists: (path) => paths.includes(path) && !removed.includes(path),
    preserve: () => 'sha',
    removeWorkspace: () => {},
    reportOpenedPrimaryWorkspace: () => undefined,
    removeCheckout: (_source, path) => { removed.push(path); },
    prune: () => {},
    writeManifest: () => {},
  };
  return { ops, inspected, removed };
}

test('removing an exact managed checkout inspects only that checkout', async () => {
  const paths = Array.from({ length: 40 }, (_, index) => `/w/task-${index}`);
  const { ops, inspected, removed } = operations(paths);
  const result = await removeContainedWorktree({ cwd: '/', operations: ops, target: '/w/task-7' });
  assert.equal(result.status, 'removed', result.message);
  assert.deepEqual(removed, ['/w/task-7']);
  assert.deepEqual([...new Set(inspected)], ['/w/task-7']);
});

test('a branch-name target still resolves through the full inventory', async () => {
  const { ops, inspected, removed } = operations(['/w/task-1', '/w/task-2']);
  const result = await removeContainedWorktree({ cwd: '/', operations: ops, target: 'task-2' });
  assert.equal(result.status, 'removed', result.message);
  assert.deepEqual(removed, ['/w/task-2']);
  assert.deepEqual([...new Set(inspected)].sort(), ['/w/task-1', '/w/task-2']);
});
