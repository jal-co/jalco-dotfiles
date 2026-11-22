import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { readWork } from '../src/work.ts';

const agent = join(homedir(), '.pi/agent');
const version = readFileSync(join(agent, 'install/current-version'), 'utf8').trim();
const { loadExtensions } = await import(pathToFileURL(join(agent, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js')).href);

test('rex_work and its commands load in Pi and only record work', async (context) => {
  const dir = mkdtempSync(join(tmpdir(), 'rex-work-tool-'));
  const old = process.env.REX_WORK_FILE;
  process.env.REX_WORK_FILE = join(dir, 'work.json');
  context.after(() => {
    if (old === undefined) delete process.env.REX_WORK_FILE; else process.env.REX_WORK_FILE = old;
    rmSync(dir, { recursive: true, force: true });
  });
  const entry = join(dir, 'extension.ts');
  writeFileSync(entry, `import { registerWork } from ${JSON.stringify(fileURLToPath(new URL('../src/work-tool.ts', import.meta.url)))};\nexport default (pi) => registerWork(pi);\n`);
  const loaded = await loadExtensions([entry], dir);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  const tool = extension.tools.get('rex_work').definition;
  assert.match(tool.description, /never launches agents, creates or changes Linear issues, commits, publishes or cleans up/);
  assert.ok(tool.promptGuidelines.every((line) => line.includes('rex_work')));
  const call = async (params) => (await tool.execute('call', params)).content[0].text;
  const notices = [];
  const ctx = { ui: { notify: (message) => notices.push(message) } };
  await extension.commands.get('rex-fix').handler('Toast overflow should wrap upstream', ctx);
  assert.match(notices.at(-1), /^Queued w1\. Nothing was started, created or published\.\nw1 fix \[open\] Toast overflow should wrap upstream$/);
  assert.match(await call({ action: 'add', kind: 'batch', title: 'Update Platform playground', package: '@mastra/playground-ui', downstream: 'platform', members: ['w1'] }), /Queued w2[\s\S]*blocked by: w1 has not landed upstream \(open\); @mastra\/playground-ui release not recorded/);
  await assert.rejects(call({ action: 'update', title: 'no id' }), /update needs a work ID/);
  await assert.rejects(call({ action: 'update', id: 'w1', dependsOn: ['w2'] }), /cycle/);
  await call({ action: 'update', id: 'w1', state: 'done', pr: 'https://github.com/mastra-ai/mastra/pull/7' });
  await call({ action: 'release', id: 'w2', version: '1.4.0', evidence: 'changelog lists #7', included: ['w1'] });
  assert.match(await call({ action: 'show' }), /w2 batch \[ready\] Update Platform playground/);
  await extension.commands.get('rex-work').handler('w2', ctx);
  assert.match(notices.at(-1), /^w2 batch \[ready\][\s\S]*includes: w1 Toast overflow should wrap upstream \(done, in 1\.4\.0\)/);
  await extension.commands.get('rex-work').handler('', ctx);
  assert.doesNotMatch(notices.at(-1), /^w1 /m);
  await extension.commands.get('rex-work').handler('all', ctx);
  assert.match(notices.at(-1), /^w1 fix \[done\]/m);
  assert.equal(readWork().entries.length, 2);
  assert.deepEqual([...extension.tools.keys()], ['rex_work']);
});
