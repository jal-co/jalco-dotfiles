import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { surfaceTarget } from './provider.mjs';

export function git(cwd, args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

export function contained(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function registeredWorktrees(repo) {
  return git(repo, ['worktree', 'list', '--porcelain', '-z']).split('\0\0').filter(Boolean).map((record) => {
    const fields = record.split('\0');
    return {
      path: fields.find((field) => field.startsWith('worktree '))?.slice(9),
      branch: fields.find((field) => field.startsWith('branch refs/heads/'))?.slice(18) ?? '',
      locked: fields.some((field) => field === 'locked' || field.startsWith('locked ')),
    };
  });
}

function ownerAlive(lease) {
  if (!lease) return false;
  try {
    process.kill(lease.pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

export class RexWorktrees {
  constructor(provider, { root = join(homedir(), '.rex') } = {}) {
    this.provider = provider;
    this.root = root;
    this.registry = join(root, 'registry');
    this.checkouts = join(root, 'worktrees');
    this.checkHolders = async () => { throw new Error('Worktree process inspection is not configured.'); };
  }

  records() {
    if (!existsSync(this.registry)) return [];
    return readdirSync(this.registry).filter((name) => name.endsWith('.json')).map((name) => {
      const record = JSON.parse(readFileSync(join(this.registry, name), 'utf8'));
      if (record.version !== 1 || record.key !== name.slice(0, -5) || !/^[a-f0-9]{24}$/.test(record.key)
        || !isAbsolute(record.repo) || !isAbsolute(record.path) || !contained(this.checkouts, record.path)
        || record.key !== createHash('sha256').update(`${record.repo}\0${record.branch}`).digest('hex').slice(0, 24)
        || (record.lease && (!Number.isInteger(record.lease.pid) || record.lease.pid <= 0))) {
        throw new Error(`Invalid Rex worktree registry entry: ${name}`);
      }
      return record;
    });
  }

  save(record) {
    mkdirSync(this.registry, { recursive: true, mode: 0o700 });
    const file = join(this.registry, `${record.key}.json`);
    const temp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, file);
  }

  async exclusive(operation) {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const lock = join(this.root, 'worktree-operation.lock');
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Another Rex worktree operation owns ${lock}. Do not retry until its owner is known to have exited.`);
      throw error;
    }
    const owner = join(lock, 'owner.json');
    try {
      writeFileSync(owner, JSON.stringify({ pid: process.pid, session: process.env.REX_SESSION, createdAt: Date.now() }), { mode: 0o600 });
      return await operation();
    } finally {
      if (existsSync(owner)) unlinkSync(owner);
      rmdirSync(lock);
    }
  }

  leaseHolders(path) {
    return this.records().filter((record) => record.path === path && ownerAlive(record.lease))
      .map(() => 'A live Rex coordinator holds the task lease. Stop the task agent and wait for confirmed exit before reuse or cleanup.');
  }

  async assertUnused(record) {
    const leased = this.leaseHolders(record.path);
    if (leased.length) throw new Error(leased.join('; '));
    const inspection = await this.checkHolders(record);
    if (inspection.blockers.length) throw new Error(inspection.blockers.join('; '));
  }

  verify(record) {
    if (!existsSync(record.path)) throw new Error(`Retained checkout is missing: ${record.path}. Inspect its registry before recreating it.`);
    if (!contained(realpathSync(this.checkouts), realpathSync(record.path))) throw new Error('Managed checkout escapes the Rex worktree root.');
    if (realpathSync(record.path) !== record.path) throw new Error('Managed checkout path contains a symbolic link.');
    const row = registeredWorktrees(record.repo).find((entry) => entry.path === record.path);
    if (!row || row.branch !== record.branch || row.locked) throw new Error('Registered Git worktree identity changed or is locked.');
    const common = git(record.path, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
    if (realpathSync(common) !== realpathSync(git(record.repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim())) {
      throw new Error('Worktree no longer belongs to its recorded source repository.');
    }
    return row;
  }

  assertOpenTask(repo, branch) {
    const remotes = git(repo, ['remote']).trim();
    if (!remotes) return;
    const pulls = JSON.parse(execFileSync('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '100', '--json', 'state'], {
      cwd: repo, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
    }));
    if (pulls.some((pull) => pull.state === 'MERGED' || pull.state === 'CLOSED')) {
      throw new Error(`Branch ${branch} belongs to a closed pull request. Do not reuse its checkout for new work.`);
    }
  }

  async create({ name, cwd, branch, base }) {
    return this.exclusive(async () => {
      const repo = realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).trim());
      if (realpathSync(git(repo, ['rev-parse', '--path-format=absolute', '--git-dir']).trim())
        !== realpathSync(git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim())) {
        throw new Error('Create worktrees from the principal repository checkout, not another task worktree.');
      }
      git(repo, ['check-ref-format', '--branch', branch]);
      const baseSha = git(repo, ['rev-parse', '--verify', `${base}^{commit}`]).trim();
      const key = createHash('sha256').update(`${repo}\0${branch}`).digest('hex').slice(0, 24);
      let record = this.records().find((entry) => entry.key === key);
      if (record?.removed) throw new Error(`Task branch ${branch} was explicitly removed. Choose a new task branch.`);
      if (record) {
        this.verify(record);
        this.assertOpenTask(repo, branch);
        await this.assertUnused(record);
        if (baseSha !== record.baseSha) throw new Error(`Retained task base is ${record.baseSha}. Supply that base explicitly instead of changing it.`);
      } else {
        const existing = registeredWorktrees(repo).find((entry) => entry.branch === branch);
        if (existing) throw new Error(`Branch ${branch} already has a checkout at ${existing.path}. Use its existing task session; Rex will not duplicate or adopt it automatically.`);
        const repoKey = createHash('sha256').update(repo).digest('hex').slice(0, 12);
        const directory = join(this.checkouts, `${basename(repo)}-${repoKey}`);
        mkdirSync(directory, { recursive: true });
        if (!contained(realpathSync(this.root), realpathSync(directory)) || realpathSync(directory) !== directory) {
          throw new Error('Rex worktree destination contains a symbolic link.');
        }
        const path = join(directory, `${branch.replaceAll('/', '-')}-${key}`);
        if (existsSync(path)) throw new Error(`Unclaimed path exists at ${path}. Inspect it before creating a checkout.`);
        record = { version: 1, key, repo, branch, baseSha, path, lease: { pid: process.pid } };
        this.save(record);
        try {
          git(repo, ['worktree', 'add', '-b', branch, path, baseSha]);
        } catch (error) {
          record.error = String(error);
          this.save(record);
          throw new Error(`Git worktree creation failed. Inspect retained registry ${key} and ${path} before retrying: ${String(error)}`);
        }
      }
      record.lease = { pid: process.pid };
      this.save(record);
      try {
        const live = this.provider.json(['ls', '--json']).sessions;
        let surface = record.surfaceId;
        if (record.workspaceId && live.some((entry) => entry.session_id === surfaceTarget(record.surfaceId).session)) {
          this.provider.sessions.add(surfaceTarget(record.surfaceId).session);
          const surfaces = await this.provider.listSurfaces();
          if (!surfaces.some((entry) => entry.id === surface)) {
            throw new Error('The retained task pane is missing. Inspect the task session before continuing.');
          }
          await this.provider.waitForShellReady(surface);
          const info = this.provider.process(surface);
          if (!info.foreground?.cwd || realpathSync(info.foreground.cwd) !== record.path) {
            throw new Error('Retained Rex shell is not in its recorded worktree. Inspect it before continuing.');
          }
        } else {
          surface = this.provider.createSurface({ name, cwd: record.path, repo });
          record.workspaceId = surface;
          record.surfaceId = surface;
        }
        record.error = undefined;
        this.save(record);
        return { path: record.path, branch, workspaceId: record.workspaceId, surfaceId: surface };
      } catch (error) {
        record.error = String(error);
        this.save(record);
        throw new Error(`Rex task startup failed; checkout retained at ${record.path}, registry ${key}: ${String(error)}`);
      }
    });
  }

  recordManifest(file, value) {
    if (!value.path) return;
    const record = this.records().find((entry) => entry.path === value.path);
    if (!record) throw new Error(`No Rex ownership record for ${value.path}`);
    record.manifest = { file, value };
    const policyFile = value.sessionFile && `${value.sessionFile}.pi-herdr-subagent-policy.json`;
    if (policyFile && existsSync(policyFile)) record.persistent = JSON.parse(readFileSync(policyFile, 'utf8')).persistent === true;
    if (record.lease && value.id) record.lease.runId = value.id;
    if (value.state === 'removed') record.removed = true;
    this.save(record);
  }

  release(message) {
    const details = message.details;
    let runId;
    let sessionFile;
    if (message.customType === 'subagent_stop' && details?.status === 'stopped') runId = details.facts?.logicalId;
    if (['subagent_result', 'subagent_ping'].includes(message.customType) && details?.worktree) sessionFile = details.sessionFile;
    if (!runId && !sessionFile) return;
    for (const record of this.records()) {
      if (!record.lease || record.lease.pid !== process.pid) continue;
      if ((runId && record.lease.runId === runId) || (sessionFile && record.persistent === false && record.manifest?.value.sessionFile === sessionFile)) {
        record.lease = null;
        this.save(record);
      }
    }
  }

  async list({ cwd } = {}) {
    const source = cwd ? realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).trim()) : undefined;
    const live = this.provider.json(['ls', '--json']).sessions;
    return this.records().filter((record) => !record.removed && (!source || record.repo === source)).map((record) => {
      this.verify(record);
      return {
        path: record.path, branch: record.branch, label: record.branch, isLinkedWorktree: true,
        workspaceId: record.workspaceId && live.some((entry) => entry.session_id === surfaceTarget(record.surfaceId).session) ? record.workspaceId : undefined,
      };
    });
  }

  async removeWorkspace(workspaceId) {
    const matches = this.records().filter((record) => !record.removed && record.workspaceId === workspaceId);
    if (matches.length !== 1) throw new Error('Rex task session ownership is missing or ambiguous.');
    const record = matches[0];
    this.verify(record);
    await this.assertUnused(record);
    git(record.repo, ['worktree', 'remove', '--', record.path]);
    record.removed = true;
    this.save(record);
    this.provider.closeSurface(record.surfaceId);
  }
}
