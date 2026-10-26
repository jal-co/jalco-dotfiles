import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { infrastructureFor, releaseInfrastructure } from './runtime.mjs';

test('reload preserves the provider, pane ownership and supervision together', () => {
  const session = randomUUID();
  let closed = 0;
  const first = infrastructureFor(session, () => ({ provider: { sessions: new Set(['task']) }, supervision: { close: () => closed++ } }));
  releaseInfrastructure(session, 'reload');
  const second = infrastructureFor(session, () => { throw new Error('Reload must reuse infrastructure'); });
  assert.equal(first, second);
  assert.equal(second.provider.sessions.has('task'), true);
  assert.equal(closed, 0);
  for (const reason of ['new', 'resume', 'fork']) releaseInfrastructure(session, reason);
  assert.equal(closed, 0);
  releaseInfrastructure(session, 'exit');
  assert.equal(closed, 1);
  assert.notEqual(infrastructureFor(session, () => ({})), first);
  releaseInfrastructure(session, 'exit');
});

test('infrastructure for different Rex sessions is never shared', () => {
  const first = randomUUID();
  const second = randomUUID();
  assert.notEqual(infrastructureFor(first, () => ({})), infrastructureFor(second, () => ({})));
  releaseInfrastructure(first, 'exit');
  releaseInfrastructure(second, 'exit');
});
