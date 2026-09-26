---
name: storybook-visual-diff
description: Produce a visual diff deck of a large UI change by screenshotting every affected Storybook story on the base branch and the working branch, then building an open-slide deck with one page per changed story (main, branch and diff side by side) and exporting it to PDF. Use when Justin asks to "see all the changes", for "visual diffs", "diff screenshots", "before and after of everything", or when a design-system change (tokens, colors, spacing, typography, shared components) touches more stories than a PR screenshot table can hold.
---

# Storybook visual diff

<context>
A token or shared-component change can move hundreds of stories. Reviewers cannot open each one, and a code diff does not show what a color swap looks like. This workflow screenshots every relevant story on both sides, keeps only the ones whose pixels changed, and sorts them most-changed first. The output is an [open-slide](https://open-slide.dev/docs) deck Justin can page through, plus its PDF export, which he attaches to Linear or a PR.

Scripts live next to this file in `scripts/`. Resolve them against this skill directory.
</context>

<workflow>

1. **Baseline checkout.** From the working checkout, run `git worktree add --detach ../<name>-vdiff-base $(git merge-base origin/main HEAD)`, then `pnpm install --prefer-offline --ignore-scripts` there. Use the merge base, not `origin/main`: comparing against a newer main mixes other people's changes into the deck. This worktree is temporary scratch space for the comparison, not a task worktree.
   Then build playground-ui's workspace dependencies in the baseline with the working checkout's turbo binary (`--ignore-scripts` leaves none of its own): `<working-checkout>/node_modules/.bin/turbo build --filter '@mastra/playground-ui^...'`. Skipping this makes baseline stories that import `@mastra/core` render Vite's error overlay, and every one of them shows up as a false ~100% change.
2. **Two Storybooks.** Start `pnpm exec storybook dev -p <port> --no-open --ci` in `packages/playground-ui` of each checkout, on two free ports (check with `lsof -iTCP:<port> -sTCP:LISTEN`). Poll `http://127.0.0.1:<port>/index.json` until both return 200. Track both processes; they are task-owned.
3. **Story list.** Read story ids from the branch Storybook's `index.json` (`entries` where `type === "story"`), one id per line in `<out>/ids.txt`. Scope:
   - Theme, token or color changes: every story. Tokens reach components the diff never names.
   - Component changes: stories whose title matches the changed components and their direct consumers.
   Skip `--docs` entries.
4. **Capture.** Delete `<out>/shots` and `<out>/results-*.tsv` from any earlier run first; stale files leak into the deck. For each theme, run `scripts/capture.sh <base-url> <branch-url> <out>/ids.txt <out> <theme> [shards] [threshold=0.02]` in the background and poll its log in short intervals. Use 16 shards: each shard is its own browser session, and 16 runs about 3x faster than 8 on this machine (roughly 5 minutes for 1,000 stories). Run themes one after another, not at the same time, so the two Storybook dev servers are not serving 32 browsers at once. Stories whose `#storybook-root` is empty (portals, full-screen panels) fall back to a viewport screenshot automatically. Capture `dark` and `light` for any color, surface or typography change, because token values differ per theme; run `dark` over every story, then run `light` only over the ids that changed in dark (`awk -F'\t' '$3>0{print $1}' <out>/results-dark.tsv`). A story unchanged in one theme is almost never changed in the other, and this cut the chromatic run's light pass from 1,028 stories to 317 (73 seconds). Spacing-only changes can use `dark` alone. Keep threshold at `0.02`: the agent-browser default of `0.1` misses small color shifts.
5. **Check errors.** The script prints the error count. Stories missing from the baseline `index.json` are recorded as `new` and get a branch-only page. Other errors on both sides, note and move on. If a whole shard errors, the Storybook stopped responding: restart it and rerun that theme.
   Before trusting the numbers, open the base and branch screenshots of the top three results. If a base screenshot shows an error overlay or file path text instead of the component, the baseline is broken: fix it (step 1) and rerun.
6. **Deck workspace.** Decks live in the local open-slide workspace `~/dev/visual-diffs` (no remote; `slides/vdiff-*/` is gitignored because the screenshots are large). If it is missing, create it with `npx -y @open-slide/cli@latest init ~/dev/visual-diffs --use-pnpm`; if pnpm stops on the esbuild build script, set `pnpm-workspace.yaml` to `allowBuilds:\n  esbuild: true` and run `pnpm install`. Do not hand-write slides for this; the generator owns the deck.
7. **Build the deck.** Run `node scripts/deck.mjs <out> ~/dev/visual-diffs vdiff-<slug> "<Title>" "main @ <base-sha>" "<branch> @ <branch-sha>" <branch-storybook-url>`. It copies only the changed screenshots into `slides/vdiff-<slug>/assets/` and writes `index.tsx`: a cover with per-theme counts, then one page per story and theme, most changed first, new stories last. Each page scales main, branch and diff by one shared factor so sizes compare honestly, and stacks them as rows when the shots are wide. Rerunning replaces the deck.
8. **Review it yourself first.** Start `pnpm exec open-slide dev --port <free-port>` in the workspace and open `http://localhost:<port>/s/vdiff-<slug>` in the task browser. Look at the top 10 pages. Anything that looks like a regression rather than the intended change goes to Justin by name, above the deck link.
9. **PDF.** In the task browser, on the deck page: stub printing with `eval 'window.__printed=false; window.print=()=>{window.__printed=true}'`, click **Download** then **Export as PDF**, poll `eval 'String(window.__printed)'` until it is `"true"` (open-slide has then rendered every page into its print root), and run `task-browser pdf <out>/<slug>-visual-diff.pdf`. Reload the page afterwards to drop the print root. The PDF comes out Letter-sized with each 16:9 page letterboxed; `task-browser pdf` has no page-size option.
10. **Hand off.** Give Justin the deck URL (open it with `task-browser review <url>`), the PDF path, the counts (captured, changed, errors), and the regressions from step 8. Upload the PDF to Linear or GitHub only when he asks.
11. **Clean up.** Stop both Storybooks, close the `task-ui-vdiff-*` browser sessions, and remove the baseline worktree with `git worktree remove`. Leave the open-slide dev server running while Justin reviews the deck, and stop it when he is done. Leave `<out>` in `/tmp`.

</workflow>

<interactions>

Screenshots cannot show hover, focus, open menus or motion. When the change affects those, record the same interaction on both Storybooks with `task-browser --session <s> record start/stop` at one viewport and theme, then put the recordings side by side:

```bash
ffmpeg -y -i main.webm -i branch.webm -filter_complex "[0:v]fps=25,setpts=PTS-STARTPTS,pad=iw+8:ih:0:0:color=0x333333[a];[1:v]fps=25,setpts=PTS-STARTPTS[b];[a][b]hstack=inputs=2,format=yuv420p[v]" -map "[v]" -shortest -c:v libx264 -crf 20 -movflags +faststart cmp.mp4
```

Script the interaction as one shell function and run it against both ports, so both recordings follow identical steps.

</interactions>

<rules>

- Every capture uses `~/.pi/agent/browser-testing/task-browser` with named `task-ui-vdiff-*` sessions. Never use the default session or a personal browser.
- Screenshot `#storybook-root` on the `iframe.html` canvas, never the Storybook manager.
- Base and branch screenshots of a story come from the same session, viewport and theme global. Different conditions produce false diffs.
- The deck is evidence for review. It does not replace Justin's localhost review of the change.

</rules>
