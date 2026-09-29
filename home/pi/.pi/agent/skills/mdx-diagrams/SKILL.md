---
name: mdx-diagrams
description: Create monospace ASCII-frame diagrams for MDX posts and docs, the dashed `+ - - [ TITLE ] - - +` boxes with a blue title, aligned columns, and accent highlights. Use for cost tables, decision/reason lists, contrast or scale ladders, side-by-side comparisons, dot grids, nested box anatomy, and formulas inside MDX. Triggers on "mdx diagram", "mdx graph", "ascii diagram", "ascii table", "terminal-style figure", "dashed box figure", "[ TITLE ] box", or `/mdx-diagram`.
---

# MDX Diagrams

Every diagram is one `<Diagram>` call. The component draws the frame, title, padding, and separators. You write only the content grid.

```mdx
<Diagram title="What the research cost">{`
  Agent                    Tokens    Tool calls    Time
  ---
  Inks and paper          115,207           120     16m
  Overprint and drift     135,218           164     16m
  ---
  Total                   250,425           284     32m
`}</Diagram>
```

## Setup

1. Search the project for an existing `Diagram` export (`rg "export function Diagram"`). If it exists, use it and skip to Content.
2. Otherwise copy `assets/Diagram.tsx` from this skill into the project's MDX components folder and register `Diagram` wherever the project maps MDX components (`mdx-components.tsx`, an `MDXProvider`, or the `components` prop). Never add a dependency; the component needs only React.
3. Override colors with the CSS variables `--diagram-bg`, `--diagram-fg`, `--diagram-muted`, `--diagram-faint`, `--diagram-frame`, `--diagram-accent`, `--diagram-bad`, `--diagram-good` when the site has its own palette. Change the defaults in the file only when the project has no tokens.

## Content syntax

| Write | Renders | Use for |
| --- | --- | --- |
| `text` | foreground | body values |
| `[[text]]` | accent blue | the one thing to compare, filled glyphs, box corners |
| `((text))` | muted | column headers, captions under grids |
| `{{text}}` | faint | illegible-by-design samples, empty glyphs, inner dashed lines |
| `!!text!!` | red | the failing or before values in a before/after comparison |
| `++text++` | green | the improvement or delta in a before/after comparison |
| `[[[text]]]`, `!!!text!!!`, `+++text+++` | blue, red, or green text on a tinted block | the single cell the reader must see first |
| ` @mark`, ` @bad`, ` @good` at the end of a line | tinted band across the whole row | the one row that carries the conclusion |
| `---` alone on a line | full-width dashed separator | under headers, above totals |

Markup characters and row markers take no width. Align columns by the visible text only. Row markers go after the last column so the source stays aligned.

## Choose the pattern

What is the reader comparing?
├── Numbers across named items → **Table**: header row, `---`, rows, `---`, `Total` row.
├── A choice and why → **Two columns**: `((Decision))` / `((Reason))` headers, `---`, plain rows. No totals.
├── Levels of one quality → **Ladder**: value column + sample column; accent the passing values, `{{faint}}` the failing ones.
├── Two approaches side by side → **Grids**: `[[■]]` for filled and `{{□}}` for empty, `((caption))` centered under each grid.
├── Parts inside parts → **Anatomy**: `[[╭]] [[╮]] [[╰]] [[╯]]` corners joined by `{{- - -}}` edges and `{{|}}` sides, labels inside, formula below.
└── More than 8 rows, or data the reader will copy → a plain Markdown table, not a Diagram. A figure is for a glance; long data belongs in something selectable and responsive.

## Layout rules

- Keep the widest content line at or under 64 characters. Wider frames scroll horizontally on phones.
- Separate columns with at least 4 spaces. Two spaces reads as one phrase.
- Left-align text columns. Right-align number columns, and right-align their headers over them. Use thousands separators and one unit per column (`16m`, `7.8 min`, not both).
- Titles are 1 to 4 words, written in sentence case in the prop. The component uppercases them.
- Use at most one accent treatment per diagram. The title is already blue; a second blue meaning makes the reader decode a legend.
- Fill at most one row and one cell per diagram. A fill says "look here first"; two of them compete.
- Red and green are only for before/after results: `!!` on what failed or got worse, `++` on the delta. Every red or green value needs a neighbor that says what it is compared with, and never color a row that did not change.
- Never put readable content in `{{faint}}`. Its contrast is about 2:1; it exists to show text you are not supposed to read.
- Box-drawing corners and `■ □ ◂ ▸` must be single-width in the site's monospace font. If a glyph renders wider, the right border drifts; swap it for ASCII.

## Export a PNG

When the user wants an image (for social posts, Slack, or a site without MDX), write the content grid to a temporary `.txt` file and run:

```sh
bun ~/.pi/agent/skills/mdx-diagrams/assets/export.ts --title "Taste, explained" grid.txt out.png
```

- Content syntax is identical to the MDX body; pass `-` to read stdin.
- It renders at 2x through the isolated task browser and crops to the figure, so the font is baked into the image. `--font '"Family", monospace'` overrides the default stack (JetBrains Mono, then Geist Mono).
- Always open the PNG and check it against the Verify list before handing it over. The browser may silently fall back to another monospace font if the requested one is not installed.

## Verify

1. Count widths: every line in a column group must share the same start column. Misaligned numbers are the most common defect.
2. Render the page and check the right border `|` forms one straight line. A kink means a line has a wide glyph or a tab.
3. Check the frame at a 375px viewport: it must scroll inside the figure, not overflow the page.
