import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rexBinary, surfaceTarget } from './provider.mjs';
import { agentIdentityFile, boundedSummary, processBirth, taskState } from './tasks.ts';

export class RexRecovery {
  constructor({ store, provider, worktrees, protocol, activity, running, retireStopped, send, notify, flags, owner, originCwd, birth = processBirth }) {
    Object.assign(this, { store, provider, worktrees, protocol, activity, running, retireStopped, send, notify, flags, owner, originCwd, birth });
    this.recovered = new Set();
    this.watchers = new Map();
    this.pending = new Set();
    this.liveness = new Map();
    this.inFlight = new Set();
    this.closed = false;
  }
  capture() {
    for (const child of this.running().values()) {
      const previous = this.store.read(child.id);
      const old = previous?.sessionFile === child.sessionFile ? previous : undefined;
      const policy = this.readPolicy(child.sessionFile);
      this.store.write({
        ...old, version: 1, id: child.id, name: child.name, surface: child.surface,
        sessionFile: child.sessionFile, activityFile: child.activityFile, originCwd: this.originCwd,
        owner: this.owner, identity: old?.identity, persistent: policy.persistent,
        logicalId: policy.logicalId, generationId: policy.generationId, policyHash: policy.policyHash,
        taskId: child.taskId, inboxSequence: child.inboxSequence ?? old?.inboxSequence ?? 0,
        stopRequested: ['pending', 'requested'].includes(child.stopState),
        branch: child.worktree?.branch, worktree: child.worktree?.path,
        model: child.runtimePlan?.model, updatedAt: Date.now(),
      });
    }
    this.observe();
  }
  owned(record) {
    return record.owner.pid === this.owner.pid && record.owner.birth === this.owner.birth;
  }
  identity(record) {
    if (!record.identity?.birth) return undefined;
    const stamp = this.birth(record.identity.pid);
    if (stamp === null || stamp !== record.identity.birth) return false;
    const info = this.provider.process(record.surface);
    const candidates = [info.foreground, info.child, ...(info.ancestors ?? [])].filter(Boolean);
    return candidates.some((process) => process.pid === record.identity.pid) ? true : undefined;
  }
  readPolicy(file) {
    try { return this.protocol.readSubagentSessionPolicy(file); } catch (cause) {
      throw new Error('Saved task policy cannot be validated. Inspect the retained task; automatic recovery was refused.', { cause });
    }
  }
  checkPolicy(record) {
    const policy = this.readPolicy(record.sessionFile);
    if (policy.version !== 2 || policy.logicalId !== record.logicalId || policy.generationId !== record.generationId || policy.policyHash !== record.policyHash || policy.persistent !== record.persistent) {
      throw new Error('Task generation or tool policy changed; recovery refused');
    }
    return policy;
  }
  attest(record) {
    const current = agentIdentityFile(record.sessionFile, record.id);
    const file = existsSync(current) ? current : `${record.sessionFile}.rex-process.json`;
    if (record.identity || !existsSync(file)) return false;
    const identity = JSON.parse(readFileSync(file, 'utf8'));
    if (identity.version !== 1 || identity.id !== record.id || identity.sessionFile !== record.sessionFile || identity.surface !== record.surface || identity.generationId !== record.generationId || identity.policyHash !== record.policyHash) throw new Error('Task process attestation does not match the saved launch');
    record.identity = { pid: identity.pid, birth: identity.birth };
    return true;
  }
  claim(record) {
    return this.store.exclusive(record.id, () => {
      const current = this.store.read(record.id);
      if (!this.owned(current)) {
        const stamp = this.birth(current.owner.pid);
        if (stamp && (!current.owner.birth || stamp === current.owner.birth)) throw new Error('Another live coordinator owns this task');
      }
      this.checkPolicy(current);
      this.attest(current);
      const alive = this.identity(current);
      if (alive !== true && !(alive === false && existsSync(`${current.sessionFile}.exit`))) throw new Error('Agent identity could not be verified; no replacement was launched');
      if (current.worktree && alive === true) {
        const checkout = this.worktrees.records().find((row) => !row.removed && row.path === current.worktree);
        if (!checkout || checkout.lease?.runId !== current.id) throw new Error('Worktree ownership no longer matches this task');
        this.worktrees.verify(checkout);
        if (checkout.lease.pid !== this.owner.pid && this.birth(checkout.lease.pid)) throw new Error('Another coordinator holds the worktree lease');
        checkout.lease = { ...checkout.lease, pid: this.owner.pid };
        this.worktrees.save(checkout);
      }
      current.owner = this.owner;
      delete current.failure;
      this.store.write(current);
      this.recovered.add(current.id);
      return current;
    });
  }
  start() {
    this.capture();
    for (const record of this.store.list().filter((row) => row.originCwd === this.originCwd)) {
      this.provider.sessions.add(surfaceTarget(record.surface).session);
      if (this.flags.recovery && !this.running().has(record.id) && !record.stopConfirmed && !record.completed) {
        try { this.claim(record); } catch (error) { this.notify(`${record.name}: ${String(error)}`); }
      }
    }
    this.observe();
    this.events = spawn(rexBinary(), ['--autostart=false', 'do', fileURLToPath(new URL('./recovery-events.lua', import.meta.url)), '--all', '--fail-fast'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    this.events.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (line) {
          try {
            const event = JSON.parse(line);
            for (const record of this.store.list()) if (event.surface === 'all' || event.surface === record.surface) this.schedule(record.id, true);
          } catch (error) { this.notify(String(error)); }
        }
      }
    });
    this.events.stderr.on('data', (chunk) => { if (!this.closed && !chunk.toString().startsWith('listening:')) this.notify(chunk.toString().trim()); });
    this.events.on('error', (error) => this.notify(`Rex task event transport failed: ${String(error)}`));
    this.events.on('exit', () => { if (!this.closed) this.notify('Rex task event transport ended. Reload the coordinator to reconnect; agents were not restarted.'); });
    for (const record of this.store.list()) this.schedule(record.id);
  }
  observe() {
    const directories = new Map();
    for (const record of this.store.list().filter((row) => row.originCwd === this.originCwd)) {
      for (const path of [record.activityFile, agentIdentityFile(record.sessionFile, record.id), `${record.sessionFile}.rex-process.json`, `${record.sessionFile}.tasks`, `${record.sessionFile}.ledger`, `${record.sessionFile}.exit`]) {
        const directory = dirname(path);
        if (!directories.has(directory)) directories.set(directory, new Map());
        const names = directories.get(directory);
        if (!names.has(basename(path))) names.set(basename(path), new Set());
        names.get(basename(path)).add(record.id);
      }
    }
    for (const [directory, names] of directories) {
      if (this.watchers.has(directory)) this.watchers.get(directory).close();
      if (!existsSync(directory)) continue;
      const watcher = watch(directory, (_event, name) => { for (const id of names.get(String(name)) ?? []) this.schedule(id, String(name).endsWith('.exit')); });
      watcher.on('error', (error) => this.notify(`Rex task file watcher failed: ${String(error)}`));
      this.watchers.set(directory, watcher);
    }
  }
  schedule(id, recheck = false) {
    if (recheck) this.liveness.delete(id);
    if (this.closed || this.pending.has(id)) return;
    this.pending.add(id);
    setImmediate(() => {
      this.pending.delete(id);
      if (this.closed) return;
      try { this.refresh(id); } catch (error) { this.notify(`Rex task ${id}: ${String(error)}`); }
    });
  }
  refresh(id) {
    let record = this.store.read(id);
    if (!record || record.originCwd !== this.originCwd) return;
    if (!this.owned(record) && this.birth(record.owner.pid)) return;
    const child = this.running().get(id);
    if (child && child.sessionFile !== record.sessionFile) { this.capture(); record = this.store.read(id); }
    const policy = this.checkPolicy(record);
    if (this.attest(record)) { this.store.write(record); this.liveness.delete(id); }
    const events = this.protocol.readPersistentTaskEvents(record.sessionFile).filter((row) => row.generation === policy.generationId);
    const ledger = this.protocol.readPersistentDeliveryLedger(record.sessionFile).filter((row) => row.generation === policy.generationId && row.policyHash === policy.policyHash);
    let alive;
    try {
      if (!this.liveness.has(id)) this.liveness.set(id, this.identity(record));
      alive = this.liveness.get(id);
      delete record.failure;
    } catch (error) { record.failure = String(error); }
    if (this.recovered.has(id) && this.owned(record) && !this.running().has(id)) {
      for (const event of events) {
        const outcome = event.type === 'task-done' ? 'delivered' : 'help-requested';
        const key = `${id}/${record.generationId}/${event.task}/${event.type}`;
        if (ledger.some((row) => row.task === event.task && row.outcome === outcome) || this.inFlight.has(key)) continue;
        if (record.pendingReceipts?.includes(key)) {
          record.failure = 'Result delivery is uncertain. Check the retained session before requesting redelivery.';
          this.store.write(record);
          continue;
        }
        this.inFlight.add(key);
        record.pendingReceipts = [...(record.pendingReceipts ?? []), key];
        this.store.write(record);
        this.send({ customType: event.type === 'task-done' ? 'subagent_result' : 'subagent_ping', display: true,
          content: event.type === 'task-done' ? `Recovered task "${record.name}" completed.\n\n${boundedSummary(record.sessionFile, event.at)}` : `Recovered task "${record.name}" needs help: ${event.message ?? ''}`,
          details: { name: record.name, sessionFile: record.sessionFile, logicalId: record.logicalId, generationId: record.generationId, policyHash: record.policyHash, task: event.task, rexReceipt: { id, key, outcome } } },
        { triggerTurn: true, deliverAs: 'steer' });
      }
      record = this.store.read(id);
      if (existsSync(`${record.sessionFile}.exit`) && alive === false) {
        if (record.stopRequested) {
          record.stopConfirmed = true;
          if (record.worktree) {
            const checkout = this.worktrees.records().find((row) => row.path === record.worktree);
            if (checkout?.lease?.pid === this.owner.pid && checkout.lease.runId === id) { checkout.lease = null; this.worktrees.save(checkout); }
          }
          if (!record.stopNotified) {
            this.send({ customType: 'subagent_stop', display: true, content: `Recovered agent "${record.name}" has stopped. Its session and checkout are retained.`, details: { status: 'stopped', facts: { logicalId: record.logicalId } } }, { triggerTurn: true, deliverAs: 'steer' });
            record.stopNotified = true;
          }
        } else if (!record.persistent && !record.completed) {
          const exit = JSON.parse(readFileSync(`${record.sessionFile}.exit`, 'utf8'));
          record.completed = { error: exit.type === 'error' ? exit.errorMessage : undefined };
          this.send({ customType: 'subagent_result', display: true, content: `Recovered task "${record.name}" exited.\n\n${boundedSummary(record.sessionFile)}`, details: { name: record.name, sessionFile: record.sessionFile, error: exit.errorMessage } }, { triggerTurn: true, deliverAs: 'steer' });
        }
      }
    }
    const read = this.activity.readSubagentActivityFile(record.activityFile, record.id);
    const view = taskState(record, read.ok ? read.activity : undefined, events, ledger, alive);
    if (record.state !== view.state || record.reason !== view.reason || record.stopConfirmed || record.completed) {
      Object.assign(record, view, { updatedAt: Date.now() });
      this.store.write(record);
    }
  }
  receipt(message) {
    const receipt = message.details?.rexReceipt;
    if (!receipt) return;
    const record = this.store.read(receipt.id);
    if (!record || !this.owned(record) || message.details.generationId !== record.generationId) return;
    this.checkPolicy(record);
    const rows = this.protocol.readPersistentDeliveryLedger(record.sessionFile);
    const acknowledged = rows.some((row) => row.task === message.details.task && row.outcome === receipt.outcome && row.generation === record.generationId);
    if (acknowledged && !record.pendingReceipts?.includes(receipt.key)) return;
    if (!acknowledged) {
      this.protocol.appendPersistentDeliveryLedger(record.sessionFile, { task: message.details.task, outcome: receipt.outcome, generation: record.generationId, logicalId: record.logicalId, policyHash: record.policyHash });
    }
    record.pendingReceipts = (record.pendingReceipts ?? []).filter((key) => key !== receipt.key);
    this.store.write(record);
    this.inFlight.delete(receipt.key);
    this.schedule(record.id);
  }
  message(message) {
    const details = message.details;
    if (!details) return;
    for (const record of this.store.list().filter((row) => row.originCwd === this.originCwd && this.owned(row))) {
      if (details.sessionFile !== record.sessionFile && details.facts?.logicalId !== record.logicalId) continue;
      if (message.customType === 'subagent_result' && !record.persistent) record.completed = { error: details.error ?? details.errorMessage };
      if (message.customType === 'subagent_stop' && details.status === 'stopped') record.stopConfirmed = true;
      this.store.write(record);
      this.schedule(record.id, true);
    }
  }
  assertNew(params, capacity) {
    const live = [...this.running().values()].find((row) => row.name === params.name);
    if (live) throw new Error(`Task ${params.name} already has a live host agent (${live.id}). No replacement was launched.`);
    const existing = this.store.list().find((row) => row.originCwd === this.originCwd && row.name === params.name && !row.stopConfirmed && !row.completed);
    if (existing) throw new Error(`Task ${params.name} already has a retained agent (${existing.id}). Reconnect or stop it; do not launch a replacement.`);
    if (params.persistent) {
      const ids = new Set(this.store.list().filter((row) => row.originCwd === this.originCwd && row.persistent && !row.stopConfirmed).map((row) => row.id));
      for (const row of this.running().values()) if (row.persistent) ids.add(row.id);
      if (ids.size >= capacity) throw new Error(`Persistent specialist cap (${capacity}) reached, including retained agents. Stop an existing specialist before dispatching another.`);
    }
  }
  async stopMissing(params) {
    const record = this.resolve(params, true);
    if (!record?.persistent) return undefined;
    const { session } = surfaceTarget(record.surface);
    const sessions = this.provider.json(['ls', '--json']).sessions;
    if (!Array.isArray(sessions) || sessions.some((row) => typeof row.session_id !== 'string')) throw new Error('Rex session inventory is invalid; nothing was retired');
    const surface = sessions.some((row) => row.session_id === session)
      ? await this.provider.inspectSurface(record.surface)
      : { kind: 'missing' };
    if (surface.kind === 'unavailable') throw new Error(`Rex terminal absence is unconfirmed: ${surface.error}`);
    if (surface.kind !== 'missing') return undefined;
    return this.store.exclusive(record.id, () => {
      const current = this.store.read(record.id);
      if (current.surface !== record.surface || current.sessionFile !== record.sessionFile) throw new Error('Task binding changed during stop verification');
      if (!this.owned(current)) {
        const stamp = this.birth(current.owner.pid);
        if (stamp && (!current.owner.birth || stamp === current.owner.birth)) throw new Error('Another live coordinator owns this task');
      }
      this.checkPolicy(current);
      this.attest(current);
      if (!current.identity?.birth) throw new Error('Original agent process identity is unavailable; nothing was retired');
      if (this.birth(current.identity.pid) === current.identity.birth) throw new Error('Original agent process is still alive; nothing was retired');
      if (this.running().has(current.id)) this.retireStopped(current.id);
      current.owner = this.owner;
      current.stopRequested = true;
      current.stopConfirmed = true;
      current.state = 'stopped';
      current.reason = 'Rex terminal is missing and original agent process exit is confirmed';
      delete current.failure;
      current.updatedAt = Date.now();
      this.store.write(current);
      this.liveness.delete(current.id);
      return { id: current.id, name: current.name, status: 'stopped', facts: { logicalId: current.logicalId }, sessionFile: current.sessionFile, reason: current.reason };
    });
  }
  resolve(params, includeRunning = false) {
    const candidates = this.store.list().filter((row) => row.originCwd === this.originCwd && (includeRunning || !this.running().has(row.id)) && (params.id ? row.id === params.id || row.logicalId === params.id : row.name === params.name));
    if (candidates.length > 1) throw new Error('Recovered task name is ambiguous; use its exact ID');
    return candidates[0];
  }
  control(name, params) {
    const record = this.resolve(params);
    if (!record) return undefined;
    if (!this.flags.recovery || !this.recovered.has(record.id)) throw new Error('This task is not safely attached. Do not launch a replacement; inspect its retained Rex session.');
    return this.store.exclusive(record.id, () => {
      const current = this.store.read(record.id);
      if (!this.owned(current) || this.identity(current) !== true) throw new Error('Recovered agent process identity is unconfirmed');
      this.checkPolicy(current);
      if (name === 'subagent_interrupt') { this.provider.sendKeys(current.surface, 'esc'); return { status: 'interrupt_requested' }; }
      if (!current.persistent) throw new Error('Recovered ordinary agents support interruption only. Stop this agent in its retained session; it will not be replaced.');
      const events = this.protocol.readPersistentTaskEvents(current.sessionFile).filter((row) => row.generation === current.generationId);
      const ledger = this.protocol.readPersistentDeliveryLedger(current.sessionFile).filter((row) => row.generation === current.generationId);
      const active = ledger.filter((row) => row.outcome === 'dispatched').at(-1)?.task ?? current.taskId;
      const done = events.some((row) => row.task === active && row.type === 'task-done');
      if (current.stopRequested || current.dispatching) throw new Error('A stop or uncertain dispatch is pending; no new task was sent');
      if (name === 'subagent_send' && active && !done) throw new Error('Recovered specialist is busy; no task was sent');
      if (!['subagent_send', 'subagent_stop'].includes(name)) throw new Error('Use graceful stop for a recovered persistent specialist');
      const task = name === 'subagent_send' ? randomUUID() : active ?? 'stop';
      current.inboxSequence = Math.max(Date.now(), (current.inboxSequence ?? 0) + 1);
      current.dispatching = true;
      if (name === 'subagent_stop') current.stopRequested = true;
      this.store.write(current);
      const inbox = this.protocol.writePersistentTaskInbox(current.sessionFile, current.inboxSequence, { type: name === 'subagent_stop' ? 'stop' : 'task', task, message: params.message ?? '' });
      this.protocol.appendPersistentDeliveryLedger(current.sessionFile, { task, outcome: name === 'subagent_send' ? 'dispatched' : 'stop-pending', generation: current.generationId, logicalId: current.logicalId, policyHash: current.policyHash });
      current.dispatching = false;
      if (name === 'subagent_send') current.taskId = task;
      this.store.write(current);
      this.schedule(current.id);
      return { id: current.id, task, inbox, outcome: name === 'subagent_send' ? 'dispatched' : undefined, status: name === 'subagent_stop' ? 'stop_requested' : 'dispatched' };
    });
  }
  close() {
    this.closed = true;
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    this.events?.kill('SIGTERM');
  }
}
