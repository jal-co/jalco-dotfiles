import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readModules } from './module-config.mjs';
import { processBirth, writeAgentIdentity } from './tasks.mjs';

type Status = 'idle' | 'working' | 'blocked' | 'done' | 'error';
type BlockKind = 'question' | 'permission';

declare global {
  var rexNativeStatusCleanup: (() => void) | undefined;
}

export default async function rexTask(pi: ExtensionAPI) {
  if (!process.env.REX_SESSION) return;
  globalThis.rexNativeStatusCleanup?.();
  let enabled = false;
  let current: Status = 'idle';
  let running = false;
  let blocked = false;
  let outcome: 'error' | 'aborted' | undefined;
  const questions = new Set<string>();
  const prompts: BlockKind[] = [];
  const emit = (state: Status, message: string, kind?: BlockKind) => {
    current = state;
    if (!enabled) return;
    let text = '';
    let bytes = 0;
    for (const character of message.replace(/[\p{Cc}\p{Cf}]/gu, ' ')) {
      bytes += Buffer.byteLength(character);
      if (bytes > 2048) break;
      text += character;
    }
    process.stdout.write(`\u001b]7501;id=rex-task:state=${state}:app=pi:msg=${Buffer.from(text).toString('base64')}${kind ? `:kind=${kind}` : ''}\u001b\\`);
  };
  const update = (message = 'Working') => {
    const kind = prompts.at(-1) ?? (blocked || questions.size ? 'question' : undefined);
    if (kind) emit('blocked', blocked ? 'Needs coordinator help' : 'Waiting for user', kind);
    else emit(running ? 'working' : 'idle', running ? message : 'Ready');
  };
  const unsubscribe = [
    pi.on('session_start', (_event, ctx) => {
      if (process.env.PI_SUBAGENT_ID) {
        const flags = readModules();
        if (flags.recovery || flags.overview) {
          const sessionFile = process.env.PI_SUBAGENT_SESSION;
          const surface = process.env.PI_SUBAGENT_SURFACE;
          assert.ok(surface?.startsWith(`${process.env.REX_SESSION}/`), 'Task surface does not match its Rex session');
          const policy = JSON.parse(readFileSync(`${sessionFile}.pi-herdr-subagent-policy.json`, 'utf8'));
          writeAgentIdentity({ version: 1, id: process.env.PI_SUBAGENT_ID, sessionFile, surface, pid: process.pid, birth: processBirth(process.pid), generationId: policy.generationId, policyHash: policy.policyHash });
        }
      }
      enabled = ctx.mode === 'tui';
      emit('idle', 'Ready');
    }),
    pi.on('agent_start', () => {
      running = true; blocked = false; outcome = undefined;
      questions.clear(); prompts.length = 0;
      emit('working', 'Working');
    }),
    pi.on('tool_execution_start', (event) => {
      if (event.toolName === 'ask_user_question') questions.add(event.toolCallId);
      update(event.toolName);
    }),
    pi.on('tool_execution_end', (event) => {
      questions.delete(event.toolCallId);
      if (event.toolName === 'caller_ping' && !event.isError) blocked = true;
      update(event.toolName);
    }),
    pi.on('ui_prompt_start', (event) => {
      prompts.push(event.kind === 'confirm' ? 'permission' : 'question');
      update();
    }),
    pi.on('ui_prompt_end', (event) => {
      const kind = event.kind === 'confirm' ? 'permission' : 'question';
      const index = prompts.lastIndexOf(kind);
      if (index !== -1) prompts.splice(index, 1);
      update();
    }),
    pi.on('message_end', (event) => {
      if (event.message.role !== 'assistant') return;
      const reason = event.message.stopReason;
      outcome = reason === 'error' || reason === 'aborted' ? reason : undefined;
    }),
    pi.on('agent_settled', (event) => {
      running = false;
      if (event.aborted || outcome === 'aborted') emit('idle', 'Interrupted');
      else if (outcome === 'error') emit('error', 'Task failed; inspect the session');
      else if (blocked || questions.size || prompts.length) update();
      else emit('done', 'Task finished');
    }),
    pi.on('session_shutdown', () => close()),
  ];
  const close = () => {
    if (enabled && current !== 'done' && current !== 'error') {
      process.stdout.write('\u001b]7501;state=clear:id=rex-task\u001b\\');
    }
    enabled = false;
    unsubscribe.forEach((off) => off());
    if (globalThis.rexNativeStatusCleanup === close) globalThis.rexNativeStatusCleanup = undefined;
  };
  globalThis.rexNativeStatusCleanup = close;
}
