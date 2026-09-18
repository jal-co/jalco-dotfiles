---
name: mastra-control-migration
description: Migrate a Mastra playground-ui control component to the semantic color contract and the shared control foundations. Use when migrating Button, Input, Textarea, InputGroup, Select, Combobox, Checkbox, Switch, Slider, Tabs, menu surfaces, or any control off legacy neutral/surface tokens; when a control's hover, focus, disabled, or sizing must match the rest of the system; or when asked to "migrate the colors", "apply the design foundations", or "put this component on the new tokens".
---

# Mastra Control Migration

Migrating a control is four passes in a fixed order: measure the old one, map its colors, align its foundations, then prove nothing drifted. Skipping the first pass is what produces migrations that "look fine" and ship a 4px regression.

## Pass 0: capture the baseline before editing

Never edit first. A migration is judged by a diff against the old rendering, and that rendering stops existing the moment you touch a file.

```bash
BASE=$(git merge-base origin/main HEAD)
git worktree add --detach ../<repo>-baseline "$BASE"
cd ../<repo>-baseline && pnpm install --prefer-offline --ignore-scripts
cd packages/playground-ui && pnpm storybook -p 6007   # branch Storybook stays on 6006
```

Capture every story of the component in both themes, element-scoped, before and after in one back-to-back pass per story:

```bash
agent-browser set media dark
agent-browser open "http://127.0.0.1:6007/iframe.html?id=<story>&viewMode=story&globals=backgrounds.value:dark"
agent-browser ready && agent-browser screenshot '#storybook-root' before-<story>-dark.png
agent-browser open "http://127.0.0.1:6006/iframe.html?id=<story>&viewMode=story&globals=backgrounds.value:dark"
agent-browser ready && agent-browser diff screenshot --selector '#storybook-root' --baseline before-<story>-dark.png
```

`--selector` is mandatory on both capture and diff. Without it the diff compares a full viewport against an element-scoped baseline and reports 100% of pixels different, which reads as catastrophe and means nothing. Capture both sides in the same loop: baselines taken in an earlier pass with different viewport state produce the same false 100%.

A pixel-identical result is a pass, not a suspicious one. It proves the token swap resolved to the same computed color.

## Pass 1: map colors onto the contract

Run the scoped report first, and again at the end. It is the only objective statement of what is left:

```bash
node packages/playground-ui/scripts/check-color-usage.mjs --report --root packages/playground-ui/src/ds/components/<Component> \
  | jq -r '.groups.production[] | select(.kind=="legacy") | "\(.file) \(.token) x\(.count)"'
```

Target: zero legacy tokens in `production`. Stories and tests may lag, but fix them in the same pass or they become the next person's archaeology.

At the component root, always:

```tsx
import '../../../../new-theme.css';   // module top, before other imports
// and `new-theme` as the first class in the cva base
```

Both are required. The class alone leaves the variables unresolved; the import alone styles nothing.

### Role mapping

| Legacy | Semantic | Why |
| --- | --- | --- |
| `neutral6` text | `foreground` | Primary text role |
| `neutral5`/`neutral4` text | `foreground/90` or `muted-foreground` | Secondary text; pick by role, not by shade |
| `neutral3`/`neutral2` text | `muted-foreground` | Metadata, placeholder, helper |
| `surface1`/`surface2` | `background` | Page canvas |
| `surface3` | `card` or `popover` | Raised container vs floating |
| `surface4`/`surface5` fills | `foreground/<alpha>` | Interaction surfaces must be background-agnostic |
| `border1`/`border2` | `border` | Resting dividers and container edges |
| `surface-overlay-soft/strong` | `foreground/10` and `foreground/14` | Same intent, now on the ramp |
| `accent1`, `accent2`, `error` | unchanged | Chromatic is deferred; migrating it silently expands the contract |

Never invent a semantic role. The contract is fixed in `new-theme.css`; a control that "needs" a new role has either mis-classified an existing one or found real contract work, which is a conversation, not a commit.

### Quantize to the alpha ramp

Every alpha value comes from `--gray-alpha-*` in `theme.css`:

```
4  7  10  14  18  30  45  60  75  90
```

Off-ramp values are the defect this exists to prevent: hand-picked `/5`, `/15`, `/20` sit a percent away from SidebarNew's `sidebar-accent` and `selected`, so two surfaces that should match never do. Snap, then re-check that snapping did not collapse two states into one value. It will, on any ladder with adjacent steps, and two identical states is a worse bug than an off-ramp one.

## Pass 2: the interaction ladder

Every control uses the same ladder. Deviating means a field and a button in one row read as two systems.

| State | Filled control | Outline control | Ghost control |
| --- | --- | --- | --- |
| Rest | `bg-foreground/10`, `border-border` | `bg-transparent`, `border-foreground/30` | `bg-transparent`, `border-transparent` |
| Hover | `bg-foreground/14` | `bg-foreground/4`, `border-foreground/45` | `bg-foreground/4` |
| Active | `bg-foreground/18` | `bg-foreground/10` | `bg-foreground/10` |
| Focus | `border-foreground/60` | `border-foreground/60` | `border-foreground/60` |

Filled controls carry hover in the fill and leave the border alone. Outline controls carry it in the border. A filled control that also moves its border is doing two things to say one thing.

Hover and focus borders must never collide. Tailwind can emit focus variants before hover variants, so an unguarded `hover:border-*` of equal specificity wins on a control that is both hovered and focused:

```
[&:hover:not(:focus-visible):not(:disabled)]:border-foreground/45
```

### Disabled

Never `opacity-50`. An opacity wash inherits whatever sits behind the control, so the identical disabled field clears contrast on one surface and fails on another.

```
base:         disabled:cursor-not-allowed disabled:text-muted-foreground
filled:       disabled:border-border disabled:bg-muted
outline:      disabled:border-border disabled:bg-transparent
ghost:        disabled:bg-transparent
hued variant: disabled:bg-<hue>/45 disabled:text-<on-hue>/75
```

Two rules that are easy to get wrong, both learned by shipping them wrong first:

1. **Hued variants keep their hue.** A disabled destructive button that turns the same gray as a disabled default button has lost the only signal that made it destructive.
2. **Transparent variants stay transparent.** Applying the muted fill to `ghost` turns every disabled icon button in a toolbar into a visible pill.

Guard every hover and active fill with `not-disabled:`, or the variant paints over the disabled state.

## Pass 3: foundations

### Size scale

Control heights are 20 / 24 / 28 / 32 for xs / sm / md / lg, from `--spacing-form-*`. Icon-only sizes come off the same scale, never a hardcoded `size-8`. When they diverge, a toolbar mixing an icon button and a labelled button at the same size misaligns by the difference, which is exactly the "few pixels off" a designer reports and nobody can locate.

### Transitions

```
transition-[background-color,border-color,color] duration-normal ease-out-custom motion-reduce:transition-none
```

Never `transition-all`. It animates width, height, and transform on every state change, so a theme switch animates layout and a hover triggers a recalculation the control never asked for.

### Typography

Control label sizes come from `controlSizeClasses`, never chosen per component. For any other text, walk the `marvin-text-hierarchy` decision tree and pick by role. Never put `leading-*` beside a `text-ui-*` or `text-header-*` utility: the size token already carries its paired line-height, and the extra utility silently overrides it.

### What not to retry

`text-box-trim` does nothing on these controls. It trims line boxes in a block container, and every control centres its label with flex, so the label is an anonymous flex item. Measured centring error is at most 0.6px with the em box. This is written down so the next person does not spend an afternoon rediscovering it.

### Deleting dead variants

A variant whose class string equals another variant's is dead API. Delete it, then leave a resolver, because cva emits **nothing** for an unknown variant value rather than falling back to `defaultVariants`. Without the resolver an unconverted consumer renders a control with no surface, no border, and no focus ring, which looks like a rendering bug rather than a removed variant:

```ts
export function resolveFieldVariant<TVariant extends string>(
  variant: TVariant | 'filled' | null | undefined,
): TVariant | 'default' | null | undefined {
  return variant === 'filled' ? 'default' : (variant as TVariant | null | undefined);
}
```

Pin the fallback with a test, or it rots silently.

## Pass 4: prove it

Assertions about color belong on computed styles, not on class strings. A class string test passes while the variable resolves to nothing.

```js
agent-browser eval '(() => {
  const el = document.querySelector(".new-theme");
  const s = getComputedStyle(el);
  return JSON.stringify({ bg: s.backgroundColor, border: s.borderTopColor, color: s.color });
})()'
```

For alignment claims, measure cap height rather than trusting the eye:

```js
agent-browser eval '(() => [...document.querySelectorAll("button.new-theme")].map(b => {
  const br = b.getBoundingClientRect();
  const tn = [...b.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
  const r = document.createRange(); r.selectNodeContents(tn);
  const tr = r.getBoundingClientRect();
  return `${b.textContent.trim()} above=${(tr.top - br.top).toFixed(2)} below=${(br.bottom - tr.bottom).toFixed(2)}`;
}).join("\n"))()'
```

Required before calling a migration done:

- [ ] Scoped color report shows zero legacy tokens in production code
- [ ] Every alpha value is on the ramp
- [ ] Computed styles verified in both themes
- [ ] Every story diffed against the baseline worktree, `--selector` scoped
- [ ] `pnpm --filter ./packages/playground-ui test` and `typecheck`
- [ ] Consumer package tests and typecheck
- [ ] Changeset written against the published behavior, not the implementation
- [ ] Baseline worktree removed and its Storybook stopped

## Environment

Node's experimental localStorage breaks the storage-dependent suites with `Cannot read properties of undefined`. It is not your change:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter ./packages/playground-ui test
```

The playground suite is flaky under CPU contention from a running Storybook. Failures that differ between runs and pass in isolation are load, not regressions. Confirm by rerunning one file alone before chasing it.
