import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanText, probeProcess } from './tasks.ts';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const hostsRoot = () => process.env.REX_HOSTS_ROOT ?? join(homedir(), '.rex', 'hosts');
export const linkRoot = () => process.env.REX_LINK_ROOT ?? join(homedir(), '.rex', 'link');
export const outboxRoot = () => join(linkRoot(), 'outbox');
const LINK_STALE_MS = 30_000;
export const COMMAND_ACTIONS = ['status', 'tasks', 'launch', 'send', 'stop', 'resume', 'stash'];
export const shortHost = (name = hostname()) => name.toLowerCase().split('.')[0];
const hostName = /^[a-z0-9][a-z0-9-]{0,40}$/;
const fileId = /^[\w-]{1,80}$/;

export const loadHosts = (file = process.env.REX_HOSTS_CONFIG ?? join(packageRoot, 'config/hosts.json')) => JSON.parse(readFileSync(file, 'utf8'));

export function selfName(config, name = process.env.REX_HOST_NAME ?? shortHost()) {
  const short = name.toLowerCase().split('.')[0];
  return Object.keys(config.hosts).find((key) => key === short || config.hosts[key].hostname === short);
}

export const brainName = (config) => config.order[0];

export function writeJson(file, value, flag = 'w') {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  if (flag === 'wx') return writeFileSync(file, JSON.stringify(value), { mode: 0o600, flag });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
}

export const readJson = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
};

const hostDir = (host, root = hostsRoot()) => {
  if (!hostName.test(String(host))) throw new Error(`Invalid host name ${cleanText(host)}`);
  return join(root, host);
};

export function workerConnected({ root = linkRoot(), now = Date.now() } = {}) {
  const state = readJson(join(root, 'state.json'));
  return Boolean(state?.connected && now - state.lastSeen <= LINK_STALE_MS);
}

export function linkStatus(host, { root = hostsRoot(), now = Date.now(), probe = probeProcess } = {}) {
  const link = readJson(join(hostDir(host, root), 'link.json'));
  if (!link) return { online: false, reason: `${host} has never connected to this machine` };
  const ago = Math.round((now - link.lastSeen) / 1000);
  if (link.closedAt) return { online: false, lastSeen: link.lastSeen, reason: `${host} disconnected ${ago}s ago` };
  if (now - link.lastSeen > LINK_STALE_MS) return { online: false, lastSeen: link.lastSeen, reason: `${host} last heard from ${ago}s ago` };
  if (probe(link.process).state === 'crashed') return { online: false, lastSeen: link.lastSeen, reason: `${host}'s link process is gone` };
  return { online: true, lastSeen: link.lastSeen, reason: `${host} connected` };
}

export const remoteSnapshot = (host, name, root = hostsRoot()) => readJson(join(hostDir(host, root), `${name}.json`));

export function remoteWaiting({ root = hostsRoot(), now = Date.now() } = {}) {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((host) => hostName.test(host)).flatMap((host) => {
    if (!linkStatus(host, { root, now }).online) return [];
    return (remoteSnapshot(host, 'waiting', root)?.waiting ?? []).map((entry) => ({ ...entry, host }));
  });
}

export async function sendCommand(host, action, params = {}, { root = hostsRoot(), timeoutMs = 6 * 60_000, interval = 250 } = {}) {
  if (!COMMAND_ACTIONS.includes(action)) throw new Error(`Unsupported remote action ${cleanText(action)}`);
  const status = linkStatus(host, { root });
  if (!status.online) return { ok: false, offline: true, text: `${status.reason}; nothing was sent. It runs again only when you resend it.` };
  const id = randomUUID();
  const commands = join(hostDir(host, root), 'commands');
  writeJson(join(commands, `${id}.json`), { version: 1, id, action, params, createdAt: Date.now() });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = readJson(join(commands, `${id}.result.json`));
    if (result) {
      try { unlinkSync(join(commands, `${id}.result.json`)); } catch {}
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  try { unlinkSync(join(commands, `${id}.json`)); } catch {}
  return { ok: false, uncertain: true, text: `No reply from ${host} after ${Math.round(timeoutMs / 1000)}s; it may still have run there` };
}

export function writeOutboxEvent(message, { root = outboxRoot(), now = Date.now() } = {}) {
  const event = { version: 1, id: `${now}-${randomUUID()}`, host: shortHost(), at: now, customType: cleanText(message.customType).slice(0, 80), content: Array.isArray(message.content) ? message.content.map((part) => part.text ?? '').join('\n') : String(message.content ?? '') };
  writeJson(join(root, `${event.id}.json`), event, 'wx');
  return event;
}

export function claimRemoteEvents({ root = hostsRoot() } = {}) {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((host) => hostName.test(host)).flatMap((host) => {
    const dir = join(root, host, 'events');
    if (!existsSync(dir)) return [];
    const delivering = join(dir, 'delivering');
    mkdirSync(delivering, { recursive: true, mode: 0o700 });
    const repeats = readdirSync(delivering).filter((name) => name.endsWith('.json')).map((name) => ({ name, repeat: true }));
    const fresh = readdirSync(dir).filter((name) => name.endsWith('.json') && fileId.test(name.slice(0, -5))).sort().flatMap((name) => {
      try { renameSync(join(dir, name), join(delivering, name)); } catch { return []; }
      return [{ name, repeat: false }];
    });
    return [...repeats, ...fresh].flatMap(({ name, repeat }) => {
      const event = readJson(join(delivering, name));
      return event ? [{ ...event, host, repeat, file: join(delivering, name) }] : [];
    });
  });
}

export function finishRemoteEvent(event) {
  const target = join(dirname(dirname(event.file)), 'delivered');
  mkdirSync(target, { recursive: true, mode: 0o700 });
  renameSync(event.file, join(target, `${event.id}.json`));
}

export function forwardOrSend(send, message, options, { connected = workerConnected(), root = outboxRoot() } = {}) {
  if (!connected) return send(message, options);
  writeOutboxEvent(message, { root });
  return send(message, { triggerTurn: false });
}

export function workerIdle({ origin, tasks, requests }) {
  if (tasks.some((task) => task.originCwd === origin && !task.stopConfirmed)) return false;
  return !existsSync(requests) || !readdirSync(requests).some((name) => /\.(json|claimed)$/.test(name) && !name.endsWith('.result.json'));
}

export const remoteEventText = (event) => `From ${event.host} (${event.customType || 'event'}): ${event.content}`;
