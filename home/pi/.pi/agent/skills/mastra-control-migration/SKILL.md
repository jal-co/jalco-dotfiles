---
name: mastra-control-migration
description: Procedure for changing a playground-ui design-system control itself, such as Button, Input, Textarea, InputGroup, Select, Combobox, Checkbox, Switch, Slider, Tabs, or menu surfaces. Covers adding or removing a variant, changing a state, size, or surface, and proving nothing drifted. Use when a change edits a component under `packages/playground-ui/src/ds/`, not when composing one on a page. Triggers include "add a variant", "remove a variant", "change the hover state", "fix the disabled state", "migrate the control", "apply the design foundations", and "put this component on the new tokens".
---

<overview>
Composing controls on a page follows `mastra-ui-contract`. This skill covers changing the controls themselves. Every page picks up such a change, so the task is judged by a before/after diff of every story, and the "before" rendering stops existing the moment a file changes. Any change to a token or a variant's classes needs Justin's explicit approval first.
</overview>

<context>
Current foundations, which are authoritative over this file:
- Surfaces and states: `src/ds/primitives/form-element.ts`. Every neutral filled control, field or button, is one material: `bg-card shadow-raised`, with state layered through `--surface-tint` and focus through `--surface-rim`.
- Fills: the `--fill-*` ladder in `theme/surfaces.css`. Alphas come from that ladder, never hand-picked.
- Sizes: `src/ds/primitives/control-size.ts`. Heights come from `h-control-*` and every size uses the `text-label` role.
- Transitions: `src/ds/primitives/transitions.ts`.
- The legacy color migration is complete. `scripts/check-color-usage.mjs --report` reports 0 legacy tokens in `src/ds`, and a change MUST keep it at 0.
</context>

<workflow>

## 1. Capture the baseline before editing

```bash
BASE=$(git merge-base origin/main HEAD)
git worktree add --detach ../<repo>-baseline "$BASE"
cd ../<repo>-baseline && pnpm install --prefer-offline --ignore-scripts
cd packages/playground-ui && pnpm storybook -p 6007   # branch Storybook stays on 6006
```

For each story of the component, in both themes, capture the before and after back to back:

```bash
agent-browser set media dark
agent-browser open "http://127.0.0.1:6007/iframe.html?id=<story>&viewMode=story&globals=backgrounds.value:dark"
agent-browser ready && agent-browser screenshot '#storybook-root' before-<story>-dark.png
agent-browser open "http://127.0.0.1:6006/iframe.html?id=<story>&viewMode=story&globals=backgrounds.value:dark"
agent-browser ready && agent-browser diff screenshot --selector '#storybook-root' --baseline before-<story>-dark.png
```

`--selector` is required on both sides. Without it, a full viewport gets compared with an element crop and reports a meaningless 100% difference. A pixel-identical result on a story the change should not touch is a pass.

## 2. Make the change on the foundations

- Build from the primitives in `form-element.ts` and `control-size.ts`. Never write a component-local fill, border, height, or text size. A local value is how two controls in one row end up reading as two systems.
- Hover and press go through `--surface-tint`, and focus through `--surface-rim`. Guard every hover and active rule with `not-disabled:` or `:not(:disabled)`, or it paints over the disabled state.
- Disabled is never `opacity-*`. Opacity picks up whatever sits behind the control, so the same disabled field passes contrast on one surface and fails on another. A hued variant keeps its hue when disabled, because a destructive button that greys out has lost the signal that it was destructive. A transparent variant stays transparent, because a muted fill on `ghost` turns every disabled toolbar icon into a pill.
- Transitions name their properties (`controlStateColorTransition`). Never use `transition-all`: it animates layout on every state change.
- Never add `leading-*` next to a role, and never try `text-box-trim` on a control. Controls center labels with flex, so trimming the line box does nothing, and the measured centering error is already under 0.6px.
- A variant whose classes match another variant's is dead API. Delete it and map the old value in a resolver like `resolveFieldVariant`, because cva renders nothing for an unknown value instead of falling back to the default. Pin the fallback with a test.

## 3. Prove it

Assert colors on computed styles, not class strings. A class-string test still passes when the variable resolves to nothing.

```bash
agent-browser eval '(() => { const s = getComputedStyle(document.querySelector("#storybook-root button")); return JSON.stringify({ bg: s.backgroundColor, shadow: s.boxShadow, color: s.color }); })()'
```

</workflow>

<quality-checklist>
- [ ] Justin approved any token or variant-class change
- [ ] Every story diffed against the baseline in both themes, `--selector` scoped
- [ ] `check-color-usage.mjs --report --root packages/playground-ui/src/ds` still shows 0 legacy tokens
- [ ] Removed variants resolve to a live one, and a test pins it
- [ ] `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter ./packages/playground-ui test` and `typecheck` pass
- [ ] Consumer packages typecheck
- [ ] Changeset describes the behavior change, not the implementation
- [ ] Baseline worktree removed and its Storybook stopped
</quality-checklist>

<constraints>
- Node's experimental localStorage breaks storage-dependent suites with `Cannot read properties of undefined`. Keep `--no-experimental-webstorage`.
- The playground suite is flaky under CPU load from a running Storybook. Rerun a failing file alone before chasing it.
</constraints>
