import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { PullRequestWatcher, PullRequestStore } from './pull-requests.mjs';
import { TaskStore } from './tasks.ts';

export function registerPullRequests(pi: ExtensionAPI, records: () => unknown[]) {
  const store = new PullRequestStore();
  let watcher: PullRequestWatcher | undefined;
  const receipts = (ctx) => {
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === 'message' && entry.message.role === 'custom') watcher?.receipt(entry.message);
    }
  };
  pi.on('session_start', async (_event, ctx) => {
    await watcher?.close();
    watcher = new PullRequestWatcher({ store, origin: ctx.cwd, tasks: () => new TaskStore().list(), records,
      send: (message, options) => pi.sendMessage(message, options),
      notify: (message) => ctx.ui.notify(message, 'warning') });
    receipts(ctx);
    watcher.reconcileCleanup(records());
    watcher.start();
  });
  pi.on('agent_settled', (_event, ctx) => receipts(ctx));
  pi.on('session_shutdown', async (_event, ctx) => { receipts(ctx); await watcher?.close(); });
  pi.registerTool({
    name: 'rex_pr_track', label: 'Track task PR',
    description: 'Persist a GitHub PR watch for a retained Rex task. Pass its task/logical ID and canonical PR URL after authorized publication. GitHub repository and head branch must match the task. Watches survive reloads and restarts; merge notifications ask Justin before cleanup. Never grants cleanup approval.',
    parameters: Type.Object({ taskId: Type.String(), url: Type.String() }),
    async execute(_id, params) {
      if (!watcher) throw new Error('PR watcher has not started');
      const row = await watcher.track(params.taskId, params.url);
      void watcher.tick();
      return { content: [{ type: 'text', text: JSON.stringify(row) }], details: row };
    },
  });
  pi.registerCommand('rex-prs', {
    description: 'Show tracked PRs, merge notification delivery and cleanup state',
    handler: async (_args, ctx) => {
      const rows = store.list(ctx.cwd);
      ctx.ui.notify(rows.map((row) => `${row.url} | ${row.state} | cleanup: ${row.cleanup} | notification: ${row.notification ?? 'not sent'}`).join('\n') || 'No tracked PRs yet. Managed task branches are checked every minute while the coordinator runs.', 'info');
    },
  });
  pi.registerCommand('rex-pr-retain', {
    description: 'Keep a tracked PR task without further cleanup prompts: /rex-pr-retain <PR URL>',
    handler: async (args, ctx) => {
      if (!watcher) throw new Error('PR watcher has not started');
      const row = watcher.retain(args.trim());
      ctx.ui.notify(`Keeping ${row.checkout}. No processes or files were removed.`, 'info');
    },
  });
  return { entries: (origin: string) => store.list(origin), reconcileCleanup: (entries) => watcher?.reconcileCleanup(entries) };
}
