import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createWorktreeCleanupOperations } from '../host/maestro/runtime/worktree-operations.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const agent = join(homedir(), '.pi/agent');
const version = readFileSync(join(agent, 'install/current-version'), 'utf8').trim();
const { loadExtensions } = await import(pathToFileURL(join(agent, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js')).href);
const bridge = join(mkdtempSync(join(tmpdir(), 'rex-host-bridge-')), 'bridge.ts');
writeFileSync(bridge, `import { __test__ } from ${JSON.stringify(join(root, 'host/pi-extension/subagents/index.ts'))};\nglobalThis.rexHostTest = __test__;\nexport default function () {}\n`);
assert.deepEqual((await loadExtensions([bridge], root)).errors, []);
const host = globalThis.rexHostTest;

function specialist() {
  const running = { id: 'specialist-a', name: 'specialist', persistent: true, taskId: 'task-a', generationId: 'generation-a', logicalId: 'specialist-a', policyHash: 'hash', sessionFile: '/tmp/specialist.jsonl', startTime: Date.now(), tasksCompleted: 0 };
  host.runningSubagents.clear();
  host.runningSubagents.set(running.id, running);
  const ledger = [];
  const dispatched = [];
  const messages = [];
  const io = {
    rejectBusy: (_record, task) => ledger.push({ task, outcome: 'rejected-busy' }),
    dispatch: (record, task, text) => { dispatched.push({ task, text }); record.taskId = task; return `inbox-${task}`; },
    readLedger: () => ledger,
    readTaskSummary: () => 'summary',
    acknowledge: (record, event) => { if (record.taskId === event.task) record.taskId = undefined; record.tasksCompleted += 1; return { task: event.task, outcome: 'delivered' }; },
    requestStop: () => {},
  };
  const api = { sendMessage: (message) => messages.push(message) };
  return { running, io, api, ledger, dispatched, messages };
}

test('a mid-turn persistent specialist queues one follow-up and receives it when its turn ends', () => {
  const f = specialist();
  const queued = host.handleSubagentSend({ name: 'specialist', message: 'next step' }, f.io);
  assert.equal(queued.details.outcome, 'queued');
  assert.match(queued.content[0].text, /queued and will be dispatched when its current turn ends/);
  assert.deepEqual(f.dispatched, []);
  const second = host.handleSubagentSend({ name: 'specialist', message: 'too many' }, f.io);
  assert.equal(second.details.outcome, 'rejected-busy');
  assert.match(second.details.error, /already has queued follow-up/);
  host.deliverPersistentTaskEvent(f.running, { type: 'task-done', task: 'task-a', generation: 'generation-a' }, f.api, f.io);
  assert.deepEqual(f.dispatched, [{ task: queued.details.task, text: 'next step' }]);
  assert.equal(f.running.queuedFollowUp, undefined);
  assert.equal(f.running.taskId, queued.details.task);
  assert.match(f.messages[0].content, /Queued follow-up .* is now being dispatched/);
  host.runningSubagents.clear();
});

test('an idle specialist dispatches immediately and a stop discards the queued follow-up', () => {
  const f = specialist();
  f.running.taskId = undefined;
  assert.equal(host.handleSubagentSend({ name: 'specialist', message: 'now' }, f.io).details.outcome, 'dispatched');
  assert.equal(host.handleSubagentSend({ name: 'specialist', message: 'later' }, f.io).details.outcome, 'queued');
  const stop = host.handleSubagentStop({ name: 'specialist' }, f.api, 15_000, f.io);
  assert.match(stop.content[0].text, /Queued follow-up .* was discarded/);
  host.deliverPersistentTaskEvent(f.running, { type: 'task-done', task: f.running.taskId, generation: 'generation-a' }, f.api, f.io);
  assert.deepEqual(f.dispatched.map((row) => row.text), ['now']);
  host.runningSubagents.clear();
});

test('a crashed persistent specialist is reported as resumable with its tab and worktree retained', () => {
  const f = specialist();
  f.io.readEvents = () => [];
  f.io.inspectWorktree = () => undefined;
  host.notifyPersistentCrash(f.running, f.api, f.io);
  assert.match(f.messages[0].content, /tab and worktree are retained.*subagent_resume and session \/tmp\/specialist\.jsonl/);
  assert.doesNotMatch(f.messages[0].content, /cannot be resumed/);
  host.runningSubagents.clear();
});

test('an open workspace without observable panes is still inspected for holders instead of refused', async () => {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'rex-holders-')));
  const provider = { listSurfaces: async () => [{ id: 'session:a/block:other', workspaceId: 'other' }], getProcessInfo: async () => { throw new Error('no pane to inspect'); } };
  const operations = createWorktreeCleanupOperations(provider, { manifestDir: checkout, liveHolders: () => [{ path: checkout, persistent: true }] });
  const inspection = await operations.holders({ path: checkout, workspaceId: 'closed-tab' });
  assert.ok(!inspection.blockers.some((value) => /observable panes/.test(value)), JSON.stringify(inspection));
  assert.ok(inspection.blockers.includes('Persistent-specialist lease holds the worktree'));
});
