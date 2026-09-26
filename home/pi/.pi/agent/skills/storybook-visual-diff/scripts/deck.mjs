#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [out, workspace, deckId, title, baseLabel, branchLabel, branchUrl] = process.argv.slice(2);
if (!branchUrl) {
  console.error('usage: deck.mjs <out-dir> <open-slide-workspace> <deck-id> <title> <base-label> <branch-label> <branch-storybook-url>');
  process.exit(1);
}

const index = await fetch(`${branchUrl}/index.json`).then(r => r.json());
const storyName = id => {
  const e = index.entries[id];
  return e ? `${e.title.replace(/\//g, ' / ')} › ${e.name}` : id;
};

const pngSize = file => {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

const themes = readdirSync(out)
  .map(f => f.match(/^results-(.+)\.tsv$/)?.[1])
  .filter(Boolean);
const counts = {};
const byId = new Map();
for (const theme of themes) {
  const rows = readFileSync(join(out, `results-${theme}.tsv`), 'utf8').trim().split('\n').map(l => l.split('\t'));
  counts[theme] = { captured: rows.length, changed: 0, errors: 0 };
  for (const [id, kind, pct] of rows) {
    if (kind.endsWith('error')) {
      counts[theme].errors++;
      continue;
    }
    if (Number(pct) === 0) continue;
    counts[theme].changed++;
    const entry = byId.get(id) ?? { id, max: 0, isNew: kind === 'new', rows: [] };
    entry.rows.push({ theme, kind, pct: Number(pct) });
    entry.max = Math.max(entry.max, Number(pct));
    byId.set(id, entry);
  }
}
const stories = [...byId.values()].sort((a, b) => Number(a.isNew) - Number(b.isNew) || b.max - a.max);

const deckDir = join(workspace, 'slides', deckId);
const assets = join(deckDir, 'assets');
rmSync(deckDir, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });

const shot = (prefix, theme, id) => `${prefix}-${theme}-${id}.png`;
const include = name => {
  const src = join(out, 'shots', name);
  if (!existsSync(src)) return null;
  copyFileSync(src, join(assets, name));
  const [w, h] = pngSize(src);
  return { file: name, w, h };
};

const pages = [];
for (const s of stories) {
  for (const r of s.rows) {
    const branch = include(shot('a', r.theme, s.id));
    if (!branch) continue;
    if (r.kind === 'new') {
      pages.push({ story: storyName(s.id), id: s.id, theme: r.theme, label: 'new story', mode: 'new', branch });
      continue;
    }
    const base = include(shot('b', r.theme, s.id));
    const diff = r.kind === 'pixels' ? include(shot('d', r.theme, s.id)) : null;
    if (!base) continue;
    pages.push({
      story: storyName(s.id),
      id: s.id,
      theme: r.theme,
      label: r.kind === 'size' ? 'size changed' : `${r.pct}% of pixels`,
      mode: diff ? 'diff' : 'overlay',
      base,
      branch,
      diff,
    });
  }
}

const summary = {
  title,
  baseLabel,
  branchLabel,
  themes: themes.map(t => ({ theme: t, ...counts[t] })),
  stories: stories.length,
  newStories: stories.filter(s => s.isNew).length,
};

writeFileSync(
  join(deckDir, 'index.tsx'),
  `import type { Page, SlideMeta } from '@open-slide/core';
import { useSlidePageNumber } from '@open-slide/core';
import type { ReactNode } from 'react';

type Img = { file: string; w: number; h: number };
type Diff = {
  story: string;
  id: string;
  theme: string;
  label: string;
  mode: 'diff' | 'overlay' | 'new';
  base?: Img;
  branch: Img;
  diff?: Img | null;
};

const urls = import.meta.glob('./assets/*.png', { eager: true, import: 'default', query: '?url' }) as Record<string, string>;
const src = (img: Img) => urls[\`./assets/\${img.file}\`];

const summary = ${JSON.stringify(summary, null, 2)};
const diffs: Diff[] = ${JSON.stringify(pages)};

const c = {
  bg: '#0d0e10',
  panel: '#16181c',
  border: '#2a2d33',
  text: '#f1f2f4',
  muted: '#8b8f98',
  accent: '#f5a524',
  font: 'system-ui, -apple-system, "SF Pro Text", sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
};
const PAD = 64;
const GAP = 32;
const BODY_W = 1920 - PAD * 2;
const BODY_H = 1080 - PAD * 2 - 120;
const CAPTION = 34;
const COL = { w: (BODY_W - GAP * 2) / 3, h: BODY_H - CAPTION };
const ROW = { w: BODY_W, h: (BODY_H - GAP * 2) / 3 - CAPTION };

const Footer = () => {
  const { current, total } = useSlidePageNumber();
  return (
    <div style={{ position: 'absolute', right: PAD, top: PAD, fontSize: 22, color: c.muted, fontFamily: c.mono }}>
      {current} / {total}
    </div>
  );
};

const Shell = ({ children }: { children: ReactNode }) => (
  <div style={{ width: '100%', height: '100%', background: c.bg, color: c.text, fontFamily: c.font, padding: PAD, boxSizing: 'border-box', position: 'relative' }}>
    {children}
    <Footer />
  </div>
);

const Cover: Page = () => (
  <Shell>
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', gap: 40 }}>
      <div style={{ fontSize: 28, color: c.accent, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Visual diff</div>
      <div style={{ fontSize: 120, fontWeight: 800, lineHeight: 1.05 }}>{summary.title}</div>
      <div style={{ fontSize: 34, color: c.muted, fontFamily: c.mono }}>
        {summary.baseLabel} → {summary.branchLabel}
      </div>
      <div style={{ display: 'flex', gap: 64, marginTop: 24 }}>
        {summary.themes.map(t => (
          <div key={t.theme} style={{ fontSize: 34, lineHeight: 1.5 }}>
            <div style={{ color: c.muted, textTransform: 'capitalize' }}>{t.theme}</div>
            <div>{t.changed} changed of {t.captured}</div>
            {t.errors > 0 && <div style={{ color: c.accent }}>{t.errors} could not be captured</div>}
          </div>
        ))}
        {summary.newStories > 0 && (
          <div style={{ fontSize: 34, lineHeight: 1.5 }}>
            <div style={{ color: c.muted }}>New stories</div>
            <div>{summary.newStories}</div>
          </div>
        )}
      </div>
    </div>
  </Shell>
);

const Frame = ({ caption, box, children }: { caption: string; box: { w: number; h: number }; children: ReactNode }) => (
  <div style={{ width: box.w, display: 'flex', flexDirection: 'column', gap: 8 }}>
    <div style={{ fontSize: 22, height: CAPTION - 8, color: c.muted }}>{caption}</div>
    <div style={{ width: box.w, height: box.h, background: c.panel, border: \`1px solid \${c.border}\`, borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
      {children}
    </div>
  </div>
);

const Shot = ({ img, scale, blend }: { img: Img; scale: number; blend?: boolean }) => (
  <img
    src={src(img)}
    alt=""
    style={{ position: 'absolute', top: 0, left: 0, width: img.w * scale, height: img.h * scale, mixBlendMode: blend ? 'difference' : undefined }}
  />
);

const DiffPage = (d: Diff): Page => {
  const imgs = [d.base, d.branch, d.diff].filter(Boolean) as Img[];
  const fit = (box: { w: number; h: number }) => Math.min(1, ...imgs.map(i => Math.min(box.w / i.w, box.h / i.h)));
  const rows = d.mode !== 'new' && fit(ROW) > fit(COL);
  const box = d.mode === 'new' ? { w: BODY_W, h: BODY_H - CAPTION } : rows ? ROW : COL;
  const scale = fit(box);
  const page: Page = () => (
    <Shell>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, height: 72 }}>
        <div style={{ fontSize: 36, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 1200 }}>{d.story}</div>
        <div style={{ fontSize: 24, color: c.muted, textTransform: 'capitalize' }}>{d.theme}</div>
        <div style={{ fontSize: 24, color: c.accent }}>{d.label}</div>
      </div>
      <div style={{ fontSize: 20, color: c.muted, fontFamily: c.mono, height: 48 }}>{d.id}</div>
      <div style={{ display: 'flex', flexDirection: rows ? 'column' : 'row', gap: GAP }}>
        {d.mode === 'new' ? (
          <Frame box={box} caption="branch (new story)">
            <Shot img={d.branch} scale={scale} />
          </Frame>
        ) : (
          <>
            <Frame box={box} caption="main">
              <Shot img={d.base!} scale={scale} />
            </Frame>
            <Frame box={box} caption="branch">
              <Shot img={d.branch} scale={scale} />
            </Frame>
            <Frame box={box} caption={d.mode === 'diff' ? 'diff (red = changed)' : 'overlay (bright = moved)'}>
              {d.mode === 'diff' ? (
                <Shot img={d.diff!} scale={scale} />
              ) : (
                <div style={{ position: 'absolute', inset: 0, background: '#000', isolation: 'isolate' }}>
                  <Shot img={d.base!} scale={scale} />
                  <Shot img={d.branch} scale={scale} blend />
                </div>
              )}
            </Frame>
          </>
        )}
      </div>
    </Shell>
  );
  return page;
};

export const meta: SlideMeta = {
  title: ${JSON.stringify(`${title} visual diff`)},
  createdAt: '${new Date().toISOString()}',
};

export default [Cover, ...diffs.map(DiffPage)] satisfies Page[];
`,
);
console.log(`${pages.length} pages from ${stories.length} stories -> ${join(deckDir, 'index.tsx')}`);
