import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseListeners, parseMeminfo, parseStat } from './machine.mjs';

export const IDLE_MS = Number(process.env.REX_RUN_IDLE_HOURS ?? 2) * 3_600_000;
export const MEMORY_MIN = 0.15;
export const RECENT_MS = 15 * 60_000;
const TOGETHER_MS = 10 * 60_000;
const RELEASED_MS = 15 * 60_000;
const START_TIMEOUT_MS = 10 * 60_000;
const PROTECTED = new Set(['pi', 'claude', 'codex', 'systemd', 'sshd', 'rex']);
const STATUS = '/_rex/status';
const START = '/_rex/start';
const LOGIN_REUSE_MS = 4 * 60_000;
const NO_LOGIN = 'rex-nologin';
const PRELOAD_WINDOW_MS = 20_000;
const PRELOAD_MAX = 1500;

export const runsDir = () => process.env.REX_RUNS_DIR ?? join(homedir(), '.local/state/rex-runs');
export const validId = (id) => /^[\w.-]{1,200}$/.test(String(id ?? ''));
const validName = (name) => /^[a-z0-9]([a-z0-9.-]{0,60}[a-z0-9])?$/.test(String(name ?? ''));
const recordFile = (id) => join(runsDir(), `${id}.json`);
export const logFile = (id) => join(runsDir(), `${id}.log`);
const tryRead = (file) => { try { return readFileSync(file, 'utf8'); } catch { return undefined; } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quote = (arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`);

export function load(id) {
  const text = tryRead(recordFile(id));
  return text ? JSON.parse(text) : undefined;
}

export function save(record) {
  mkdirSync(runsDir(), { recursive: true, mode: 0o700 });
  const temporary = `${recordFile(record.id)}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, recordFile(record.id));
  return record;
}

export function all() {
  if (!existsSync(runsDir())) return [];
  return readdirSync(runsDir()).filter((name) => name.endsWith('.json')).flatMap((name) => {
    try { return [JSON.parse(readFileSync(join(runsDir(), name), 'utf8'))]; } catch { return []; }
  });
}

export function forget(id) {
  rmSync(recordFile(id), { force: true });
}

export function logTail(id, lines = 40) {
  return (tryRead(logFile(id)) ?? '').trimEnd().split('\n').slice(-lines).join('\n');
}

export function parsePorts(value) {
  const ports = String(value ?? '').split(',').map((port) => Number(port.trim()));
  if (!ports.length || ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('--ports takes a comma-separated list, such as 3300,3301');
  return [...new Set(ports)];
}

export function parsePeers(output, ports) {
  const wanted = new Set(ports);
  const peers = new Map(ports.map((port) => [port, new Set()]));
  for (const line of output.split('\n')) {
    const [local, peer] = line.trim().split(/\s+/).filter((token) => /:\d+$/.test(token));
    const port = Number(local?.split(':').at(-1));
    if (peer && wanted.has(port)) peers.get(port).add(peer);
  }
  return peers;
}

export function freshUse(previous, current) {
  for (const [port, peers] of current) {
    for (const peer of peers) if (!previous.get(port)?.has(peer)) return true;
  }
  return false;
}

const lastUseOf = (record) => Math.max(record.lastUse ?? 0, record.startedAt ?? 0);

export function toStop(records, { now, memory }) {
  const up = records.filter((record) => record.state === 'up');
  const stops = up.filter((record) => now - lastUseOf(record) > IDLE_MS).map((record) => ({ id: record.id, reason: 'idle' }));
  if (memory && memory.available / memory.total < MEMORY_MIN) {
    const idle = new Set(stops.map((stop) => stop.id));
    const victim = up.filter((record) => !idle.has(record.id) && now - lastUseOf(record) > RECENT_MS).sort((a, b) => lastUseOf(a) - lastUseOf(b))[0];
    if (victim) stops.push({ id: victim.id, reason: 'memory' });
  }
  return stops;
}

export function startsWith(record, records) {
  return records.filter((other) => other.id !== record.id && other.cwd === record.cwd && ['stopped', 'failed'].includes(other.state)
    && ['idle', 'memory', 'exited'].includes(other.stopReason) && Math.abs((other.stoppedAt ?? 0) - (record.stoppedAt ?? 0)) < TOGETHER_MS);
}

export function wakeAction(method, headers) {
  if (headers.upgrade) return 'refuse';
  const mode = headers['sec-fetch-mode'];
  if (!mode) return 'refuse';
  if (method !== 'GET' || mode !== 'navigate' || headers['sec-fetch-dest'] !== 'document') return 'refuse';
  return headers['sec-fetch-user'] === '?1' ? 'start' : 'page';
}

export const localHost = (host = '') => /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9.-]+\.localhost)(:\d+)?$/i.test(host);

function statOf(pid) {
  const text = tryRead(`/proc/${pid}/stat`);
  if (!text) return undefined;
  const close = text.lastIndexOf(')');
  return { ...parseStat(text), pgid: Number(text.slice(close + 2).split(' ')[2]) };
}

export const processStart = (pid) => statOf(pid)?.start;

function processes() {
  return readdirSync('/proc').filter((name) => /^\d+$/.test(name)).flatMap((name) => {
    const stat = statOf(Number(name));
    return stat ? [{ pid: Number(name), ...stat }] : [];
  });
}

export function listening(ports) {
  const output = execFileSync('ss', ['-tlnpH'], { encoding: 'utf8' });
  const byPid = parseListeners(output);
  const open = new Set(output.split('\n').map((line) => Number(/^\S+\s+\d+\s+\d+\s+\S+:(\d+)\s/.exec(line)?.[1])));
  return { open: ports.filter((port) => open.has(port)), pids: [...byPid].filter(([, own]) => own.some((port) => ports.includes(port))).map(([pid]) => pid) };
}

export function groupsToStop(record, list = processes(), self = process.pid) {
  const byPid = new Map(list.map((entry) => [entry.pid, entry]));
  const leaders = (record.groups ?? []).filter((group) => byPid.get(group.pid)?.start === group.start).map((group) => group.pid);
  const listeners = record.listeners ?? [];
  const groups = new Set();
  const singles = new Set();
  const selfGroup = byPid.get(self)?.pgid;
  for (const pid of [...leaders, ...listeners]) {
    const entry = byPid.get(pid);
    if (!entry) continue;
    const members = list.filter((other) => other.pgid === entry.pgid);
    if (entry.pgid === selfGroup || entry.pgid <= 1 || members.some((member) => PROTECTED.has(member.comm))) singles.add(pid);
    else groups.add(entry.pgid);
  }
  return { groups: [...groups], singles: [...singles].filter((pid) => !groups.has(byPid.get(pid)?.pgid)) };
}

function signal(target, name) {
  try { process.kill(target, name); return true; } catch { return false; }
}

export async function stopProcesses(record) {
  const { pids } = listening(record.ports);
  const { groups, singles } = groupsToStop({ ...record, listeners: pids });
  for (const group of groups) signal(-group, 'SIGTERM');
  for (const pid of singles) signal(pid, 'SIGTERM');
  for (let waited = 0; waited < 10_000 && listening(record.ports).open.length; waited += 250) await sleep(250);
  for (const group of groups) signal(-group, 'SIGKILL');
  for (const pid of singles) signal(pid, 'SIGKILL');
}

function tcpUp(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(1000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function waitListening(ports, child, timeoutMs) {
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
    if (child && child.exitCode !== null) return `exited with code ${child.exitCode}`;
    if ((await Promise.all(ports.map(tcpUp))).every(Boolean)) return '';
    await sleep(500);
  }
  return `not listening after ${Math.round(timeoutMs / 1000)}s`;
}

export function register({ id, cwd, ports, start, pids = [], name, front, cookie, login }) {
  if (!validId(id)) throw new Error('the id takes letters, digits, dots, dashes and underscores');
  if (front !== undefined && (!Number.isInteger(front) || front < 1 || front > 65535 || ports.includes(front))) throw new Error('--front takes one port that is not in --ports');
  if ((cookie === undefined) !== (login === undefined) || (cookie !== undefined && (front === undefined || !/^[\w-]{1,64}$/.test(cookie)))) throw new Error('--cookie and --login go together, with --front');
  if (name !== undefined && !validName(name)) throw new Error('--name takes lowercase letters, digits, dots and dashes');
  if (!start?.length) throw new Error('give the command that starts it after --');
  const now = Date.now();
  return save({ id, name, cwd, ports, front, cookie, login, start, groups: pids.map((pid) => ({ pid, start: processStart(pid) })).filter((group) => group.start !== undefined), state: 'up', startedAt: now, lastUse: now });
}

function forwardToMac(ports, name) {
  if (process.platform !== 'linux' || !process.env.REX_SESSION || !name) return undefined;
  const result = spawnSync('rex-remote', ['forward', '--ports', ports.join(','), '--name', name], { encoding: 'utf8', timeout: 45_000 });
  return result.status === 0 ? `https://${name}.localhost` : undefined;
}

export async function run({ id, ports, name, command, cwd = process.cwd() }) {
  const existing = load(id);
  if (existing?.state === 'up' && (await waitListening(ports, undefined, 1000)) === '') return { record: existing, reused: true, url: forwardToMac(ports, name) };
  await release(id);
  const busy = (await Promise.all(ports.map(tcpUp))).some(Boolean);
  if (busy) throw new Error(`a port in ${ports.join(',')} is already in use`);
  mkdirSync(runsDir(), { recursive: true, mode: 0o700 });
  const log = openSync(logFile(id), 'w', 0o600);
  const child = spawn(command[0], command.slice(1), { cwd, detached: true, stdio: ['ignore', log, log], env: { ...process.env, PORT: String(ports[0]) } });
  closeSync(log);
  child.unref();
  const failure = await waitListening(ports, child, START_TIMEOUT_MS);
  if (failure) {
    signal(-child.pid, 'SIGTERM');
    throw new Error(`${id} did not start: ${failure}\n${logTail(id)}`);
  }
  const start = [join(homedir(), '.local/bin/rex-run'), 'run', id, '--ports', ports.join(','), ...(name ? ['--name', name] : []), '--', ...command];
  return { record: register({ id, cwd, ports, start, pids: [child.pid], name }), reused: false, url: forwardToMac(ports, name) };
}

export async function release(id) {
  const record = load(id);
  if (!record || record.state === 'up' || record.state === 'starting') return;
  save({ ...record, state: 'released', releasedAt: Date.now() });
  for (let waited = 0; waited < 10_000; waited += 250) {
    if (!(await Promise.all(record.ports.map(tcpUp))).some(Boolean)) return;
    await sleep(250);
  }
}

export async function stop(id, reason) {
  const record = load(id);
  if (!record) return undefined;
  await stopProcesses(record);
  return save({ ...load(id), state: 'stopped', stoppedAt: Date.now(), stopReason: reason, groups: [] });
}

function page(record, state) {
  const title = `${record.name ?? record.id} is stopped`;
  const why = { idle: 'it had no visits for a while', memory: 'b1 was low on memory', exited: 'it exited', manual: 'it was stopped' }[record.stopReason] ?? 'it is not running';
  const data = JSON.stringify({ status: STATUS, start: START, auto: state === 'start-visible' }).replaceAll('<', '\\u003c');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>
<style>body{font:15px/1.5 ui-sans-serif,system-ui;margin:2rem;max-width:56rem;color:#ddd;background:#111}pre{background:#000;padding:1rem;overflow:auto;max-height:60vh;font-size:12px}button{font:inherit;padding:.4rem 1rem}</style>
<h1 id="h"></h1><p id="p"></p><button id="b" hidden>Start again</button><pre id="log" hidden></pre>
<script>
const cfg=${data};const h=document.getElementById('h'),p=document.getElementById('p'),b=document.getElementById('b'),log=document.getElementById('log');
h.textContent=${JSON.stringify(title)};p.textContent=${JSON.stringify(`Stopped because ${why}. Starting it now.`)};
const start=()=>fetch(cfg.start,{method:'POST'}).catch(()=>{});
b.onclick=()=>{b.hidden=true;start();};
if(cfg.auto){if(document.visibilityState==='visible')start();else document.addEventListener('visibilitychange',()=>document.visibilityState==='visible'&&start(),{once:true});}
const since=Date.now();
async function poll(){try{const r=await fetch(cfg.status,{cache:'no-store'});const s=r.headers.get('x-rex-run')?await r.json():null;
if(!s){location.reload();return;}
if(s.state==='failed'){h.textContent=${JSON.stringify(`${record.name ?? record.id} did not start`)};p.textContent=s.error||'';b.hidden=false;}
if(s.log){log.hidden=false;log.textContent=s.log;}}catch{p.textContent='Starting, '+Math.round((Date.now()-since)/1000)+'s';}
setTimeout(poll,1000);}poll();
</script>`;
}

export function createWaker(id, { onStart }) {
  return createServer(wakerHandler(id, { onStart }));
}

function wakerHandler(id, { onStart }) {
  return (request, response) => {
    if (!localHost(request.headers.host)) { response.writeHead(421).end(); return; }
    const record = load(id);
    if (!record) { response.writeHead(404).end(); return; }
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === STATUS) {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-rex-run': '1' });
      response.end(JSON.stringify({ state: record.state, error: record.error, log: logTail(id, 30) }));
      return;
    }
    if (url.pathname === START && request.method === 'POST') {
      if (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') { response.writeHead(403).end(); return; }
      response.writeHead(202, { 'x-rex-run': '1' }).end();
      onStart(id);
      return;
    }
    const action = wakeAction(request.method, request.headers);
    if (action === 'refuse') {
      response.writeHead(503, { 'content-type': 'text/plain', 'retry-after': '5' }).end(`${id} is stopped. Open its page, or run: rex-run wake ${id}\n`);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page(record, action === 'start' ? 'starting' : 'start-visible'));
    if (action === 'start') onStart(id);
  };
}

export const cookieOf = (header = '', name) => header.split(';').map((part) => part.trim().split('=')).find(([key]) => key === name)?.slice(1).join('=') || undefined;
export const validCookieValue = (value) => /^[\w.~+/=%*-]{1,8192}$/.test(String(value ?? ''));

export function needsLogin(record, request) {
  if (!record.login || wakeAction(request.method, request.headers) === 'refuse') return false;
  return !cookieOf(request.headers.cookie, record.cookie) && !cookieOf(request.headers.cookie, NO_LOGIN);
}

const escapeAttribute = (text) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

export class Preloads {
  constructor(now = Date.now) {
    this.now = now;
    this.paths = new Set();
    this.since = -Infinity;
  }

  page() {
    this.since = this.now();
  }

  seen(request, status) {
    const url = request.url;
    if (request.method !== 'GET' || request.headers['sec-fetch-dest'] !== 'script' || !url.startsWith('/') || url.startsWith('//') || /[?&]t=\d/.test(url)) return;
    if (status >= 400) this.paths.delete(url);
    else if (this.now() - this.since <= PRELOAD_WINDOW_MS && this.paths.size < PRELOAD_MAX) this.paths.add(url);
  }

  inject(html) {
    if (!this.paths.size) return html;
    const links = Array.from(this.paths, (path) => `<link rel="modulepreload" href="${escapeAttribute(path)}">`).join('');
    return html.replace(/<head(\s[^>]*)?>/i, (tag) => `${tag}${links}`);
  }
}

function proxy(port, request, response, { inject, seen } = {}) {
  const headers = { ...request.headers };
  if (inject) for (const name of ['if-none-match', 'if-modified-since']) delete headers[name];
  const upstream = httpRequest({ host: '127.0.0.1', port, method: request.method, path: request.url, headers }, (reply) => {
    seen?.(reply.statusCode);
    const html = inject && /text\/html/.test(reply.headers['content-type'] ?? '') && !reply.headers['content-encoding'];
    if (!html) {
      response.writeHead(reply.statusCode, reply.rawHeaders);
      reply.pipe(response);
      return;
    }
    const chunks = [];
    reply.on('data', (chunk) => chunks.push(chunk));
    reply.on('end', () => {
      const body = Buffer.from(inject(Buffer.concat(chunks).toString('utf8')));
      const sent = { ...reply.headers, 'content-length': body.length, 'cache-control': 'no-cache' };
      delete sent.etag;
      delete sent['transfer-encoding'];
      response.writeHead(reply.statusCode, sent).end(body);
    });
  });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' }); response.end('the app did not answer\n'); });
  request.pipe(upstream);
}

function proxyUpgrade(port, request, socket, head) {
  const upstream = connect(port, '127.0.0.1', () => {
    const lines = [`${request.method} ${request.url} HTTP/1.1`];
    for (let index = 0; index < request.rawHeaders.length; index += 2) lines.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`);
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    upstream.pipe(socket).pipe(upstream);
  });
  const close = () => { upstream.destroy(); socket.destroy(); };
  upstream.on('error', close);
  socket.on('error', close);
}

export function createFront(id, { onStart, login, preloads = new Preloads() }) {
  const waker = wakerHandler(id, { onStart });
  const server = createServer(async (request, response) => {
    if (!localHost(request.headers.host)) { response.writeHead(421).end(); return; }
    const record = load(id);
    if (!record) { response.writeHead(404).end(); return; }
    if (record.state !== 'up') { waker(request, response); return; }
    const path = new URL(request.url, 'http://localhost').pathname;
    if (record.login && path === '/_rex/logout') {
      response.writeHead(302, { location: '/', 'set-cookie': [`${record.cookie}=; Path=/; Max-Age=0`, `${NO_LOGIN}=1; Path=/; Max-Age=31536000; SameSite=Lax`] }).end();
      return;
    }
    if (record.login && path === '/_rex/login') {
      response.writeHead(302, { location: '/', 'set-cookie': `${NO_LOGIN}=; Path=/; Max-Age=0` }).end();
      return;
    }
    if (needsLogin(record, request)) {
      const value = await login(record).catch(() => undefined);
      if (value) {
        response.writeHead(302, { location: request.url, 'cache-control': 'no-store', 'set-cookie': `${record.cookie}=${value}; Path=/; HttpOnly; SameSite=Lax` }).end();
        return;
      }
    }
    const page = request.method === 'GET' && request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document';
    if (page) preloads.page();
    proxy(record.ports[0], request, response, page ? { inject: (html) => preloads.inject(html) } : { seen: (status) => preloads.seen(request, status) });
  });
  server.on('upgrade', (request, socket, head) => {
    const record = load(id);
    if (!localHost(request.headers.host) || record?.state !== 'up') { socket.destroy(); return; }
    proxyUpgrade(record.ports[0], request, socket, head);
  });
  return server;
}

export class Supervisor {
  constructor({ now = Date.now, peers = () => execFileSync('ss', ['-tnH', 'state', 'established'], { encoding: 'utf8' }), memory = () => parseMeminfo(readFileSync('/proc/meminfo', 'utf8')), log = console.log } = {}) {
    Object.assign(this, { now, peers, memory, log });
    this.wakers = new Map();
    this.fronts = new Map();
    this.sessions = new Map();
    this.seen = new Map();
    this.starting = new Set();
  }

  sample() {
    const records = all().filter((record) => record.state === 'up');
    const ports = records.flatMap((record) => record.ports);
    if (!ports.length) return;
    const current = parsePeers(this.peers(), ports);
    for (const record of records) {
      const mine = new Map(record.ports.map((port) => [port, current.get(port)]));
      const latest = this.seen.has(record.id) && freshUse(this.seen.get(record.id), mine) && load(record.id);
      if (latest) save({ ...latest, lastUse: this.now() });
      this.seen.set(record.id, mine);
    }
  }

  async sweep() {
    const now = this.now();
    for (const record of all()) {
      if (!existsSync(record.cwd)) {
        if (record.state === 'up') await stopProcesses(record);
        this.closeWaker(record.id);
        forget(record.id);
        this.log(`forgot ${record.id}: ${record.cwd} is gone`);
        continue;
      }
      const open = listening(record.ports).open.length > 0;
      if (record.state === 'up' && !open) {
        if (record.missing) { save({ ...record, state: 'stopped', stoppedAt: now, stopReason: 'exited', missing: undefined }); this.log(`${record.id} exited`); }
        else save({ ...record, missing: true });
      } else if (record.state === 'up' && record.missing) save({ ...record, missing: undefined });
      if (record.state === 'released' && !open && now - (record.releasedAt ?? 0) > RELEASED_MS) save({ ...record, state: 'stopped', stoppedAt: now, stopReason: 'exited' });
    }
    for (const { id, reason } of toStop(all(), { now, memory: this.memory() })) {
      await stop(id, reason);
      this.log(`stopped ${id}: ${reason === 'idle' ? `no visits for ${IDLE_MS / 3_600_000} h` : `memory under ${MEMORY_MIN * 100}%`}`);
    }
  }

  async reconcile() {
    const records = all();
    await this.reconcileFronts(records);
    const wanted = new Set(records.filter((record) => ['stopped', 'failed'].includes(record.state) && !this.starting.has(record.id)).map((record) => record.id));
    for (const id of this.wakers.keys()) if (!wanted.has(id)) await this.closeWaker(id);
    for (const record of records.filter((entry) => wanted.has(entry.id) && !this.wakers.has(entry.id))) {
      const servers = [];
      for (const port of record.ports) {
        const server = createWaker(record.id, { onStart: (id) => void this.coldStart(id) });
        const bound = await new Promise((resolve) => {
          server.once('error', () => resolve(false));
          server.listen(port, '127.0.0.1', () => resolve(true));
        });
        if (bound) servers.push(server);
      }
      if (servers.length) this.wakers.set(record.id, servers);
    }
  }

  async reconcileFronts(records) {
    const wanted = new Map(records.filter((record) => record.front).map((record) => [record.id, record.front]));
    for (const [id, { port, server }] of this.fronts) {
      if (wanted.get(id) === port) continue;
      this.fronts.delete(id);
      server.closeAllConnections();
      server.close();
    }
    for (const [id, port] of wanted) {
      if (this.fronts.has(id)) continue;
      const server = createFront(id, { onStart: (target) => void this.coldStart(target), login: (record) => this.login(record) });
      const bound = await new Promise((resolve) => {
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => resolve(true));
      });
      if (bound) this.fronts.set(id, { port, server });
    }
  }

  login(record) {
    const cached = this.sessions.get(record.id);
    if (cached && this.now() - cached.at < LOGIN_REUSE_MS) return cached.value;
    const value = new Promise((resolve, reject) => {
      execFile(process.env.SHELL || '/bin/sh', ['-lc', record.login], { cwd: record.cwd, timeout: 60_000, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        const line = stdout.trim().split('\n').at(-1)?.trim();
        if (error || !validCookieValue(line)) {
          this.sessions.delete(record.id);
          this.log(`signing in to ${record.id} failed: ${(stderr || error?.message || 'no cookie printed').trim().split('\n').at(-1)}`);
          reject(new Error('login failed'));
        } else resolve(line);
      });
    });
    this.sessions.set(record.id, { at: this.now(), value });
    return value;
  }

  async closeWaker(id) {
    const servers = this.wakers.get(id) ?? [];
    this.wakers.delete(id);
    await Promise.all(servers.map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
  }

  async coldStart(id, { withOthers = true } = {}) {
    const record = load(id);
    if (!record || this.starting.has(id) || !['stopped', 'failed'].includes(record.state)) return;
    this.starting.add(id);
    const others = withOthers ? startsWith(record, all()) : [];
    try {
      await this.closeWaker(id);
      save({ ...record, state: 'starting', error: undefined });
      this.log(`starting ${id} in ${record.cwd}: ${withOthers ? 'its URL was opened' : 'with another app in its folder'}`);
      for (const other of others) void this.coldStart(other.id, { withOthers: false });
      const shell = process.env.SHELL || '/bin/sh';
      const log = openSync(logFile(id), 'a', 0o600);
      const child = spawn(shell, ['-lc', record.start.map(quote).join(' ')], { cwd: record.cwd, detached: true, stdio: ['ignore', log, log], env: { HOME: homedir(), USER: process.env.USER, LOGNAME: process.env.LOGNAME, SHELL: shell, PATH: process.env.PATH, LANG: process.env.LANG ?? 'C.UTF-8', REX_RUNS_DIR: runsDir() } });
      closeSync(log);
      const code = await new Promise((resolve) => {
        const timer = setTimeout(() => { signal(-child.pid, 'SIGTERM'); resolve('timeout'); }, START_TIMEOUT_MS);
        child.once('exit', (exit) => { clearTimeout(timer); resolve(exit); });
        child.once('error', () => { clearTimeout(timer); resolve('error'); });
      });
      const after = load(id);
      if (code === 0 && after?.state === 'up') this.log(`${id} is up again`);
      else if (after) {
        save({ ...after, state: 'failed', error: code === 'timeout' ? `not ready after ${START_TIMEOUT_MS / 60_000} min` : `the start command exited with ${code}`, stoppedAt: this.now() });
        this.log(`${id} did not start (${code})`);
      }
    } finally {
      this.starting.delete(id);
      await this.reconcile();
    }
  }

  async serve() {
    const loop = (ms, task) => { const tick = async () => { try { await task(); } catch (error) { this.log(`rex-runs: ${error.message}`); } setTimeout(tick, ms); }; void tick(); };
    loop(1000, () => this.reconcile());
    loop(5000, () => this.sample());
    loop(60_000, () => this.sweep());
  }
}

async function wake(id) {
  const record = load(id);
  if (!record) throw new Error(`no run named ${id}`);
  if (record.state === 'up') return `${id} is already up`;
  const response = await fetch(`http://127.0.0.1:${record.ports[0]}${START}`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }).catch(() => undefined);
  if (response?.headers.get('x-rex-run') !== '1') throw new Error(`${id} has no waker on ${record.ports[0]}; is rex-runs running? (systemctl --user status rex-runs)`);
  for (const deadline = Date.now() + START_TIMEOUT_MS; Date.now() < deadline; await sleep(1000)) {
    const state = load(id)?.state;
    if (state === 'up') return `${id} is up`;
    if (state === 'failed') throw new Error(`${id} did not start: ${load(id).error}\n${logTail(id)}`);
  }
  throw new Error(`${id} is still starting`);
}

function list(json) {
  const records = all();
  if (json) return JSON.stringify(records, null, 2);
  if (!records.length) return 'nothing registered';
  const now = Date.now();
  return records.map((record) => [record.id, record.state + (record.stopReason && record.state !== 'up' ? ` (${record.stopReason})` : ''), record.ports.join(','), `${Math.round((now - lastUseOf(record)) / 60_000)} min since use`, record.cwd].join('\t')).join('\n');
}

const USAGE = `Usage: rex-run <command>

  run <id> --ports P[,P] [--name N] -- <command>   Start a dev server in the background, wait until it listens, and register it.
                                                   With --name and a Rex tab, it also opens on the Mac as https://N.localhost
  watch <id> --ports P[,P] [--pids A,B] -- <command>
  [--front P [--cookie NAME --login CMD]]          Register a server that is already running; <command> starts it again.
                                                   --front: a port that proxies to the first port while it is up and wakes it
                                                   while it is stopped. --login: a command printing a session cookie value,
                                                   set as NAME on page loads that lack it (/_rex/logout turns that off)
  release <id>      Hand a stopped server's ports back before starting it by hand (mdev up does this)
  wake <id>         Start a stopped server now, as opening its page would
  stop <id>         Stop it; opening its URL starts it again
  forget <id>       Stop tracking it (it keeps running if it is up)
  ls [--json]       Every registered server
  serve             The service: stops servers after ${IDLE_MS / 3_600_000} h without visits or when memory is under ${MEMORY_MIN * 100}%,
                    and starts them again when their URL is opened`;

async function main(argv) {
  const split = argv.indexOf('--');
  const head = split < 0 ? argv : argv.slice(0, split);
  const command = split < 0 ? [] : argv.slice(split + 1);
  const { values, positionals } = parseArgs({ args: head, allowPositionals: true, options: { ports: { type: 'string' }, name: { type: 'string' }, pids: { type: 'string' }, front: { type: 'string' }, cookie: { type: 'string' }, login: { type: 'string' }, json: { type: 'boolean' } } });
  const [verb, id] = positionals;
  if (verb === 'serve') return new Supervisor().serve();
  if (verb === 'ls') return console.log(list(values.json));
  if (!verb || verb === 'help' || !validId(id)) return console.log(USAGE);
  if (verb === 'run') {
    const result = await run({ id, ports: parsePorts(values.ports), name: values.name, command });
    console.log(`${id} ${result.reused ? 'already running' : 'is up'} on ${result.record.ports.map((port) => `http://localhost:${port}`).join(', ')}${result.url ? `\nopen on the Mac: ${result.url}` : ''}`);
    return;
  }
  if (verb === 'watch') {
    register({ id, cwd: process.cwd(), ports: parsePorts(values.ports), start: command, name: values.name, front: values.front === undefined ? undefined : Number(values.front), cookie: values.cookie, login: values.login, pids: values.pids ? values.pids.split(',').map(Number).filter(Number.isInteger) : [] });
    return;
  }
  if (verb === 'release') return release(id);
  if (verb === 'wake') return console.log(await wake(id));
  if (verb === 'stop') return console.log((await stop(id, 'manual')) ? `stopped ${id}; its URL starts it again` : `no run named ${id}`);
  if (verb === 'forget') return forget(id);
  console.log(USAGE);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
