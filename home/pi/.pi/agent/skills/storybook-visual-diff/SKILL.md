---
name: storybook-visual-diff
description: Produce a visual diff report of a large UI change by screenshotting every affected Storybook story on the base branch and the working branch, then building one HTML report (main, branch, diff and a zoom on the changed region per story) and a PDF of it. Use when Justin asks to "see all the changes", for "visual diffs", "diff screenshots", "before and after of everything", or when a design-system change (tokens, colors, spacing, typography, shared components) touches more stories than a PR screenshot table can hold.
---

# Storybook visual diff

<context>
A token or shared-component change can move hundreds of stories. Reviewers cannot open each one, and a code diff does not show what a color swap looks like. This workflow screenshots every relevant story on both sides, keeps only the ones whose pixels changed, and sorts them most-changed first. The output is `report.html` plus a PDF of it, which Justin attaches to Linear or a PR.

Scripts live next to this file in `scripts/`. Resolve them against this skill directory.
</context>

<workflow>

1. **Baseline checkout.** From the working checkout, run `git worktree add --detach ../<name>-vdiff-base $(git merge-base origin/main HEAD)`, then `pnpm install --prefer-offline --ignore-scripts` there. Use the merge base, not `origin/main`: comparing against a newer main mixes other people's changes into the report. This worktree is temporary scratch space for the comparison, not a task worktree.
   Then build playground-ui's workspace dependencies in the baseline with the working checkout's turbo binary (`--ignore-scripts` leaves none of its own): `<working-checkout>/node_modules/.bin/turbo build --filter '@mastra/playground-ui^...'`. Skipping this makes baseline stories that import `@mastra/core` render Vite's error overlay, and every one of them shows up as a false ~100% change.
2. **Two Storybooks.** Start `pnpm exec storybook dev -p <port> --no-open --ci` in `packages/playground-ui` of each checkout, on two free ports (check with `lsof -iTCP:<port> -sTCP:LISTEN`). Poll `http://127.0.0.1:<port>/index.json` until both return 200. Track both processes; they are task-owned.
3. **Story list.** Read story ids from the branch Storybook's `index.json` (`entries` where `type === "story"`), one id per line in `<out>/ids.txt`. Scope:
   - Theme, token or color changes: every story. Tokens reach components the diff never names.
   - Component changes: stories whose title matches the changed components and their direct consumers.
   Skip `--docs` entries.
4. **Capture.** Delete `<out>/shots` and `<out>/results-*.tsv` from any earlier run first; stale files leak into the report. For each theme, run `scripts/capture.sh <base-url> <branch-url> <out>/ids.txt <out> <theme> [shards] [threshold=0.02]` in the background and poll its log in short intervals. Use 16 shards: each shard is its own browser session, and 16 runs about 3x faster than 8 on this machine (roughly 5 minutes for 1,000 stories). Run themes one after another, not at the same time, so the two Storybook dev servers are not serving 32 browsers at once. Screenshots are taken at a 1280×800 viewport and device scale 2, so zoomed views stay sharp. Stories whose `#storybook-root` is empty (portals, full-screen panels) fall back to a viewport screenshot automatically. Capture `dark` and `light` for any color, surface or typography change, because token values differ per theme; run `dark` over every story, then run `light` only over the ids that changed in dark (`awk -F'\t' '$3>0{print $1}' <out>/results-dark.tsv`). A story unchanged in one theme is almost never changed in the other, and this cut the chromatic run's light pass from 1,028 stories to 317 (73 seconds). Spacing-only changes can use `dark` alone. Keep threshold at `0.02`: the agent-browser default of `0.1` misses small color shifts.
5. **Check errors.** The script prints the error count. Stories missing from the baseline `index.json` are recorded as `new` and get a branch-only page. Other errors on both sides, note and move on. If a whole shard errors, the Storybook stopped responding: restart it and rerun that theme.
   Before trusting the numbers, open the base and branch screenshots of the top three results. If a base screenshot shows an error overlay or file path text instead of the component, the baseline is broken: fix it (step 1) and rerun.
6. **Report.** Run `node scripts/report.mjs <out> "<Title>" "main @ <base-sha>" "<branch> @ <branch-sha>" <base-url> <branch-url>`. For each changed story and theme it shows main, branch and the pixel diff (or a difference overlay when the size changed), then main and branch zoomed onto the changed region when the change is localized. Every screenshot is cropped to the component's content, so empty canvas is never shown. Small components display up to 4x (sharp, since captures are 2x); large ones display at native size, three across when they fit and stacked otherwise. Stories with 0% change are dropped; new stories come last with a branch-only frame.
7. **Review it yourself first.** Serve `<out>` with `python3 -m http.server <port> --bind 127.0.0.1` and open `report.html` in the task browser. Look at the top 10 entries. Anything that looks like a regression rather than the intended change goes to Justin by name, above the report link.
8. **PDF.** With the report open in the task browser, run `task-browser pdf <out>/<slug>-visual-diff.pdf`. The print CSS keeps each story on one page.
9. **Hand off.** Give Justin the report URL (open it with `task-browser review <url>`), the PDF path, the counts (captured, changed, errors), and the regressions from step 7. Upload the PDF to Linear or GitHub only when he asks.
10. **Clean up.** Stop both Storybooks, close the `task-ui-vdiff-*` browser sessions, and remove the baseline worktree with `git worktree remove`. Leave the HTTP server running while Justin reviews the report, and stop it when he is done. Leave `<out>` in `/tmp`.

</workflow>

<interactions>

Screenshots cannot show hover, focus, open menus or motion. When the change affects those, record the same interaction on both Storybooks with `task-browser --session <s> record start/stop` at one viewport and theme, then put the recordings side by side:

```bash
ffmpeg -y -i main.webm -i branch.webm -filter_complex "[0:v]fps=25,setpts=PTS-STARTPTS,pad=iw+8:ih:0:0:color=0x333333[a];[1:v]fps=25,setpts=PTS-STARTPTS[b];[a][b]hstack=inputs=2,format=yuv420p[v]" -map "[v]" -shortest -c:v libx264 -crf 20 -movflags +faststart cmp.mp4
```

Script the interaction as one shell function and run it against both ports, so both recordings follow identical steps.

</interactions>

<apps>

For running apps (Factory, Studio) instead of Storybook, run both versions side by side and use `scripts/capture-pages.sh <pages.tsv> <out> <theme> [shards=4] [threshold=0.02]`. `pages.tsv` has one line per page: `id<TAB>base-url<TAB>branch-url`. Keep it in `<out>` so the report links each entry to both URLs.

- Serve the baseline app from the baseline worktree on its own port against the same backend as the branch, so both render identical data.
- Authenticated apps: sign in once in a named task session, save that session's `localhost` cookies to a `0600` JSON file (`{"cookies": [...], "origins": []}`), and pass it as `VDIFF_STATE=<file>` so every shard starts signed in. Never read cookies from a personal browser.
- Pages are captured as full 1440×900 viewports at scale 2. Timestamps, counts and live data show up as small diffs; call them out rather than treating them as regressions.
- Before starting any backend with placeholder integration credentials, read what it does on boot and on page load. Factory deletes GitHub installations that GitHub answers with 404; block the provider's hosts (for example `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:9 NO_PROXY=localhost,127.0.0.1,.mastra.ai`) so those calls fail without a 404.

</apps>

<rules>

- Every capture uses `~/.pi/agent/browser-testing/task-browser` with named `task-ui-vdiff-*` sessions. Never use the default session or a personal browser.
- Screenshot `#storybook-root` on the `iframe.html` canvas, never the Storybook manager.
- Base and branch screenshots of a story come from the same session, viewport and theme global. Different conditions produce false diffs.
- The report is evidence for review. It does not replace Justin's localhost review of the change.

</rules>
