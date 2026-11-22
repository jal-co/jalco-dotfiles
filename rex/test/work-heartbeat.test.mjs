import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WorkHeartbeat, beat, changelogLists, compareVersions, searchTerms } from '../src/work-heartbeat.ts';
import { addWork, changeWork, findWork, readWork, updateWork, workStatus } from '../src/work.ts';

const CHANGELOG = `# @mastra/playground-ui

## 71.0.0-alpha.3

- Sidebar details panel ([#102](https://github.com/mastra-ai/mastra/pull/102))

## 71.0.0-alpha.2

- Card alignment ([#101](https://github.com/mastra-ai/mastra/pull/101))

## 70.0.0

- Old ([#50](https://github.com/mastra-ai/mastra/pull/50))
`;

const release = (version) => createHash('sha1').update(version).digest('hex');
const REPOSITORY = { url: 'git+https://github.com/mastra-ai/mastra.git', directory: 'packages/playground-ui' };

function world(context) {
  const dir = mkdtempSync(join(tmpdir(), 'rex-work-beat-'));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  const platform = join(dir, 'platform');
  mkdirSync(platform);
  const state = {
    prs: { 101: { state: 'MERGED', mergedAt: '2026-11-20T09:00:00Z', mergeCommit: { oid: 'a1' } }, 102: { state: 'MERGED', mergedAt: '2026-11-20T10:00:00Z', mergeCommit: { oid: 'a2' } }, 103: { state: 'OPEN' }, 9: { state: 'OPEN' } },
    alpha: '71.0.0-alpha.3', latest: '70.0.0', changelog: CHANGELOG, released: {}, published: {}, pins: ['"@mastra/playground-ui": "0.0.0-snapshot-1"'], searches: {}, calls: [], fail: new Set(),
  };
  const run = async (file, args) => {
    state.calls.push([file, ...args].join(' '));
    if (state.fail.has(file)) throw Object.assign(new Error('boom'), { stderr: file === 'gh' ? 'error connecting to api.github.com' : `${file} unavailable` });
    if (file === 'gh' && args[0] === 'pr' && args[1] === 'view') return JSON.stringify(state.prs[args[2]]);
    if (file === 'gh' && args[0] === 'pr' && args[1] === 'list') return JSON.stringify(state.searches[args[args.indexOf('--search') + 1]] ?? []);
    if (file === 'gh' && args[0] === 'api') {
      const ref = /[?&]ref=([^&]+)$/.exec(args.at(-1))?.[1];
      return ref ? state.released[ref] ?? state.changelog : state.changelog;
    }
    if (file === 'npm' && args[1].lastIndexOf('@') > 0) {
      const version = args[1].slice(args[1].lastIndexOf('@') + 1);
      return JSON.stringify({ version, gitHead: release(version), repository: REPOSITORY, ...state.published[version] });
    }
    if (file === 'npm') return JSON.stringify({ 'dist-tags': { alpha: state.alpha, latest: state.latest }, repository: REPOSITORY });
    if (file === 'git' && args.includes('remote')) return 'git@github.com:mastra-ai/mastra.git\n';
    if (file === 'git' && args.includes('rev-parse')) return 'origin/main\n';
    if (file === 'git' && args.includes('grep')) return state.pins.join('\n');
    if (file === 'git') return '';
    throw new Error(`unexpected ${file} ${args.join(' ')}`);
  };
  const file = join(dir, 'work.json');
  updateWork((doc) => {
    addWork(doc, { title: 'Alert template card alignment', pr: 'https://github.com/mastra-ai/mastra/pull/101' });
    addWork(doc, { title: 'Sidebar details panel', pr: 'https://github.com/mastra-ai/mastra/pull/102' });
    addWork(doc, { kind: 'batch', title: 'Update Platform playground', package: '@mastra/playground-ui', downstream: platform, members: ['w1', 'w2'] });
  }, file);
  const tick = (options = {}) => beat({ file, run, now: Date.parse('2026-11-20T12:00:00Z'), ...options });
  return { state, run, file, tick, platform };
}

test('versions order prereleases below their release and numerically within a tag', () => {
  assert.ok(compareVersions('71.0.0-alpha.10', '71.0.0-alpha.9') > 0);
  assert.ok(compareVersions('71.0.0', '71.0.0-alpha.9') > 0);
  assert.ok(compareVersions('70.0.0', '71.0.0-alpha.0') < 0);
  assert.ok(compareVersions('0.0.0-snapshot-1', '71.0.0-alpha.2') < 0);
  assert.equal(compareVersions('71.0.0-alpha.2', '71.0.0-alpha.2'), 0);
  assert.equal(changelogLists(CHANGELOG, '71.0.0-alpha.3', 101), true, 'a version includes everything listed below it');
  assert.equal(changelogLists(CHANGELOG, '71.0.0-alpha.2', 102), false);
  assert.equal(changelogLists(CHANGELOG, '71.0.0-alpha.2', 10), false);
  assert.equal(changelogLists(CHANGELOG, '72.0.0', 101), undefined);
  assert.deepEqual(searchTerms('Address the toast overflow upstream, it should wrap on mobile'), ['toast', 'overflow', 'wrap', 'mobile']);
});

test('merged fix PRs close their fixes, the alpha confirms them and the batch becomes ready, once', async (context) => {
  const { tick, file } = world(context);
  const first = await tick();
  assert.deepEqual(first.errors, []);
  assert.deepEqual(first.notes, [
    'w1 Alert template card alignment: PR #101 merged, marked done.',
    'w2 Sidebar details panel: PR #102 merged, marked done.',
    'w3 Update Platform playground: @mastra/playground-ui 71.0.0-alpha.3 includes w1, w2; ready to land.',
  ]);
  const doc = readWork(file);
  assert.deepEqual(findWork(doc, 'w1').merged, { number: 101, at: '2026-11-20T09:00:00Z', sha: 'a1' });
  assert.equal(findWork(doc, 'w3').release.version, '71.0.0-alpha.3');
  assert.equal(findWork(doc, 'w3').release.evidence, `mastra-ai/mastra packages/playground-ui/CHANGELOG.md at ${release('71.0.0-alpha.3')}, the commit npm records for @mastra/playground-ui@71.0.0-alpha.3, lists #101, #102 under 71.0.0-alpha.3 or earlier`);
  assert.equal(workStatus(doc, findWork(doc, 'w3')), 'ready');
  assert.deepEqual((await tick()).notes, [], 'nothing changed, nothing to say');
});

test('a member missing from the alpha is named once and keeps the batch blocked', async (context) => {
  const { tick, file, state } = world(context);
  updateWork((doc) => {
    addWork(doc, { title: 'Breadcrumb actions', pr: 'https://github.com/mastra-ai/mastra/pull/104' });
    changeWork(doc, 'w3', { members: ['w4'] });
  }, file);
  state.prs[104] = { state: 'MERGED', mergedAt: '2026-11-20T11:00:00Z', mergeCommit: { oid: 'a4' } };
  const { notes } = await tick();
  assert.equal(notes.at(-1), 'w3 Update Platform playground: @mastra/playground-ui 71.0.0-alpha.3 includes w1, w2; missing: w4 (#104) is not in 71.0.0-alpha.3.');
  assert.equal(workStatus(readWork(file), findWork(readWork(file), 'w3')), 'blocked');
  assert.deepEqual((await tick()).notes, []);
  state.alpha = '71.0.0-alpha.4';
  state.changelog = CHANGELOG.replace('## 71.0.0-alpha.3', '## 71.0.0-alpha.4\n\n- Breadcrumbs ([#104](https://github.com/mastra-ai/mastra/pull/104))\n\n## 71.0.0-alpha.3');
  assert.deepEqual((await tick()).notes, ['w3 Update Platform playground: @mastra/playground-ui 71.0.0-alpha.4 includes w4; ready to land.']);
});

test('a fix taken out of the batch while a check runs is skipped, not a crash', async (context) => {
  const { file, run } = world(context);
  let removed = false;
  const racing = async (command, args) => {
    if (command === 'npm' && !removed) {
      removed = true;
      updateWork((doc) => changeWork(doc, 'w3', { removeMembers: ['w2'] }), file);
    }
    return run(command, args);
  };
  const { notes, errors } = await beat({ file, run: racing, now: Date.parse('2026-11-20T12:00:00Z') });
  assert.deepEqual(errors, []);
  assert.equal(notes.at(-1), 'w3 Update Platform playground: @mastra/playground-ui 71.0.0-alpha.3 includes w1; ready to land.');
});

test('a downstream pin at or past the confirmed release lands the batch; an older pin does not', async (context) => {
  const { tick, file, state, platform } = world(context);
  await tick();
  state.pins = ['"@mastra/playground-ui": "71.0.0-alpha.2"', '"@mastra/playground-ui": "0.0.0-central-icons-1"'];
  assert.deepEqual((await tick()).notes, []);
  state.alpha = '71.0.0-alpha.5';
  await tick();
  assert.equal(findWork(readWork(file), 'w3').release.version, '71.0.0-alpha.3', 'a complete release is not moved to a newer alpha');
  state.pins = ['"@mastra/playground-ui": "71.0.0-alpha.3"'];
  assert.deepEqual((await tick()).notes, [`w3 Update Platform playground landed: ${platform} origin/main pins @mastra/playground-ui 71.0.0-alpha.3. Marked done.`]);
  const batch = findWork(readWork(file), 'w3');
  assert.equal(batch.state, 'done');
  assert.ok(batch.steps.every((step) => step.done));
  assert.ok(state.calls.some((call) => call.endsWith('fetch --quiet origin')));
});

test('a merged downstream PR lands a ready batch', async (context) => {
  const { tick, file, state } = world(context);
  updateWork((doc) => changeWork(doc, 'w3', { pr: 'https://github.com/mastra-ai/platform/pull/9' }), file);
  await tick();
  assert.equal(findWork(readWork(file), 'w3').state, 'open');
  state.prs[9] = { state: 'MERGED' };
  assert.deepEqual((await tick()).notes, ['w3 Update Platform playground landed: PR #9 merged. Marked done.']);
});

test('unlinked fixes are checked for an existing fix: issue IDs link, other matches only flag', async (context) => {
  const { tick, file, state, platform } = world(context);
  const queued = '2026-11-20T08:00:00.000Z';
  updateWork((doc) => {
    addWork(doc, { title: 'Settings subtitles', repo: platform, issue: 'PLTFRM-12' }, queued);
    addWork(doc, { title: 'Toast overflow should wrap on mobile', repo: 'mastra-ai/mastra' }, queued);
    addWork(doc, { title: 'Too vague', repo: 'mastra-ai/mastra' }, queued);
  }, file);
  state.searches['PLTFRM-12 merged:>=2026-11-20'] = [{ number: 7, url: 'https://github.com/mastra-ai/mastra/pull/7', title: 'fix: subtitles', headRefName: 'jal/pltfrm-12-subtitles', mergedAt: '2026-11-20T11:00:00Z', mergeCommit: { oid: 'b7' } }];
  state.searches['toast overflow wrap mobile merged:>=2026-11-20'] = [{ number: 8, url: 'https://github.com/mastra-ai/mastra/pull/8', title: 'fix(ui): toast wraps on small screens' }];
  const { notes } = await tick();
  assert.ok(notes.includes('w4 Settings subtitles: PR #7 merged (found by PLTFRM-12), marked done.'));
  assert.ok(notes.includes('w5 Toast overflow should wrap on mobile: may already be fixed by #8 fix(ui): toast wraps on small screens. Check it in the Work tab; K dismisses it.'));
  const doc = readWork(file);
  assert.equal(findWork(doc, 'w4').links.pr, 'https://github.com/mastra-ai/mastra/pull/7');
  assert.equal(findWork(doc, 'w5').state, 'open', 'a keyword match never closes a fix');
  assert.equal(findWork(doc, 'w5').flag.pr, 'https://github.com/mastra-ai/mastra/pull/8');
  assert.equal(findWork(doc, 'w6').flag, undefined);
  const searched = state.calls.filter((call) => call.includes('pr list')).length;
  const memory = new Map([['w5', Date.parse('2026-11-20T12:00:00Z')], ['w6', Date.parse('2026-11-20T12:00:00Z')]]);
  await tick({ searched: memory });
  assert.equal(state.calls.filter((call) => call.includes('pr list')).length, searched, 'searches wait six hours');
  updateWork((doc) => changeWork(doc, 'w5', { dismissFlag: true }), file);
  assert.deepEqual((await tick()).notes.filter((note) => note.startsWith('w5')), [], 'a dismissed PR is not flagged again');
  assert.deepEqual(findWork(readWork(file), 'w5').dismissed, ['https://github.com/mastra-ai/mastra/pull/8']);
});

test('closed PRs and unmet dependencies are reported instead of closing work', async (context) => {
  const { tick, file, state } = world(context);
  updateWork((doc) => {
    addWork(doc, { title: 'Prerequisite' });
    addWork(doc, { title: 'Depends on it', pr: 'https://github.com/mastra-ai/mastra/pull/105', dependsOn: ['w4'] });
    addWork(doc, { title: 'Abandoned', pr: 'https://github.com/mastra-ai/mastra/pull/106' });
  }, file);
  state.prs[105] = { state: 'MERGED', mergedAt: '2026-11-20T11:00:00Z', mergeCommit: { oid: 'c5' } };
  state.prs[106] = { state: 'CLOSED' };
  const { notes } = await tick();
  assert.ok(notes.includes('w5: PR #105 merged, but waits on w4 Prerequisite (open).'));
  assert.ok(notes.includes('w6 Abandoned: PR #106 was closed without merging. Check it in the Work tab.'));
  assert.equal(findWork(readWork(file), 'w5').state, 'open');
  assert.deepEqual((await tick()).notes.filter((note) => note.startsWith('w6')), []);
});

test('one failing check does not stop the others, and unsafe names never reach a command', async (context) => {
  const { tick, file, state } = world(context);
  updateWork((doc) => addWork(doc, { kind: 'batch', title: 'Odd', package: '--registry=evil', downstream: '../../etc' }), file);
  state.fail.add('npm');
  const { notes, errors } = await tick();
  assert.equal(notes.length, 2);
  assert.deepEqual(errors, ['w3: npm unavailable']);
  assert.ok(!state.calls.some((call) => call.includes('evil') || call.includes('etc')));
});

test('the heartbeat sends changes, reports each distinct failure once and stops on close', async (context) => {
  const { run, file, state } = world(context);
  const sent = [];
  const warnings = [];
  const heart = new WorkHeartbeat({ file, run, send: (notes) => sent.push(notes), notify: (message) => warnings.push(message), interval: 60_000 });
  state.fail.add('npm');
  await heart.tick();
  await heart.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 2);
  assert.deepEqual(warnings, ['Work heartbeat check failed: w3: npm unavailable']);
  state.fail.delete('npm');
  state.fail.add('gh');
  const offline = state.calls.length;
  await heart.tick();
  assert.ok(state.calls.length > offline);
  assert.equal(warnings.length, 1, 'connectivity failures stay quiet');
  heart.start();
  await heart.close();
  const calls = state.calls.length;
  await heart.tick();
  assert.equal(state.calls.length, calls);
});

test('an issue ID only links a PR that names exactly that issue, never a longer number', async (context) => {
  const { tick, file, state } = world(context);
  const queued = '2026-11-20T08:00:00.000Z';
  updateWork((doc) => addWork(doc, { title: 'Settings subtitles', repo: 'mastra-ai/mastra', issue: 'PLTFRM-12' }, queued), file);
  const search = 'PLTFRM-12 merged:>=2026-11-20';
  const pr = (number, title, headRefName) => ({ number, url: `https://github.com/mastra-ai/mastra/pull/${number}`, title, headRefName, mergedAt: '2026-11-20T11:00:00Z', mergeCommit: { oid: `m${number}` } });
  state.searches[search] = [pr(30, 'fix: PLTFRM-123 settings subtitles', 'jal/pltfrm-123-settings-subtitles'), pr(31, 'XPLTFRM-12 lookalike', 'jal/xpltfrm-12'), pr(32, 'PLTFRM-120', 'pltfrm-1200')];
  const { notes } = await tick();
  const fix = findWork(readWork(file), 'w4');
  assert.equal(fix.state, 'open', 'a longer or prefixed issue number never closes the fix');
  assert.equal(fix.links.pr, undefined);
  assert.equal(fix.flag.pr, 'https://github.com/mastra-ai/mastra/pull/30', 'it is only flagged for a look');
  assert.ok(notes.includes('w4 Settings subtitles: may already be fixed by #30 fix: PLTFRM-123 settings subtitles. Check it in the Work tab; K dismisses it.'));
  for (const [title, branch] of [['Fix settings subtitles (pltfrm-12)', 'jal/settings'], ['fix: settings', 'jal/PLTFRM-12'], ['[PLTFRM-12] settings', 'x'], ['PLTFRM-12: settings', 'x'], ['settings', 'feature/pltfrm-12_settings']]) {
    const other = world(context);
    updateWork((doc) => addWork(doc, { title: 'Settings subtitles', repo: 'mastra-ai/mastra', issue: 'PLTFRM-12' }, queued), other.file);
    other.state.searches[search] = [pr(40, title, branch)];
    await other.tick();
    assert.equal(findWork(readWork(other.file), 'w4').state, 'done', `${title} / ${branch}`);
  }
});

test('release inclusion comes from the changelog at the commit npm published, not the default branch', async (context) => {
  const { tick, file, state } = world(context);
  state.released[release('71.0.0-alpha.3')] = CHANGELOG.replace('- Sidebar details panel ([#102](https://github.com/mastra-ai/mastra/pull/102))\n', '');
  const { notes } = await tick();
  const batch = findWork(readWork(file), 'w3');
  assert.deepEqual(batch.members.map((member) => [member.id, member.included?.version]), [['w1', '71.0.0-alpha.3'], ['w2', undefined]], 'main lists #102 but the published commit does not');
  assert.equal(workStatus(readWork(file), batch), 'blocked');
  assert.match(batch.release.evidence, new RegExp(`^mastra-ai/mastra packages/playground-ui/CHANGELOG\\.md at ${release('71.0.0-alpha.3')}, the commit npm records for @mastra/playground-ui@71\\.0\\.0-alpha\\.3, lists #101 under 71\\.0\\.0-alpha\\.3 or earlier$`));
  assert.equal(notes.at(-1), 'w3 Update Platform playground: @mastra/playground-ui 71.0.0-alpha.3 includes w1; missing: w2 (#102) is not in 71.0.0-alpha.3.');
  const reads = state.calls.filter((call) => call.startsWith('gh api'));
  assert.deepEqual(reads, [`gh api -H Accept: application/vnd.github.raw repos/mastra-ai/mastra/contents/packages/playground-ui/CHANGELOG.md?ref=${release('71.0.0-alpha.3')}`]);
});

test('without authoritative publish provenance a batch waits for explicit evidence', async (context) => {
  const cases = {
    noGitHead: [{ gitHead: undefined }, /npm records no source commit for @mastra\/playground-ui@71\.0\.0-alpha\.3/],
    branchName: [{ gitHead: 'main' }, /npm records no source commit/],
    tagName: [{ gitHead: 'v71.0.0-alpha.3' }, /npm records no source commit/],
    shortSha: [{ gitHead: 'abc1234' }, /npm records no source commit/],
    longHex: [{ gitHead: 'a'.repeat(41) }, /npm records no source commit/],
    otherVersion: [{ version: '71.0.0-alpha.2' }, /npm answered for 71\.0\.0-alpha\.2, not 71\.0\.0-alpha\.3/],
    otherRepository: [{ repository: { url: 'git+https://github.com/someone/fork.git', directory: 'packages/playground-ui' } }, /was published from someone\/fork, not mastra-ai\/mastra/],
    noRepository: [{ repository: undefined }, /was published from an unknown repository/],
  };
  for (const [name, [published, expected]] of Object.entries(cases)) {
    const { tick, file, state } = world(context);
    state.published['71.0.0-alpha.3'] = published;
    const { notes } = await tick();
    const batch = findWork(readWork(file), 'w3');
    assert.equal(batch.release, undefined, name);
    assert.ok(batch.members.every((member) => !member.included), name);
    assert.equal(workStatus(readWork(file), batch), 'blocked', name);
    assert.match(notes.at(-1), expected, name);
    assert.match(notes.at(-1), /record the release with rex_work once you have checked it/, name);
    assert.ok(!state.calls.some((call) => call.startsWith('gh api')), `${name}: no changelog is read without a verified commit`);
    assert.deepEqual((await tick()).notes, [], `${name}: said once`);
  }
});

test('batches sharing a package reuse one npm lookup and one changelog read per beat', async (context) => {
  const { tick, file, state } = world(context);
  updateWork((doc) => {
    addWork(doc, { title: 'Open upstream fix', pr: 'https://github.com/mastra-ai/mastra/pull/103' });
    addWork(doc, { kind: 'batch', title: 'Second consumer', package: '@mastra/playground-ui', members: ['w4'] });
  }, file);
  await tick();
  assert.equal(state.calls.filter((call) => call.startsWith('npm view @mastra/playground-ui dist-tags')).length, 1);
  assert.equal(state.calls.filter((call) => call.startsWith('npm view @mastra/playground-ui@')).length, 1);
  assert.equal(state.calls.filter((call) => call.startsWith('gh api')).length, 1);
});
