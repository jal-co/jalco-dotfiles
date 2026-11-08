import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { cleanText, TaskStore } from './tasks.ts';

export const requestRoot = () => process.env.REX_REQUEST_ROOT ?? join(homedir(), '.rex', 'requests');
export const REQUEST_TTL = 60_000;
const ref = /^(?!-)[\w./-]{1,200}$/;
const id = /^[a-f0-9-]{36}$/;

function write(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
}

export function submitRequest({ origin, action, params }, root = requestRoot()) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const request = { version: 1, id: randomUUID(), origin, action, params, createdAt: Date.now() };
  write(join(root, `${request.id}.json`), request);
  return request.id;
}

export function requestState(requestId, root = requestRoot()) {
  const result = join(root, `${requestId}.result.json`);
  if (existsSync(result)) {
    const value = JSON.parse(readFileSync(result, 'utf8'));
    unlinkSync(result);
    return { state: 'done', ...value };
  }
  if (existsSync(join(root, `${requestId}.json`))) return { state: 'queued' };
  return { state: 'running' };
}

const text = (value, limit) => {
  const string = String(value ?? '');
  if (!string.trim() || string.length > limit) throw new Error('Request text is missing or too long');
  return string;
};

export function orphanResults(root = requestRoot()) {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => /^[a-f0-9-]{36}\.result\.json$/.test(name)).flatMap((name) => {
    const state = requestState(name.slice(0, 36), root);
    return state.state === 'done' ? [state] : [];
  });
}

export function parseRequest(request, { now = Date.now(), tasks = () => new TaskStore().list() } = {}) {
  if (request.version !== 1 || !id.test(request.id)) throw new Error('Unknown request format');
  if (!(now - request.createdAt <= REQUEST_TTL)) throw new Error(`Request expired after ${REQUEST_TTL / 1000}s without a running coordinator; nothing was launched or sent`);
  const params = request.params ?? {};
  if (request.action === 'send') {
    if (!/^[a-zA-Z0-9-]+$/.test(params.id ?? '')) throw new Error('Invalid task ID');
    return { tool: 'subagent_send', params: { id: params.id, message: text(params.message, 20_000) } };
  }
  if (request.action === 'message') return { tool: 'message', params: { message: text(params.message, 20_000) } };
  if (request.action === 'resume') {
    const task = tasks().find((row) => row.originCwd === request.origin && (row.id === params.id || row.logicalId === params.id));
    if (!task) throw new Error('No retained task matches this resume request');
    return { tool: 'subagent_resume', params: { sessionPath: task.sessionFile, name: task.name } };
  }
  if (request.action === 'cleanup') {
    if (!/^[a-zA-Z0-9-]+$/.test(params.id ?? '')) throw new Error('Invalid task ID');
    if (!isAbsolute(String(params.checkout))) throw new Error('Cleanup needs the task checkout path');
    return { tool: 'cleanup', params: { id: params.id, checkout: params.checkout, preserve: params.preserve === true } };
  }
  if (request.action === 'stop') {
    if (!/^[a-zA-Z0-9-]+$/.test(params.id ?? '')) throw new Error('Invalid task ID');
    return { tool: 'subagent_stop', params: { id: params.id } };
  }
  if (request.action === 'launch') {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(params.name ?? '')) throw new Error('Invalid task name');
    if (!isAbsolute(String(params.cwd)) || !existsSync(join(params.cwd, '.git'))) throw new Error('Launch checkout is not a Git repository');
    if (params.worktree !== null && (!ref.test(params.worktree?.branch ?? '') || !ref.test(params.worktree?.base ?? ''))) throw new Error('Invalid worktree branch or base');
    return {
      tool: 'subagent',
      params: {
        name: params.name, task: text(params.task, 20_000), cwd: params.cwd,
        worktree: params.worktree && { branch: params.worktree.branch, base: params.worktree.base },
        persistent: true, interactive: true, model: 'task:coding', thinking: 'medium',
      },
    };
  }
  throw new Error(`Unsupported request action: ${cleanText(request.action)}`);
}

export class RequestInbox {
  constructor({ origin, run, root = requestRoot(), now = Date.now, tasks = () => new TaskStore().list() }) {
    Object.assign(this, { origin, run, root, now, tasks });
    this.busy = Promise.resolve();
  }
  start() {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.watcher = watch(this.root, (_event, name) => { if (/^[a-f0-9-]{36}\.json$/.test(String(name))) this.scan(); });
    this.watcher.on('error', () => this.close());
    this.scan();
  }
  scan() {
    if (this.closed || !existsSync(this.root)) return this.busy;
    for (const name of readdirSync(this.root).filter((entry) => /^[a-f0-9-]{36}\.json$/.test(entry)).sort()) {
      const job = this.claim(name.slice(0, -5));
      if (job) this.busy = this.busy.then(() => this.execute(job));
    }
    return this.busy;
  }
  claim(requestId) {
    const file = join(this.root, `${requestId}.json`);
    let request;
    try { request = JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
    if (request.origin !== this.origin) return undefined;
    const claimed = join(this.root, `${requestId}.claimed`);
    try { renameSync(file, claimed); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    try {
      return { requestId, ...parseRequest(request, { now: this.now(), tasks: this.tasks }) };
    } catch (error) {
      this.finish(requestId, { ok: false, text: cleanText(error.message) });
      return undefined;
    }
  }
  async execute({ requestId, tool, params }) {
    let result;
    try {
      result = this.closed
        ? { ok: false, text: 'The coordinator reloaded before running this request; nothing was done. Try again.' }
        : await this.run(tool, params);
    } catch (error) {
      result = { ok: false, text: cleanText(error.message) };
    }
    this.finish(requestId, result);
  }
  finish(requestId, result) {
    write(join(this.root, `${requestId}.result.json`), result);
    unlinkSync(join(this.root, `${requestId}.claimed`));
  }
  close() {
    this.closed = true;
    this.watcher?.close();
    return this.busy;
  }
}
