import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export const defaultRoot = () => resolve(process.env.REX_PLUGINS_STATE ?? join(homedir(), '.local', 'state', 'rex-plugins'));
export const terminalStates = new Set(['completed', 'failed', 'stopped']);
export const cleanText = (value) => String(value).replace(/[\p{Cc}\p{Cf}]/gu, ' ');

export function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export function writeJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}

export class Store {
  constructor(root = defaultRoot()) {
    assert.ok(isAbsolute(root), 'State root must be absolute');
    this.root = root;
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const owner = lstatSync(root);
    assert.ok(owner.isDirectory() && !owner.isSymbolicLink(), 'State root must be a real directory');
    assert.ok((owner.mode & 0o077) === 0 && owner.uid === process.getuid(), 'State root must be private and owned by the current user');
    this.runs = join(root, 'runs');
    mkdirSync(this.runs, { recursive: true, mode: 0o700 });
  }
  directory(id) {
    assert.match(id, /^[a-f0-9-]{36}$/, 'Expected an exact run UUID');
    const directory = join(this.runs, id);
    if (existsSync(directory)) assert.ok(!lstatSync(directory).isSymbolicLink(), 'Run directory cannot be a symlink');
    return directory;
  }
  file(id, name) {
    assert.ok(['request', 'runtime', 'binding', 'stop', 'launch-error'].includes(name));
    return join(this.directory(id), `${name}.json`);
  }
  request(id) {
    const request = readJson(this.file(id, 'request'));
    assert.ok(request?.version === 1 && request.id === id, `Unknown or invalid run: ${id}`);
    return request;
  }
  ids() { return readdirSync(this.runs).filter((name) => /^[a-f0-9-]{36}$/.test(name)); }
  exclusive(operation) {
    const lock = join(this.root, 'operation.lock');
    try { mkdirSync(lock, { mode: 0o700 }); } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Another operation holds ${lock}; inspect it rather than retrying a launch`);
      throw error;
    }
    try { return operation(); } finally { rmdirSync(lock); }
  }
}
