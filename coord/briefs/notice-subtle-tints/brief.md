# Implement approved quiet notices and toasts

## Goal and permission

Justin selected Paper light `3OZB-1` and dark `3PMB-0` as final and asked to update playground-ui. He explicitly chose “just do it”, not pstack. Implement directly in your dedicated task checkout. You are the sole writer. Do not delegate, create another checkout, commit, push, open a PR, deploy, publish, or mutate Linear. Leave verified changes uncommitted for Justin's localhost review.

Repository: `/Users/justin/dev/mastra`. Task branch: `style/notice-subtle-tints`. Start from `origin/main`; the coordinator did not modify the principal checkout's dirty/untracked files.

## Exact approved design, not the earlier variants

Paper file Mastra GUI `01M3ZEJQE1FBY8QS12PDAP7EAD`, page Alerts / Toasts V3 `p-T-1`. URL: https://app.paper.design/file/01M3ZEJQE1FBY8QS12PDAP7EAD/p-T-1

Authoritative current exports are next to this brief:

- `light-reference.jsx`, `dark-reference.jsx`: direct Paper get_jsx exports with includeNodeIds:false. Use these and computed styles for implementation values, not screenshots.
- `light-styles.json`, `dark-styles.json`: direct computed styles for representative surfaces.
- `light-tree.json`, `dark-tree.json`: structure and node IDs.
- `paper-tokens.json`: existing token registry, hash `45347756`.
- `light-reference.png`, `dark-reference.png`: visual verification references only.

Ignore `light-jsx.json` and `dark-jsx.json`: those contain only metadata because JSX arrived as a separate text block. The `.jsx` files hold the full actual exports.

IMPORTANT: The selected dark board `3PMB-0` has NEUTRAL raised-material rims. Do not accidentally use original C dark `3P1U-1`, which received a later 12% semantic rim tint. Justin knowingly selected the neutral-rim dark board after the coordinator explained this difference.

Light: very subtle fills, mostly neutral rim with a trace of semantic color. A previous 70% semantic rim was explicitly rejected as too strong. Most final light surfaces combine a 12% alpha semantic light-edge inset with the existing 8% black neutral rim and subtle drop layers. Inspect the exact fresh exports: the light success toast has a locally modified half-pixel rim; do not assume every example has identical shadow values.

Fill reference values: light info `#F4F8FF`, success `#F3FBF4`, warning `#FFF9E8`, destructive `#FFF6F5`; dark info `#13171E`, success `#141815`, warning `#1B1614`, destructive `#221312`. These quiet fills were derived from 35% existing semantic subtle plus 65% card in OKLab, not global semantic-token replacements. Verify against current repository theme definitions, derive through existing tokens when equivalent, and avoid hardcoding palette values in TSX. Paper could not reliably retain mode overrides; its light literals represent authoritative light-theme values rather than new global tokens.

Keep existing semantic icons and ink roles, Mona Sans and typography/spacing roles. No gradients or glow washes in the approved treatment. No redesign of Button: right-side actions are the EXISTING default/md neutral pill Button, 30px high, 13px/500 label, 0.9em horizontal padding and label-token line height. Below-message actions use EXISTING Notice.Button underlined text, 13px/500, foreground ink, foreground/40 underline, 4px underline offset. Support single and multiple footer actions, such as Rotate now and Retry/Troubleshoot. Keep their link/button semantics and keyboard behavior. Compact untitled and multi-line notices and toast actions/dismissal also matter. Board dimensions, fixed mock action lanes and explanatory comparison headers are not production component requirements.

## Scope

Primary allowed files: `packages/playground-ui/src/ds/components/Notice/**`, `packages/playground-ui/src/ds/components/Toaster/**`, the actual shared toast implementation under `packages/playground-ui/src/lib/toast*`, their existing tests/stories, a focused package changeset and directly relevant component documentation if required. Inspect the actual current-main implementations first. Use the smallest backwards-compatible component/composition changes needed for both action placements. Preserve existing exports and consumer contracts and existing loading/neutral/progress variants. Do not spread this into a consumer migration or a wholesale surface redesign.

Do not modify global status/surface/typography/spacing token definitions or Button defaults. This task authorizes the notice/toast-specific styling and token assignments required by the approved boards, not retuning unrelated components. Use scoped CSS custom properties or established primitives. Do not add dependencies or code comments, docstrings, directives, TODOs, commented-out code or tooling config. Preserve unrelated work.

## Required guidance

Before edits read root/nearest AGENTS.md, CONTRIBUTING.md, and the applicable package conventions. Load mastra-work, then its required UI contracts under `/Users/justin/dev/agent-contracts-justin/skills/`, including building-playground-components and marvin-text-hierarchy, and `/Users/justin/dev/agent-contracts-justin/mastra-design.md`. Read `/Users/justin/.pi/agent/workflows/frontend.md`, `/Users/justin/.pi/agent/skills/work/mastra-ui-preview/SKILL.md`, and the scoped Storybook guidance. Use relevant emil component/color/surface/accessibility/typography skills and ponytail. Do not invoke variant, break or state-machine workflows unless Justin requests them. Do cover relevant cases through ordinary stories/tests and browser checks.

Alexandria previously failed consistently with “No API key found for anthropic”; the approved fallback is source/history inspection. Do not repeatedly retry the unavailable service for this styling task.

Linear lookup already performed: historical Done PLTFRM-2166 (quieter tokenized notices), Done PLTFRM-2776 (DS toast typography/buttons), Done PLTFRM-1608 (shared error surface). These are historical context, not permission to reopen them or pretend this is a new open ticket. Do not block local implementation for a new issue. Publication will require confirming a covering issue and fresh authorization later.

## Execution and verification

1. Inspect current source and consumer usages. Capture before screenshots through the prescribed isolated headless task-browser wrapper. Do not attach to personal browsers or use personal auth. Use Storybook/component preview without unrelated backend services where possible.
2. Implement approved Notice and Toaster styling, preserve composition contracts, and demonstrate right-side Button and below-message Notice.Button actions in existing stories. Use semantic HTML and preserve alert/status/live-region behavior. Cover all four semantic tones, untitled/wrapping text, neutral/loading variants if present, actions and dismissibility. Support narrow screens without clipping.
3. Run applicable existing package tests, typecheck, scoped lint/format and diff checks. Discover exact scripts from package.json. Typical starting point: `pnpm --filter @mastra/playground-ui test --run src/ds/components/Notice src/ds/components/Toaster`; adjust to the actual runner. No whole-monorepo build or new tooling. Run ponytail-review on the complete diff and `/Users/justin/dotfiles/tools/anti-slop/bin/anti-slop` on changed JS/TS, fixing actual findings.
4. Browser-test both themes, all semantic states and both action placements, action callbacks, keyboard focus/activation, dismissal and long-content/narrow layouts. Inspect console and failed requests. Screenshots alone do not prove interactions. Exercise representative real preview pages if the shared component affects them. Record actual versus mocked evidence honestly.
5. Prepare an exact localhost URL and compact verification handoff for Justin. Stop unneeded task-owned processes and close isolated browser sessions; keep only a documented preview needed for his required localhost review. Do not close the task workspace or delete its checkout. Do not mark UI fully complete until Justin has reviewed the implemented localhost result. The Paper sign-off is not localhost sign-off.

Report changed files, design matches/deviations, exact commands and outcomes, browser route/actions/results/evidence paths, retained preview process ownership and stop command, base/head SHAs, commits ahead, clean/dirty/conflicted state, and any blocker. No commit or publication.
