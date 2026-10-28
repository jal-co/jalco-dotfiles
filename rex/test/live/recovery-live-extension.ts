import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processBirth, TaskStore, writeAgentIdentity } from '../../src/tasks.ts';

export default async function recoveryProof(pi: ExtensionAPI) {
  const fixture = process.env.REX_RECOVERY_PROOF;
  if (!fixture) throw new Error('Only load this extension in the disposable recovery test');
  const store = new TaskStore();
  const seed = JSON.parse(readFileSync(join(fixture, 'worker-ready.json'), 'utf8'));
  if (!existsSync(store.file(seed.id))) {
    const module = await import('../../host/maestro/adapters/pi/session.ts');
    const policy = module.writeSubagentSessionPolicy(seed.sessionFile, { owner: 'public', tools: [], deniedTools: [], persistent: true, logicalId: seed.id, generationId: seed.generationId });
    writeAgentIdentity({ version: 1, id: seed.id, sessionFile: seed.sessionFile, surface: seed.surface, pid: seed.pid, birth: processBirth(seed.pid), generationId: seed.generationId, policyHash: policy.policyHash });
    store.write({ ...seed, version: 1, persistent: true, logicalId: seed.id, policyHash: policy.policyHash,
      owner: { pid: process.pid, birth: processBirth(process.pid), session: process.env.REX_SESSION },
      originCwd: fixture });
  }
  const tools = new Map();
  const { default: registerRex } = await import('../../src/index.ts');
  await registerRex({ ...pi, registerTool(tool) { tools.set(tool.name, tool); pi.registerTool(tool); } });
  pi.on('agent_start', (_event, ctx) => ctx.abort());
  pi.on('before_provider_request', () => { throw new Error('The recovery proof must never make a model request'); });
  pi.registerCommand('rex-recovery-proof', {
    description: 'Execute one test-owned lifecycle operation without a model turn',
    handler: async (args, ctx) => {
      const request = JSON.parse(args);
      if (!['subagent_send', 'subagent_stop'].includes(request.name)) throw new Error('Unexpected proof operation');
      if (request.params.name !== seed.name) throw new Error('The proof can only control its own worker');
      const result = await tools.get(request.name).execute('proof-operation', request.params, undefined, undefined, ctx);
      pi.sendMessage({ customType: 'rex-proof-operation', display: true, content: JSON.stringify(result), details: result.details });
    },
  });
}
