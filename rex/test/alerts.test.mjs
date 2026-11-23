import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
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
  assert.deepEqual(sent, [{ title: 'fix-toast needs you', body: 'In platform. Save button. Open Rex to answer.', brief: 'fix-toast needs you in platform.', event: 'b1:0', tag: 'b1', url: '/', count: 1 }]);
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
  const entry = { key: 'b1', since: 5, tab: 'pltfrm-12', place: 'platform', record: { msg: 'Waiting for user', kind: 'question' } };
  assert.deepEqual(payloadFor(entry, 2), { title: 'pltfrm-12 needs you', body: 'In platform. Open Rex to answer.', brief: 'pltfrm-12 needs you in platform.', event: 'b1:5', tag: 'b1', url: '/', count: 2 });
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

test('waiting tabs from another machine alert with its name and leave when it stops listing them', async () => {
  let clock = 0;
  const sent = [];
  const watcher = new Watcher({ now: () => clock, quiet: 1000, labelOf: () => ({ tab: 'local', place: '' }), send: async (payload) => sent.push(payload) });
  watcher.remote([{ host: 'mac', key: 'b9', tab: 'pencil-export', place: 'design', message: 'Export 3x too?', kind: 'question' }]);
  clock = 2000;
  await watcher.tick();
  assert.deepEqual([sent[0].title, sent[0].body, sent[0].tag], ['pencil-export needs you', 'In design on mac. Export 3x too? Open Rex to answer.', 'mac:b9']);
  assert.equal(watcher.list()[0].place, 'design on mac');
  watcher.apply(changed('b1', 'rex-task', 'blocked', 'local one', 'question'));
  watcher.remote([]);
  assert.deepEqual(watcher.list().map((row) => row.tab), ['local']);
});

test('blocked tabs are summarized per tab for the link', async () => {
  const { blockedTabs } = await import('../src/alerts.mjs');
  const rows = blockedTabs([
    changed('b1', '', 'blocked', 'Pi dialog', 'question'), changed('b1', 'rex-task', 'blocked', 'Save button', 'question'),
    changed('b2', 'rex-task', 'working', 'bash'), changed('b3', 'rex-task', 'blocked', 'Needs coordinator help', 'question'),
  ], (_session, block) => ({ tab: block, place: 'p' }));
  assert.deepEqual(rows, [{ key: 'b1', tab: 'b1', place: 'p', message: 'Save button', kind: 'question' }]);
});

test('the tailnet port trusts only the owner login, the local port only .localhost names, and stop takes a whole pid and start', async (context) => {
  const { handler: make, loopbackName } = await import('../src/alerts.mjs');
  const stops = [];
  const tailnet = createServer(make({ login: 'me@example.com', root: mkdtempSync(join(tmpdir(), 'rex-alerts-')), machine: async () => ({ attention: [] }) }));
  await new Promise((resolve) => tailnet.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => tailnet.close(resolve)));
  const server = createServer(make({
    login: 'me@example.com', local: true, root: mkdtempSync(join(tmpdir(), 'rex-alerts-')),
    machine: async () => ({ attention: [{ pid: 7 }] }),
    stop: async (target) => { stops.push(target); if (target.pid === 8) throw new Error('That process ID now belongs to a different process; refresh and look again'); return { ok: true, text: 'Stopped vite (7).' }; },
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const call = (path, { host, body, login, port = server.address().port } = {}) => new Promise((resolve, reject) => {
    const headers = { 'x-rex-phone': '1' };
    if (host) headers.host = host;
    if (login) headers['tailscale-user-login'] = login;
    if (body) headers['content-type'] = 'application/json';
    const request = httpRequest({ host: '127.0.0.1', port, path, method: body ? 'POST' : 'GET', headers }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text }));
    });
    request.on('error', reject);
    request.end(body ? JSON.stringify(body) : undefined);
  });
  assert.deepEqual([loopbackName('tasks.localhost'), loopbackName('localhost:8787'), loopbackName('evil.com'), loopbackName('tasks.localhost.evil.com'), loopbackName(undefined)], [true, true, false, false, false]);
  assert.equal((await call('/api/machine', { host: 'evil.example' })).status, 403);
  assert.equal((await call('/api/machine', { host: '127.0.0.1:8787' })).status, 403);
  assert.deepEqual(JSON.parse((await call('/api/machine', { host: 'tasks.localhost' })).text), { attention: [{ pid: 7 }] });
  assert.equal((await call('/api/machine', { host: 'b1.example.ts.net', login: 'me@example.com' })).status, 403);
  const viaTailnet = { port: tailnet.address().port };
  assert.equal((await call('/api/machine', { ...viaTailnet, host: 'tasks.localhost' })).status, 403);
  assert.equal((await call('/api/machine', { ...viaTailnet, host: 'b1.example.ts.net', login: 'other@example.com' })).status, 403);
  assert.equal((await call('/api/machine', { ...viaTailnet, host: 'b1.example.ts.net', login: 'me@example.com' })).status, 200);
  for (const bad of [{ pid: '7', start: 1 }, { pid: 1, start: 1 }, { pid: 7.5, start: 1 }, { pid: 7 }]) {
    assert.equal((await call('/api/machine/stop', { host: 'tasks.localhost', body: bad })).status, 400, JSON.stringify(bad));
  }
  assert.deepEqual(stops, []);
  assert.deepEqual(JSON.parse((await call('/api/machine/stop', { host: 'tasks.localhost', body: { pid: 7, start: 12 } })).text), { ok: true, text: 'Stopped vite (7).' });
  const refused = await call('/api/machine/stop', { host: 'tasks.localhost', body: { pid: 8, start: 12 } });
  assert.deepEqual([refused.status, JSON.parse(refused.text).text], [400, 'That process ID now belongs to a different process; refresh and look again']);
  assert.deepEqual(stops, [{ pid: 7, start: 12 }, { pid: 8, start: 12 }]);
});

test('Hark gets names only, is withdrawn once the tab stops waiting, falls back to web push, and its URL comes only from 1Password', async () => {
  const { harkSender, harkWebhook } = await import('../src/alerts.mjs');
  const calls = [];
  const answers = [{ ok: true, eventId: 'evt_1', delivered: 1 }, { ok: true, eventId: 'evt_2', delivered: 0, message: 'No device' }];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const answer = url.endsWith('/withdraw') ? { ok: true } : answers.shift() ?? { ok: false, error: 'Unknown webhook' };
    return { ok: answer.ok, status: answer.ok ? 200 : 404, json: async () => answer };
  };
  const fallen = [];
  const hark = harkSender({ url: 'https://hark.fyi/hooks/whk_test', fetch, fallback: async (payload) => fallen.push(payload.tag), log: () => {} });
  let clock = 0;
  const watcher = new Watcher({ now: () => clock, quiet: 1000, labelOf: () => ({ tab: 'PLTFRM-3376', place: 'platform' }), send: hark.send, clear: hark.clear });
  watcher.apply(changed('b1', 'rex-task', 'blocked', 'Ship the secret plan to prod?', 'question'));
  clock = 2000;
  await watcher.tick();
  assert.deepEqual(calls[0].body, { body: 'PLTFRM-3376 needs you in platform.' });
  assert.equal(calls[0].headers['Idempotency-Key'], 'b1:0');
  assert.doesNotMatch(JSON.stringify(calls[0]), /secret plan/);
  watcher.apply({ session: 's', block: 'b1', removed: [] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[1].url, 'https://hark.fyi/hooks/whk_test/events/evt_1/withdraw');
  watcher.apply(changed('b2', 'rex-task', 'blocked', 'x', 'question'));
  watcher.apply(changed('b3', 'rex-task', 'blocked', 'y', 'question'));
  clock = 4000;
  await watcher.tick();
  assert.deepEqual(fallen, ['b2', 'b3']);
  const reads = [];
  const read = (url) => async (args) => { reads.push(args); return { stdout: `${url}\n` }; };
  assert.equal(await harkWebhook(undefined, read('x')), undefined);
  assert.equal(await harkWebhook('op://vault/Hark Rex alerts/credential', read('https://hark.fyi/hooks/whk_abc123def')), 'https://hark.fyi/hooks/whk_abc123def');
  assert.deepEqual(reads[0], ['read', '--no-newline', 'op://vault/Hark Rex alerts/credential']);
  await assert.rejects(harkWebhook('op://vault/item/credential', read('https://evil.example/hooks/whk_abc123def')), /does not hold a Hark webhook URL/);
  await assert.rejects(harkWebhook('/home/me/url.txt', read('x')), /op:\/\/ reference/);
});
