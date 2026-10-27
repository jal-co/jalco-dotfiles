import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { patchPersistentCompletion } from './child-completion-fix.mjs';

const agent = join(homedir(), '.pi/agent');
const version = readFileSync(join(agent, 'install/current-version'), 'utf8').trim();
const { loadExtensions } = await import(pathToFileURL(join(agent, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js')).href);
const child = fileURLToPath(new URL('./host/maestro/adapters/pi/child/subagent-done.ts', import.meta.url));

async function fixture(context, { persistent = true, completed = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rex-child-completion-'));
  const session = join(root, 'child.jsonl');
  const values = { PI_SUBAGENT_PERSISTENT: persistent ? '1' : '0', PI_SUBAGENT_AUTO_EXIT: '0', PI_SUBAGENT_SESSION: session, PI_SUBAGENT_TASK_ID: 'task', PI_SUBAGENT_GENERATION_ID: 'generation', PI_SUBAGENT_ID: 'fixture', PI_SUBAGENT_ACTIVITY_FILE: join(root, 'activity.json') };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  if (completed) writeFileSync(`${session}.tasks`, `${JSON.stringify({ version: 1, type: 'task-done', task: 'task', generation: 'generation', at: new Date().toISOString() })}\n`);
  let extension;
  context.after(async () => {
    for (const handler of extension?.handlers.get('session_shutdown') ?? []) await handler({ reason: 'quit' });
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    for (const file of readdirSync(root)) unlinkSync(join(root, file));
    rmdirSync(root);
  });
  const loaded = await loadExtensions([child], root);
  assert.deepEqual(loaded.errors, []);
  extension = loaded.extensions[0];
  loaded.runtime.getAllTools = () => [];
  let shutdowns = 0;
  const ctx = { shutdown: () => shutdowns++, ui: { setWidget() {} }, sessionManager: { getBranch: () => [] } };
  const emit = async (event, payload = {}) => { for (const handler of extension.handlers.get(event) ?? []) await handler(payload, ctx); };
  await emit('session_start');
  const done = () => extension.tools.get('subagent_done').definition.execute('fixture', {}, undefined, undefined, ctx);
  return { session, emit, done, shutdowns: () => shutdowns, events: () => existsSync(`${session}.tasks`) ? readFileSync(`${session}.tasks`, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [] };
}

test('the compatibility fix is idempotent and rejects unknown or duplicated handlers', () => {
  const source = readFileSync(child, 'utf8');
  assert.equal(patchPersistentCompletion(source), source);
  assert.throws(() => patchPersistentCompletion('unknown handler'), /refusing to modify/);
  assert.throws(() => patchPersistentCompletion(source + source), /refusing to modify/);
});

test('persistent completion can be repeated without stopping or duplicate task events', async (context) => {
  const f = await fixture(context);
  await f.done(); await f.done();
  assert.equal(f.shutdowns(), 0);
  assert.equal(f.events().length, 1);
  assert.equal(existsSync(`${f.session}.exit`), false);
});

test('completion after agent_settled remains available', async (context) => {
  const f = await fixture(context);
  await f.emit('agent_settled'); await f.done();
  assert.equal(f.shutdowns(), 0);
  assert.equal(f.events().length, 1);
  assert.equal(existsSync(`${f.session}.exit`), false);
});

test('reload with an already-completed persistent task remains available', async (context) => {
  const f = await fixture(context, { completed: true });
  await f.done();
  assert.equal(f.shutdowns(), 0);
  assert.equal(f.events().length, 1);
  assert.equal(existsSync(`${f.session}.exit`), false);
});

test('ordinary agent completion still requests shutdown', async (context) => {
  const f = await fixture(context, { persistent: false });
  await f.done();
  assert.equal(f.shutdowns(), 1);
  assert.equal(JSON.parse(readFileSync(`${f.session}.exit`, 'utf8')).type, 'done');
});

test('explicit persistent stop still requests shutdown after repeated completion', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const f = await fixture(context);
  await f.done(); await f.done();
  assert.equal(f.shutdowns(), 0);
  writeFileSync(`${f.session}.task-inbox.000000000001.json`, JSON.stringify({ version: 1, type: 'stop', task: 'stop', message: '', at: new Date().toISOString() }));
  context.mock.timers.tick(1000);
  assert.equal(f.shutdowns(), 1);
  assert.equal(JSON.parse(readFileSync(`${f.session}.exit`, 'utf8')).type, 'done');
});
