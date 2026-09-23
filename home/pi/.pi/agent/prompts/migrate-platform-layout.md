---
description: Migrate Platform pages off PageShell, PageFrame, and the local PageLayout onto playground-ui PageLayout
argument-hint: "[page files or route area]"
---

Load `mastra-ui-contract`, `mastra-work`, and `platform-local-dev`, then migrate ${@:-every Platform page that uses the legacy layout layer} in the `platform` repository.

## Gate

1. Read the `@mastra/playground-ui` version in `frontend/package.json`. If it is `57.0.0` or lower, stop and tell Justin the migration needs the playground-ui upgrade first. Do not bump it yourself.
2. Confirm `frontend/node_modules/@mastra/playground-ui/dist/src/ds/components/PageLayout/page-layout.d.ts` lists `narrow` and a `header` prop. If it does not, run `pnpm install` in `frontend` and check again. If it still does not, stop and report.

## Inventory

List every use of `PageShell`, `PageFrame`, `PageFrameCenter`, and the local `PageLayout` from `frontend/src/shared/ui/layouts/` with `git grep`. Group the pages by route area and show the list before editing.

## Migrate

Classify each page with the contract's layout tree (content shape first, then header), not only by its old wrapper:

| Legacy | Replacement |
| --- | --- |
| `PageShell` | `PageLayout variant="container" header={<PageHeader>…</PageHeader>}` |
| `PageShell` around panels that scroll on their own | `PageLayout variant="fit"` with breadcrumbs, no header |
| local `PageLayout variant="constrained"` | `PageLayout variant="narrow"`, with a `PageHeader` in `header` when the page has a title |
| local `PageLayout variant="fullwidth"` | `PageLayout variant="container"` |
| `PageFrameCenter` | `EmptyState variant="fill"` or `Spinner fill` |

- Convert `PageShell` props to the compound API: `title` to `PageHeader.Title`, `description` to `.Description`, `meta` to `.Meta beside`, `icon` to `.Icon`, `action` to `.Action`, and `isLoading` to `PageHeader.Title isLoading`. Drop the mobile placement classes `PageShell` put on `.Action`.
- Remove the page-level padding, `mx-auto`, `max-w-*`, `space-y-*`, and scroll wrappers the legacy layer added. The body's first element sets `mt-6` below a header and `pb-16` at the end.
- Pages using `SettingsLayout` also follow `platform-settings-sections`.
- Migrate one route area per commit. Delete `PageShell`, `PageFrame`, and the local `PageLayout` only after `git grep` finds no remaining callers.

## Verify

- Frontend typecheck, focused tests for every touched page, ESLint, and Prettier.
- Check each migrated route at 1440px and 390px with the task browser: title, width, scroll owner, and empty, loading, and error states.
- Stop for Justin's localhost review before any push or PR.
