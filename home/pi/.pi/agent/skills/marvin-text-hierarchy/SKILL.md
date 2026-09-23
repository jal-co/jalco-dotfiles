---
name: marvin-text-hierarchy
description: Audit and fix typography in Mastra product interfaces against the semantic text roles. Use when reviewing text sizing, `Txt` variants, heading levels, form labels, helper and validation copy, status text, badges, or typography slots in existing code. Triggers include "Marvin hierarchy", "text hierarchy", "text sizing", "typography review", "field label", "helper text", "which Txt variant", and legacy names such as "ui-sm", "ui-smd", "header-md".
---

<overview>
The role tree and rules live in `mastra-ui-contract`, section 5 ("Text roles"). This skill is the procedure for auditing existing code against them. Load `mastra-ui-contract` first. Its roles are the only vocabulary, and the code in `packages/playground-ui/theme/typography.css` is authoritative over both files.
</overview>

<workflow>
1. List every text node in the change or component.
2. Name each node's role with the contract's text tree before looking at its current classes. Classifying from the current size copies the existing mistake.
3. Compare the node to its role. Fix these in order:
   - raw `text-xs|sm|base|lg|xl`, `text-[Npx]`, legacy `text-ui-*` / `text-header-*`: replace with the role
   - `leading-*`, `font-medium|semibold|bold`, `tracking-*` beside a role: delete, since the role owns them
   - `text-neutral*`, palette colors, `opacity-*` on text: replace with `tone`
   - a heading element shrunk to `caption` or `meta`: restore the heading role, and keep `h1` to `h6` in document order
4. Check reusable components for hardcoded text roles. When real callers need two levels, add a text slot with the common role as the default.
5. Verify at mobile, tablet, and desktop widths that roles did not change between breakpoints.
</workflow>

<examples>
<example type="legacy-to-role">
| Legacy | Role |
| --- | --- |
| `header-xl` | `display` |
| `header-md` page or panel title | `heading`, owned by `PageHeader` / `SettingsLayout` |
| `header-sm` section title | `subheading` |
| `ui-md` prose | `body` |
| `ui-smd` field label | `label` |
| field value | `body-sm` |
| `ui-sm` helper or validation | `caption` |
| `ui-xs` badge or status | `meta` |
</example>

<example type="wrong-form-label">
```tsx
<label className="text-caption">Search</label>
```

A field label names the control, so it is `label`, never `caption`. Caption is for text that explains the control.
</example>
</examples>
