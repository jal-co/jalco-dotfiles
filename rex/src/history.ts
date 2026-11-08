import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

function sessionSnapshot(file) {
  assert.ok(isAbsolute(file), 'Session log path must be absolute');
  const before = statSync(file);
  assert.ok(before.isFile(), `Session log is not a regular file: ${file}`);
  const bytes = readFileSync(file);
  const after = statSync(file);
  assert.ok(before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, `Session log changed during archival: ${file}`);
  const header = JSON.parse(bytes.subarray(0, bytes.indexOf(10) < 0 ? bytes.length : bytes.indexOf(10)).toString('utf8'));
  assert.equal(header.type, 'session', `Not a Pi session log: ${file}`);
  assert.match(header.id, /^[a-zA-Z0-9-]+$/, 'Pi session ID is missing or malformed');
  return { bytes, sessionId: header.id, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export class TaskHistory {
  constructor(root = process.env.REX_HISTORY_ROOT ?? join(homedir(), '.rex', 'history')) { this.root = root; }
  archive({ checkout, tasks, coordinatorSession, pullRequests = [] }) {
    const sources = new Map(tasks.filter((task) => task.worktree === checkout.path).map((task) => [task.sessionFile, task]));
    const manifestSession = checkout.manifest?.value.sessionFile;
    if (manifestSession && !sources.has(manifestSession)) sources.set(manifestSession, { id: checkout.manifest.value.id, name: checkout.branch });
    if (!sources.size) {
      assert.ok(!checkout.manifest, 'Task manifest has no session log; inspect it before cleanup');
      return [];
    }
    assert.ok(coordinatorSession, 'Coordinator session log is required before task cleanup');
    const coordinator = sessionSnapshot(coordinatorSession);
    const snapshots = [...sources].map(([file, task]) => ({ file, task, snapshot: sessionSnapshot(file) }));
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    return snapshots.map(({ file, task, snapshot }) => {
      const id = createHash('sha256').update(`${checkout.path}\0${file}\0${snapshot.sha256}\0${coordinator.sha256}`).digest('hex');
      const directory = join(this.root, id);
      const record = { version: 1, id, taskId: task.id, name: task.name ?? checkout.branch, branch: checkout.branch,
        checkout: checkout.path, repository: checkout.repo, archivedAt: new Date().toISOString(),
        pullRequests: pullRequests.filter((row) => row.checkout === checkout.path).map((row) => row.url),
        taskLog: { original: file, archived: join(directory, 'task.jsonl'), sessionId: snapshot.sessionId, sha256: snapshot.sha256 },
        coordinatorLog: { original: coordinatorSession, archived: join(directory, 'coordinator.jsonl'), sessionId: coordinator.sessionId, sha256: coordinator.sha256 } };
      if (!existsSync(directory)) {
        const pending = join(this.root, `.pending-${randomUUID()}`);
        mkdirSync(pending, { mode: 0o700 });
        writeFileSync(join(pending, 'task.jsonl'), snapshot.bytes, { mode: 0o600, flag: 'wx' });
        writeFileSync(join(pending, 'coordinator.jsonl'), coordinator.bytes, { mode: 0o600, flag: 'wx' });
        writeFileSync(join(pending, 'record.json'), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        renameSync(pending, directory);
      }
      this.verify(record);
      return record;
    });
  }
  verify(record) {
    const saved = JSON.parse(readFileSync(join(this.root, record.id, 'record.json'), 'utf8'));
    assert.equal(saved.id, record.id, 'Task history identity mismatch');
    for (const [kind, file] of [['taskLog', 'task.jsonl'], ['coordinatorLog', 'coordinator.jsonl']]) {
      const path = join(this.root, record.id, file);
      assert.equal(saved[kind].archived, path, 'Task history path mismatch');
      const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
      assert.equal(digest, record[kind].sha256, `Task history verification failed: ${path}`);
      assert.equal(saved[kind].sha256, digest, 'Task history digest mismatch');
    }
  }
  list(query = '') {
    if (!existsSync(this.root)) return [];
    const needle = query.toLowerCase();
    return readdirSync(this.root).filter((name) => /^[a-f0-9]{64}$/.test(name)).map((name) => {
      const row = JSON.parse(readFileSync(join(this.root, name, 'record.json'), 'utf8'));
      assert.equal(row.version, 1); assert.equal(row.id, name);
      assert.equal(row.taskLog.archived, join(this.root, name, 'task.jsonl'));
      assert.equal(row.coordinatorLog.archived, join(this.root, name, 'coordinator.jsonl'));
      return row;
    }).filter((row) => [row.taskId, row.name, row.branch, row.checkout, ...(row.pullRequests ?? [])].some((value) => String(value ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  }
}
