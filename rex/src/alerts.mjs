import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { rexBinary } from './provider.ts';
import { generateVapidKeys, sendPush } from './webpush.mjs';
import { remoteWaiting } from './hosts.ts';

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'alerts');
export const alertsRoot = () => process.env.REX_ALERTS_ROOT ?? join(homedir(), '.rex', 'phone');
const QUIET_MS = 20_000;
const NOT_FOR_JUSTIN = new Set(['Needs coordinator help']);
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icon-180.png': ['icon-180.png', 'image/png'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
};

const clean = (value, limit = 200) => String(value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const read = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; } };
function write(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  renameSync(temporary, file);
}

export function statusChange(event) {
  const block = event?.payload?.event?.payload;
  if (event?.type !== 'session_event' || event.payload.event?.type !== 'block_event' || !block) return undefined;
  const session = event.payload.session_id;
  if (block.name === 'program_status_changed') return { session, block: block.block_id, id: block.payload?.id ?? '', record: block.payload?.record };
  if (block.name === 'program_status_removed') return { session, block: block.block_id, removed: block.payload?.ids ?? [] };
  return undefined;
}

export function payloadFor(entry, open) {
  const { tab, place, record } = entry;
  const permission = record.kind === 'permission' || /needs approval/i.test(record.msg ?? '');
  const message = clean(record.msg, 120);
  const what = message && message !== 'Waiting for user' ? (/[.?!]$/.test(message) ? message : `${message}.`) : '';
  return {
    title: permission ? `${tab} wants approval` : `${tab} needs you`,
    body: [place && `In ${place}.`, what, 'Open Rex to answer.'].filter(Boolean).join(' '),
    tag: entry.key, url: '/', count: open,
  };
}

const waitingRecord = (records) => {
  const blocked = records.filter((record) => record?.state === 'blocked' && !NOT_FOR_JUSTIN.has(record.msg));
  return blocked.find((entry) => entry.id === 'rex-task') ?? blocked[0];
};

export function blockedTabs(changes, labelOf) {
  const byBlock = new Map();
  for (const change of changes) {
    if (!byBlock.has(change.block)) byBlock.set(change.block, { session: change.session, records: [] });
    byBlock.get(change.block).records.push(change.record);
  }
  return [...byBlock].flatMap(([block, tab]) => {
    const record = waitingRecord(tab.records);
    return record ? [{ key: block, ...labelOf(tab.session, block), message: clean(record.msg, 300), kind: record.kind }] : [];
  });
}

export class Watcher {
  constructor({ send, labelOf, now = Date.now, quiet = QUIET_MS }) {
    Object.assign(this, { send, labelOf, now, quiet });
    this.tabs = new Map();
    this.waiting = new Map();
    this.alerted = new Set();
  }

  reset(changes) {
    const seen = new Set(changes.map((change) => change.block));
    for (const block of this.tabs.keys()) if (!seen.has(block)) { this.tabs.delete(block); this.refresh(block); }
    for (const block of seen) this.tabs.set(block, { session: changes.find((change) => change.block === block).session, records: new Map() });
    for (const change of changes) this.apply(change, false);
    for (const block of seen) this.refresh(block);
  }

  apply(change, refresh = true) {
    if (!change) return;
    const tab = this.tabs.get(change.block) ?? { session: change.session, records: new Map() };
    this.tabs.set(change.block, tab);
    if (change.removed) {
      if (change.removed.length) for (const id of change.removed) tab.records.delete(id);
      else tab.records.clear();
    } else {
      tab.records.set(change.id, change.record);
    }
    if (refresh) this.refresh(change.block);
  }

  refresh(block) {
    const tab = this.tabs.get(block);
    const record = waitingRecord([...(tab?.records.values() ?? [])]);
    if (!record) {
      this.waiting.delete(block);
      this.alerted.delete(block);
      return;
    }
    const current = this.waiting.get(block);
    this.waiting.set(block, { key: block, session: tab.session, block, record, since: current?.since ?? this.now() });
  }

  remote(entries) {
    const keys = new Set(entries.map((entry) => `${entry.host}:${entry.key}`));
    for (const key of this.waiting.keys()) if (this.waiting.get(key).labels && !keys.has(key)) { this.waiting.delete(key); this.alerted.delete(key); }
    for (const entry of entries) {
      const key = `${entry.host}:${entry.key}`;
      const labels = { tab: entry.tab, place: entry.place ? `${entry.place} on ${entry.host}` : `${entry.host}` };
      this.waiting.set(key, { key, labels, record: { msg: entry.message, kind: entry.kind }, since: this.waiting.get(key)?.since ?? this.now() });
    }
  }

  labelsOf(entry) {
    return entry.labels ?? this.labelOf(entry.session, entry.block);
  }

  async tick() {
    for (const entry of this.waiting.values()) {
      if (this.alerted.has(entry.key) || this.now() - entry.since < this.quiet) continue;
      this.alerted.add(entry.key);
      await this.send(payloadFor({ ...entry, ...this.labelsOf(entry) }, this.waiting.size));
    }
  }

  list() {
    return [...this.waiting.values()].map((entry) => ({ ...this.labelsOf(entry), message: clean(entry.record.msg, 300), kind: entry.record.kind, app: entry.record.effective_app ?? entry.record.app, since: entry.since }))
      .sort((a, b) => a.since - b.since);
  }
}

const rexJson = (args) => JSON.parse(execFileSync(rexBinary(), ['--autostart=false', ...args], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }));

export function labeler(inspect = (session) => rexJson(['session', 'inspect', session, '--json']), list = () => rexJson(['ls', '--json']).sessions, now = Date.now) {
  const cache = new Map();
  return (session, block) => {
    let entry = cache.get(session);
    if (!entry || now() - entry.at > 60_000) {
      try { entry = { at: now(), view: inspect(session), label: list().find((row) => row.session_id === session)?.label }; } catch { entry = { at: now() }; }
      cache.set(session, entry);
    }
    const window = (entry.view?.windows ?? []).find((row) => row.layers?.some((layer) => layer.blocks?.some((item) => item.block_id === block)));
    return { tab: clean(window?.label, 60) || 'A Rex tab', place: clean(entry.label, 60) };
  };
}

export function vapidKeys(root = alertsRoot()) {
  const file = join(root, 'vapid.json');
  const existing = read(file);
  if (existing?.publicKey) return existing;
  const keys = generateVapidKeys();
  write(file, keys);
  return keys;
}

export function saveSubscription(subscription, root = alertsRoot()) {
  const endpoint = new URL(String(subscription?.endpoint ?? ''));
  if (endpoint.protocol !== 'https:') throw new Error('Push endpoints must use https');
  const { p256dh, auth } = subscription.keys ?? {};
  if (!/^[\w-]{80,100}$/.test(String(p256dh)) || !/^[\w-]{16,24}$/.test(String(auth))) throw new Error('Subscription keys are malformed');
  const file = join(root, 'subscriptions.json');
  const rows = (read(file)?.subscriptions ?? []).filter((row) => row.endpoint !== endpoint.href);
  write(file, { subscriptions: [...rows, { endpoint: endpoint.href, keys: { p256dh, auth }, createdAt: Date.now() }].slice(-10) });
  return rows.length + 1;
}

export async function pushAll(payload, { root = alertsRoot(), subject, send = sendPush } = {}) {
  const subscriptions = read(join(root, 'subscriptions.json'))?.subscriptions ?? [];
  const gone = new Set();
  const results = [];
  for (const subscription of subscriptions) {
    try {
      const result = await send(subscription, payload, vapidKeys(root), { subject });
      results.push(result.status);
      if (result.gone) gone.add(subscription.endpoint);
    } catch (error) {
      results.push(clean(error.message));
    }
  }
  if (gone.size) write(join(root, 'subscriptions.json'), { subscriptions: subscriptions.filter((row) => !gone.has(row.endpoint)) });
  return results;
}

export function ownerLogin() {
  const status = JSON.parse(execFileSync('tailscale', ['status', '--self', '--json'], { encoding: 'utf8', timeout: 10_000 }));
  const login = status.User?.[status.Self?.UserID]?.LoginName;
  if (!login) throw new Error('Could not read the Tailscale login that owns this machine');
  return login;
}

const MAX_BODY = 16 * 1024;
const readBody = (request) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  request.on('data', (chunk) => { size += chunk.length; if (size <= MAX_BODY) chunks.push(chunk); });
  request.on('end', () => {
    if (size > MAX_BODY) return reject(new Error('Request too large'));
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Body is not JSON')); }
  });
  request.on('error', reject);
});

function send(response, status, body, type) {
  response.writeHead(status, {
    'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  });
  response.end(body);
}
const json = (response, status, value) => send(response, status, JSON.stringify(value), 'application/json');

export function handler({ login, dev = false, root = alertsRoot(), waiting = () => [], push = (payload) => pushAll(payload, { root }) }) {
  return async (request, response) => {
    try {
      const url = new URL(request.url, 'http://alerts.local');
      if (!dev && request.headers['tailscale-user-login'] !== login) return send(response, 403, 'Open this from your own tailnet login.', 'text/plain; charset=utf-8');
      if (request.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        return send(response, 200, readFileSync(join(assets, file)), type);
      }
      if (!url.pathname.startsWith('/api/')) return send(response, 404, 'Not found', 'text/plain; charset=utf-8');
      if (request.headers['x-rex-phone'] !== '1') return json(response, 400, { ok: false, text: 'Missing request header' });
      if (request.method === 'GET' && url.pathname === '/api/waiting') return json(response, 200, { waiting: waiting(), at: Date.now() });
      if (request.method === 'GET' && url.pathname === '/api/push') return json(response, 200, { publicKey: vapidKeys(root).publicKey });
      if (request.method === 'GET' && url.pathname === '/api/push/seen') return json(response, 200, read(join(root, 'last-push.json')) ?? {});
      if (request.method !== 'POST') return json(response, 405, { ok: false, text: 'Method not allowed' });
      const body = await readBody(request);
      if (url.pathname === '/api/push') return json(response, 200, { ok: true, devices: saveSubscription(body.subscription, root) });
      if (url.pathname === '/api/push/seen') {
        write(join(root, 'last-push.json'), { tag: clean(body.tag, 120), stage: clean(body.stage, 20), problem: clean(body.problem, 300), at: Date.now() });
        return json(response, 200, { ok: true });
      }
      if (url.pathname === '/api/push/test') {
        const tag = `test-${Date.now()}`;
        const results = await push({ title: 'Test alert from b1', body: 'Alerts work.', tag, url: '/', count: 0 });
        if (!results.length) return json(response, 200, { ok: false, text: 'No phone has turned on alerts yet.' });
        return json(response, 200, { ok: results.includes(201), tag, text: `Apple answered ${results.join(', ')}.` });
      }
      return json(response, 404, { ok: false, text: 'Not found' });
    } catch (error) {
      return json(response, 400, { ok: false, text: clean(error.message, 300) });
    }
  };
}

export function scan(json = rexJson) {
  const changes = [];
  for (const { session_id: session } of json(['ls', '--json']).sessions ?? []) {
    const view = json(['session', 'inspect', session, '--json']);
    for (const window of view.windows ?? []) for (const layer of window.layers ?? []) for (const block of layer.blocks ?? []) {
      if (block.creator_name !== 'com.superlogical.terminal') continue;
      let records = [];
      try { records = json(['block', 'call', '-s', session, '-b', block.block_id, 'program_status']).records ?? []; } catch {}
      for (const record of records) changes.push({ session, block: block.block_id, id: record.id ?? '', record });
    }
  }
  return changes;
}

function follow(watcher, log) {
  let wait = 1000;
  const start = () => {
    try { watcher.reset(scan()); } catch (error) { log(`scan failed: ${error.message}`); }
    const child = spawn(rexBinary(), ['--autostart=false', 'events', '--all', '--json'], { stdio: ['ignore', 'pipe', 'inherit'] });
    createInterface({ input: child.stdout }).on('line', (line) => {
      wait = 1000;
      try { watcher.apply(statusChange(JSON.parse(line))); } catch {}
    });
    child.on('close', () => {
      log(`rex events stopped; retrying in ${wait / 1000}s`);
      setTimeout(start, wait);
      wait = Math.min(wait * 2, 60_000);
    });
  };
  start();
}

async function main(argv) {
  const { values } = parseArgs({ args: argv, options: { port: { type: 'string', default: '8787' }, dev: { type: 'boolean', default: false } } });
  const root = alertsRoot();
  const login = values.dev ? undefined : ownerLogin();
  const subject = `mailto:${login ?? 'nobody@example.com'}`;
  const watcher = new Watcher({
    labelOf: labeler(),
    send: (payload) => (values.dev ? console.log('would push', payload) : pushAll(payload, { root, subject })),
  });
  follow(watcher, console.error);
  setInterval(() => {
    try { watcher.remote(remoteWaiting()); } catch (error) { console.error(`remote tabs unreadable: ${error.message}`); }
    watcher.tick().catch((error) => console.error(`push failed: ${error.message}`));
  }, 2000).unref();
  createServer(handler({ login, dev: values.dev, root, waiting: () => watcher.list(), push: (payload) => pushAll(payload, { root, subject }) }))
    .listen(Number(values.port), '127.0.0.1', () => console.log(`Rex alerts on http://127.0.0.1:${values.port}${login ? ` for ${login}` : ' (dev)'}`));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => { console.error(`rex alerts: ${error.message}`); process.exitCode = 1; });
}
