import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { isConnectivityError } from './pull-request-watcher.ts';
import { cleanText } from './tasks.ts';
import { changeWork, isClosed, readWork, recordRelease, updateWork, workFile, workStatus } from './work.ts';

const exec = promisify(execFile);
const PR = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/;
const SEARCH_EVERY = 6 * 3_600_000;
const SEARCHES_PER_TICK = 5;
const COMMON = new Set(['should', 'would', 'could', 'there', 'their', 'about', 'after', 'before', 'with', 'from', 'into', 'when', 'that', 'this', 'than', 'then', 'them', 'they', 'have', 'make', 'some', 'more', 'also', 'later', 'upstream', 'downstream', 'address', 'issue', 'fixes', 'needs']);

export const command = async (file, args) => (await exec(file, args, {
  encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' },
})).stdout;

export function compareVersions(left, right) {
  const parse = (value) => {
    const cut = String(value).indexOf('-');
    return { core: String(cut < 0 ? value : value.slice(0, cut)).split('.').map(Number), pre: cut < 0 ? [] : value.slice(cut + 1).split('.') };
  };
  const [a, b] = [parse(left), parse(right)];
  for (let index = 0; index < 3; index += 1) if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const [x, y] = [a.pre[index], b.pre[index]];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    return /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x < y ? -1 : 1;
  }
  return 0;
}

export function changelogLists(changelog, version, number) {
  const heading = new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').exec(changelog);
  if (!heading) return undefined;
  return new RegExp(`/pull/${number}\\b|#${number}\\b`).test(changelog.slice(heading.index));
}

export const searchTerms = (title) => [...new Set(cleanText(title).toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [])].filter((word) => !COMMON.has(word)).slice(0, 4);

const PACKAGE = /^(?:@[\w.-]+\/)?[\w.-]+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const githubOf = (repository) => /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(repository?.url ?? '')?.[1];
const localPath = (repo) => (isAbsolute(repo) ? repo : /^[\w.-]+$/.test(repo) && !/^\.+$/.test(repo) ? join(homedir(), 'dev', repo) : undefined);
const reason = (error) => cleanText(error.stderr || error.message).slice(0, 300);

async function githubRepository(repo, run) {
  if (!repo) return undefined;
  if (/^[\w.-]+\/[\w.-]+$/.test(repo)) return repo;
  if (!localPath(repo) || !existsSync(localPath(repo))) return undefined;
  const url = (await run('git', ['-C', localPath(repo), 'remote', 'get-url', 'origin'])).trim();
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url)?.[1];
}

async function checkFixes(doc, { run, now, searched, errors }) {
  const facts = [];
  let budget = SEARCHES_PER_TICK;
  for (const fix of doc.entries.filter((entry) => entry.kind === 'fix' && !isClosed(entry))) {
    try { budget = await checkFix(fix, { run, now, searched, facts, budget }); } catch (error) { errors.push(`${fix.id}: ${reason(error)}`); }
  }
  return facts;
}

async function checkFix(fix, { run, now, searched, facts, budget }) {
  const linked = PR.exec(fix.links.pr ?? '');
  if (linked) {
    const pr = JSON.parse(await run('gh', ['pr', 'view', linked[2], '-R', linked[1], '--json', 'state,mergedAt,mergeCommit']));
    if (pr.state === 'MERGED') facts.push({ type: 'merged', id: fix.id, pr: fix.links.pr, number: Number(linked[2]), at: pr.mergedAt, sha: pr.mergeCommit?.oid });
    if (pr.state === 'CLOSED') facts.push({ type: 'flag', id: fix.id, pr: fix.links.pr, text: `PR #${linked[2]} was closed without merging` });
    return budget;
  }
  if (budget <= 0 || now - (searched.get(fix.id) ?? 0) < SEARCH_EVERY) return budget;
  const repo = await githubRepository(fix.links.repo, run);
  if (!repo) return budget;
  searched.set(fix.id, now);
  const issue = /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,7}$/.test(fix.links.issue ?? '') ? fix.links.issue.toUpperCase() : undefined;
  const terms = issue ? [issue] : searchTerms(fix.title);
  if (terms.length < (issue ? 1 : 2)) return budget;
  const since = fix.createdAt.slice(0, 10);
  const found = JSON.parse(await run('gh', ['pr', 'list', '-R', repo, '--state', 'merged', '--search', `${terms.join(' ')} merged:>=${since}`, '--json', 'number,url,title,headRefName,mergedAt,mergeCommit', '--limit', '5']));
  const mention = issue && new RegExp(`(?<![A-Za-z0-9])${issue}(?![A-Za-z0-9])`, 'i');
  const named = mention && found.find((pr) => mention.test(`${pr.title} ${pr.headRefName}`));
  if (named) facts.push({ type: 'merged', id: fix.id, pr: named.url, number: named.number, at: named.mergedAt, sha: named.mergeCommit?.oid, link: true });
  else if (found[0]) facts.push({ type: 'flag', id: fix.id, pr: found[0].url, text: `may already be fixed by #${found[0].number} ${cleanText(found[0].title)}`, possible: true });
  return budget - 1;
}

async function checkBatches(doc, { run, errors }) {
  const facts = [];
  const cache = new Map();
  const once = (key, read) => {
    if (!cache.has(key)) cache.set(key, read());
    return cache.get(key);
  };
  for (const batch of doc.entries.filter((entry) => entry.kind === 'batch' && !isClosed(entry) && PACKAGE.test(entry.package ?? ''))) {
    try { await checkBatch(doc, batch, { run, facts, once }); } catch (error) { errors.push(`${batch.id}: ${reason(error)}`); }
  }
  return facts;
}

async function provenance(name, version, repo, run) {
  const exact = JSON.parse(await run('npm', ['view', `${name}@${version}`, 'version', 'gitHead', 'repository', '--json']));
  const source = githubOf(exact.repository);
  const problem = exact.version !== version ? `npm answered for ${exact.version}, not ${version}`
    : !source ? `${name}@${version} was published from an unknown repository`
      : source.toLowerCase() !== repo.toLowerCase() ? `${name}@${version} was published from ${source}, not ${repo}`
        : !COMMIT.test(exact.gitHead ?? '') ? `npm records no source commit for ${name}@${version}` : undefined;
  return { problem, commit: exact.gitHead, changelog: [exact.repository?.directory, 'CHANGELOG.md'].filter(Boolean).join('/') };
}

async function checkBatch(doc, batch, { run, facts, once }) {
  const info = JSON.parse(await once(`npm ${batch.package}`, () => run('npm', ['view', batch.package, 'dist-tags', 'repository', '--json'])));
  const version = [info['dist-tags']?.alpha, info['dist-tags']?.latest].filter(Boolean).sort(compareVersions).at(-1);
  const repo = githubOf(info.repository);
  if (version && repo && batch.members.length) {
    const { problem, commit, changelog } = await once(`npm ${batch.package}@${version}`, () => provenance(batch.package, version, repo, run));
    if (problem) {
      facts.push({ type: 'release', id: batch.id, version, included: [], missing: [`${problem}, so what it contains cannot be confirmed; record the release with rex_work once you have checked it`] });
    } else {
      const text = await once(`gh ${repo} ${changelog} ${commit}`, () => run('gh', ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${changelog}?ref=${commit}`]));
      const included = [];
      const missing = [];
      for (const member of batch.members) {
        const fix = doc.entries.find((entry) => entry.id === member.id);
        const number = PR.exec(fix.links.pr ?? '')?.[2];
        if (fix.state !== 'done') continue;
        if (!number) { missing.push(`${fix.id} has no PR link to check`); continue; }
        const listed = changelogLists(text, version, number);
        if (listed === undefined) { missing.push(`the changelog has no ${version} section`); break; }
        if (listed) included.push(fix.id); else missing.push(`${fix.id} (#${number}) is not in ${version}`);
      }
      facts.push({ type: 'release', id: batch.id, version, evidence: `${repo} ${changelog} at ${commit}, the commit npm records for ${batch.package}@${version}, lists ${included.map((id) => `#${PR.exec(doc.entries.find((entry) => entry.id === id).links.pr)[2]}`).join(', ')} under ${version} or earlier`, included, missing });
    }
  }
  const target = batch.release?.version ?? version;
  const path = batch.downstream && localPath(batch.downstream);
  if (path && target && existsSync(path)) {
    await run('git', ['-C', path, 'fetch', '--quiet', 'origin']);
    const head = (await run('git', ['-C', path, 'rev-parse', '--abbrev-ref', 'origin/HEAD']).catch(() => 'origin/main')).trim();
    const pins = (await run('git', ['-C', path, 'grep', '-h', '-o', '-E', `"${batch.package.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}": *"[^"]+"`, head, '--', '*package.json']).catch(() => '')).split('\n')
      .flatMap((row) => /: *"([^"]+)"/.exec(row)?.[1] ?? []).filter((pin) => /^\d+\.\d+\.\d+/.test(pin));
    const pin = pins.sort(compareVersions).at(-1);
    if (pin) facts.push({ type: 'pinned', id: batch.id, pin, branch: head });
  }
  const downstreamPr = PR.exec(batch.links.pr ?? '');
  if (downstreamPr) {
    const pr = JSON.parse(await run('gh', ['pr', 'view', downstreamPr[2], '-R', downstreamPr[1], '--json', 'state']));
    if (pr.state === 'MERGED') facts.push({ type: 'landed', id: batch.id, how: `PR #${downstreamPr[2]} merged` });
  }
}

function apply(doc, facts, at) {
  const notes = [];
  for (const fact of facts) {
    const entry = doc.entries.find((row) => row.id === fact.id);
    if (!entry || isClosed(entry)) continue;
    if (fact.type === 'merged') {
      if (fact.link && entry.links.pr) continue;
      if (!fact.link && entry.links.pr !== fact.pr) continue;
      entry.links.pr = fact.pr;
      entry.merged = { number: fact.number, at: fact.at, sha: fact.sha };
      delete entry.flag;
      try {
        changeWork(doc, entry.id, { state: 'done' }, at);
        notes.push(`${entry.id} ${entry.title}: PR #${fact.number} merged${fact.link ? ` (found by ${entry.links.issue})` : ''}, marked done.`);
      } catch (error) {
        entry.updatedAt = at;
        notes.push(`${entry.id}: PR #${fact.number} merged, but ${cleanText(error.message).replace(/^.*cannot be done yet: /, '')}`);
      }
    }
    if (fact.type === 'flag') {
      if (entry.flag?.pr === fact.pr || entry.dismissed?.includes(fact.pr) || (fact.possible && entry.links.pr)) continue;
      entry.flag = { text: fact.text, pr: fact.pr, at };
      entry.updatedAt = at;
      notes.push(`${entry.id} ${entry.title}: ${fact.text}. ${fact.possible ? 'Check it in the Work tab; K dismisses it.' : 'Check it in the Work tab.'}`);
    }
    if (fact.type === 'release') {
      if (entry.release && entry.members.length && entry.members.every((member) => member.included?.version === entry.release.version)) continue;
      const before = workStatus(doc, entry);
      const members = new Map(entry.members.map((member) => [member.id, member]));
      const included = fact.included.filter((id) => members.has(id) && doc.entries.find((row) => row.id === id).state === 'done');
      const shipped = included.filter((id) => !members.get(id).included);
      const missed = fact.missing.join('; ');
      if (included.some((id) => members.get(id).included?.version !== fact.version)) recordRelease(doc, entry.id, { version: fact.version, evidence: fact.evidence, included }, at);
      const repeat = !missed || entry.checked === `${fact.version} ${missed}`;
      if (missed) entry.checked = `${fact.version} ${missed}`;
      const ready = before !== 'ready' && workStatus(doc, entry) === 'ready';
      if (!shipped.length && repeat && !ready) continue;
      entry.updatedAt = at;
      const parts = [shipped.length ? `${entry.package} ${fact.version} includes ${shipped.join(', ')}` : '', missed && !repeat ? `missing: ${missed}` : ''].filter(Boolean);
      notes.push(`${entry.id} ${entry.title}: ${[...parts, ...(ready ? ['ready to land'] : [])].join('; ')}.`);
    }
    if (fact.type === 'pinned' || fact.type === 'landed') {
      if (fact.type === 'pinned' && !(entry.release && compareVersions(fact.pin, entry.release.version) >= 0)) continue;
      if (workStatus(doc, entry) !== 'ready') continue;
      changeWork(doc, entry.id, { check: entry.steps.map((_step, index) => index + 1), state: 'done' }, at);
      notes.push(`${entry.id} ${entry.title} landed: ${fact.type === 'pinned' ? `${entry.downstream} ${fact.branch} pins ${entry.package} ${fact.pin}` : fact.how}. Marked done.`);
    }
  }
  return notes;
}

export async function beat({ file = workFile(), run = command, now = Date.now(), searched = new Map() } = {}) {
  const at = new Date(now).toISOString();
  const errors = [];
  const notes = [];
  const fixFacts = await checkFixes(readWork(file), { run, now, searched, errors });
  if (fixFacts.length) notes.push(...updateWork((doc) => apply(doc, fixFacts, at), file).result);
  const batchFacts = await checkBatches(readWork(file), { run, errors });
  if (batchFacts.length) notes.push(...updateWork((doc) => apply(doc, batchFacts, at), file).result);
  return { notes, errors };
}

export class WorkHeartbeat {
  constructor({ send, notify, run = command, file = workFile(), interval = 600_000 }) {
    Object.assign(this, { send, notify, run, file, interval, searched: new Map(), reported: new Set() });
  }
  start() {
    this.timer = setInterval(() => { void this.tick(); }, this.interval);
    this.timer.unref();
    this.poke(5_000);
  }
  poke(delay = 2_000) {
    clearTimeout(this.soon);
    this.soon = setTimeout(() => { void this.tick(); }, delay);
    this.soon.unref();
  }
  async tick() {
    if (this.closed || this.running) return this.running;
    this.running = (async () => {
      try {
        const { notes, errors } = await beat({ file: this.file, run: this.run, searched: this.searched });
        if (notes.length && !this.closed) this.send(notes);
        for (const error of errors) {
          if (this.reported.has(error) || isConnectivityError(error)) continue;
          this.reported.add(error);
          this.notify(`Work heartbeat check failed: ${error}`);
        }
      } catch (error) {
        this.notify(`Work heartbeat: ${cleanText(error.message)}`);
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    clearTimeout(this.soon);
    await this.running;
  }
}
