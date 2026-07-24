---
name: docs-writer
description: Write, edit, review, and restructure Shieldcn documentation with accurate code-backed content, Fumadocs MDX conventions, and consistent technical-writing style. Use for docs rewrites, badge provider docs, API reference updates, sidebar/meta changes, documentation audits, and consolidation work. Triggers include "redo the docs", "write docs", "review docs", "update badge docs", "consolidate docs", "docs style", or any task modifying packages/web/content/docs.
---

# Docs Writer

Use this skill when writing, editing, reviewing, auditing, or restructuring
Shieldcn documentation.

## Project context

Shieldcn is a badge rendering project. The docs live primarily in
`packages/web/content/docs/` and use Fumadocs MDX. Badge provider docs live in
`packages/web/content/docs/badges/`. Navigation is also represented in
`packages/web/components/sidebar.tsx` and relevant `meta.json` files.

When you work on docs, reflect the current implementation in `packages/core`,
`packages/web`, and `packages/engine`. Do not document intended behavior unless
the user explicitly asks for future-facing copy.

## Documentation standards

### Voice and tone

Write in a professional, friendly, and direct voice.

- Address the reader as "you."
- Use active voice and present tense.
- Use standard US English.
- Use simple vocabulary and avoid jargon, slang, idioms, and marketing hype.
- Use "must" for requirements and "we recommend" for recommendations.
- Avoid "should."
- Avoid "please."
- Use contractions when they improve flow.
- Avoid anthropomorphism. For example, write "the API returns" instead of
  "the API thinks."

### Language and grammar

Write precise, unambiguous instructions.

- Use "for example" instead of "e.g."
- Use "that is" instead of "i.e."
- Use the serial comma.
- Put periods and commas inside quotation marks.
- Use unambiguous dates, such as "January 22, 2026."
- Use "lets you" instead of "allows you to."
- Use meaningful names in examples. Avoid `foo` and `bar`.
- Use "quota" for an administrative bucket and "limit" for the numerical
  ceiling.

### Formatting and syntax

Make documentation scannable and accessible.

- Add an overview paragraph after every heading before lists, tables, callouts,
  or subheadings.
- Wrap prose at 80 characters, except long links and tables.
- Use sentence case for headings, titles, and bold text.
- Use numbered lists for sequential steps.
- Use bulleted lists for non-sequential lists.
- Keep list items parallel.
- Use bold text for UI labels.
- Use code font for filenames, snippets, commands, parameters, API elements,
  and paths.
- Use semantic headings, lists, and tables.
- Use lowercase hyphenated filenames for media.
- Provide descriptive alt text for images.
- Use `<details>` for supplementary or data-heavy content that isn't critical
  to the main flow.
- Avoid tables of contents. Remove them when editing a page that has one.

### Callouts

Use GitHub-flavored Markdown alerts for important information. Preserve callout
formatting with a Prettier ignore comment directly before the callout.

For MDX files, use this format:

```mdx
{/* prettier-ignore */}

> [!NOTE]
> This is an example note.
```

For Markdown files, use this format:

```md
<!-- prettier-ignore -->

> [!NOTE]
> This is an example note.
```

Use `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, or `CAUTION`.

### Links

Use links that remain useful when read out of context.

- Use descriptive anchor text. Avoid "click here."
- In docs pages, use relative links from the current file's directory.
- Do not include `/docs/` in relative docs links.
- Verify that relative links exist.
- If you change a heading, search for deep links to that heading and update
  them.

## Shieldcn docs structure

### Badge provider pages

Prefer one page per provider unless the user asks for detailed sub-pages. Use
this structure for provider pages in `packages/web/content/docs/badges/`:

```mdx
---
title: Provider name
description: Badges for Provider name.
badge: "/provider/example.svg?variant=branded"
---

Introductory paragraph that explains what the provider page covers.

<BadgePreviewGroup>
  <BadgePreviewCard ... />
</BadgePreviewGroup>

## Available badges

Introductory paragraph for the table.

| Badge | Endpoint | Description |
| --- | --- | --- |

## Quick examples

Introductory paragraph for examples.

```md
![Example](https://shieldcn.dev/provider/example.svg)
```

## Usage notes

Provider-specific naming, IDs, setup, or constraints.

## Data source

API source, auth requirements, cache behavior, and freshness notes.
```

Every badge provider page must include `badge` frontmatter. Use
`?variant=branded` when the provider has a brand icon.

### Badge docs components

Use existing MDX components instead of custom markup when possible.

- `<BadgePreview>` for a single badge with copy support.
- `<BadgePreviewGroup>` for a grid of badge examples.
- `<BadgePreviewCard>` for compact badge cards.
- `<BadgeSandbox>` for interactive badge builders.
- `<CodeBlock>` and `<CodeLine>` for code examples.
- `<ApiRefTable>` for API reference tables.
- `<InstallBlock>` for install commands.

For provider overview pages, include four to six preview cards when practical.
Show the branded variant first when available, then common variants such as
`secondary`, `outline`, and `ghost`.

## Preparation workflow

Before modifying documentation, investigate the request and surrounding context.

1. Clarify ambiguous requests before editing.
2. Read relevant docs files in `packages/web/content/docs/`.
3. Inspect relevant implementation files in `packages/core`, `packages/web`,
   and `packages/engine`.
4. Search for existing references, internal links, and deep links.
5. Check `packages/web/content/docs/**/meta.json` and
   `packages/web/components/sidebar.tsx` when navigation might change.
6. Create a concise plan before making changes.

## Execution workflow

Update docs with the smallest safe set of changes.

1. Edit existing pages when preserving URLs is better for users.
2. Create new pages only when the information needs its own durable URL.
3. When consolidating pages, merge unique details into the parent provider page.
4. Remove stale sub-page references from `meta.json`, sidebar navigation, and
   internal links.
5. Keep API routes and docs URLs distinct. Do not change badge API behavior when
   the task is documentation-only.
6. Do not silently fix unrelated docs issues. Mention them separately.

## Verification workflow

Review documentation changes before responding.

1. Re-read edited pages for accuracy, structure, and flow.
2. Verify new and changed links.
3. If headings changed, search for old heading anchors.
4. Confirm examples match implemented badge routes and query parameters.
5. Ask before running broad formatting commands. If approved, run the project
   formatter, such as `pnpm format` or the documented repo command.
6. Summarize changed files and note any follow-up work.
