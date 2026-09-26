#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [out, title, baseUrl, branchUrl] = process.argv.slice(2);
const themes = readdirSync(out)
  .map(f => f.match(/^results-(.+)\.tsv$/)?.[1])
  .filter(Boolean);

const byId = new Map();
for (const theme of themes) {
  for (const line of readFileSync(join(out, `results-${theme}.tsv`), 'utf8').trim().split('\n')) {
    const [id, kind, pct] = line.split('\t');
    if (!id || kind.endsWith('error') || Number(pct) === 0) continue;
    const entry = byId.get(id) ?? { id, max: 0, rows: [] };
    entry.rows.push({ theme, kind, pct: Number(pct) });
    entry.max = Math.max(entry.max, Number(pct));
    byId.set(id, entry);
  }
}
const stories = [...byId.values()].sort((a, b) => Number(a.rows[0].kind === 'new') - Number(b.rows[0].kind === 'new') || b.max - a.max);
const errors = themes.flatMap(theme =>
  readFileSync(join(out, `results-${theme}.tsv`), 'utf8')
    .split('\n')
    .filter(l => l.split('\t')[1]?.endsWith('error'))
    .map(l => `${l.split('\t')[0]} (${theme})`),
);

const shot = (prefix, theme, id) => `shots/${prefix}-${theme}-${id}.png`;
const third = (theme, id, kind) =>
  kind === 'pixels' && existsSync(join(out, shot('d', theme, id)))
    ? `<figcaption>diff (red = changed)</figcaption><img src="${shot('d', theme, id)}">`
    : `<figcaption>overlay (bright = moved)</figcaption><div class=ov><img src="${shot('b', theme, id)}"><img class=top src="${shot('a', theme, id)}"></div>`;

const figures = (r, id) =>
  r.kind === 'new'
    ? `<figure><figcaption>branch (new story)</figcaption><img src="${shot('a', r.theme, id)}"></figure>`
    : `<figure><figcaption>main</figcaption><img src="${shot('b', r.theme, id)}"></figure>
<figure><figcaption>branch</figcaption><img src="${shot('a', r.theme, id)}"></figure>
<figure>${third(r.theme, id, r.kind)}</figure>`;
const label = r => (r.kind === 'size' ? 'size changed' : r.kind === 'new' ? 'new story' : `${r.pct}%`);

const section = s => `<section><h2>${s.id}<a href="${baseUrl}/?path=/story/${s.id}">main</a><a href="${branchUrl}/?path=/story/${s.id}">branch</a></h2>${s.rows
  .map(
    r => `<div class=theme>${r.theme} <span>${label(r)}</span></div><div class=row>${figures(r, s.id)}</div>`,
  )
  .join('')}</section>`;

writeFileSync(
  join(out, 'report.html'),
  `<!doctype html><meta charset=utf-8><title>${title}</title><style>
body{background:#111;color:#ddd;font:13px system-ui;margin:24px}
h1{font-size:18px}h2{font-size:13px;font-weight:500;margin:28px 0 4px}
.theme{color:#888;margin:8px 0 4px}.theme span{color:#f90;margin-left:6px}
a{color:#8af;margin-left:8px}.errors{color:#f66}
.row{display:flex;gap:16px;align-items:flex-start;overflow-x:auto}
figure{margin:0;flex:0 0 auto}figcaption{color:#888;margin-bottom:4px}
img{display:block;max-width:600px;border:1px solid #333}
.ov{position:relative}.ov img{max-width:none}.ov .top{position:absolute;top:0;left:0;mix-blend-mode:difference}
@media print{body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.row{flex-wrap:nowrap;overflow:visible;break-inside:avoid}h2,.theme{break-after:avoid}img,.ov img{max-width:31vw;max-height:85vh;object-fit:contain;object-position:top left}}
</style><h1>${title}: ${stories.length} changed stories, most changed first</h1>
${errors.length ? `<p class=errors>Could not capture: ${errors.join(', ')}</p>` : ''}
${stories.map(section).join('')}`,
);
console.log(`${stories.length} changed, ${errors.length} errors -> ${join(out, 'report.html')}`);
