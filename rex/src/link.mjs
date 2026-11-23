import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, watch } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { brainName, hostsRoot, linkRoot, loadHosts, outboxRoot, readJson, selfName, writeJson, COMMAND_ACTIONS } from './hosts.ts';
import { cleanText, processBirth, processCommand } from './tasks.ts';

const HEARTBEAT_MS = 10_000;
const COMMAND_TTL_MS = 60_000;
const send = (output, message) => output.write(`${JSON.stringify(message)}\n`);
const lines = (input, handle) => createInterface({ input }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message && message === Object(message)) handle(message);
});

function watchDir(dir, onChange, interval) {
  let watcher;
  try {
    watcher = watch(dir, () => onChange());
    watcher.on('error', () => watcher?.close());
  } catch {}
  const timer = setInterval(onChange, interval);
  return () => { watcher?.close(); clearInterval(timer); };
}

export function serve({ host, input = process.stdin, output = process.stdout, root = hostsRoot(), now = Date.now }) {
  const dir = join(root, host);
  const commands = join(dir, 'commands');
  const events = join(dir, 'events');
  mkdirSync(commands, { recursive: true, mode: 0o700 });
  const me = { pid: process.pid, birth: processBirth(process.pid), command: processCommand(process.pid) };
  const link = { version: 1, host, process: me, connectedAt: now(), lastSeen: now() };
  const touch = () => { link.lastSeen = now(); writeJson(join(dir, 'link.json'), link); };
  touch();
  for (const name of readdirSync(commands)) {
    const id = name.replace(/\.(claimed|json)$/, '');
    if (name.endsWith('.claimed')) {
      writeJson(join(commands, `${id}.result.json`), { ok: false, uncertain: true, text: `The link to ${host} dropped while this ran; it may have run there` });
      unlinkSync(join(commands, name));
    }
  }
  const forward = () => {
    for (const name of readdirSync(commands).filter((entry) => /^[\w-]+\.json$/.test(entry) && !entry.endsWith('.result.json')).sort()) {
      const id = name.slice(0, -5);
      const command = readJson(join(commands, name));
      if (!command) continue;
      if (now() - command.createdAt > COMMAND_TTL_MS || !COMMAND_ACTIONS.includes(command.action)) {
        writeJson(join(commands, `${id}.result.json`), { ok: false, text: COMMAND_ACTIONS.includes(command.action) ? `Expired after ${COMMAND_TTL_MS / 1000}s before ${host} could take it; nothing ran` : 'Unsupported remote action' });
        unlinkSync(join(commands, name));
        continue;
      }
      try { renameSync(join(commands, name), join(commands, `${id}.claimed`)); } catch { continue; }
      send(output, { type: 'command', id, action: command.action, params: command.params ?? {} });
    }
  };
  const stopWatching = watchDir(commands, forward, 500);
  const beat = setInterval(() => send(output, { type: 'heartbeat', at: now() }), HEARTBEAT_MS);
  send(output, { type: 'welcome', host, at: now() });
  forward();
  lines(input, (message) => {
    touch();
    if (message.type === 'snapshot' && ['waiting', 'tasks', 'status'].includes(message.name)) {
      writeJson(join(dir, `${message.name}.json`), { at: now(), ...message.value });
    } else if (message.type === 'event' && /^[\w-]{1,80}$/.test(String(message.event?.id))) {
      if (!['', 'delivering', 'delivered'].some((sub) => existsSync(join(events, sub, `${message.event.id}.json`)))) {
        writeJson(join(events, `${message.event.id}.json`), { ...message.event, host, receivedAt: now() });
      }
      send(output, { type: 'ack', id: message.event.id });
    } else if (message.type === 'reply' && /^[\w-]{1,80}$/.test(String(message.id))) {
      writeJson(join(commands, `${message.id}.result.json`), message.result ?? { ok: false, text: 'Empty reply' });
      try { unlinkSync(join(commands, `${message.id}.claimed`)); } catch {}
    }
  });
  return new Promise((resolve) => input.on('close', () => {
    stopWatching();
    clearInterval(beat);
    link.closedAt = now();
    writeJson(join(dir, 'link.json'), link);
    resolve();
  }));
}

export function connectOnce({ brain, transport, agent, root = linkRoot(), now = Date.now, snapshots }) {
  const child = transport();
  const state = { brain, connected: false, lastSeen: 0, since: now() };
  const save = () => writeJson(join(root, 'state.json'), state);
  const outbox = outboxRoot();
  const inFlight = new Set();
  const flush = () => {
    if (!state.connected || !existsSync(outbox)) return;
    for (const name of readdirSync(outbox).filter((entry) => entry.endsWith('.json')).sort()) {
      const event = readJson(join(outbox, name));
      if (!event || inFlight.has(event.id)) continue;
      inFlight.add(event.id);
      send(child.stdin, { type: 'event', event });
    }
  };
  const report = async () => {
    for (const [name, read] of Object.entries(snapshots)) {
      try { send(child.stdin, { type: 'snapshot', name, value: await read() }); } catch (error) {
        send(child.stdin, { type: 'snapshot', name, value: { error: cleanText(error.message) } });
      }
    }
    send(child.stdin, { type: 'heartbeat', at: now() });
  };
  let beat;
  let stopWatching = () => {};
  child.stdin.on('error', () => {});
  lines(child.stdout, async (message) => {
    state.lastSeen = now();
    if (message.type === 'welcome') {
      state.connected = true;
      save();
      stopWatching = watchDir(outbox, flush, 1000);
      beat = setInterval(() => { save(); void report(); }, HEARTBEAT_MS);
      await report();
      flush();
      return;
    }
    save();
    if (message.type === 'ack') {
      inFlight.delete(message.id);
      try { unlinkSync(join(outbox, `${message.id}.json`)); } catch {}
    } else if (message.type === 'command') {
      let result;
      try {
        if (!COMMAND_ACTIONS.includes(message.action) || !agent[message.action]) throw new Error('Unsupported remote action');
        result = await agent[message.action](message.params ?? {});
      } catch (error) {
        result = { ok: false, text: cleanText(error.message).slice(0, 500) };
      }
      send(child.stdin, { type: 'reply', id: message.id, result: result ?? { ok: true } });
    }
  });
  return new Promise((resolve) => child.on('close', (code) => {
    clearInterval(beat);
    stopWatching();
    state.connected = false;
    save();
    resolve({ code, everConnected: state.lastSeen > 0 });
  }));
}

export async function work({ config = loadHosts(), agent, transport, snapshots, once = false } = {}) {
  const self = selfName(config);
  const brain = brainName(config);
  if (!self) throw new Error('This machine is not listed in hosts.json');
  if (self === brain) throw new Error(`${self} is the primary host; it serves links instead of opening one`);
  const command = process.env.REX_LINK_COMMAND;
  const open = transport ?? (() => (command
    ? spawn('sh', ['-c', command], { stdio: ['pipe', 'pipe', 'inherit'] })
    : spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3', config.hosts[brain].ssh,
      `~/.local/share/mise/shims/node ~/dotfiles/rex/src/link.mjs serve --host ${self}`], { stdio: ['pipe', 'pipe', 'inherit'] })));
  let wait = 5_000;
  for (;;) {
    const { everConnected } = await connectOnce({ brain, transport: open, agent, snapshots });
    if (once) return;
    wait = everConnected ? 5_000 : Math.min(wait * 2, 60_000);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function main(argv) {
  const [mode, ...rest] = argv;
  const { values } = parseArgs({ args: rest, options: { host: { type: 'string' } } });
  if (mode === 'serve') {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(values.host ?? '')) throw new Error('serve needs --host <name>');
    return serve({ host: values.host });
  }
  if (mode === 'work') {
    const { agent } = await import('./remote.mjs');
    const { blockedTabs, labeler, scan } = await import('./alerts.mjs');
    const labelOf = labeler();
    return work({
      agent,
      snapshots: {
        waiting: () => ({ waiting: blockedTabs(scan(), labelOf) }),
        tasks: () => ({ tasks: agent.tasks() }),
        status: () => agent.status(),
      },
    });
  }
  console.log('Usage:\n  link.mjs work                  on a worker host: keep a link open to the primary host\n  link.mjs serve --host NAME     on the primary host, run by the worker over ssh');
  process.exitCode = mode ? 2 : 0;
  return undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`rex link: ${cleanText(error.message)}`);
    process.exitCode = 1;
  });
}
