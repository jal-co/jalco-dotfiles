import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

export class RexSurfaceProvider {
  name = 'rex';
  sessions = new Set();
  launchBoundaries = new Map();

  constructor(call = callRex, processGroup = (pid) => Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8', timeout: 5_000 }).trim())) {
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
    return 'Start the Rex coordinator with node ~/dotfiles/rex/pinned.mjs.';
  }

  createSurface({ name, cwd }) {
    const created = this.json(['new', name, '-c', cwd, '--window', name, '--json']);
    this.sessions.add(created.session_id);
    const block = created.initial_windows?.[0]?.block_ids?.[0];
    if (!block) throw new Error(`Rex created ${created.session_id} without a terminal. Inspect it before retrying.`);
    return `${created.session_id}/${block}`;
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
    for (const record of this.worktrees?.records() ?? []) {
      if (!record.removed && record.workspaceId) this.sessions.add(record.workspaceId);
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
              name: block.label, group: window.window_id, workspaceId: session.session_id,
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
