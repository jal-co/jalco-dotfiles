import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { cleanText } from './tasks.ts';

const run = promisify(execFile);
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'onto', 'that', 'this', 'when', 'not', 'but', 'are', 'was', 'were', 'has', 'have', 'its', 'our', 'you', 'your', 'use', 'add', 'fix', 'make', 'should', 'does', 'show', 'shows', 'instead', 'missing', 'new', 'all', 'can', 'cannot', 'via', 'per']);

export const githubRepository = (url) => /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?(?:[/#?]|$)/i.exec(url ?? '')?.[1].toLowerCase();

export function knownRepositories({ root = join(homedir(), '.rex'), records = [], config = {} } = {}) {
  const paths = new Set(Object.values(config.repositories ?? {}));
  const bindings = join(root, 'repositories');
  if (existsSync(bindings)) {
    for (const name of readdirSync(bindings).filter((entry) => entry.endsWith('.json'))) {
      try { paths.add(JSON.parse(readFileSync(join(bindings, name), 'utf8')).repo); } catch {}
    }
  }
  for (const record of records) if (!record.removed) paths.add(record.repo);
  return [...paths].filter((path) => path && existsSync(join(path, '.git')));
}

export async function remoteOf(path, exec = run) {
  try {
    const { stdout } = await exec('git', ['-C', path, 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 5_000 });
    return githubRepository(stdout.trim()) ?? stdout.trim();
  } catch {
    return undefined;
  }
}

function bigrams(text) {
  const words = cleanText(text).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, ' ').split(/\s+/).filter(Boolean);
  const found = [];
  for (let index = 0; index + 1 < words.length; index += 1) {
    const [first, second] = [words[index], words[index + 1]];
    if (first.length > 2 && second.length > 2 && !STOP.has(first) && !STOP.has(second)) found.push(`${first} ${second}`);
  }
  return found;
}

export function terms({ title = '', description = '' }) {
  const body = String(description).replace(/!?\[[^\]]*\]\([^)]*\)|https?:\/\/\S+/g, ' ').slice(0, 800);
  const weighted = [
    ...[...body.matchAll(/`([^`\n]{3,60})`/g)].map(([, code]) => [code.trim(), 2]),
    ...(cleanText(title).match(/[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)+|\p{Ll}+\p{Lu}[\p{L}\p{N}]*/gu) ?? []).map((token) => [token, 2]),
    ...bigrams(title).map((phrase) => [phrase, 1]),
    ...bigrams(body).slice(0, 6).map((phrase) => [phrase, 0.5]),
  ];
  const seen = new Map();
  for (const [text, weight] of weighted) if (!seen.has(text.toLowerCase())) seen.set(text.toLowerCase(), { text, weight });
  return [...seen.values()].slice(0, 14);
}

export async function phraseHits(path, list, exec = run) {
  const hits = await Promise.all(list.map(async (term) => {
    try {
      await exec('git', ['-C', path, 'grep', '-q', '-I', '-i', '-F', '-e', term.text], { timeout: 8_000 });
      return term;
    } catch {
      return undefined;
    }
  }));
  return hits.filter(Boolean);
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export async function rankRepositories(subject, { candidates, tasks = [], records = [], issues = [], config = {}, exec = run }) {
  const team = subject.team?.key;
  const remotes = await Promise.all(candidates.map((path) => remoteOf(path, exec)));
  const usable = candidates.filter((_path, index) => remotes[index]);
  const repos = new Map(candidates.map((path, index) => [path, remotes[index]]));
  const list = terms(subject);
  const grep = await Promise.all(usable.map((path) => phraseHits(path, list, exec)));
  const prefix = team && new RegExp(`(^|[/_-])${team.toLowerCase()}-\\d+`);
  const repoOf = (task) => records.find((record) => record.path === task.worktree)?.repo;
  const ranked = usable.map((path, index) => {
    const repo = repos.get(path);
    const reasons = [];
    let score = 0;
    const own = (subject.attachments?.nodes ?? []).filter((link) => githubRepository(link.url) === repo).length;
    if (own) { score += 100 * own; reasons.push(`${plural(own, 'linked PR')} here`); }
    if (team && config.repositories?.[team] === path) { score += 40; reasons.push(`you picked it for ${team} before`); }
    const teamTasks = prefix ? tasks.filter((task) => prefix.test(String(task.branch).toLowerCase()) && repoOf(task) === path).length : 0;
    if (teamTasks) { score += Math.min(50, 10 * teamTasks); reasons.push(`${plural(teamTasks, `${team} task`)}`); }
    const teamLinks = team ? issues.filter((issue) => issue.team?.key === team && issue.identifier !== subject.identifier)
      .flatMap((issue) => issue.attachments?.nodes ?? []).filter((link) => githubRepository(link.url) === repo).length : 0;
    if (teamLinks) { score += Math.min(40, 5 * teamLinks); reasons.push(`${plural(teamLinks, `${team} PR`)}`); }
    if (grep[index].length) {
      score += 15 * grep[index].reduce((sum, term) => sum + term.weight / grep.filter((hits) => hits.includes(term)).length, 0);
      const strongest = [...grep[index]].sort((a, b) => grep.filter((hits) => hits.includes(a)).length - grep.filter((hits) => hits.includes(b)).length || b.weight - a.weight);
      reasons.push(`mentions ${strongest.slice(0, 2).map((term) => `“${term.text}”`).join(', ')}`);
    }
    const usage = records.filter((record) => record.repo === path).length;
    score += Math.min(5, usage / 5);
    if (!reasons.length) reasons.push(usage ? `${plural(usage, 'past task')}` : 'no evidence');
    return { path, name: basename(path), repo, score, reasons };
  });
  return ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export const confident = (ranked) => ranked.length > 0 && ranked[0].score >= 15 && ranked[0].score >= 2 * (ranked[1]?.score ?? 0);
