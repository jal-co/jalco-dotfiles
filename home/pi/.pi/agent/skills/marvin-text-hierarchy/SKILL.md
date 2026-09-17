---
name: marvin-text-hierarchy
description: Apply Marvin's semantic text hierarchy to Mastra product interfaces. Use when choosing or reviewing `Txt` variants, text size, heading levels, labels, helper copy, status text, badges, or typography slots. Triggers include "Marvin hierarchy", "text hierarchy", "text sizing", "which Txt variant", "ui-xs", "ui-sm", "ui-md", "header-sm", "header-md", and any Mastra UI work that adds or changes text.
---

<overview>
Choose typography by the text's role in the interface, never by which size looks close. The hierarchy keeps unrelated screens legible and makes reusable components fit their surrounding context.
</overview>

<instructions>

## Select the role first

Walk this decision tree before writing classes or choosing a `Txt` variant:

```text
Is this the primary onboarding hero?
|-- Yes -> header-xl
\-- No
    |-- Is this the page title? -> header-md
    |-- Is this a section title? -> header-sm
    |-- Is this a panel subtitle? -> ui-md + font-medium
    |-- Is this body copy? -> ui-md
    |-- Is this secondary/helper text? -> ui-sm
    \-- Is this metadata, a badge, or a compact status label? -> ui-xs
```

The agent MUST classify the role before choosing a variant. It MUST NOT move text up or down the scale to solve spacing, density, or emphasis problems. Fix those with layout, color, or weight.

## Apply the canonical hierarchy

| Role | `Txt` variant | Default treatment |
| --- | --- | --- |
| Onboarding hero | `header-xl` | `text-neutral6 font-semibold` |
| Page title | `header-md` | `text-neutral6 font-medium` |
| Section title | `header-sm` | `text-neutral6 font-medium` |
| Panel subtitle | `ui-md` | `text-neutral5 font-medium` |
| Body | `ui-md` | `text-neutral4` |
| Secondary/helper | `ui-sm` | `text-neutral3` |
| Metadata, badge, compact status | `ui-xs` | `text-neutral3` |

`header-xl` MUST remain limited to onboarding heroes. Headings MUST NOT use `ui-xs` or `ui-sm`; those variants describe supporting text, not document structure.

Use `Txt` so every text-size token receives its paired line-height. The agent MUST NOT add `leading-*` beside a `Txt` variant or a `text-ui-*` / `text-header-*` utility.

## Compose reusable components

A reusable component that owns adjacent text SHOULD expose a `children` or named text slot when the same component can appear at more than one hierarchy level. The component MAY provide the most common semantic default, but it MUST document that default.

Status indicators MUST default their label to `ui-xs`, because compact status text belongs to the metadata/badge level. They SHOULD expose a text slot so a caller can supply `Txt variant="ui-sm"` when the status functions as secondary text.

The component MUST own layout between its icon and text. It MUST NOT restyle slotted text with a competing size or line-height.

## Preserve semantics across breakpoints

Responsive layouts MAY change placement, wrapping, and available width. They SHOULD NOT change a text role's variant merely because the viewport is smaller. A page title remains a page title on mobile.

## Review existing code

When reviewing typography:

1. Identify each text node's role.
2. Compare its variant to the canonical hierarchy.
3. Replace raw `text-xs`, `text-sm`, `text-base`, arbitrary font sizes, and mismatched line-height utilities with the correct DS role.
4. Check heading elements independently from visual size. Keep semantic heading order even when the visual variant differs.
5. Check reusable components for hardcoded label sizing. Add a text slot when callers need more than one role.
6. Verify the result at mobile, tablet, and desktop widths.

</instructions>

<examples>

<example type="status-default">
```tsx
<Status presentation={presentation} />
```

The default label is `ui-xs` because the status is compact metadata.
</example>

<example type="status-secondary-slot">
```tsx
<Status presentation={presentation}>
  <Txt as="span" variant="ui-sm">
    {presentation.label}
  </Txt>
</Status>
```

Use the slot when the status participates in a secondary text row.
</example>

<example type="body-copy">
```tsx
<Txt as="p" variant="ui-md" className="text-neutral4">
  Changes apply on the next deploy.
</Txt>
```
</example>

<example type="wrong">
```tsx
<h2 className="text-xs leading-4">Server</h2>
```

A section heading uses `header-sm`; shrinking it to fit breaks the hierarchy.
</example>

</examples>

<quality-checklist>

- [ ] Every text node has a named semantic role
- [ ] Variants match the canonical hierarchy
- [ ] Headings use semantic HTML and never use `ui-xs` or `ui-sm`
- [ ] No raw or arbitrary font sizes replace DS tokens
- [ ] No extra line-height utility competes with the selected variant
- [ ] Reusable text-bearing components expose a slot when contexts differ
- [ ] Mobile, tablet, and desktop preserve the same semantic roles

</quality-checklist>
