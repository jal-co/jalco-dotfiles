import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { RexSurfaceProvider } from './provider.mjs';
import { RexWorktrees } from './worktrees.mjs';
import { infrastructureFor, releaseInfrastructure } from './runtime.mjs';
import { coordinatorInstructions } from './instructions.mjs';

export default async function rexAgents(pi: ExtensionAPI) {
  if (!process.env.REX_SESSION) throw new Error('Load this extension inside a Rex terminal.');
  if (process.env.HERDR_ENV === '1') throw new Error('Rex coordinator cannot run in a Herdr pane.');
  const root = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'), 'npm/node_modules/pi-herdr-agents');
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (manifest.version !== '3.3.1') throw new Error(`Rex integration requires pi-herdr-agents 3.3.1, found ${manifest.version}.`);
  const load = (path: string) => import(pathToFileURL(join(root, path)).href);
  const [{ default: host }, { SupervisionCoordinator }, worktreeModule] = await Promise.all([
    load('pi-extension/subagents/index.ts'),
    load('maestro/core/supervision.ts'),
    load('maestro/runtime/worktree-operations.ts'),
  ]);
  const { provider, worktrees, cleanupOperations, worktreeOperations, supervision } = infrastructureFor(process.env.REX_SESSION, () => {
    const provider = new RexSurfaceProvider();
    const worktrees = new RexWorktrees(provider);
    provider.worktrees = worktrees;
    const baseOperations = worktreeModule.createWorktreeOperations();
    const writeManifest = (file, value) => {
      baseOperations.writeWorktreeManifest(file, value);
      worktrees.recordManifest(file, JSON.parse(readFileSync(file, 'utf8')));
    };
    const worktreeOperations = {
      ...baseOperations,
      writeWorktreeManifest: writeManifest,
      persistWorktreeResult: (worktree, state, handoff) => writeManifest(worktree.manifestFile, { ...worktree, ...handoff, state }),
    };
    const cleanupOperations = worktreeModule.createWorktreeCleanupOperations(provider, {
      manifestDir: worktrees.registry,
      managedRoot: worktrees.checkouts,
      liveHolders: () => [],
    });
    cleanupOperations.scan = () => worktrees.records().filter((record) => !record.removed).map((record) => record.path);
    cleanupOperations.readManifests = () => worktrees.records().flatMap((record) => record.manifest ? [record.manifest] : []);
    cleanupOperations.writeManifest = writeManifest;
    const processHolders = cleanupOperations.holders;
    cleanupOperations.holders = async (entry) => {
      const inspection = await processHolders(entry);
      return { ...inspection, blockers: [...inspection.blockers, ...worktrees.leaseHolders(entry.path)] };
    };
    worktrees.checkHolders = async (record) => {
      const live = provider.json(['ls', '--json']).sessions;
      const present = live.some((entry) => entry.session_id === record.workspaceId);
      return processHolders({ path: record.path, workspaceId: present ? record.workspaceId : undefined });
    };
    const supervision = new SupervisionCoordinator(
      async () => ({ complete: true, panes: (await provider.listSurfaces()).map((surface) => ({ paneId: surface.id, workspaceId: surface.workspaceId })) }),
      (id: string) => provider.inspectSurface(id),
    );
    return { provider, worktrees, cleanupOperations, worktreeOperations, supervision };
  });
  pi.on('before_agent_start', (event) => {
    if (event.systemPromptOptions.appendSystemPrompt.startsWith('This is the experimental Rex coordinator,')) {
      event.systemPromptOptions.appendSystemPrompt = '';
    }
    event.systemPromptOptions.sections.rex_coordinator = coordinatorInstructions;
  });
  const guarded: ExtensionAPI = {
    ...pi,
    sendMessage(message, options) {
      worktrees.release(message);
      pi.sendMessage(message, options);
    },
    registerTool(tool) {
      const description = tool.name === 'subagent'
        ? 'Launch a Pi task agent in its own Rex session. Use worktree:{branch,base?} for isolated code changes. Reuse the same task branch and session; never start a second writer. Set persistent:true and interactive:true for follow-ups. Approved implementation authorizes dispatch without another permission question. Results arrive automatically; never poll or invent results. Keep task sessions and checkouts after completion. Cleanup needs separate user approval.'
        : tool.description.replaceAll('Herdr', 'Rex').replaceAll('herdr', 'Rex');
      pi.registerTool({
        ...tool,
        description,
        promptSnippet: description,
        execute: async (id, params, signal, onUpdate, ctx) => {
          const cleanup = ['worktree_list', 'worktree_remove'].includes(tool.name);
          if (tool.name === 'worktree_remove') {
            if (!ctx.hasUI || !await ctx.ui.confirm('Remove Rex worktree?', `Remove ${params.target}? Dirty checkouts and active agents block cleanup. Branches and commits remain. Preservation commits require preserve:true; ignored files are not committed.`)) {
              throw new Error('Rex worktree removal was not confirmed. Nothing removed.');
            }
            return worktrees.exclusive(() => tool.execute(id, params, signal, onUpdate, { ...ctx, cwd: homedir() }));
          }
          return tool.execute(id, params, signal, onUpdate, cleanup ? { ...ctx, cwd: homedir() } : ctx);
        },
      });
    },
    registerCommand(name, command) {
      if (['worktree', 'subagents-init'].includes(name)) return;
      pi.registerCommand(name, command);
    },
  };
  host(guarded, {
    cleanupOperations: () => cleanupOperations,
    infrastructure: {
      surfaceProvider: provider,
      supervision,
      worktreeOperations,
      launchOperations: {
        worktree: worktreeOperations,
        createPane: (name: string, cwd: string) => provider.createSurface({ name, cwd }),
        createWorktree: async (name: string, cwd: string, branch: string, base: string) => {
          const surface = await provider.createWorktreeSurface({ name, cwd, branch, base });
          return { ...surface, paneId: surface.surfaceId };
        },
        waitForShellReady: (id: string) => provider.waitForShellReady(id),
        runScript: (id: string, command: string, options) => provider.runScript(id, command, options),
        closePane: (id: string) => provider.closeSurface(id),
      },
    },
  });
  pi.on('session_shutdown', (event) => releaseInfrastructure(process.env.REX_SESSION, event.reason));
}
