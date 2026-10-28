import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function liveTest(pi: ExtensionAPI) {
  if (!process.env.REX_PROOF_DIR) throw new Error('This extension is only for a disposable Rex test session.');
  pi.registerCommand('rex-proof-reload', {
    description: 'Reload the disposable test coordinator',
    handler: async (_args, ctx) => { await ctx.reload(); },
  });
}
