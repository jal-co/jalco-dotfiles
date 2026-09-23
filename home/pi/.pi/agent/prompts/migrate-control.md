---
description: Change a playground-ui design-system control and prove nothing drifted
argument-hint: "<Component> [story-ids]"
---

Load and follow the `mastra-control-migration` skill, then change ${1:-the control component in the current change} in `packages/playground-ui`.

Also load `mastra-ui-contract` for variants, sizes, and text roles, and `mastra-work` for build, test, and review rules.

Run the skill's workflow in order: capture the baseline from a merge-base worktree before editing, make the change on the shared foundations, then prove it with computed styles, scoped screenshot diffs, and the full checklist.

Stories to cover: ${@:2}. When none are given, enumerate the component's stories from `http://127.0.0.1:6006/index.json` and cover every one in both themes.

Stop and ask before changing a token, a variant's classes, or a public prop.
