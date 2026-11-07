import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rexBinary, surfaceTarget } from './provider.mjs';
import { agentIdentityFile, boundedSummary, processBirth, processCommand, processParent, probeProcess, taskState } from './tasks.ts';
import { leaseAlive } from './worktrees.mjs';

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

export class RexRecovery {
  constructor({ store, provider, worktrees, protocol, activity, running, retireStopped, send, notify, flags, owner, originCwd, birth = processBirth, command = processCommand, parentOf = processParent, onChange, launch }) {
    Object.assign(this, { store, provider, worktrees, protocol, activity, running, retireStopped, send, notify, flags, owner, originCwd, birth, command, parentOf, onChange, launch });
    this.recovered = new Set();
    this.view = new Map();
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
        model: child.runtimePlan?.model, thinking: child.runtimePlan?.thinking, updatedAt: Date.now(),
      });
    }
    this.observe();
  }
  owned(record) {
    return record.owner.pid === this.owner.pid && record.owner.birth === this.owner.birth;
  }
  probe(record) {
    try {
      if (!record.identity) this.attest(record);
      return probeProcess(record.identity, { birth: this.birth, command: this.command });
    } catch (error) {
      return { state: 'unknown', reason: String(error) };
    }
  }
  identity(record) {
    const probe = probeProcess(record.identity, { birth: this.birth, command: this.command });
    if (probe.state === 'unknown') return undefined;
    if (probe.state === 'crashed') return false;
    const info = this.provider.process(record.surface);
    const candidates = [info.foreground, info.child, ...(info.ancestors ?? [])].filter(Boolean);
    const terminal = new Set(candidates.map((process) => process.pid));
    return terminal.has(record.identity.pid) || this.descendsFrom(record.identity.pid, terminal) ? true : undefined;
  }
  descendsFrom(pid, ancestors) {
    let current = pid;
    for (let depth = 0; depth < 16; depth += 1) {
      current = this.parentOf(current);
      if (!current || current === 1) return false;
      if (ancestors.has(current)) return true;
    }
    return false;
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
    record.identity = { pid: identity.pid, birth: identity.birth, command: identity.command };
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
        if (checkout.lease.pid !== this.owner.pid && leaseAlive(checkout.lease, { birth: this.birth })) throw new Error('Another coordinator holds the worktree lease');
        checkout.lease = { ...checkout.lease, pid: this.owner.pid, birth: this.owner.birth };
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
          this.releaseLease(record);
          if (!record.stopNotified) {
            this.closeTab(record);
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
    if (record.queued && alive === true && this.recovered.has(id) && this.owned(record) && !record.stopRequested && !record.dispatching) {
      const active = ledger.filter((row) => row.outcome === 'dispatched').at(-1)?.task ?? record.taskId;
      if (!active || events.some((row) => row.task === active && row.type === 'task-done')) {
        const queued = record.queued;
        delete record.queued;
        this.dispatch(record, queued.task, queued.message);
      }
    }
    const read = this.activity.readSubagentActivityFile(record.activityFile, record.id);
    const view = taskState(record, read.ok ? read.activity : undefined, events, ledger, alive);
    if (this.recovered.has(id) && this.owned(record) && !record.completed && !record.stopConfirmed) {
      this.view.set(id, { id, name: record.name, model: record.model, state: view.state, reason: view.reason });
    } else this.view.delete(id);
    this.onChange?.();
    if (record.state !== view.state || record.reason !== view.reason || record.stopConfirmed || record.completed) {
      Object.assign(record, view, { updatedAt: Date.now() });
      this.store.write(record);
    }
  }
  attached() { return [...this.view.values()]; }
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
      if (message.customType === 'subagent_stop' && details.status === 'stopped') {
        record.stopConfirmed = true;
        delete record.queued;
        this.closeTab(record);
      }
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
  retire(params) {
    const record = this.resolve(params, true);
    if (!record) return undefined;
    const probe = this.probe({ ...record });
    if (probe.state === 'alive') return undefined;
    if (probe.state === 'unknown') {
      if (this.running().has(record.id) || this.recovered.has(record.id)) return undefined;
      throw new Error(`Agent liveness cannot be established (${probe.reason}); nothing was retired`);
    }
    return this.store.exclusive(record.id, () => {
      const current = this.store.read(record.id);
      if (current.surface !== record.surface || current.sessionFile !== record.sessionFile) throw new Error('Task binding changed during stop verification');
      if (!this.owned(current)) {
        const stamp = this.birth(current.owner.pid);
        if (stamp && (!current.owner.birth || stamp === current.owner.birth)) throw new Error('Another live coordinator owns this task');
      }
      this.checkPolicy(current);
      const confirmed = this.probe(current);
      if (confirmed.state !== 'crashed') throw new Error(`Agent process exit is no longer confirmed (${confirmed.reason}); nothing was retired`);
      if (this.running().has(current.id)) this.retireStopped(current.id);
      current.owner = this.owner;
      current.stopRequested = true;
      current.stopConfirmed = true;
      current.state = 'stopped';
      current.reason = `Retired after confirmed agent exit: ${confirmed.reason}`;
      delete current.failure;
      delete current.queued;
      current.updatedAt = Date.now();
      this.store.write(current);
      this.recovered.delete(current.id);
      this.view.delete(current.id);
      this.liveness.delete(current.id);
      this.releaseLease(current);
      this.closeTab(current);
      return { id: current.id, name: current.name, status: 'retired', facts: { logicalId: current.logicalId }, sessionFile: current.sessionFile, reason: current.reason };
    });
  }
  releaseLease(record, owner = null) {
    if (!record.worktree) return;
    for (const checkout of this.worktrees.records()) {
      if (checkout.removed || checkout.path !== record.worktree || checkout.lease?.runId !== record.id) continue;
      if (checkout.lease.pid !== this.owner.pid && leaseAlive(checkout.lease, { birth: this.birth })) continue;
      checkout.lease = owner && { ...checkout.lease, ...owner };
      this.worktrees.save(checkout);
    }
  }
  crashed(params) {
    const matches = this.store.list().filter((row) => row.originCwd === this.originCwd && !row.stopConfirmed && (params.id ? row.id === params.id || row.logicalId === params.id : row.name === params.name));
    if (matches.length !== 1) return undefined;
    const probe = this.probe({ ...matches[0] });
    if (probe.state !== 'crashed') return undefined;
    return new Error(`Agent process has exited (${probe.reason}); nothing was sent. Use subagent_stop to retire it and free its capacity, or subagent_resume with session ${matches[0].sessionFile} to resume it in its retained tab.`);
  }
  closeTab(record) {
    try {
      this.provider.sessions.add(surfaceTarget(record.surface).session);
      this.provider.closeTab(record.surface);
      if (!record.worktree) return;
      for (const checkout of this.worktrees.records()) {
        if (checkout.removed || checkout.path !== record.worktree || checkout.surfaceId !== record.surface) continue;
        delete checkout.workspaceId;
        delete checkout.surfaceId;
        this.worktrees.save(checkout);
      }
    } catch (error) {
      this.notify(`${record.name}: its tab could not be closed: ${String(error)}`);
    }
  }
  async resume(params) {
    const record = this.store.list().find((row) => row.originCwd === this.originCwd && row.sessionFile === params.sessionPath);
    if (!record) return undefined;
    if (!this.flags.recovery) throw new Error('Recovery is disabled; retained task sessions cannot be resumed');
    if (this.running().has(record.id)) throw new Error(`Task "${record.name}" is still supervised by this coordinator; wait for its result before resuming`);
    const probe = this.probe({ ...record });
    if (probe.state === 'alive') throw new Error(`Task "${record.name}" is still running (${probe.reason}); use subagent_send instead of resuming it`);
    if (probe.state === 'unknown') throw new Error(`Task "${record.name}" liveness cannot be established (${probe.reason}); nothing was resumed`);
    if (record.stopConfirmed) throw new Error(`Task "${record.name}" was stopped and its tab closed; launch a new task instead`);
    const surface = await this.provider.inspectSurface(record.surface);
    if (surface.kind !== 'present') throw new Error(`Task "${record.name}" no longer has its retained tab (${surface.kind}); nothing was resumed`);
    await this.provider.waitForShellReady(record.surface);
    return this.store.exclusive(record.id, () => {
      const current = this.store.read(record.id);
      if (!this.owned(current)) {
        const stamp = this.birth(current.owner.pid);
        if (stamp && (!current.owner.birth || stamp === current.owner.birth)) throw new Error('Another live coordinator owns this task');
      }
      const policy = this.checkPolicy(current);
      if (this.probe(current).state !== 'crashed') throw new Error('Agent process exit is no longer confirmed; nothing was resumed');
      const stamp = Date.now();
      for (const file of [agentIdentityFile(current.sessionFile, current.id), `${current.sessionFile}.rex-process.json`, `${current.sessionFile}.exit`]) {
        if (existsSync(file)) renameSync(file, `${file}.crashed-${stamp}`);
      }
      const artifacts = dirname(dirname(current.activityFile));
      const messageFile = join(artifacts, 'subagent-resume', `${current.id}-${stamp}.md`);
      mkdirSync(dirname(messageFile), { recursive: true });
      writeFileSync(messageFile, params.message || 'Your previous agent process exited before finishing. Continue from where it stopped.', { mode: 0o600 });
      const header = readFileSync(current.sessionFile, 'utf8').split('\n', 1)[0];
      const cwd = JSON.parse(header).cwd ?? current.worktree ?? current.originCwd;
      const autoExit = !current.persistent;
      const tools = this.launch.toolAllowlist(policy.tools?.join(','), autoExit);
      const env = [
        `PI_HERDR_AGENTS_SESSION=${quote(current.sessionFile)}`, 'PI_REX_AGENT=1',
        ...(process.env.PI_CODING_AGENT_DIR ? [`PI_CODING_AGENT_DIR=${quote(process.env.PI_CODING_AGENT_DIR)}`] : []),
        ...(policy.deniedTools?.length ? [`PI_DENY_TOOLS=${quote(policy.deniedTools.join(','))}`] : []),
        `PI_SUBAGENT_NAME=${quote(current.name)}`, `PI_SUBAGENT_AUTO_EXIT=${autoExit ? 1 : 0}`,
        ...(current.persistent ? ['PI_SUBAGENT_PERSISTENT=1', `PI_SUBAGENT_GENERATION_ID=${quote(current.generationId)}`, `PI_SUBAGENT_TASK_ID=${quote(current.taskId ?? '')}`] : []),
        `PI_SUBAGENT_SESSION=${quote(current.sessionFile)}`, `PI_SUBAGENT_ID=${quote(current.id)}`,
        `PI_SUBAGENT_ACTIVITY_FILE=${quote(current.activityFile)}`, `PI_SUBAGENT_SURFACE=${quote(current.surface)}`,
      ];
      const command = [
        `cd ${quote(cwd)} &&`, ...env, 'pi', '--session', quote(current.sessionFile),
        ...this.launch.extensions.flatMap((file) => ['-e', quote(file)]),
        ...(current.model ? ['--model', quote(current.model)] : []),
        ...(current.thinking ? ['--thinking', quote(current.thinking)] : []),
        ...(tools ? ['--tools', quote(tools)] : []),
        quote(`@${messageFile}`),
      ].join(' ');
      this.provider.runScript(current.surface, `${command}; echo '__SUBAGENT_DONE_'$?'__'`, { scriptPath: join(artifacts, 'subagent-scripts', `${current.id}-resume-${stamp}.sh`) });
      this.releaseLease(current, { pid: this.owner.pid, birth: this.owner.birth });
      delete current.identity;
      delete current.completed;
      delete current.failure;
      delete current.queued;
      current.stopRequested = false;
      current.stopConfirmed = false;
      current.stopNotified = false;
      current.owner = this.owner;
      current.state = 'unknown';
      current.reason = `Resumed after ${probe.reason}`;
      current.updatedAt = stamp;
      this.store.write(current);
      this.recovered.add(current.id);
      this.liveness.delete(current.id);
      this.observe();
      this.schedule(current.id);
      return { id: current.id, name: current.name, status: 'resumed', sessionFile: current.sessionFile, surface: current.surface, worktree: current.worktree, reason: current.reason };
    });
  }
  resolve(params, includeRunning = false) {
    const candidates = this.store.list().filter((row) => row.originCwd === this.originCwd && !row.stopConfirmed && (includeRunning || !this.running().has(row.id)) && (params.id ? row.id === params.id || row.logicalId === params.id : row.name === params.name));
    if (candidates.length > 1) throw new Error('Recovered task name is ambiguous; use its exact ID');
    return candidates[0];
  }
  control(name, params) {
    const record = this.resolve(params);
    if (!record) return undefined;
    if (!this.flags.recovery || !this.recovered.has(record.id)) {
      const crashed = this.crashed({ id: record.id });
      if (crashed) throw crashed;
      throw new Error('This task is not safely attached. Do not launch a replacement; inspect its retained Rex session.');
    }
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
      if (!['subagent_send', 'subagent_stop'].includes(name)) throw new Error('Use graceful stop for a recovered persistent specialist');
      if (name === 'subagent_send' && active && !done) {
        if (current.queued) throw new Error(`Recovered specialist is busy and already has queued follow-up ${current.queued.task}; nothing more was queued`);
        current.queued = { task: randomUUID(), message: params.message ?? '' };
        this.store.write(current);
        return { id: current.id, task: current.queued.task, outcome: 'queued', status: 'queued', reason: 'Specialist is mid-turn; this follow-up is delivered when the current turn ends' };
      }
      const discarded = name === 'subagent_stop' ? current.queued?.task : undefined;
      delete current.queued;
      if (name === 'subagent_stop') current.stopRequested = true;
      const task = name === 'subagent_send' ? randomUUID() : active ?? 'stop';
      const inbox = this.dispatch(current, task, params.message ?? '', name === 'subagent_stop' ? 'stop' : 'task');
      this.schedule(current.id);
      return { id: current.id, task, inbox, outcome: name === 'subagent_send' ? 'dispatched' : undefined, status: name === 'subagent_stop' ? 'stop_requested' : 'dispatched', discarded };
    });
  }
  dispatch(current, task, message, type = 'task') {
    current.inboxSequence = Math.max(Date.now(), (current.inboxSequence ?? 0) + 1);
    current.dispatching = true;
    this.store.write(current);
    const inbox = this.protocol.writePersistentTaskInbox(current.sessionFile, current.inboxSequence, { type, task, message });
    this.protocol.appendPersistentDeliveryLedger(current.sessionFile, { task, outcome: type === 'task' ? 'dispatched' : 'stop-pending', generation: current.generationId, logicalId: current.logicalId, policyHash: current.policyHash });
    current.dispatching = false;
    if (type === 'task') current.taskId = task;
    this.store.write(current);
    return inbox;
  }
  close() {
    this.closed = true;
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    this.events?.kill('SIGTERM');
  }
}
