import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { cleanText, processBirth } from './tasks.ts';

export const workFile = () => process.env.REX_WORK_FILE ?? join(homedir(), '.rex', 'work.json');
export const STATES = ['open', 'active', 'done', 'dropped'];
const KINDS = ['fix', 'batch'];
const CLOSED = ['done', 'dropped'];
const ID = /^w[1-9]\d{0,8}$/;
const LINKS = {
  repo: /^[^\p{Cc}]{1,300}$/u,
  issue: /^(?:[A-Za-z][A-Za-z0-9]{0,9}-\d{1,7}|https:\/\/linear\.app\/\S{1,300})$/,
  task: /^[\w.-]{1,100}$/,
  pr: /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/,
};

const fail = (message) => { throw new Error(message); };
const text = (value, limit, name) => {
  const clean = cleanText(value);
  if (!clean || clean.length > limit) fail(`${name} must be 1 to ${limit} characters.`);
  return clean;
};

export const emptyWork = () => ({ version: 1, next: 1, entries: [] });
export const findWork = (doc, id) => doc.entries.find((entry) => entry.id === id) ?? fail(`No work entry ${cleanText(id)}.`);
export const isClosed = (entry) => CLOSED.includes(entry.state);
export const batchOf = (doc, id) => doc.entries.find((entry) => entry.kind === 'batch' && entry.state !== 'dropped' && entry.members.some((member) => member.id === id));

export function validateWork(doc) {
  if (doc?.version !== 1 || !Number.isSafeInteger(doc.next) || doc.next < 1 || !Array.isArray(doc.entries)) fail('Unknown work queue format.');
  const byId = new Map();
  for (const entry of doc.entries) {
    if (!ID.test(entry?.id) || byId.has(entry.id) || Number(entry.id.slice(1)) >= doc.next) fail(`Invalid or duplicate work ID ${cleanText(entry?.id)}.`);
    byId.set(entry.id, entry);
  }
  const owners = new Map();
  for (const entry of doc.entries) {
    if (!KINDS.includes(entry.kind) || !STATES.includes(entry.state)) fail(`${entry.id} has an unknown kind or state.`);
    text(entry.title, 300, `${entry.id} title`);
    if (entry.note !== undefined) text(entry.note, 4000, `${entry.id} note`);
    for (const [key, value] of Object.entries(entry.links ?? fail(`${entry.id} has no links object.`))) {
      if (!LINKS[key]?.test(value)) fail(`${entry.id} has an invalid ${cleanText(key)} link.`);
    }
    if (entry.flag !== undefined) text(entry.flag.text, 500, `${entry.id} flag`);
    if (entry.dismissed !== undefined && !(Array.isArray(entry.dismissed) && entry.dismissed.every((url) => LINKS.pr.test(url)))) fail(`${entry.id} has invalid dismissed flags.`);
    if (entry.merged !== undefined && !Number.isSafeInteger(entry.merged.number)) fail(`${entry.id} has invalid merge evidence.`);
    if (!Array.isArray(entry.dependsOn)) fail(`${entry.id} has no dependency list.`);
    for (const id of entry.dependsOn) if (id === entry.id || !byId.has(id)) fail(`${entry.id} depends on unknown work ${cleanText(id)}.`);
    if (entry.kind === 'fix') {
      if (entry.members || entry.steps || entry.release) fail(`${entry.id} is a fix; only batches include work, steps or a release.`);
      continue;
    }
    if (!Array.isArray(entry.members) || !Array.isArray(entry.steps)) fail(`${entry.id} is missing its members or steps.`);
    for (const member of entry.members) {
      if (byId.get(member?.id)?.kind !== 'fix') fail(`${entry.id} can only include fixes; ${cleanText(member?.id)} is not one.`);
      if (member.included !== undefined) text(member.included.version, 100, `${member.id} release`);
      if (entry.state === 'dropped') continue;
      if (owners.has(member.id)) fail(`${member.id} would be in both ${owners.get(member.id)} and ${entry.id}; a fix belongs to one batch.`);
      owners.set(member.id, entry.id);
    }
    for (const step of entry.steps) {
      text(step?.text, 300, `${entry.id} step`);
      if (step.done !== true && step.done !== false) fail(`${entry.id} has a step without a done flag.`);
    }
    if (entry.release !== undefined) text(entry.release.version, 100, `${entry.id} release`);
  }
  const visited = new Map();
  const visit = (id, path) => {
    if (visited.get(id) === 'done') return;
    if (visited.get(id) === 'open') fail(`That would make a dependency cycle: ${[...path.slice(path.indexOf(id)), id].join(' -> ')}.`);
    visited.set(id, 'open');
    const entry = byId.get(id);
    for (const next of [...entry.dependsOn, ...(entry.members ?? []).map((member) => member.id)]) visit(next, [...path, id]);
    visited.set(id, 'done');
  };
  for (const id of byId.keys()) visit(id, []);
  return doc;
}

export function blockers(doc, entry) {
  const out = [];
  for (const id of entry.dependsOn) {
    const dependency = findWork(doc, id);
    if (dependency.state === 'dropped') out.push(`${id} was dropped; remove the dependency or reopen it`);
    else if (dependency.state !== 'done') out.push(`waits on ${id} ${dependency.title} (${dependency.state})`);
  }
  if (entry.kind !== 'batch') return out;
  if (!entry.members.length) out.push('includes no work yet');
  for (const member of entry.members) {
    const fix = findWork(doc, member.id);
    if (fix.state === 'dropped') out.push(`${member.id} was dropped; remove it from the batch or reopen it`);
    else if (fix.state !== 'done') out.push(`${member.id} has not landed upstream (${fix.state})`);
  }
  if (!entry.release) out.push(`${entry.package ?? 'package'} release not recorded`);
  else for (const member of entry.members) if (member.included?.version !== entry.release.version) out.push(`${member.id} not confirmed in ${entry.release.version}`);
  return out;
}

export function workStatus(doc, entry) {
  if (isClosed(entry)) return entry.state;
  if (blockers(doc, entry).length) return 'blocked';
  return entry.kind === 'batch' ? 'ready' : entry.state;
}

const defaultSteps = (pkg, downstream) => [
  `Bump ${pkg ?? 'the package'} in ${downstream ?? 'the downstream repository'}`,
  'Apply the integration changes it needs',
  'Verify everything together',
  'Open one PR',
];

export function addWork(doc, input, now = new Date().toISOString()) {
  const kind = input.kind ?? 'fix';
  if (!KINDS.includes(kind)) fail('Kind must be fix or batch.');
  const entry = { id: `w${doc.next}`, kind, title: text(input.title, 300, 'Title'), state: 'open', links: {}, dependsOn: [], createdAt: now, updatedAt: now };
  if (kind === 'batch') Object.assign(entry, { members: [], steps: [] });
  doc.next += 1;
  doc.entries.push(entry);
  const steps = kind === 'batch' && !input.steps?.length ? defaultSteps(cleanText(input.package) || undefined, cleanText(input.downstream) || undefined) : input.steps;
  return changeWork(doc, entry.id, { ...input, title: undefined, steps }, now);
}

export function changeWork(doc, id, changes, now = new Date().toISOString()) {
  const entry = findWork(doc, id);
  const batch = entry.kind === 'batch';
  const only = (field) => { if (!batch) fail(`${id} is a fix; only batches have ${field}.`); };
  if (changes.title !== undefined) entry.title = text(changes.title, 300, 'Title');
  if (changes.note !== undefined) {
    if (cleanText(changes.note)) entry.note = text(changes.note, 4000, 'Note'); else delete entry.note;
  }
  for (const key of Object.keys(LINKS)) {
    if (changes[key] === undefined) continue;
    const value = cleanText(changes[key]);
    if (value && !LINKS[key].test(value)) fail(`${cleanText(changes[key])} is not a valid ${key} link.`);
    if (value) entry.links[key] = value; else delete entry.links[key];
    if (key === 'pr') delete entry.flag;
  }
  if (changes.dismissFlag && entry.flag) {
    entry.dismissed = [...new Set([...(entry.dismissed ?? []), entry.flag.pr].filter(Boolean))];
    delete entry.flag;
  }
  for (const field of ['package', 'downstream']) {
    if (changes[field] === undefined) continue;
    only(`a ${field}`);
    if (cleanText(changes[field])) entry[field] = text(changes[field], 200, field); else delete entry[field];
  }
  if (changes.members?.length || changes.removeMembers?.length) {
    only('included work');
    if (isClosed(entry)) fail(`${id} is ${entry.state}; reopen it before changing what it includes.`);
    for (const member of changes.removeMembers ?? []) {
      if (!entry.members.some((row) => row.id === member)) fail(`${cleanText(member)} is not in ${id}.`);
      entry.members = entry.members.filter((row) => row.id !== member);
    }
    for (const member of changes.members ?? []) {
      if (findWork(doc, member).kind !== 'fix') fail(`${member} is a batch; batches include fixes only.`);
      if (!entry.members.some((row) => row.id === member)) entry.members.push({ id: member });
    }
  }
  for (const dependency of changes.removeDependsOn ?? []) {
    if (!entry.dependsOn.includes(dependency)) fail(`${id} does not depend on ${cleanText(dependency)}.`);
    entry.dependsOn = entry.dependsOn.filter((row) => row !== dependency);
  }
  for (const dependency of changes.dependsOn ?? []) {
    findWork(doc, dependency);
    if (!entry.dependsOn.includes(dependency)) entry.dependsOn.push(dependency);
  }
  if (changes.steps?.length) {
    only('steps');
    entry.steps.push(...changes.steps.map((step) => ({ text: text(step, 300, 'Step'), done: false })));
  }
  for (const [field, done] of [['check', true], ['uncheck', false]]) {
    for (const number of changes[field] ?? []) {
      only('steps');
      const step = entry.steps[number - 1] ?? fail(`${id} has no step ${cleanText(number)}; it has ${entry.steps.length}.`);
      step.done = done;
    }
  }
  if (changes.state !== undefined) {
    if (!STATES.includes(changes.state)) fail(`State must be one of ${STATES.join(', ')}.`);
    if (changes.state === 'done' && entry.state !== 'done') {
      const open = [...blockers(doc, entry), ...(batch ? entry.steps.flatMap((step, index) => (step.done ? [] : [`step ${index + 1} not done: ${step.text}`])) : [])];
      if (open.length) fail(`${id} cannot be done yet: ${open.join('; ')}.`);
    }
    entry.state = changes.state;
    if (isClosed(entry)) delete entry.flag;
  }
  entry.updatedAt = now;
  return entry;
}

export function recordRelease(doc, id, { version, evidence, included = [] }, now = new Date().toISOString()) {
  const entry = findWork(doc, id);
  if (entry.kind !== 'batch') fail(`${id} is a fix; releases are recorded on batches.`);
  if (isClosed(entry)) fail(`${id} is ${entry.state}; reopen it before recording a release.`);
  const name = text(version, 100, 'Version');
  const proof = text(evidence, 1000, 'Evidence');
  if (entry.release?.version !== name) entry.release = { version: name, evidence: proof, at: now };
  for (const memberId of included) {
    const member = entry.members.find((row) => row.id === memberId) ?? fail(`${cleanText(memberId)} is not in ${id}.`);
    const fix = findWork(doc, memberId);
    if (fix.state !== 'done') fail(`${memberId} has not landed (${fix.state}); mark it done before confirming it shipped in ${name}.`);
    member.included = { version: name, evidence: proof, at: now };
  }
  entry.updatedAt = now;
  return entry;
}

export function describeWork(doc, entry) {
  const links = Object.entries(entry.links).map(([key, value]) => `${key} ${value}`);
  const lines = [`${entry.id} ${entry.kind} [${workStatus(doc, entry)}] ${entry.title}${links.length ? ` (${links.join(', ')})` : ''}`];
  if (entry.note) lines.push(`  note: ${entry.note}`);
  if (entry.flag) lines.push(`  check: ${entry.flag.text} (${entry.flag.pr ?? 'no link'})`);
  if (entry.kind === 'batch') {
    if (entry.package || entry.downstream) lines.push(`  delivers ${entry.package ?? 'a package'} to ${entry.downstream ?? 'its downstream repository'}`);
    const members = entry.members.map((member) => {
      const fix = findWork(doc, member.id);
      return `${member.id} ${fix.title} (${fix.state}${member.included ? `, in ${member.included.version}` : ''})`;
    });
    lines.push(`  includes: ${members.join('; ') || 'nothing yet'}`);
    if (entry.release) lines.push(`  release: ${entry.release.version} (${entry.release.evidence})`);
    lines.push(`  steps: ${entry.steps.map((step, index) => `${index + 1}.[${step.done ? 'x' : ' '}] ${step.text}`).join('  ')}`);
  }
  if (entry.dependsOn.length) lines.push(`  depends on: ${entry.dependsOn.join(', ')}`);
  const open = isClosed(entry) ? [] : blockers(doc, entry);
  if (open.length) lines.push(`  blocked by: ${open.join('; ')}`);
  return lines.join('\n');
}

export function workSummary(doc, { all = false } = {}) {
  const rows = doc.entries.filter((entry) => all || !isClosed(entry));
  if (!rows.length) return all ? 'The work queue is empty.' : 'Nothing open in the work queue.';
  return rows.map((entry) => describeWork(doc, entry)).join('\n');
}

export function readWork(file = workFile()) {
  if (!existsSync(file)) return emptyWork();
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { fail(`${file} is unreadable (${cleanText(error.message)}). It was left unchanged.`); }
  return validateWork(doc);
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function staleLock(lock) {
  try {
    const owner = JSON.parse(readFileSync(lock, 'utf8'));
    return processBirth(owner.pid) !== owner.birth;
  } catch {
    try { return Date.now() - statSync(lock).mtimeMs > 5_000; } catch { return false; }
  }
}

export function updateWork(change, file = workFile(), wait = 2_000) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  const owner = JSON.stringify({ pid: process.pid, birth: processBirth(process.pid) });
  for (const deadline = Date.now() + wait; ;) {
    try { writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 }); break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (staleLock(lock)) { try { unlinkSync(lock); } catch {} continue; }
    if (Date.now() > deadline) fail(`The work queue is busy; another process holds ${lock}. Try again.`);
    pause(25);
  }
  try {
    const doc = readWork(file);
    const result = change(doc);
    validateWork(doc);
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
    return { doc, result };
  } finally {
    unlinkSync(lock);
  }
}
