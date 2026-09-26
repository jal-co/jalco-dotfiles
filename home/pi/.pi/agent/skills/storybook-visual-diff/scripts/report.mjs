#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const [out, title, baseLabel, branchLabel, baseUrl, branchUrl] = process.argv.slice(2);
if (!branchUrl) {
  console.error('usage: report.mjs <out-dir> <title> <base-label> <branch-label> <base-storybook-url> <branch-storybook-url>');
  process.exit(1);
}

const index = await fetch(`${branchUrl}/index.json`).then(r => r.json());
const storyName = id => {
  const e = index.entries[id];
  return e ? `${e.title.replace(/\//g, ' / ')} › ${e.name}` : id;
};

const decodePng = file => {
  const buf = readFileSync(file);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const bpp = buf[25] === 6 ? 4 : 3;
  const chunks = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    if (buf.toString('ascii', o + 4, o + 8) === 'IDAT') chunks.push(buf.subarray(o + 8, o + 8 + len));
    o += len + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = w * bpp;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      px[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  return { w, h, bpp, px };
};

const contentBox = file => {
  const { w, h, bpp, px } = decodePng(file);
  const bg = [px[0], px[1], px[2]];
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * bpp;
      if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? { w, h, x: 0, y: 0, cw: w, ch: h } : { w, h, x: x0, y: y0, cw: x1 - x0 + 1, ch: y1 - y0 + 1 };
};

const changedBox = file => {
  const { w, h, bpp, px } = decodePng(file);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * bpp;
      if (px[i] > 200 && px[i + 1] < 70 && px[i + 2] < 70) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};

const zoomCrop = (changed, crop) => {
  if (!changed) return null;
  const minW = crop.w / 4;
  const minH = crop.h / 4;
  const pad = Math.max(12, Math.round(Math.max(changed.w, changed.h) / 10));
  let w = Math.max(changed.w + pad * 2, minW);
  let h = Math.max(changed.h + pad * 2, minH);
  if (w >= crop.w * 0.8 && h >= crop.h * 0.8) return null;
  w = Math.min(w, crop.w);
  h = Math.min(h, crop.h);
  const x = Math.min(Math.max(crop.x, changed.x + changed.w / 2 - w / 2), crop.x + crop.w - w);
  const y = Math.min(Math.max(crop.y, changed.y + changed.h / 2 - h / 2), crop.y + crop.h - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
};

const unionCrop = boxes => {
  const pad = Math.round(Math.max(...boxes.map(b => b.w)) / 80);
  const x = Math.max(0, Math.min(...boxes.map(b => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map(b => b.y)) - pad);
  const r = Math.min(Math.max(...boxes.map(b => b.w)), Math.max(...boxes.map(b => b.x + b.cw)) + pad);
  const btm = Math.min(Math.max(...boxes.map(b => b.h)), Math.max(...boxes.map(b => b.y + b.ch)) + pad);
  return { x, y, w: r - x, h: btm - y };
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

const shot = (prefix, theme, id) => `${prefix}-${theme}-${id}.png`;
const include = name => {
  const src = join(out, 'shots', name);
  if (!existsSync(src)) return null;
  const box = contentBox(src);
  return { file: name, w: box.w, h: box.h, box };
};
const strip = img => img && { file: img.file, w: img.w, h: img.h };

const pages = [];
for (const s of stories) {
  for (const r of s.rows) {
    const branch = include(shot('a', r.theme, s.id));
    if (!branch) continue;
    if (r.kind === 'new') {
      pages.push({ story: storyName(s.id), id: s.id, theme: r.theme, label: 'new story', mode: 'new', branch: strip(branch), crop: unionCrop([branch.box]) });
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
      base: strip(base),
      branch: strip(branch),
      diff: strip(diff),
      crop: unionCrop([base.box, branch.box]),
    });
    const last = pages[pages.length - 1];
    last.zoom = diff ? zoomCrop(changedBox(join(out, 'shots', diff.file)), last.crop) : null;
  }
}

const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const view = (img, crop, caption, blend) => {
  const style = `width:${(img.w / crop.w) * 100}%;left:${(-crop.x / crop.w) * 100}%;top:${(-crop.y / crop.h) * 100}%`;
  return `<img src="shots/${img.file}" style="${style}"${blend ? ' class=blend' : ''} loading=lazy>`;
};
const dpr = Math.max(1, Math.round(Math.max(...pages.map(p => p.branch.w)) / 1280));
const baseScale = crop => Math.min(4, Math.max(1, 480 / (crop.w / dpr)));
const frame = (crop, caption, inner, magnify = baseScale(crop)) =>
  `<figure style="width:min(100%,${Math.round((crop.w / dpr) * magnify)}px,calc(78vh * ${crop.w / crop.h}))"><div class=crop style="aspect-ratio:${crop.w}/${crop.h}">${inner}</div><figcaption>${caption}</figcaption></figure>`;

const section = p => {
  const cells =
    p.mode === 'new'
      ? frame(p.crop, 'branch (new story)', view(p.branch, p.crop))
      : [
          frame(p.crop, 'main', view(p.base, p.crop)),
          frame(p.crop, 'branch', view(p.branch, p.crop)),
          p.mode === 'diff'
            ? frame(p.crop, 'diff (red = changed)', view(p.diff, p.crop))
            : frame(p.crop, 'overlay (bright = moved)', view(p.base, p.crop) + view(p.branch, p.crop, '', true)),
        ].join('');
  const zoom = p.zoom
    ? `<div class=grid style="grid-template-columns:repeat(2,minmax(0,${Math.round((p.zoom.w / dpr) * 2)}px))">${frame(p.zoom, 'main, zoomed to the change', view(p.base, p.zoom), 2)}${frame(p.zoom, 'branch, zoomed to the change', view(p.branch, p.zoom), 2)}</div>`
    : '';
  return `<section><header><h2>${esc(p.story)}</h2><span class=chip>${p.theme}</span><span class=pct>${p.label}</span><code>${p.id}</code><a href="${baseUrl}/?path=/story/${p.id}">main</a><a href="${branchUrl}/?path=/story/${p.id}">branch</a></header><div class=grid style="${p.mode === 'new' || (p.crop.w / dpr) * baseScale(p.crop) * 0.55 > 492 ? '' : `grid-template-columns:repeat(3,minmax(0,${Math.round((p.crop.w / dpr) * baseScale(p.crop))}px))`}">${cells}</div>${zoom}</section>`;
};

const counts_line = [
  ...themes.map(t => `${counts[t].changed} ${t}`),
  ...(stories.some(s => s.isNew) ? [`${stories.filter(s => s.isNew).length} new`] : []),
].join(' · ');

writeFileSync(
  join(out, 'report.html'),
  `<!doctype html><meta charset=utf-8><title>${esc(title)} visual diff</title><style>
:root{--bg:#08090a;--surface:#0e0f12;--border:rgba(255,255,255,.08);--text:#f7f8f8;--soft:#c7c9d1;--muted:#6f727c;--accent:#7170ff;--mono:ui-monospace,"SF Mono",Menlo,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.4 system-ui,-apple-system,"Inter",sans-serif}
.top{display:flex;gap:16px;align-items:baseline;padding:16px 48px;font-size:14px}.top span{font:12px var(--mono);color:var(--muted)}
section{padding:28px 48px;border-top:1px solid var(--border)}
header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px}h2{font-size:20px;margin:0;letter-spacing:-.01em}
.chip{font-size:12px;color:var(--soft);border:1px solid var(--border);border-radius:999px;padding:2px 10px;text-transform:capitalize}
.pct{font:14px var(--mono);color:var(--accent)}code{font:12px var(--mono);color:var(--muted)}a{color:var(--muted);font-size:13px}a:hover{color:var(--text)}
.grid{display:grid;grid-template-columns:minmax(0,max-content);gap:16px 12px;align-items:start}.grid+.grid{margin-top:16px}
figure{margin:0;min-width:0}
.crop{position:relative;overflow:hidden;background:#000;border:1px solid var(--border);border-radius:10px}
.crop img{position:absolute;display:block;height:auto;max-width:none}.crop img.blend{mix-blend-mode:difference}
figcaption{font:12px var(--mono);color:var(--muted);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}section{break-inside:avoid;padding:16px 24px}}
</style>
<div class=top><b>${esc(title)}</b><span>${counts_line}</span><span>${esc(baseLabel)} → ${esc(branchLabel)}</span></div>
${pages.map(section).join('\n')}`,
);
console.log(`${pages.length} sections from ${stories.length} stories -> ${join(out, 'report.html')}`);
