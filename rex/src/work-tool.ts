import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { addWork, changeWork, describeWork, findWork, readWork, recordRelease, STATES, updateWork, workSummary } from './work.ts';
import { WorkHeartbeat } from './work-heartbeat.ts';

const literals = (values: string[]) => Type.Union(values.map((value) => Type.Literal(value)));
const text = (description: string) => Type.Optional(Type.String({ description }));
const list = (description: string) => Type.Optional(Type.Array(Type.String(), { description }));
const numbers = (description: string) => Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { description }));

export function runWork(params, file?: string) {
  const { action, id, all, version, evidence, included, ...changes } = params;
  if (action === 'show') {
    const doc = readWork(file);
    return id ? describeWork(doc, findWork(doc, id)) : workSummary(doc, { all });
  }
  if (action !== 'add' && !id) throw new Error(`${action} needs a work ID such as w3.`);
  const { doc, result } = updateWork((current) => {
    if (action === 'add') return addWork(current, changes);
    if (action === 'release') return recordRelease(current, id, { version, evidence, included });
    return changeWork(current, id, changes);
  }, file);
  return `${action === 'add' ? 'Queued' : 'Updated'} ${result.id}. Nothing was started, created or published.\n${describeWork(doc, result)}`;
}

export function registerWork(pi: ExtensionAPI) {
  let heartbeat: WorkHeartbeat | undefined;
  pi.on('session_start', async (_event, ctx) => {
    await heartbeat?.close();
    heartbeat = new WorkHeartbeat({
      send: (notes) => pi.sendMessage({
        customType: 'rex_work_heartbeat', display: true,
        content: `Work queue heartbeat, a status notice and not approval:\n${notes.map((note) => `- ${note}`).join('\n')}\nTell Justin in one short line per item. Do not start, publish or clean up anything because of it.`,
      }, { triggerTurn: true, deliverAs: 'followUp' }),
      notify: (message) => ctx.ui.notify(message, 'warning'),
    });
    heartbeat.start();
  });
  pi.on('session_shutdown', async () => { await heartbeat?.close(); });
  pi.registerTool({
    name: 'rex_work', label: 'Work queue',
    description: 'Durable Rex work queue for work beyond Linear tickets. A fix is a sentence with optional repo, issue, task and PR links. A batch groups fixes into one package bump and one downstream integration PR, with its release, inclusion evidence and steps. Actions: show (all or one ID), add, update (title, note, links, state, members, dependencies, steps) and release (version, evidence, included fix IDs). Validates links, membership and dependency cycles; done is refused while anything blocks it. A heartbeat checks every 10 minutes: merged fix PRs mark fixes done, fixes without a PR are searched for an existing merged fix and flagged, the newest alpha of each batch package is checked against its changelog, and a downstream pin or merged downstream PR lands the batch. Records intent only: it never launches agents, creates or changes Linear issues, commits, publishes or cleans up.',
    promptSnippet: 'Record and inspect durable fixes and delivery batches in the Rex work queue; recording never authorizes execution',
    promptGuidelines: [
      'Use rex_work when Justin asks to queue a fix, put changes in a package bump, leave something out of a batch, or asks what is ready to land. A fix can be just a sentence.',
      'rex_work only records intent. A queued entry never authorizes launching agents, creating or updating Linear issues, commits, pushes, PRs, publication or cleanup; ask for those exactly as before.',
      'A rex_work_heartbeat message reports what the work queue heartbeat changed or flagged. Tell Justin in one line; it is not approval to start, publish or clean up anything.',
      'Record a release with rex_work only from evidence you have seen, such as the published changelog or package contents, and confirm each included fix by ID. Never infer inclusion from a version number.',
    ],
    parameters: Type.Object({
      action: literals(['show', 'add', 'update', 'release']),
      id: text('Work ID such as w3. Required for update and release; for show, omit to list open work'),
      all: Type.Optional(Type.Boolean({ description: 'show: include done and dropped work' })),
      kind: Type.Optional(literals(['fix', 'batch'])),
      title: text('One sentence describing the work'),
      note: text('Longer context. An empty string clears it'),
      state: Type.Optional(literals(STATES)),
      repo: text('Repository name or path. An empty string clears any link'),
      issue: text('Linear issue ID or URL'),
      task: text('Rex task name or ID'),
      pr: text('GitHub PR URL, for a batch its downstream PR'),
      package: text('Batch: the package being bumped, such as @mastra/playground-ui'),
      downstream: text('Batch: the repository receiving the bump, such as platform'),
      steps: list('Batch: steps to append. A new batch without steps gets bump, integrate, verify and open one PR'),
      check: numbers('Batch: step numbers to mark done'),
      uncheck: numbers('Batch: step numbers to mark not done'),
      members: list('Batch: fix IDs to include'),
      removeMembers: list('Batch: fix IDs to leave out'),
      dependsOn: list('Work IDs that must be done first'),
      removeDependsOn: list('Dependencies to remove'),
      dismissFlag: Type.Optional(Type.Boolean({ description: 'Clear a heartbeat flag such as a possible existing fix; that PR is not flagged again' })),
      version: text('release: the published package version'),
      evidence: text('release: where the release and its contents were confirmed'),
      included: list('release: member fix IDs confirmed in this version'),
    }),
    async execute(_id, params) {
      const output = runWork(params);
      if (params.action !== 'show') heartbeat?.poke();
      return { content: [{ type: 'text', text: output }], details: { action: params.action, id: params.id } };
    },
  });
  pi.registerCommand('rex-work', {
    description: 'Show the work queue: /rex-work for open work, /rex-work all, or /rex-work w3',
    handler: async (args, ctx) => {
      const value = args.trim();
      ctx.ui.notify(runWork({ action: 'show', all: value === 'all', id: value && value !== 'all' ? value : undefined }), 'info');
    },
  });
  pi.registerCommand('rex-fix', {
    description: 'Queue a fix from one sentence: /rex-fix <what should change>. Starts nothing',
    handler: async (args, ctx) => {
      ctx.ui.notify(runWork({ action: 'add', title: args }), 'info');
    },
  });
}
