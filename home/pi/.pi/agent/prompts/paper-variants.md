---
description: Generate a grid of Mastra UI variants in Paper, seeded by Mobbin references
argument-hint: "<surface or component, e.g. 'Studio agents list' or 'Platform usage card'>"
---
Generate design variants in Paper for: ${ARGUMENTS}

Use the `paper` MCP to draw and the `mobbin` MCP for references. If either reports it needs sign-in, stop and tell Justin to run `pi mcp login <server>`. Load `mastra-ui-contract` and `mastra-ui-copy` first.

1. Pin the content. Find the surface in the Mastra code (`packages/playground-ui`, `packages/playground`, or `~/dev/platform/frontend`) and copy its real labels, data shape and states. Every variant uses this exact content, so the only thing that changes between them is structure. Invented filler hides whether a layout survives real names and counts.
2. Gather references. Run 3-5 Mobbin searches (`search_screens`, `search_sections`, `search_flows` for multi-step surfaces) aimed at how strong products lay out this kind of content, not at products that look like Mastra. Note the distinct structural ideas you find: chips, numbered index, columns, timeline, split header, comparison table, and so on.
3. Plan 16-20 variants, each a different structural idea. Two variants that differ only in color or spacing count as one; replace it. Include at least one dense option, one spacious option, and one dark-surface option.
4. Draw them in Paper as one grid of equal-size artboards on a new page named after the surface. Label each artboard in small caps at its top left: `01 · CHIPS`, `02 · EDITORIAL ROWS`, and so on. Use Mastra's real tokens and type: the semantic colors, text roles and radii from playground-ui, not approximations. Keep every artboard at the same zoom and content length so they compare side by side.
5. Read the canvas back with Paper's screenshot tool and fix anything clipped, overlapping, or broken by the real content.
6. Reply with the Paper page name, then one line per variant: number, name, and the trade-off it makes. End with your top three and why.

Do not write production code. This is exploration; promising variants go to `emil-prototype` or an implementation task afterward.
