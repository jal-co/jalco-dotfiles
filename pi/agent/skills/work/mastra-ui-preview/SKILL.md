---
name: mastra-ui-preview
disable-model-invocation: true
description: Quickly test a playground-ui or shared UI change on Platform, Factory, and Studio, with a mock API, swapping the change in and out for before/after, and opening the result in Justin's browser. Use when a change to PageLayout, a DS primitive, or global styling must be verified across Platform, Factory and Studio pages, when asked for before/after evidence, or when Studio or Factory shows a blank page or failed startup check.
---

# mastra UI preview

Three apps consume `playground-ui` from its built `dist/`, so a source edit shows nothing until rebuilt:

| App | Where | How it gets playground-ui | Port |
| --- | --- | --- | --- |
| Studio | `packages/playground` | workspace link | 5290 |
| Factory | `mastracode/factory-ui` | workspace link | 5173 |
| Platform | `platform/frontend` | published npm snapshot, so it must be linked to the local build | 5173 (use `--port 5231` if Factory runs) |

Studio and Factory share one mock API on :4111. Platform uses its own backend or `frontend/.fixtures` (see `platform-local-dev`).

All scripts live in `~/.pi/agent/skills/work/mastra-ui-preview/scripts` (`S` below). Run `variant.sh` from the mastra task worktree. Never use `~/Documents/Github/mastra`.

## Where the result is viewed

Default: Justin's browser, never the T3 preview pane. Large pages are unreadable in the pane and Justin reviews in his own browser. Open each URL with `~/.pi/agent/browser-testing/task-browser review <url>`, which opens it in the background without taking focus. Use the T3 preview pane only when Justin asks for it. Agent Browser (`capture.sh`) is for probes and screenshots; it is evidence, not the review.

## Setup (once per worktree)

1. Build what the apps import. Unresolvable workspace imports (`@mastra/livekit`) mean unbuilt dependencies:
   ```bash
   pnpm turbo build --filter './packages/playground...' --filter './mastracode/factory-ui...' > /tmp/ui-build.log 2>&1
   ```
2. Mock API (logs `UNMOCKED <method> <url>` for uncovered routes, which return `{}`):
   ```bash
   node $S/mock-api.mjs > /tmp/mock-api.log 2>&1 &
   ```
3. Apps:
   ```bash
   (cd mastracode/factory-ui && pnpm dev) &
   (cd packages/playground && pnpm exec vite --host 127.0.0.1 --port 5290) &
   ```
4. Studio asks for an instance URL on first load: enter `http://127.0.0.1:4111`. It persists in `localStorage['mastra-studio-config']`, per browser. Justin's browser needs it once too.
5. Platform (only when the change must be seen there):
   ```bash
   $S/pui-link.sh in <mastra-worktree> <platform-worktree>/frontend
   (cd <platform-worktree>/frontend && npx vite --port 5231 --strictPort --force) &
   ```
   Follow `platform-local-dev` for env, Cloudflare vars, and fixtures. `pui-link.sh in` copies the installed package's pnpm directory to `node_modules/.pnpm/pui-local-copy` (so its dependencies still resolve), overlays your `dist`, `theme`, `theme.css`, `package.json`, and repoints the symlink. It records the original target, so `out` restores exactly. Platform pins its own `@mastra/core`; if the local build needs a newer core, the page errors at import, so say so rather than patching platform.

## Changing things in and out

Compare against `origin/main` without touching git history or losing uncommitted work:

```bash
$S/variant.sh main  <file> [file...]   # saves your versions, writes origin/main's, rebuilds playground-ui
$S/variant.sh branch                   # restores every saved file, rebuilds
$S/variant.sh status                   # lists swapped files; "branch is live" when none
```

- Set `REF=<ref>` to compare against another ref. Set `NOBUILD=1` to skip the rebuild.
- Set `PLATFORM_FRONTEND=<platform>/frontend` and each swap also re-copies `dist` into the linked platform. Without it, run `$S/pui-link.sh sync <mastra> <frontend>` after a build.
- Saved files live in `$TMPDIR/ui-preview-saved/<worktree>`. A second `main` call keeps the original save, so repeating is safe.
- Platform: `$S/pui-link.sh out <mastra> <frontend>` restores the published package. Always run it before finishing; a linked platform worktree builds against a path outside its lockfile.
- Vite picks up the new `dist` on HMR. When a page still shows the old UI, restart vite with `--force` (the optimized-deps cache survives otherwise).

Before finishing, run `variant.sh status` and `pui-link.sh status`. Expect "branch is live" and "published package", and `git status` matching what you started with.

## Capture evidence

```bash
$S/variant.sh branch && $S/capture.sh after /tmp/ui-preview
$S/variant.sh main <file> && $S/capture.sh before /tmp/ui-preview && $S/variant.sh branch
diff /tmp/ui-preview/before.txt /tmp/ui-preview/after.txt
```

Capture `after` first: it needs no swap, so a failure leaves the branch intact. Output: one JSON probe per page in `<tag>.txt`, screenshots in `shots/<tag>-<app>-<page>.png`. Override `FACTORY_PAGES`, `STUDIO_PAGES`, `FACTORY_URL`, `STUDIO_URL`, `SETTLE` (default 6s); an empty page list skips that app.

## Visual diff (side by side, red highlights)

When asked for a visual diff, run this, with the live apps showing the branch:

```bash
$S/variant.sh main <file> && $S/capture.sh before /tmp/ui-preview && $S/variant.sh branch
$S/visual-diff.sh before after /tmp/ui-preview
```

`capture.sh` records each page URL in `pages.tsv`. `visual-diff.sh` reopens every page on the branch, screenshots it, and runs `agent-browser diff screenshot --baseline <before>` to get a diff image where changed pixels are red. It then writes `report.html`: one row per page, sorted by percent changed, with before, diff, and after side by side (click an image for full size). It serves the report on :5399 and opens it in Justin's browser. Pages at 0% are dimmed.

- `THRESHOLD` (0-1, default 0.1) is the per-pixel color distance; lower it to catch subtle color changes. `REPORT_PORT`, `SETTLE`, `NO_OPEN=1` are also available.
- The diff compares viewport screenshots, so a height change on a scrolling page shows only above the fold. Pass the page's `contentH` from the probe when that matters.
- Dev ports move when one is taken (Factory lands on 5291 if 5173 is busy). Read the port from the vite log and set `FACTORY_URL` / `STUDIO_URL` before `capture.sh`; a dead port prints `warn: could not open`.
- Stop the report server (`kill $(cat /tmp/ui-preview/report-server.pid)`) when done.

Probe fields: `gutter`, `scrollerOffW` vs `scrollerClientW` (gap = reserved gutter), `contentX/W/H`, `scrolls`, `mainH`. `noLayout: true` means the route redirected or skips `PageLayout`; read `path`.

## Mock data

Change states by editing `scripts/mock-api.mjs`, not the app. Fixtures: 40 prompt blocks, 29 work items across 6 stages, 6 GitHub issues, empty lists elsewhere. Return `[]` or `{}` for an empty state, raise the generated count for a long one. A blank or throwing page means a missing route; read the `UNMOCKED` lines in the mock log.

## Failures seen

| Symptom | Cause | Fix |
| --- | --- | --- |
| Studio "startup check failed" while `curl :4111` works | Credentialed CORS rejects `Access-Control-Allow-Headers: *` | The mock echoes requested headers and sets `allow-credentials`. Keep both |
| Capture fails with unreachable API | Vite reload dropped the connection | Re-run; `curl -s :4111/api/agents` first |
| UI unchanged after editing source | Apps read `dist/` | Rebuild, or use `variant.sh` which rebuilds |
| UI unchanged after rebuild, platform | Stale `node_modules/.vite` | `pui-link.sh sync` clears it; restart vite with `--force` |
| Container page grows to 1605px instead of filling 473px | `h-full` missing on content wrapper | Compare `contentH` to `mainH` |

## Handoff

1. Open every page Justin should judge in his browser with `task-browser review <url>`, one per URL, for Platform, Factory, and Studio as applicable.
2. Tell him which variant is live (`variant.sh status`), the mock API port, and that Studio needs the instance URL entered once.
3. Stop and wait, per `mastra-work`. When he is done, run `variant.sh branch`, `pui-link.sh out`, and stop the mock and dev servers you started.
