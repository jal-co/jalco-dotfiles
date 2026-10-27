import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, readJson, terminalStates, writeJson } from './store.mjs';
import { identityAlive } from './process.mjs';
import { capabilities, commandFor } from './adapters.mjs';
import { Rex, taskLayout } from './rex.mjs';

const runner = fileURLToPath(new URL('./runner.mjs', import.meta.url));
const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export class Manager {
  constructor({ store = new Store(), rex = new Rex(), alive = identityAlive } = {}) {
    Object.assign(this, { store, rex, alive });
  }
  launch(spec) {
    assert.ok(spec && typeof spec === 'object' && !Array.isArray(spec), 'Expected a run object');
    const keys = ['name', 'adapter', 'argv', 'prompt', 'model', 'binary', 'cwd', 'worktree', 'panels'];
    assert.ok(Object.keys(spec).every((key) => keys.includes(key)), 'Unknown launch option');
    assert.match(spec.name ?? '', /^[a-z0-9][a-z0-9-]{0,63}$/, 'Use a short lowercase task name');
    assert.ok(spec.panels === undefined || typeof spec.panels === 'boolean', 'panels must be boolean');
    assert.ok(Boolean(spec.cwd) !== Boolean(spec.worktree), 'Supply either cwd or worktree, not both');
    const id = randomUUID();
    const directory = this.store.directory(id);
    const command = commandFor(spec, directory);
    let cwd;
    let worktree;
    if (spec.worktree) {
      const w = spec.worktree;
      assert.ok(w && Object.keys(w).every((key) => ['repo', 'branch', 'base'].includes(key)), 'Invalid worktree request');
      assert.ok(isAbsolute(w.repo), 'Repository must be absolute');
      const repo = realpathSync(w.repo);
      assert.equal(git(repo, ['rev-parse', '--show-toplevel']), repo, 'Use the repository root');
      assert.match(w.branch, /^[a-z][a-z0-9/-]*$/, 'Invalid new branch name');
      assert.ok(typeof w.base === 'string' && w.base && !w.base.startsWith('-'), 'Explicit base ref required');
      git(repo, ['check-ref-format', '--branch', w.branch]);
      const base = git(repo, ['rev-parse', '--verify', '--end-of-options', `${w.base}^{commit}`]);
      cwd = join(this.store.root, 'worktrees', id);
      worktree = { repo, branch: w.branch, base, path: cwd };
    } else {
      assert.ok(isAbsolute(spec.cwd), 'cwd must be absolute');
      cwd = realpathSync(spec.cwd);
      assert.ok(statSync(cwd).isDirectory(), 'cwd must be a directory');
    }
    const server = this.rex.localServer();
    return this.store.exclusive(() => {
      for (const currentId of this.store.ids()) {
        const row = this.status(currentId);
        assert.ok(terminalStates.has(row.state) || (row.name !== spec.name && row.cwd !== cwd), `Existing run ${row.id} owns this name or directory (${row.state})`);
      }
      mkdirSync(directory, { mode: 0o700 });
      const request = { version: 1, id, name: spec.name, adapter: spec.adapter, command, cwd, worktree, server, capabilities: capabilities[spec.adapter], createdAt: new Date().toISOString() };
      writeJson(this.store.file(id, 'request'), request);
      try {
        if (worktree) {
          mkdirSync(join(this.store.root, 'worktrees'), { recursive: true, mode: 0o700 });
          git(worktree.repo, ['worktree', 'add', '-b', worktree.branch, cwd, worktree.base]);
        }
        const args = ['--root', this.store.root, id];
        const created = this.rex.create(spec.name, taskLayout({ name: spec.name, cwd, panels: spec.panels,
          runner: [process.execPath, runner, ...args], view: [process.execPath, cli, 'watch', ...args], details: [process.execPath, cli, 'show', ...args],
        }));
        const block = created.initial_windows?.[0]?.block_ids?.[0];
        assert.ok(created.session_id && block, 'Rex launch returned no session or agent block');
        writeJson(this.store.file(id, 'binding'), { server, session: created.session_id, block, blocks: created.initial_windows[0].block_ids });
      } catch (error) {
        writeJson(this.store.file(id, 'launch-error'), { message: String(error), at: new Date().toISOString() });
        throw new Error(`Run ${id} retained after launch uncertainty. Inspect it before any retry: ${error.message}`);
      }
      return this.status(id);
    });
  }
  status(id) {
    const request = this.store.request(id);
    const runtime = readJson(this.store.file(id, 'runtime'));
    const binding = readJson(this.store.file(id, 'binding'));
    const launchError = readJson(this.store.file(id, 'launch-error'));
    const stop = readJson(this.store.file(id, 'stop'));
    let state = 'starting';
    let reason = 'Waiting for runner process evidence';
    if (runtime) {
      assert.equal(runtime.id, id, 'Mismatched runtime record');
      const live = this.alive(runtime.identity);
      const childLive = runtime.child ? this.alive(runtime.child) : false;
      if (!live && childLive) { state = 'unknown'; reason = 'Runner exited but its child is still alive'; }
      else if (!live && terminalStates.has(runtime.state)) { state = runtime.state; reason = 'Runner exited with a recorded outcome'; }
      else if (!live && runtime.child && !childLive) { state = 'interrupted'; reason = 'Runner and child exited without a final outcome; stop to retire this record'; }
      else if (!live) { state = 'unknown'; reason = 'Runner exited but child exit is unverified'; }
      else { state = stop ? 'stopping' : 'running'; reason = stop ? 'Stop requested; process exit is not yet confirmed' : 'Runner process identity verified'; }
    } else if (launchError) { state = 'unknown'; reason = launchError.message; }
    return { id, name: request.name, adapter: request.adapter, cwd: request.cwd, worktree: request.worktree, capabilities: request.capabilities, state, reason, binding, runtime, createdAt: request.createdAt };
  }
  list() { return this.store.ids().map((id) => this.status(id)); }
  stop(id) {
    return this.store.exclusive(() => {
      const status = this.status(id);
      if (terminalStates.has(status.state)) return status;
      if (status.state === 'interrupted') {
        assert.ok(status.binding, 'Missing launch binding; exit is unconfirmed');
        assert.equal(this.rex.presence(status.binding), 'missing', 'Runner terminal still exists; inspect it before retiring');
        assert.ok(!this.alive(status.runtime.identity) && !this.alive(status.runtime.child), 'Process identity changed during verification');
        writeJson(this.store.file(id, 'runtime'), { ...status.runtime, state: 'stopped', retiredAt: new Date().toISOString() });
        return this.status(id);
      }
      assert.ok(status.runtime && this.alive(status.runtime.identity), 'Cannot stop without a verified live runner');
      writeJson(this.store.file(id, 'stop'), { id, requestedAt: new Date().toISOString() });
      return this.status(id);
    });
  }
  capture(id) {
    const status = this.status(id);
    assert.ok(status.binding, 'Launch binding is unavailable');
    return this.rex.capture(status.binding);
  }
}
