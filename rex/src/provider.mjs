import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';

export function rexBinary() {
  const binary = process.env.REX_BIN ?? (process.env.REX_BIN_DIR
    ? join(process.env.REX_BIN_DIR, 'rex')
    : '/Applications/Rex Beta.app/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex');
  if (!existsSync(binary)) throw new Error(`Rex CLI not found at ${binary}. Set REX_BIN to its path.`);
  return binary;
}

export function callRex(args) {
  return execFileSync(rexBinary(), ['--autostart=false', ...args], {
    encoding: 'utf8', timeout: 15_000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function surfaceTarget(id) {
  const match = /^(session:[a-zA-Z0-9-]+)\/(block:[a-zA-Z0-9-]+)$/.exec(id);
  if (!match) throw new Error(`Invalid Rex surface ID: ${id}`);
  return { session: match[1], block: match[2] };
}

export function repositoryFor(cwd) {
  try {
    const output = execFileSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain', '-z'], {
      encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return realpathSync(output.split('\0')[0].slice(9));
  } catch (error) {
    if (error.status === 128 && String(error.stderr).includes('not a git repository')) return realpathSync(cwd);
    throw error;
  }
}

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

export class RexSurfaceProvider {
  name = 'rex';
  sessions = new Set();
  launchBoundaries = new Map();

  constructor(call = callRex, processGroup = (pid) => Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8', timeout: 5_000 }).trim()), { root = join(homedir(), '.rex'), repository = repositoryFor } = {}) {
    this.root = root;
    this.repository = repository;
    this.call = call;
    this.processGroup = processGroup;
  }

  json(args) {
    return JSON.parse(this.call(args));
  }

  isAvailable() {
    try {
      this.json(['whoami', '--json']);
      return Boolean(process.env.REX_SESSION);
    } catch {
      return false;
    }
  }

  setupHint() {
    return 'Start the Rex coordinator with node ~/dotfiles/rex/src/pinned.mjs.';
  }

  createSurface({ name, cwd, repo = this.repository(cwd) }) {
    const directory = join(this.root, 'repositories');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `${createHash('sha256').update(repo).digest('hex')}.json`);
    const lock = `${file}.lock`;
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Rex repository launch is locked at ${lock}. Verify its owner has exited before recovery.`);
      throw error;
    }
    const owner = join(lock, 'owner.json');
    try {
      writeFileSync(owner, JSON.stringify({ pid: process.pid, session: process.env.REX_SESSION }), { mode: 0o600 });
      const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
      if (saved !== undefined && (saved?.repo !== repo || !/^session:[a-zA-Z0-9-]+$/.test(saved?.session))) {
        throw new Error(`Invalid Rex repository session record: ${file}`);
      }
      const live = this.json(['ls', '--json']).sessions;
      let session = saved?.session;
      let block;
      if (session && live.some((entry) => entry.session_id === session)) {
        const created = this.json(['window', 'new', '-s', session, name, '-c', cwd, '--focus=false', '--json']);
        block = created.block_ids?.[0];
      } else {
        const created = this.json(['new', basename(repo), '-c', cwd, '--window', name, '--json']);
        session = created.session_id;
        block = created.initial_windows?.[0]?.block_ids?.[0];
        const temp = `${file}.${randomUUID()}.tmp`;
        writeFileSync(temp, `${JSON.stringify({ repo, session })}\n`, { mode: 0o600 });
        renameSync(temp, file);
      }
      this.sessions.add(session);
      if (!block) throw new Error(`Rex created a tab in ${session} without a terminal. Inspect it before retrying.`);
      return `${session}/${block}`;
    } finally {
      if (existsSync(owner)) unlinkSync(owner);
      rmdirSync(lock);
    }
  }

  target(id) {
    const target = surfaceTarget(id);
    if (!this.sessions.has(target.session)) throw new Error(`Rex session is not owned by this coordinator: ${target.session}`);
    return ['-s', target.session, '-b', target.block];
  }

  runCommand(id, command) {
    const target = this.target(id);
    this.call(['send', ...target, '--', command]);
    this.call(['send-key', ...target, 'enter']);
  }

  runScript(id, command, { scriptPath }) {
    this.target(id);
    mkdirSync(dirname(scriptPath), { recursive: true });
    writeFileSync(scriptPath, `${command}\n`, { mode: 0o600 });
    const boundary = `__REX_RUN_${randomUUID()}__`;
    this.launchBoundaries.set(id, boundary);
    this.runCommand(id, `printf '\\n%s\\n' ${quote(boundary)}; bash ${quote(scriptPath)}`);
    return scriptPath;
  }

  async readScreen(id, lines = 100) {
    const screen = this.call(['capture', ...this.target(id), '--trim', '--unwrap']);
    const boundary = this.launchBoundaries.get(id);
    const start = boundary ? screen.lastIndexOf(boundary) : -1;
    const current = boundary ? (start < 0 ? '' : screen.slice(start + boundary.length)) : screen;
    return current.split('\n').slice(-lines).join('\n');
  }

  closeSurface(id) {
    const { session, block } = surfaceTarget(id);
    this.target(id);
    this.call(['block', 'close', '-s', session, block]);
  }

  async listSurfaces() {
    const live = this.json(['ls', '--json']).sessions;
    const records = this.worktrees?.records() ?? [];
    for (const record of records) {
      if (!record.removed && record.workspaceId) this.sessions.add(surfaceTarget(record.surfaceId).session);
    }
    const surfaces = [];
    for (const session of live) {
      if (!this.sessions.has(session.session_id)) continue;
      const view = this.json(['session', 'inspect', session.session_id, '--json']);
      for (const window of view.windows) {
        for (const layer of window.layers) {
          for (const block of layer.blocks) {
            surfaces.push({
              id: `${session.session_id}/${block.block_id}`,
              name: block.label, group: window.window_id,
              workspaceId: records.find((record) => !record.removed
                && record.surfaceId === `${session.session_id}/${block.block_id}`)?.workspaceId,
            });
          }
        }
      }
    }
    return surfaces;
  }

  attachSurface(id) {
    this.target(id);
    return {
      id,
      runCommand: (command) => this.runCommand(id, command),
      readScreen: (lines) => this.readScreen(id, lines),
      sendKeys: (keys) => this.sendKeys(id, keys),
      close: () => this.closeSurface(id),
    };
  }

  async inspectSurface(id) {
    try {
      const present = (await this.listSurfaces()).some((surface) => surface.id === id);
      if (!present) return { kind: 'missing' };
      return { kind: 'present', agentStatus: 'unknown', observedAt: Date.now() };
    } catch (error) {
      return { kind: 'unavailable', error: String(error) };
    }
  }

  sendKeys(id, keys) {
    this.call(['send-key', ...this.target(id), keys === 'esc' ? 'escape' : keys]);
  }

  process(id) {
    return this.json(['block', 'call', ...this.target(id), 'process']);
  }

  async getProcessInfo(id) {
    const info = this.process(id);
    const processes = [info.child, ...(info.ancestors ?? []), info.foreground].filter(Boolean);
    const idleShell = info.foreground && ['zsh', 'bash', 'fish', 'sh'].includes(info.foreground.name)
      && info.foreground.argv0?.startsWith('-');
    return {
      shellPid: idleShell ? info.foreground.pid : info.child?.pid,
      foregroundProcessGroupId: info.foreground ? this.processGroup(info.foreground.pid) : undefined,
      pids: [...new Set(processes.map((entry) => entry.pid))],
      foregroundProcesses: info.foreground ? [info.foreground] : [],
    };
  }

  async waitForShellReady(id, { timeoutMs = 10_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    do {
      const info = this.process(id);
      const foreground = info.foreground;
      if (foreground && ['zsh', 'bash', 'fish', 'sh'].includes(foreground.name)
        && foreground.argv0?.startsWith('-')) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error(`Rex shell readiness not confirmed: ${id}`);
  }

  async waitForSurfaceAbsence(id, { timeoutMs = 5_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    do {
      const state = await this.inspectSurface(id);
      if (state.kind === 'missing') return;
      if (state.kind === 'unavailable') throw new Error(state.error);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error(`Rex pane exit not confirmed: ${id}`);
  }

  createWorktreeSurface(options) {
    if (!this.worktrees) throw new Error('Rex worktree management is not configured.');
    return this.worktrees.create(options);
  }

  removeWorktreeSurface(workspaceId) {
    if (!this.worktrees) throw new Error('Rex worktree management is not configured.');
    return this.worktrees.removeWorkspace(workspaceId);
  }

  async reportOpenedPrimaryWorkspace() { return undefined; }
  async listWorktreeSurfaces(options) {
    if (!this.worktrees) throw new Error('Rex worktree management is not configured.');
    return this.worktrees.list(options);
  }
  focusWorkspace() { throw new Error('Select the task session in Rex manually.'); }
  setTitle() {}
}
