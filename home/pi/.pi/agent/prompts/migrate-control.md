---
description: Migrate a Mastra control component to the semantic color contract and shared control foundations
argument-hint: "<Component> [story-ids]"
---

Load and follow the `mastra-control-migration` skill, then migrate ${1:-the control component in the current change} in `packages/playground-ui`.

Also load `marvin-text-hierarchy` before touching any text, and `mastra-work` for build, test, and review rules.

Run the skill's four passes in order and do not reorder them:

1. Capture the baseline from a merge-base worktree before editing anything.
2. Map colors onto the contract and quantize every alpha to the ramp.
3. Apply the interaction ladder, disabled language, size scale, and transitions.
4. Prove it with computed styles, scoped screenshot diffs, and the full checklist.

Stories to cover: ${@:2}. When none are given, enumerate the component's stories from `http://127.0.0.1:6006/index.json` and cover every one in both themes.

Stop and ask before: adding a semantic role that does not exist in the contract, migrating chromatic tokens, or changing a public prop. Report any off-ramp value you cannot resolve without a contract change rather than inventing one.
