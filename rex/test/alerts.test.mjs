import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Watcher, handler, labeler, payloadFor, scan, statusChange } from '../src/alerts.mjs';

const event = (block, name, payload) => ({ type: 'session_event', payload: { session_id: 's1', event: { type: 'block_event', payload: { block_id: block, creator_name: 'com.superlogical.terminal', name, payload } } } });
const changed = (block, id, state, msg, kind) => statusChange(event(block, 'program_status_changed', { id, record: { id, state, msg, kind, app: 'pi' } }));

test('status events become changes and other events are ignored', () => {
  assert.deepEqual(changed('b1', 'rex-task', 'blocked', 'Save button', 'question'), { session: 's1', block: 'b1', id: 'rex-task', record: { id: 'rex-task', state: 'blocked', msg: 'Save button', kind: 'question', app: 'pi' } });
  assert.deepEqual(statusChange(event('b1', 'program_status_removed', { ids: ['rex-task'] })), { session: 's1', block: 'b1', removed: ['rex-task'] });
  assert.equal(statusChange(event('b1', 'child_exited', {})), undefined);
  assert.equal(statusChange({ type: 'session_created', payload: {} }), undefined);
});

test('a tab alerts once after the quiet period, not when answered quickly, and again after it unblocks', async () => {
  let clock = 0;
  const sent = [];
  const watcher = new Watcher({ now: () => clock, quiet: 20_000, labelOf: () => ({ tab: 'fix-toast', place: 'platform' }), send: async (payload) => sent.push(payload) });
  watcher.apply(changed('b1', '', 'blocked', 'Waiting', 'question'));
  watcher.apply(changed('b1', 'rex-task', 'blocked', 'Save button', 'question'));
  clock = 10_000;
  await watcher.tick();
  assert.equal(sent.length, 0);
  clock = 21_000;
  await watcher.tick();
  await watcher.tick();
  assert.deepEqual(sent, [{ title: 'fix-toast needs you', body: 'In platform. Save button. Open Rex to answer.', tag: 'b1', url: '/', count: 1 }]);
  watcher.apply(changed('b2', 'rex-task', 'blocked', 'Pick one', 'question'));
  clock = 25_000;
  watcher.apply(changed('b2', 'rex-task', 'working', 'bash'));
  clock = 60_000;
  await watcher.tick();
  assert.equal(sent.length, 1);
  watcher.apply(changed('b1', 'rex-task', 'working', 'bash'));
  watcher.apply(changed('b1', '', 'idle', ''));
  assert.deepEqual(watcher.list(), []);
  watcher.apply(changed('b1', 'rex-task', 'blocked', 'Git push — Auto Permissions needs approval', 'question'));
  clock = 90_000;
  await watcher.tick();
  assert.equal(sent.at(-1).title, 'fix-toast wants approval');
});

test('coordinator help requests and removed records never alert', async () => {
  let clock = 0;
  const sent = [];
  const watcher = new Watcher({ now: () => clock, quiet: 1000, labelOf: () => ({ tab: 't', place: '' }), send: async (payload) => sent.push(payload) });
  watcher.apply(changed('b1', 'rex-task', 'blocked', 'Needs coordinator help', 'question'));
  watcher.apply(changed('b2', 'rex-task', 'blocked', 'Waiting for user', 'question'));
  watcher.apply(statusChange(event('b2', 'program_status_removed', { ids: [] })));
  clock = 5000;
  await watcher.tick();
  assert.deepEqual(sent, []);
});

test('a rescan keeps waiting tabs, drops closed ones and adds ones blocked while disconnected', () => {
  let clock = 0;
  const watcher = new Watcher({ now: () => clock, quiet: 1000, labelOf: (_s, block) => ({ tab: block, place: '' }), send: async () => {} });
  watcher.apply(changed('b1', 'rex-task', 'blocked', 'one', 'question'));
  watcher.apply(changed('b2', 'rex-task', 'blocked', 'two', 'question'));
  clock = 500;
  watcher.reset([changed('b1', 'rex-task', 'blocked', 'one', 'question'), changed('b3', 'rex-task', 'blocked', 'three', 'permission')]);
  assert.deepEqual(watcher.list().map((row) => [row.tab, row.since]), [['b1', 0], ['b3', 500]]);
});

test('payloads say who and where, and skip the generic wait text', () => {
  const entry = { key: 'b1', tab: 'pltfrm-12', place: 'platform', record: { msg: 'Waiting for user', kind: 'question' } };
  assert.deepEqual(payloadFor(entry, 2), { title: 'pltfrm-12 needs you', body: 'In platform. Open Rex to answer.', tag: 'b1', url: '/', count: 2 });
  assert.equal(payloadFor({ ...entry, record: { msg: 'x', kind: 'permission' } }, 1).title, 'pltfrm-12 wants approval');
});

test('the scan reads every terminal block of every session and labels tabs by window and session', () => {
  const calls = [];
  const json = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'ls') return { sessions: [{ session_id: 's1', label: 'platform' }] };
    if (args[0] === 'session') return { windows: [{ label: 'fix-toast', layers: [{ blocks: [{ block_id: 'b1', creator_name: 'com.superlogical.terminal' }, { block_id: 'x', creator_name: 'other' }] }] }] };
    return { records: [{ id: 'rex-task', state: 'blocked', msg: 'Q' }] };
  };
  assert.deepEqual(scan(json), [{ session: 's1', block: 'b1', id: 'rex-task', record: { id: 'rex-task', state: 'blocked', msg: 'Q' } }]);
  assert.equal(calls.filter((call) => call.startsWith('block')).length, 1);
  const label = labeler((session) => json(['session', 'inspect', session]), () => json(['ls']).sessions);
  assert.deepEqual(label('s1', 'b1'), { tab: 'fix-toast', place: 'platform' });
  assert.deepEqual(label('s1', 'missing'), { tab: 'A Rex tab', place: 'platform' });
});

test('the page only answers the owning tailnet login and stores subscriptions', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'rex-alerts-'));
  const pushed = [];
  const server = createServer(handler({ login: 'me@example.com', root, waiting: () => [{ tab: 'fix' }], push: async (payload) => { pushed.push(payload); return [201]; } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { login = 'me@example.com', api = true, body } = {}) => {
    const headers = new Headers();
    if (login) headers.set('tailscale-user-login', login);
    if (api) headers.set('x-rex-phone', '1');
    if (body) headers.set('content-type', 'application/json');
    return fetch(base + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  };
  assert.equal((await call('/', { login: 'other@example.com' })).status, 403);
  assert.equal((await call('/')).status, 200);
  assert.equal((await call('/api/waiting', { api: false })).status, 400);
  assert.deepEqual((await (await call('/api/waiting')).json()).waiting, [{ tab: 'fix' }]);
  const { publicKey } = await (await call('/api/push')).json();
  assert.match(publicKey, /^[\w-]{87}$/);
  const p256dh = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
  const key = Buffer.concat([Buffer.from([4]), Buffer.from(p256dh.x, 'base64url'), Buffer.from(p256dh.y, 'base64url')]).toString('base64url');
  assert.equal((await call('/api/push', { body: { subscription: { endpoint: 'http://push.example/a', keys: { p256dh: key, auth: 'AAAAAAAAAAAAAAAAAAAAAA' } } } })).status, 400);
  assert.deepEqual(await (await call('/api/push', { body: { subscription: { endpoint: 'https://push.example/a', keys: { p256dh: key, auth: 'AAAAAAAAAAAAAAAAAAAAAA' } } } })).json(), { ok: true, devices: 1 });
  const tested = await (await call('/api/push/test', { body: {} })).json();
  assert.equal(tested.ok, true);
  assert.equal(pushed[0].title, 'Test alert from b1');
  await call('/api/push/seen', { body: { tag: tested.tag, stage: 'shown' } });
  assert.equal((await (await call('/api/push/seen')).json()).stage, 'shown');
});
