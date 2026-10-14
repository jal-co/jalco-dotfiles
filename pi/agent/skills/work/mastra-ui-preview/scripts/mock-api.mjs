import http from 'node:http';
const now = '2026-09-01T12:00:00.000Z';
const stagesWork = ['intake','triage','planning','execute','review','done'];
const items = [];
let n = 0;
for (const stage of stagesWork) for (let i = 0; i < (stage==='intake'?14:stage==='done'?3:5); i++) {
  n++;
  items.push({
    id: `w${n}`, orgId: 'o', createdBy: 'u', factoryProjectId: 'factory-1', board: 'work',
    externalSource: { integrationId: 'github', type: 'issue', externalId: `github:${n}`, url: null },
    parentWorkItemId: null, title: `Card ${n}: ${stage} task with a reasonably long title to wrap`, stages: [stage],
    stageHistory: [{ stage, enteredAt: now, by: 'u' }], sessions: {}, metadata: { labels: ['bug'], author: 'alice' },
    triageType: null, acceptedAt: null, commentCount: 0, feedActivityAt: null, revision: 1, createdAt: now, updatedAt: now,
  });
}
const board = (id, title, phases) => ({ id, title, initialPhase: 'intake', phases: phases.map(([pid, t, kind, role]) => ({ id: pid, title: t, kind, ...(role ? { role } : {}), transitions: [] })) });
const catalog = { boards: [
  board('work','Work',[['intake','Intake','resting'],['triage','Triage','working','triage'],['planning','Planning','working','plan'],['execute','Building','working','build'],['review','Review','resting'],['done','Done','terminal'],['canceled','Canceled','terminal']]),
  board('review','Review',[['intake','Intake','resting'],['review','Reviewing','working','review'],['done','Done','terminal'],['canceled','Canceled','terminal']]),
]};
const issue = k => ({ number: k, title: `Issue ${k}`, url: `https://github.com/acme/app/issues/${k}`, author: 'alice', labels: ['bug'], comments: 0, createdAt: now, updatedAt: now });
const blocks = Array.from({ length: 40 }, (_, i) => ({ id: 'pb'+i, status: 'published', hasDraft: false, createdAt: now, updatedAt: now, name: `Prompt block ${i+1}`, description: 'A reusable instruction block used across agents.', content: 'You are helpful.' }));
const routes = [
  [/\/api\/mcp\/v0\/servers$/, () => ({ servers: [], total_count: 0, next: null })],
  [/\/api\/workspaces$/, () => ({ workspaces: [] })],
  [/\/api\/processors$/, () => ({})],
  [/\/api\/scores\/scorers$/, () => ({})],
  [/\/api\/editor\/builder\/settings$/, () => ({ enabled: false })],
  [/\/refresh-events$/, () => ({})],
  [/\/api\/auth\/capabilities$/, () => ({ enabled: false, login: null })],
  [/\/stored\/prompt-blocks$/, () => ({ total: blocks.length, page: 0, perPage: 40, hasMore: false, promptBlocks: blocks })],
  [/\/api\/agents$/, () => ({})],
  [/\/api\/workflows$/, () => ({})],
  [/\/api\/tools$/, () => ({})],
  [/\/api\/scorers$/, () => ({})],
  [/\/api\/system\/packages$/, () => ({ packages: [], isDev: true, cmsEnabled: true, storageType: 'mock', observabilityStorageType: 'mock' })],
  [/\/api\/observability\/.*$/, () => ({})],
  [/\/feed-events$/, () => ({ events: [] })],
  [/\/audit$/, () => ({ events: [], actors: {} })],
  [/\/auth\/me$/, () => ({ authenticated: true, user: { userId: 'u', email: 'a@b.co', name: 'Alice', organizationId: 'o' }, provider: 'better-auth' })],
  [/\/web\/config\/models$/, () => ({ models: [] })],
  [/\/web\/config\/providers$/, () => ({ providers: [] })],
  [/\/web\/config\/features$/, () => ({ knowledge: false })],
  [/\/boards$/, () => catalog],
  [/\/web\/factory\/projects$/, () => ({ projects: [{ id: 'factory-1', name: 'Factory' }] })],
  [/\/source-control-connections$/, () => ({ connections: [{ id: 'c1', integrationId: 'github', installationId: '1', repositories: [{ id: 'repo-1', branch: 'main', sandboxWorkdir: '', repository: { slug: 'acme/app', defaultBranch: 'main' } }] }] })],
  [/\/work-items$/, () => ({ workItems: items, runningSessionIds: [], parkedSessionIds: [] })],
  [/\/intake\/config$/, () => ({ config: { github: { enabled: true, sourceIds: ['acme/app'] } } })],
  [/\/intake\/bindings$/, () => ({ bindings: [] })],
  [/\/intake\/label-routes$/, () => ({ routes: [] })],
  [/\/(linear|incidentio|jira|gitlab)\/status$/, () => ({ connected: false })],
  [/\/factory\/projects\/[^/]+\/sessions$/, () => ({ sessions: [] })],
  [/\/github\/projects\/repo-1\/issues$/, () => ({ issues: Array.from({length: 6}, (_, i) => issue(100 + i)), nextPage: null })],
  [/\/github\/projects\/repo-1\/prs$/, () => ({ pullRequests: [], nextPage: null })],
  [/\/mention-roster$/, () => ({ members: [] })],
  [/\/decisions$/, () => ({ decisions: [] })],
  [/\/attention$/, () => ({ items: [], hasMore: false, kinds: Object.fromEntries(['automation-failed','automation-proposed','mention','activity','supervisor-finding','agent-waiting'].map(k => [k, { open: 0, unread: 0, latest: null }])) })],
  [/\/active-runs$/, () => ({ runs: [] })],
];
http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', req.headers.origin || '*');
  res.setHeader('access-control-allow-headers', req.headers['access-control-request-headers'] || '*'); res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-methods', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = req.url.split('?')[0];
  for (const [re, fn] of routes) if (re.test(url)) {
    let out = fn(); let status = 200;
    if (Array.isArray(out)) [status, out] = out;
    res.writeHead(status, { 'content-type': 'application/json' }); return res.end(JSON.stringify(out));
  }
  console.log('UNMOCKED', req.method, req.url);
  res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
}).listen(Number(process.env.PORT || 4111), () => console.log('mock api on', process.env.PORT || 4111));
