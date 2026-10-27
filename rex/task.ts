import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readModules } from './module-config.mjs';
import { processBirth, writeAgentIdentity } from './tasks.mjs';

export default async function rexTask(pi: ExtensionAPI) {
  if (!process.env.REX_SESSION || !process.env.PI_SUBAGENT_ID) return;
  const initial = readModules();
  if (!initial.recovery && !initial.overview) return;
  let visible = false;
  let error = false;
  let blocked = false;
  let aborted = false;
  let current = 'idle';
  const emit = (state: string, message: string, kind?: string) => {
    if (!readModules().overview) {
      if (visible) process.stdout.write('\u001b]7501;state=clear:id=rex-task\u001b\\');
      visible = false;
      return;
    }
    current = state;
    const text = message.replace(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, 300);
    process.stdout.write(`\u001b]7501;id=rex-task:state=${state}:app=pi:msg=${Buffer.from(text).toString('base64')}${kind ? `:kind=${kind}` : ''}\u001b\\`);
    visible = true;
  };
  pi.on('session_start', () => {
    const flags = readModules();
    if (flags.recovery || flags.overview) {
      const sessionFile = process.env.PI_SUBAGENT_SESSION;
      const surface = process.env.PI_SUBAGENT_SURFACE;
      assert.ok(surface?.startsWith(`${process.env.REX_SESSION}/`), 'Task surface does not match its Rex session');
      const policy = JSON.parse(readFileSync(`${sessionFile}.pi-herdr-subagent-policy.json`, 'utf8'));
      writeAgentIdentity({ version: 1, id: process.env.PI_SUBAGENT_ID, sessionFile, surface, pid: process.pid, birth: processBirth(process.pid), generationId: policy.generationId, policyHash: policy.policyHash });
    }
    emit('idle', 'Ready');
  });
  pi.on('agent_start', () => { error = false; blocked = false; aborted = false; emit('working', 'Working'); });
  pi.on('tool_execution_start', (event) => emit(event.toolName === 'ask_user_question' ? 'blocked' : 'working', event.toolName, event.toolName === 'ask_user_question' ? 'question' : undefined));
  pi.on('tool_execution_end', (event) => {
    if (event.toolName === 'caller_ping') blocked = true;
    emit(blocked ? 'blocked' : event.toolName === 'subagent_done' ? 'done' : 'working', blocked ? 'Needs coordinator help' : event.toolName, blocked ? 'question' : undefined);
  });
  pi.on('message_end', (event) => {
    if (event.message.role !== 'assistant') return;
    if (event.message.stopReason === 'error') error = true;
    if (event.message.stopReason === 'aborted') aborted = true;
  });
  pi.on('agent_settled', () => emit(blocked ? 'blocked' : aborted ? 'idle' : error ? 'error' : 'done', blocked ? 'Needs coordinator help' : aborted ? 'Interrupted' : error ? 'Task failed; inspect the task session' : 'Task finished', blocked ? 'question' : undefined));
  pi.on('session_shutdown', () => { if (visible && ['working', 'blocked'].includes(current)) emit('idle', 'Agent stopped'); });
}
