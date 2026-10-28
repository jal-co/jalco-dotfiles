import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.REX_RECOVERY_PROOF;
if (!root) throw new Error('This worker is only for the disposable recovery proof');
const record = JSON.parse(readFileSync(join(root, 'worker-seed.json'), 'utf8'));
const atomic = (file, value) => { writeFileSync(`${file}.tmp`, JSON.stringify(value)); renameSync(`${file}.tmp`, file); };
const activity = (phase) => atomic(record.activityFile, { version: 1, runningChildId: record.id, sequence: 1, createdAt: Date.now(), updatedAt: Date.now(), latestEvent: phase === 'active' ? 'agent_start' : 'agent_end', phase, agentActive: phase === 'active', turnActive: false, providerActive: false, toolActive: false });
let pending;
let sequence = 0;
const complete = () => {
  if (!pending) return;
  const text = pending.message;
  appendFileSync(record.sessionFile, `${JSON.stringify({ type: 'message', timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text }] } })}\n`);
  appendFileSync(`${record.sessionFile}.tasks`, `${JSON.stringify({ version: 1, type: 'task-done', task: pending.task, generation: record.generationId, at: new Date().toISOString() })}\n`);
  process.stdout.write('\u001b]7501;state=done:app=rex-proof\u001b\\');
  activity('waiting'); pending = undefined;
};
const processInbox = () => {
  if (pending && existsSync(join(root, 'finish'))) { unlinkSync(join(root, 'finish')); complete(); }
  if (pending) return;
  const inbox = readdirSync(root).filter((name) => name.startsWith('worker.jsonl.task-inbox.') && name.endsWith('.json')).sort()[0];
  if (!inbox) return;
  pending = JSON.parse(readFileSync(join(root, inbox), 'utf8')); unlinkSync(join(root, inbox));
  if (pending.type === 'stop') {
    writeFileSync(`${record.sessionFile}.exit`, '{"type":"done"}');
    watcher.close(); return;
  }
  sequence++;
  activity('active');
  process.stdout.write('\u001b]7501;state=working:app=rex-proof\u001b\\');
  if (sequence !== 1) complete();
};
const watcher = watch(root, processInbox);
activity('waiting');
atomic(join(root, 'worker-ready.json'), { ...record, pid: process.pid });
