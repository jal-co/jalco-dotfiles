import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { processBirth } from './tasks.mjs';

const execute = promisify(execFile);
const fields = 'url,state,mergedAt,headRefName,headRefOid,headRepository';

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
  async exclusive(origin, operation) {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const lock = join(this.root, `${this.key(origin, 'watch')}.lock`);
    try { mkdirSync(lock, { mode: 0o700 }); } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`PR watcher busy or stale lock: ${lock}. Verify its owner before recovery.`);
      throw error;
    }
    const owner = join(lock, 'owner.json');
    try {
      writeFileSync(owner, JSON.stringify({ pid: process.pid, birth: processBirth(process.pid), origin }), { mode: 0o600, flag: 'wx' });
      return await operation();
    } finally {
      if (existsSync(owner)) unlinkSync(owner);
      rmdirSync(lock);
    }
  }
}

export class PullRequestWatcher {
  constructor({ store = new PullRequestStore(), origin, tasks, records, send, notify, query = github, interval = 60000 }) {
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
  async lookup(candidate, url) {
    const { task, checkout } = candidate;
    const repo = await this.query(['repo', 'view', '--json', 'nameWithOwner'], checkout.repo, this.controller.signal);
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
    this.tracking = this.store.exclusive(this.origin, async () => {
      const candidate = this.candidates().find(({ task }) => task.id === taskId || task.logicalId === taskId);
      assert.ok(candidate, 'Task has no matching retained managed checkout');
      const pr = await this.lookup(candidate, url);
      assert.ok(pr, 'No matching PR found');
      assert.ok(!this.closed, 'PR watcher stopped before registration completed');
      return this.save(candidate, pr);
    }).finally(() => { this.tracking = undefined; });
    return this.tracking;
  }
  async tick() {
    if (this.closed || this.pending || this.tracking) return this.pending;
    this.pending = this.store.exclusive(this.origin, async () => {
      const candidates = this.candidates();
      const saved = this.store.list(this.origin);
      for (const candidate of candidates) {
        if (this.closed) return;
        const known = saved.filter((row) => row.checkout === candidate.checkout.path);
        try {
          if (!known.length) {
            const pr = await this.lookup(candidate);
            if (pr) this.save(candidate, pr);
          } else {
            for (const row of known.filter((row) => row.state !== 'MERGED' && row.cleanup === 'pending')) {
              this.save(candidate, await this.lookup(candidate, row.url));
            }
          }
          this.errors.delete(candidate.task.id);
        } catch (error) {
          if (!this.closed && !this.errors.has(candidate.task.id)) {
            this.errors.add(candidate.task.id);
            this.notify(`PR tracking for ${candidate.task.name} failed: ${String(error)}`);
          }
        }
      }
      if (this.closed) return;
      for (const row of this.store.list(this.origin)) {
        if (row.state !== 'MERGED' || row.cleanup !== 'pending' || row.notification) continue;
        row.notification = 'pending';
        this.store.write(row);
        this.send({ customType: 'rex_pr_merged', display: true,
          content: `PR merged: ${row.url}\nTask: ${row.name}\nCheckout: ${row.checkout}\nAsk Justin whether to clean up this task. Merge is not cleanup approval. Do not stop processes or remove anything until he approves.`,
          details: { rexPullRequest: { origin: this.origin, url: row.url } } },
        { triggerTurn: true, deliverAs: 'steer' });
      }
    }).catch((error) => { if (!this.closed) this.notify(`PR watcher: ${String(error)}`); }).finally(() => { this.pending = undefined; });
    return this.pending;
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
  reconcileCleanup(records) {
    for (const row of this.store.list(this.origin)) {
      if (records.some((record) => record.path === row.checkout && record.removed) && row.cleanup !== 'removed') {
        row.cleanup = 'removed'; this.store.write(row);
      }
    }
  }
  start() {
    for (const row of this.store.list(this.origin)) {
      if (row.notification === 'pending') this.notify(`Merge notification delivery is uncertain for ${row.url}. Inspect /rex-prs; cleanup still needs approval.`);
    }
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, this.interval);
    this.timer.unref();
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.controller.abort();
    await Promise.allSettled([this.pending, this.tracking]);
  }
}
