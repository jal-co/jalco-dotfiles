import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

process.env.REX_RUNS_DIR = mkdtempSync(join(tmpdir(), 'rex-runs-'));
process.env.SHELL = '/bin/sh';
const runs = await import('../src/runs.mjs');
const cli = join(dirname(fileURLToPath(import.meta.url)), '../src/runs.mjs');
const H = 3_600_000;

const freePort = () => new Promise((resolve) => { const server = createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const until = async (check, ms = 15_000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 100))) { const value = await check(); if (value) return value; } throw new Error('timed out'); };
const nav = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-user': '?1' };
const get = (port, headers, path = '/') => new Promise((resolve, reject) => request({ port, host: '127.0.0.1', path, headers }, (response) => { let body = ''; response.setEncoding('utf8').on('data', (chunk) => { body += chunk; }).on('end', () => resolve({ status: response.statusCode, body })); }).once('error', reject).end());
const serverCode = "require('http').createServer((q,s)=>s.end('app '+process.env.PORT)).listen(Number(process.env.PORT),'127.0.0.1')";

test('ports are parsed strictly', () => {
  assert.deepEqual(runs.parsePorts('3300, 3301,3300'), [3300, 3301]);
  assert.throws(() => runs.parsePorts('3300,x'));
  assert.throws(() => runs.parsePorts('70000'));
});

test('only new connections to a server count as use, so an open HMR socket does not keep it alive', () => {
  const output = '0 0 127.0.0.1:3300 127.0.0.1:50001\n0 0 [::1]:3301 [::1]:50002\n0 0 127.0.0.1:50003 127.0.0.1:3300\n';
  const first = runs.parsePeers(output, [3300, 3301]);
  assert.deepEqual([...first.get(3300)], ['127.0.0.1:50001']);
  assert.deepEqual([...first.get(3301)], ['[::1]:50002']);
  assert.equal(runs.freshUse(first, runs.parsePeers(output, [3300, 3301])), false);
  assert.equal(runs.freshUse(first, runs.parsePeers(`${output}0 0 127.0.0.1:3300 127.0.0.1:50009\n`, [3300, 3301])), true);
});

test('idle servers stop after the TTL, and low memory stops the least recently used one that is not in use now', () => {
  const now = 10 * H;
  const records = [
    { id: 'old', state: 'up', startedAt: 0, lastUse: now - runs.IDLE_MS - 1 },
    { id: 'quiet', state: 'up', startedAt: 0, lastUse: now - runs.RECENT_MS - 60_000 },
    { id: 'quieter', state: 'up', startedAt: 0, lastUse: now - runs.RECENT_MS - 120_000 },
    { id: 'busy', state: 'up', startedAt: 0, lastUse: now - 1000 },
    { id: 'down', state: 'stopped', startedAt: 0, lastUse: 0 },
  ];
  assert.deepEqual(runs.toStop(records, { now, memory: { total: 100, available: 50 } }), [{ id: 'old', reason: 'idle' }]);
  assert.deepEqual(runs.toStop(records, { now, memory: { total: 100, available: 10 } }), [{ id: 'old', reason: 'idle' }, { id: 'quieter', reason: 'memory' }]);
  assert.deepEqual(runs.toStop(records.filter((record) => record.id === 'busy'), { now, memory: { total: 100, available: 1 } }), []);
});

test('opening one app starts the apps in its folder that stopped with it', () => {
  const record = { id: 'ui', cwd: '/w', state: 'stopped', stopReason: 'idle', stoppedAt: 1000 };
  const others = [record, { id: 'api', cwd: '/w', state: 'stopped', stopReason: 'idle', stoppedAt: 2000 }, { id: 'old', cwd: '/w', state: 'stopped', stopReason: 'idle', stoppedAt: 1000 + 11 * 60_000 }, { id: 'manual', cwd: '/w', state: 'stopped', stopReason: 'manual', stoppedAt: 1000 }, { id: 'elsewhere', cwd: '/x', state: 'stopped', stopReason: 'idle', stoppedAt: 1000 }];
  assert.deepEqual(runs.startsWith(record, others).map((other) => other.id), ['api']);
});

test('only a page opened by a person starts a server; background requests and other hosts do not', () => {
  const nav = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  assert.equal(runs.wakeAction('GET', { ...nav, 'sec-fetch-user': '?1' }), 'start');
  assert.equal(runs.wakeAction('GET', nav), 'page');
  assert.equal(runs.wakeAction('GET', { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }), 'refuse');
  assert.equal(runs.wakeAction('GET', { ...nav, 'sec-fetch-dest': 'iframe' }), 'refuse');
  assert.equal(runs.wakeAction('GET', { ...nav, upgrade: 'websocket' }), 'refuse');
  assert.equal(runs.wakeAction('GET', {}), 'refuse');
  assert.equal(runs.wakeAction('HEAD', { ...nav, 'sec-fetch-user': '?1' }), 'refuse');
  for (const host of ['localhost:3300', '127.0.0.1:3300', 'studio.pltfrm-1.localhost', '[::1]:80']) assert.ok(runs.localHost(host), host);
  for (const host of ['evil.example', 'localhost.evil.example', '']) assert.ok(!runs.localHost(host), host);
});

test('stopping never signals a group that holds an agent or the service, and ignores a reused pid', () => {
  const list = [
    { pid: 10, pgid: 10, comm: 'node', start: 5 },
    { pid: 11, pgid: 10, comm: 'esbuild', start: 6 },
    { pid: 20, pgid: 20, comm: 'pi', start: 7 },
    { pid: 21, pgid: 20, comm: 'node', start: 8 },
    { pid: 30, pgid: 30, comm: 'node', start: 9 },
    { pid: 99, pgid: 99, comm: 'node', start: 1 },
  ];
  assert.deepEqual(runs.groupsToStop({ groups: [{ pid: 10, start: 5 }, { pid: 30, start: 1234 }], listeners: [21] }, list, 99), { groups: [10], singles: [21] });
  assert.deepEqual(runs.groupsToStop({ listeners: [99] }, list, 99), { groups: [], singles: [99] });
});

test('a stopped server is held by a waker, and opening its page starts it again', async (t) => {
  const port = await freePort();
  const id = `t-${port}`;
  const start = [process.execPath, cli, 'run', id, '--ports', String(port), '--', process.execPath, '-e', serverCode];
  const first = await runs.run({ id, ports: [port], command: [process.execPath, '-e', serverCode] });
  assert.equal(first.record.state, 'up');
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), `app ${port}`);
  runs.save({ ...runs.load(id), start });
  const lines = [];
  const supervisor = new runs.Supervisor({ log: (line) => lines.push(line) });
  t.after(async () => { for (const key of supervisor.wakers.keys()) await supervisor.closeWaker(key); await runs.stop(id, 'manual'); runs.forget(id); });

  await runs.stop(id, 'idle');
  assert.equal(runs.load(id).state, 'stopped');
  await supervisor.reconcile();
  assert.ok(supervisor.wakers.has(id));

  assert.equal((await get(port, { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }, '/api')).status, 503);
  assert.equal(runs.load(id).state, 'stopped');
  assert.equal((await get(port, { ...nav, host: 'evil.example' })).status, 421);
  assert.equal(runs.load(id).state, 'stopped');

  const opened = await get(port, nav);
  assert.equal(opened.status, 200);
  assert.match(opened.body, /is stopped/);
  await until(() => runs.load(id)?.state === 'up');
  assert.equal(await until(async () => { try { return await (await fetch(`http://127.0.0.1:${port}/`)).text(); } catch { return undefined; } }), `app ${port}`);
  assert.equal(supervisor.wakers.has(id), false);
  assert.ok(lines.some((line) => line.includes(`starting ${id}`)), lines.join('\n'));
});

test('a failed cold start reports why and the waker comes back', async (t) => {
  const port = await freePort();
  const id = `f-${port}`;
  runs.save({ id, cwd: tmpdir(), ports: [port], start: ['/bin/sh', '-c', 'echo boom; exit 7'], state: 'stopped', stopReason: 'idle', stoppedAt: Date.now(), startedAt: 0, lastUse: 0 });
  const supervisor = new runs.Supervisor({ log: () => {} });
  t.after(async () => { for (const key of supervisor.wakers.keys()) await supervisor.closeWaker(key); runs.forget(id); });
  await supervisor.reconcile();
  await supervisor.coldStart(id);
  const record = runs.load(id);
  assert.equal(record.state, 'failed');
  assert.match(record.error, /exited with 7/);
  assert.ok(supervisor.wakers.has(id));
  const status = await (await fetch(`http://127.0.0.1:${port}/_rex/status`)).json();
  assert.equal(status.state, 'failed');
  assert.match(status.log, /boom/);
});

test('release hands a stopped server\'s ports back so it can be started by hand', async (t) => {
  const port = await freePort();
  const id = `r-${port}`;
  runs.save({ id, cwd: tmpdir(), ports: [port], start: ['true'], state: 'stopped', stopReason: 'idle', stoppedAt: Date.now(), startedAt: 0, lastUse: 0 });
  const supervisor = new runs.Supervisor({ log: () => {} });
  t.after(async () => { for (const key of supervisor.wakers.keys()) await supervisor.closeWaker(key); runs.forget(id); });
  await supervisor.reconcile();
  const timer = setInterval(() => void supervisor.reconcile(), 100);
  t.after(() => clearInterval(timer));
  await runs.release(id);
  assert.equal(runs.load(id).state, 'released');
  assert.equal(supervisor.wakers.has(id), false);
  await new Promise((resolve, reject) => { const server = createServer().once('error', reject).listen(port, '127.0.0.1', () => server.close(resolve)); });
});
