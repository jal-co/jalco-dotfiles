import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { processBirth } from './tasks.ts';
import { lockOwnerGone, reclaimLock } from './worktrees.ts';

const execute = promisify(execFile);
const fields = 'url,state,mergedAt,headRefName,headRefOid,headRepository';
const CONNECTIVITY_ERROR = /error connecting to api\.github\.com|ENOTFOUND|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|EPIPE|\bEOF\b|connection reset|broken pipe|i\/o timeout|TLS handshake timeout|no such host|context deadline exceeded|socket hang up|network/i;
const RATE_LIMIT = /rate limit|HTTP 429|submitted too quickly|abuse detection/i;
const RATE_COOLDOWN = 15 * 60_000;
const errorText = (error) => `${error?.stderr ?? ''}\n${error?.message ?? error}`;

export function isConnectivityError(error) {
  return Boolean(error?.killed) || CONNECTIVITY_ERROR.test(errorText(error));
}

export function outageOf(error) {
  if (RATE_LIMIT.test(errorText(error))) return 'rate';
  if (isConnectivityError(error)) return 'network';
  return undefined;
}

export async function github(args, cwd, signal) {
  const { stdout } = await execute('gh', args, { cwd, signal, timeout: 20000, maxBuffer: 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1' } });
  return JSON.parse(stdout);
}

export function prIdentity(url) {
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)$/.exec(url);
  assert.ok(match, 'Expected a canonical github.com pull request URL');
  return { repository: match[1], number: Number(match[2]) };
}

export class PullRequestStore {
  constructor(root = process.env.REX_PR_ROOT ?? join(homedir(), '.rex', 'pull-requests')) { this.root = root; }
  key(origin, url) { return createHash('sha256').update(`${origin}\0${url}`).digest('hex'); }
  list(origin) {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root).filter((file) => file.endsWith('.json')).map((file) => {
      const row = JSON.parse(readFileSync(join(this.root, file), 'utf8'));
      assert.equal(row.version, 1);
      assert.ok(isAbsolute(row.origin) && isAbsolute(row.checkout));
      prIdentity(row.url);
      assert.equal(file, `${this.key(row.origin, row.url)}.json`);
      return row;
    }).filter((row) => row.origin === origin);
  }
  write(row) {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const file = join(this.root, `${this.key(row.origin, row.url)}.json`);
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(row, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  }
  sweepFile(origin) { return join(this.root, `${this.key(origin, 'watch')}.sweep`); }
  sweep(origin) {
    try { return JSON.parse(readFileSync(this.sweepFile(origin), 'utf8')); } catch { return {}; }
  }
  writeSweep(origin, value) {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const file = this.sweepFile(origin);
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  }
  async exclusive(origin, operation) {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const lock = join(this.root, `${this.key(origin, 'watch')}.lock`);
    const owner = join(lock, 'owner.json');
    const identity = JSON.stringify({ pid: process.pid, birth: processBirth(process.pid), origin });
    for (let attempt = 0; ; attempt++) {
      try { mkdirSync(lock, { mode: 0o700 }); break; } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      let holder;
      try { holder = JSON.parse(readFileSync(owner, 'utf8')); } catch {}
      if (!Number.isInteger(holder?.pid) || holder.pid <= 0) throw new Error(`PR watcher lock has no readable owner: ${lock}. Verify nothing holds it before removing it.`);
      if (!lockOwnerGone(holder)) return undefined;
      if (attempt) throw new Error(`PR watcher lock is still held by exited process ${holder.pid} after recovery: ${lock}.`);
      reclaimLock(lock, holder);
    }
    try {
      writeFileSync(owner, identity, { mode: 0o600, flag: 'wx' });
      return await operation();
    } finally {
      if (existsSync(owner)) unlinkSync(owner);
      rmdirSync(lock);
    }
  }
}

export class PullRequestWatcher {
  constructor({ store = new PullRequestStore(), origin, tasks, records, send, notify, query = github, interval = 300000 }) {
    Object.assign(this, { store, origin, tasks, records, send, notify, query, interval });
    this.controller = new AbortController();
    this.closed = false;
    this.errors = new Set();
  }
  candidates() {
    const records = this.records();
    const unique = new Map();
    for (const task of this.tasks().filter((row) => row.originCwd === this.origin && row.worktree && row.branch)) {
      const checkout = records.find((row) => row.path === task.worktree && row.branch === task.branch && !row.removed);
      if (checkout) unique.set(checkout.path, { task, checkout });
    }
    return [...unique.values()];
  }
  async lookup(candidate, url, names = new Map()) {
    const { task, checkout } = candidate;
    if (!names.has(checkout.repo)) names.set(checkout.repo, this.query(['repo', 'view', '--json', 'nameWithOwner'], checkout.repo, this.controller.signal));
    const repo = await names.get(checkout.repo);
    assert.match(repo.nameWithOwner, /^[\w.-]+\/[\w.-]+$/);
    let prs;
    if (url) {
      assert.equal(prIdentity(url).repository.toLowerCase(), repo.nameWithOwner.toLowerCase(), 'PR repository differs from task repository');
      prs = [await this.query(['pr', 'view', url, '--json', fields], checkout.repo, this.controller.signal)];
    } else {
      prs = await this.query(['pr', 'list', '--repo', repo.nameWithOwner, '--head', task.branch, '--state', 'all', '--limit', '20', '--json', fields], checkout.repo, this.controller.signal);
    }
    const matching = prs.filter((pr) => pr.headRefName === task.branch && pr.headRepository?.nameWithOwner?.toLowerCase() === repo.nameWithOwner.toLowerCase());
    if (url) assert.equal(matching.length, 1, 'PR does not match the task branch and head repository');
    if (matching.length > 1) throw new Error(`Multiple PRs match ${task.branch}; use rex_pr_track with the intended URL.`);
    return matching[0];
  }
  save(candidate, pr) {
    prIdentity(pr.url);
    assert.ok(['OPEN', 'CLOSED', 'MERGED'].includes(pr.state), 'Unknown GitHub PR state');
    assert.ok(pr.state !== 'MERGED' || pr.mergedAt, 'Merged PR has no merge timestamp');
    const previous = this.store.list(this.origin).find((row) => row.url === pr.url);
    if (previous) assert.equal(previous.checkout, candidate.checkout.path, 'PR already belongs to a different checkout');
    const row = { ...previous, version: 1, origin: this.origin, url: pr.url, taskId: candidate.task.id,
      name: candidate.task.name, checkout: candidate.checkout.path, repositoryPath: candidate.checkout.repo,
      branch: candidate.task.branch, state: pr.state, mergedAt: pr.mergedAt, head: pr.headRefOid,
      checkedAt: new Date().toISOString(), cleanup: previous?.cleanup ?? 'pending' };
    if (!this.closed) this.store.write(row);
    return row;
  }
  async track(taskId, url) {
    assert.ok(!this.closed, 'PR watcher has stopped');
    assert.ok(!this.tracking, 'PR registration is already in progress');
    this.tracking = (async () => {
      if (this.pending) await this.pending;
      const row = await this.store.exclusive(this.origin, () => this.register(taskId, url));
      assert.ok(row, 'Another coordinator is checking PRs for this origin; try again in a minute');
      return row;
    })().finally(() => { this.tracking = undefined; });
    return this.tracking;
  }
  async register(taskId, url) {
    const candidate = this.candidates().find(({ task }) => task.id === taskId || task.logicalId === taskId);
    assert.ok(candidate, 'Task has no matching retained managed checkout');
    const pr = await this.lookup(candidate, url);
    assert.ok(pr, 'No matching PR found');
    assert.ok(!this.closed, 'PR watcher stopped before registration completed');
    return this.save(candidate, pr);
  }
  async tick() {
    if (this.closed || this.pending || this.tracking) return this.pending;
    this.pending = this.store.exclusive(this.origin, async () => {
      const state = this.store.sweep(this.origin);
      const now = Date.now();
      if (now >= (state.dueAt ?? 0)) await this.sweep(state, now);
      if (this.closed) return;
      for (const row of this.store.list(this.origin)) {
        if (row.state !== 'MERGED' || row.cleanup !== 'pending' || row.notification) continue;
        row.notification = 'pending';
        this.store.write(row);
        this.send({ customType: 'rex_pr_merged', display: true,
          content: `PR merged: ${row.url}\nTask: ${row.name}\nCheckout: ${row.checkout}\nTell Justin in one line that it merged. The cleanup approval waits for him in the command center Inbox; do not ask about cleanup in chat. Merge is not cleanup approval. Do not stop processes or remove anything until he approves.`,
          details: { rexPullRequest: { origin: this.origin, url: row.url } } },
        { triggerTurn: true, deliverAs: 'steer' });
      }
    }).catch((error) => { if (!this.closed) this.notify(`PR watcher: ${String(error)}`); }).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  async sweep(state, startedAt) {
    const names = new Map();
    const saved = this.store.list(this.origin);
    let answered = 0;
    let outage;
    for (const candidate of this.candidates()) {
      if (this.closed) return;
      const known = saved.filter((row) => row.checkout === candidate.checkout.path);
      try {
        if (!known.length) {
          const pr = await this.lookup(candidate, undefined, names);
          answered += 1;
          if (pr) this.save(candidate, pr);
        } else {
          for (const row of known.filter((row) => row.state !== 'MERGED' && row.cleanup === 'pending')) {
            const pr = await this.lookup(candidate, row.url, names);
            answered += 1;
            this.save(candidate, pr);
          }
        }
        this.errors.delete(candidate.task.id);
      } catch (error) {
        const kind = outageOf(error);
        if (kind) {
          outage = { kind, cwd: candidate.checkout.repo, reason: errorText(error).trim().split('\n')[0].slice(0, 160) };
          break;
        }
        if (!this.closed && !this.errors.has(candidate.task.id)) {
          this.errors.add(candidate.task.id);
          this.notify(`PR tracking for ${candidate.task.name} failed: ${String(error)}`);
        }
      }
    }
    if (this.closed) return;
    const next = { dueAt: startedAt + this.interval };
    if (outage) {
      next.outage = outage.kind;
      if (outage.kind === 'rate') next.dueAt = await this.rateReset(outage.cwd);
      if (this.closed) return;
      if (state.outage !== outage.kind) {
        this.notify(outage.kind === 'rate'
          ? `PR checks paused: the GitHub API rate limit is used up. Watches stay registered and checks resume at ${new Date(next.dueAt).toLocaleTimeString()}.`
          : `PR checks paused: GitHub could not be reached (${outage.reason}). Watches stay registered and checks retry every ${Math.round(this.interval / 60000)} minutes.`);
      }
    } else if (state.outage && !answered) {
      next.outage = state.outage;
    } else if (state.outage) {
      this.notify('PR checks resumed: GitHub is reachable again.');
    }
    this.store.writeSweep(this.origin, next);
  }
  async rateReset(cwd) {
    try {
      const { resources } = await this.query(['api', 'rate_limit'], cwd, this.controller.signal);
      const exhausted = [resources?.graphql, resources?.core].filter((row) => row?.remaining === 0 && row.reset * 1000 > Date.now());
      if (exhausted.length) return Math.max(...exhausted.map((row) => row.reset * 1000));
    } catch {}
    return Date.now() + RATE_COOLDOWN;
  }
  receipt(message) {
    const receipt = message.details?.rexPullRequest;
    if (message.customType !== 'rex_pr_merged' || receipt?.origin !== this.origin) return;
    const row = this.store.list(this.origin).find((entry) => entry.url === receipt.url);
    if (row && row.notification !== 'delivered') { row.notification = 'delivered'; this.store.write(row); }
  }
  retain(url) {
    const row = this.store.list(this.origin).find((entry) => entry.url === url);
    assert.ok(row, 'PR is not tracked');
    row.cleanup = 'retained'; this.store.write(row); return row;
  }
  markResidual(checkout, residual) {
    for (const row of this.store.list(this.origin)) {
      if (row.checkout !== checkout || !['pending', 'residual'].includes(row.cleanup)) continue;
      row.cleanup = 'residual'; row.residual = residual; this.store.write(row);
    }
  }
  reconcileCleanup(records) {
    for (const row of this.store.list(this.origin)) {
      if (records.some((record) => record.path === row.checkout && record.removed) && row.cleanup !== 'removed') {
        row.cleanup = 'removed'; this.store.write(row);
      }
    }
  }
  start() {
    const uncertain = this.store.list(this.origin).filter((row) => row.notification === 'pending' && row.cleanup === 'pending');
    if (uncertain.length === 1) this.notify(`Merge notification delivery is uncertain for ${uncertain[0].url}. Inspect /rex-prs; cleanup still needs approval.`);
    if (uncertain.length > 1) this.notify(`Merge notification delivery is uncertain for ${uncertain.length} merged PRs. They wait in the command center Inbox under "Merged, cleanup pending"; cleanup still needs approval.`);
    void this.cycle();
  }
  async cycle() {
    await this.tick();
    if (this.closed) return;
    const due = this.store.sweep(this.origin).dueAt ?? 0;
    const wait = due > Date.now() ? Math.min(due - Date.now(), this.interval) : this.interval;
    this.timer = setTimeout(() => { void this.cycle(); }, wait);
    this.timer.unref();
  }
  async close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.controller.abort();
    await Promise.allSettled([this.pending, this.tracking]);
  }
}
