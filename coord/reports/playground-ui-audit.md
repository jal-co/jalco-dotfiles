# Playground UI design-system audit

## Verdict

**Keep the system. Fix its accessibility seams and conflicting guidance rather than redesigning it.** The token architecture, surface recipes, control sizing, and newer compound components form a coherent Mastra system. The largest problems are specific: light-mode search highlights become unreadable, meaningful text uses an ink below normal-text contrast, warning badges select the wrong foreground, hidden form labels disappear, and truncated content loses its keyboard disclosure path.

There is no evidence here that a new palette, larger default type, another component library, or broader spacing would solve those problems.

### Scope and method

- Audited checkout: `/Users/justin/dev/mastra`, HEAD `827ca73e958`.
- Unless an absolute path is given, evidence paths below are relative to `/Users/justin/dev/mastra/packages/playground-ui`.
- Read-only source audit of the theme, shared primitives, component APIs, relevant tests, package documentation, and selected package consumers. Inventory scans covered the design-system tree, which contains 841 production TypeScript/TSX files across 133 component-directory entries. This is not a claim that every file received an equally deep manual review.
- Authority order: Mastra's design entrypoint and four contracts first, source precedence as explicitly required by `~/dev/agent-contracts-justin/skills/mastra-ui-contract/SKILL.md:11-21`, then UI/UX Pro Max's design-system, styling, and accessibility guidance. Source/contract disagreements are reported as drift, not automatic implementation defects.
- Source-derived contrast calculations resolve both themes, convert OKLCH to sRGB, composite transparent badge/state fills over named surfaces, and calculate WCAG 2 luminance ratios. Values are rounded to two decimals and are approximate for browser gamut mapping. The failures near 1.7:1 or 3.4:1 are not rounding questions. No APCA certification is claimed.
- No installs, builds, tests, servers, browser sessions, commits, or repository edits were performed. Existing tests were read, not run. Runtime keyboard journeys, screen-reader behavior, zoom, and screenshots remain unverified.
- Only this report and an external temporary contrast-analysis script were written. Existing untracked files in both repositories were left untouched.

Severity: **P1** means a concrete reading or access barrier in a supported component path. **P2** means a conditional behavioral defect or a significant contract/default inconsistency. **P3** means localized maintenance or retuning friction. No P0 issue was established.

## What is healthy

1. **The theme has a real structure.** `theme.css:24-31` imports separate color, status, data-viz, code, surface, typography, scale, and motion layers. Semantic roles are distinct from palette ramps (`theme.css:33-65`). This is already the useful part of Pro Max's primitive-to-semantic architecture.
2. **Elevation and edges have specific jobs.** `src/ds/primitives/raised-surface.ts:30-48` supplies separate raised, overlay, dialog, and frame recipes. `README.md:302-342` distinguishes a surface rim from a content divider and explains why an added ring would erase or double a surface's edge. This is more precise than generic shadow recommendations.
3. **Sizing and type are mostly centralized.** `theme/scale.css:7-41` supplies a spacing multiplier, named control/icon/table rungs, and radii. `theme/typography.css:16-87` defines complete text roles, not just font sizes. Font-family overrides do not require bundling licensed fonts (`theme/typography.css:89-106`).
4. **Focus and invalid states are shared mechanisms.** `src/ds/primitives/form-element.ts:47-85` owns rim focus, invalid rims, and input states. `src/ds/components/Field/field-control-aria.ts:18-41` centralizes field naming/descriptions. `src/ds/components/Field/field.tsx:244-258` renders native errors as alerts with their icon and message.
5. **The newer APIs generally compose well.** Examples include `src/ds/components/DataPanel/data-panel-root.tsx:45-59`, which prevents drawer-only props on inline panels, and `src/ds/components/SegmentedControl/segmented-control.tsx:21-41`, which requires an accessible group name and uses radio-group semantics. Its animated thumb is explicitly motion-safe (`:128-135`). A controlled-only API is not automatically a defect when the product intentionally requires ownership of selection.
6. **DataList's sorting affordance is named.** `src/ds/components/DataList/data-list-sortable-top-cell.tsx:52-75` gives the sort button the column name, present order, and next action. This is not an anonymous icon button. The older `Table.Row` also has Enter handling (`src/ds/components/Table/Table.tsx:203-206`); it should not be described as entirely mouse-only.
7. **There are meaningful source-level guardrails.** `src/theme-export.test.ts:338-350` checks text-role registration, `:465-478` checks the TypeScript size mirror, `:530-536` checks unresolved CSS references, `:549-575` checks neutral contrast, and `:619-632` checks shipped theme imports. These are valuable tests, with the coverage limits noted below.
8. **Compatibility is often intentional.** Deprecated `filled` inputs are resolved centrally (`src/ds/primitives/form-element.ts:105-114`), and Tooltip's `asChild` is explicitly deprecated (`src/ds/components/Tooltip/tooltip.tsx:34-42`). Their existence is not evidence that they should be deleted while published consumers still use them.

## Findings ranked by impact

### 1. P1: Light-mode search highlighting makes the matching text difficult to read

**Evidence:** `src/hooks/use-text-highlight.css:5-15` uses `warning-indicator` as the direct-match background with `sidebar` as text, then uses the same indicator as text on `warning-subtle` for indirect matches. `src/hooks/use-text-highlight.ts:167-168` registers both highlight styles on actual text ranges. The light mappings are in `theme/status.css:102-106` and `theme/colors.css:221-224`.

**Impact:** Direct matches calculate to **1.72:1** in light mode; indirect matches calculate to **1.65:1**. Search reduces the readability of exactly the strings it should help users identify. Both dark-mode pairs pass, so a dark-only review misses this.

**Smallest fix:** Use an existing readable paired surface/foreground for indirect matches, such as `warning-subtle` with `warning-subtle-foreground`. Give the direct highlight an explicitly paired text role, not the theme's sidebar surface. Preserve distinguishability using a different fill or underline rather than sacrificing text contrast. Gate these actual CSS pairings in the existing theme tests.

### 2. P1: Placeholder-level ink is used for facts, descriptions, and labels

**Evidence:** The third ink resolves to `gray-7` (`theme.css:48-49`). Actual content uses it in `src/ds/components/DataKeysAndValues/data-keys-and-values-key.tsx:8-9`, `src/ds/components/MetricsCard/metrics-card-description.tsx:4-7`, `src/ds/components/DataPanel/data-panel-no-data.tsx:6-9`, and `src/ds/components/Table/Table.tsx:121-122`. The contrast test permits that ink at only **3:1** (`src/theme-export.test.ts:565-574`).

**Impact:** Dark-mode faint text measures **3.12-3.63:1** on the named surfaces. In light mode it measures **4.13:1** on muted, **4.15:1** on a panel, and **4.40:1** on the sidebar. These are 10-14px roles, not large text eligible for the 3:1 threshold. Keys, table headers, and empty-state explanations are information, not inactive UI.

**Smallest fix:** Move informative uses to the existing muted ink, which clears 4.5:1 on all unfilled named surfaces. Keep the third ink for deliberately lower-priority decoration where appropriate. Do not brighten every neutral token indiscriminately. Add gates for the component roles that carry information, rather than treating the 3:1 placeholder test as a content-text guarantee.

### 3. P1: Warning badges bypass the readable amber foreground

**Evidence:** `src/ds/components/Badge/Badge.tsx:77-80` pairs both amber badge fills with `text-warning-foreground`, unlike the normal hue recipes. Light amber's dedicated badge foreground is `amber-800` (`theme/status.css:127-131`), while the warning foreground is a lighter text role (`theme/status.css:102-106`).

**Impact:** On the light card the warning variant is **3.92:1 strong / 4.19:1 subtle**. On muted it is **3.41:1 / 3.59:1**. These are small badge labels, so both emphases fail normal-text AA. The ordinary amber badge passes with the same fills.

**Smallest fix:** Use `text-badge-amber-foreground` for the warning badge's strong and subtle recipes. Keep its warning indicator and meaning. No new palette or fill is necessary. Test the public `warning` alias as well as the hue tokens.

### 4. P1: The hidden-label flag removes the accessible label in vertical legacy fields

**Evidence:** `src/ds/components/FormFieldBlocks/fields/text-field-block.tsx:50-58` preserves hidden text only in horizontal layout; vertical layout renders the label only when `!labelIsHidden`. The same branch exists in `src/ds/components/FormFieldBlocks/fields/textarea-field-block.tsx:48-56`. Both default to vertical layout. `src/ds/components/FormFieldBlocks/fields/search-field-block.tsx:96-104` already demonstrates the safer behavior by retaining a label with `sr-only`.

**Impact:** Passing `label="Name" labelIsHidden` in the default layout drops the `<label>` rather than visually hiding it. Unless the caller separately supplies an accessible name, the input or textarea is unnamed. Deprecation does not remove the barrier for current consumers, especially while the written contract still recommends these wrappers.

**Smallest fix:** Always render a provided label in both layouts and apply the existing visually-hidden treatment when requested. Preserve existing IDs and external ARIA names. Add one regression case per wrapper for default layout plus `labelIsHidden`.

### 5. P1: Truncate's full value is hover-only, and its optional copy action stays invisible on focus

**Evidence:** `src/ds/components/Truncate/truncate.tsx:30-38` removes characters from the actual string. `:49-60` puts that shortened string in a rendered `span` tooltip trigger without a tab stop; the full string exists only in tooltip content. `:65` hides CopyButton with `opacity-0` and restores opacity only through `group-hover`. The Tooltip adapter merely forwards the rendered child (`src/ds/components/Tooltip/tooltip.tsx:39-46`). Inspection of the installed Base UI tooltip trigger and focus implementation found no automatic tab-index injection for this rendered span.

**Impact:** Keyboard users cannot focus the disclosure in the default truncated case. With `copy`, the button remains in the tab order but is transparent when focused, including its focus treatment. With tooltips disabled, the full value is not present as ordinary text at all. This matters for IDs and names users must distinguish or copy.

**Smallest fix:** Prefer keeping the full string in the DOM and truncating visually. Where character-based shortening is required, provide a focusable, correctly named disclosure and an accessible full value. Reveal the copy control on `focus-within` and its own focus as well as hover, with a non-hover discovery path. Replace the internal deprecated `asChild` while touching this component, not across the whole package.

### 6. P2: Reduced-motion coverage has gaps, including a specificity bug in drawers

**Evidence:** `src/ds/components/Skeleton/skeleton.tsx:12-15` starts an infinite pseudo-element shimmer without a motion-safe/reduce guard. `src/ds/components/ChartSkeleton/chart-skeleton.tsx:53-59` does the same for chart ghosts. `src/ds/components/BrandLoader/brand-loader.css:18-20` starts an infinite pulse; its component supplies no motion guard (`src/ds/components/BrandLoader/brand-loader.tsx:38-45`). In drawers, the higher-specificity transition on `.drawer-popup[data-slot='data-panel-popup']` (`src/ds/components/Drawer/drawer.css:47-52`) outranks the reduced-motion `.drawer-popup` duration rule (`:167-171`). The ending-style duration selector at `:62-63` also outranks that rule.

**Impact:** Users requesting reduced motion can still receive continuous loading motion and the DataPanel width/slide transition. The presence of a media query in the drawer stylesheet does not prove that it wins the cascade.

**Smallest fix:** Guard the loading animation declarations with `motion-safe` or disable the corresponding elements/pseudo-elements under reduced motion. Match the drawer state/data-slot specificity in its reduced-motion block, or author transitions only inside no-preference media queries. Keep the static loading affordance and existing status name.

### 7. P2: Legacy field messages clip the part that tells users how to recover

**Evidence:** `src/ds/components/FormFieldBlocks/block/field-block-message.tsx:12-18` fixes the message box at one line with `h-lh overflow-hidden`, truncates its paragraph, and explicitly truncates errors. `src/ds/components/FormFieldBlocks/fields/text-field-block.tsx:43-44` wires only the error ID, not the help text; `field-block-message.tsx:18` gives help text no description ID. The modern `Field` path has explicit description/error IDs (`src/ds/components/Field/field-control-aria.ts:3-10,33-41`).

**Impact:** A long validation fix is visually cut off with no disclosure. The modern promise of linked help text does not hold for these deprecated wrappers. This is most harmful at narrow widths or with a long server-provided validation message.

**Smallest fix:** Let validation text wrap and grow. If keeping a minimum line for layout stability, use minimum height, not fixed height plus clipping. Give any retained help text an ID and include it in `aria-describedby`. Keep the label fix in finding 4 independent so it cannot be lost during a larger migration.

### 8. P2: ErrorBoundary's default UI contradicts the error-copy and shared-state contract

**Evidence:** `src/ds/components/ErrorBoundary/ErrorBoundary.tsx:166-177` uses the explicitly banned generic headings and renders `error.message`; `:200-205` exposes the stack in details. `:150-164` also builds a separate responsive icon/title hierarchy. The governing copy rules explicitly prohibit raw errors and those generic phrases (`~/dev/agent-contracts-justin/skills/mastra-ui-copy/SKILL.md:130-139`).

**Impact:** The fallback can expose developer internals and fails to tell users what failed in their terms. It creates another state presentation to maintain alongside EmptyState and Notice. This is a copy/default defect, not proof that every error contains secrets. An error boundary cannot honestly promise that pending edits are safe.

**Smallest fix:** Make the default describe only the known rendering failure and give one appropriate recovery action. Keep developer diagnostics in logging or an explicitly chosen developer fallback, not the generic product fallback. Reuse the current shared empty/error-state slots and roles instead of maintaining a second responsive hierarchy. Do not invent a cause or reassurance the boundary cannot know.

### 9. P2: ThemeProvider advertises an arbitrary target that the theme CSS does not support

**Evidence:** `src/ds/components/ThemeProvider/theme-provider.tsx:7-12,46-53` accepts an `HTMLElement` and puts `light`/`dark` classes on it. Light values, however, are selected through `html.light`, for example `theme/colors.css:221-244` and `theme/status.css:98-103`. The target tests assert class placement, not themed rendering (`src/ds/components/ThemeProvider/theme-provider.test.tsx:144-175`).

**Impact:** A light theme on a supplied `div` changes context state and classes but does not activate the light token overrides. A dark subtree inside a light document is not reset either. A consumer using the advertised target for a preview or embedded surface can report one theme while rendering another.

**Smallest fix:** Decide whether target means document-root routing or true scoped themes. If it is root-only, constrain/document that API and reject unsupported targets. If subtree themes are intended, scope both token modes and portal containers consistently. Simply broadening `html.light` to `.light` is insufficient because inherited custom-property aliases and light-document-to-dark-subtree resets also need consideration.

### 10. P2: The written instructions disagree with the shipped design-system direction

**Evidence and smallest corrections:**

- `~/dev/agent-contracts-justin/skills/mastra-ui-contract/SKILL.md:211-223` recommends `*FieldBlock`, while `src/ds/components/FormFieldBlocks/fields/text-field-block.tsx:22` deprecates it for `Field + FieldLabel + Input`. Update the decision tree to the source-preferred composition; keep compatibility APIs until consumers migrate.
- The same contract says no shared info-tip exists (`:193`), but `src/ds/components/Tooltip/info-tooltip.tsx:21-52` already provides one. Point consumers at the helper rather than directing another hand-rolled instance.
- The contract fixes an EmptyState icon at 32px (`:202`); the source explicitly documents and implements 20px (`src/ds/components/EmptyState/EmptyState.tsx:18-20,54`). Document the source value rather than changing the component to satisfy a stale sentence.
- The contract gives a blanket 500 weight ceiling and says roles do not change at breakpoints (`:367-369`), while `theme/typography.css:12-24,52-65` explicitly preserves responsive welcome roles and 550/600 Factory card-title exceptions. Document the narrow exceptions; do not erase them based on a generic rule.
- Package `AGENTS.md:29` still recommends `text-ui-*` / `text-header-*`, whereas the current source and README use `text-label`, `text-body`, `text-title`, and other roles (`theme/typography.css:32-86`, `README.md:352-358`). Replace stale names with the current role vocabulary.

**Impact:** An agent following the contracts can introduce deprecated forms, duplicate a helper that already exists, and disagree with the source about icon sizes and typography. This is a repeated-regression mechanism, not cosmetic documentation cleanup. The contract itself says source wins (`~/dev/agent-contracts-justin/skills/mastra-ui-contract/SKILL.md:11-21`), so these are documentation findings rather than five redesign requests.

### 11. P2: Interactive Card's TypeScript contract describes the wrong DOM element

**Evidence:** `src/ds/components/Card/Card.tsx:31-43` types all props and its ref as `HTMLDivElement`, but defaults `interactive` cards to a `button`, and accepts an unrestricted `as` element. `CardLink` already has a separate anchor-oriented API (`:52-59`).

**Impact:** A real button cannot accept typed native `disabled`/button props through the advertised Card API, and handlers/refs promise a div even when a button is rendered. This encourages casts or custom event handling where native semantics should be sufficient. The default interactive element itself is a healthy choice, not a mouse-only defect.

**Smallest fix:** Make the existing static and interactive forms a discriminated div/button prop and ref contract, or expose a narrowly typed interactive wrapper while preserving compatibility. Use CardLink for navigation. Do not introduce a generalized polymorphic-component framework just to fix this mismatch.

### 12. P3: Some components still assemble partial text styles beside complete roles

**Evidence:** `src/ds/components/DataPanel/data-panel-section-heading.tsx:19` combines `text-caption` with `tracking-widest uppercase`; `src/ds/components/DataKeysAndValues/data-keys-and-values-header.tsx:10` repeats it. `src/ds/primitives/menu-item.ts:74-82` overrides tracking on meta roles. `src/ds/components/Badge/Badge.tsx:123-125` resets tracking beside `text-column`. `src/ds/components/MetricsCard/metrics-card-description.tsx:6` omits a role and therefore inherits Txt's `body` default (`src/ds/components/Txt/Txt.tsx:22-29`) rather than the supporting-copy caption role.

**Impact:** Changing one role does not reliably retune the components that claim to use it, and descriptions do not share a consistent semantic default. The panel/header recipes also carry the contrast problem in finding 2. This is a smaller migration seam, not evidence that every uppercase label is wrong.

**Smallest fix:** Map each repeated text slot to the source-approved role it actually represents. If a deliberately different small-caps treatment is required, give that treatment one owned recipe instead of appending tracking in multiple places. Preserve deliberate component-owned exceptions rather than blindly replacing every occurrence with `eyebrow`.

## Token inventory gaps

The main inventory exists. The gaps concern ownership and actual use, not a missing token system.

| Layer | Present | Gap, impact, and smallest fix |
| --- | --- | --- |
| Primitive colors | OKLCH neutral/chromatic ramps in `theme/colors.css:1-244`; source supports light and dark mappings. | No blanket hex-to-OKLCH migration needed. Masks/currentColor/brand artwork are not semantic surface leaks merely because they use literal black or white. |
| Neutral semantic roles | Background, sidebar, card, popover, field, muted, three inks (`theme.css:33-65`). | Content eligibility is not encoded. The third ink is treated as both decoration and informative text. Restrict consumers or document/check permitted roles, finding 2. |
| Status/badge pairs | Subtle foregrounds and hue-specific strong/subtle badge roles (`theme/status.css:1-65,98-156`). | The warning alias and search highlighter bypass their matched foregrounds, findings 1 and 3. Add tests of recipes, not just token existence/opacity. |
| Surface material | Shared fill/boundary ladders and two elevation distances (`theme/surfaces.css:27-95`, `src/ds/primitives/raised-surface.ts:30-48`). | Resting chromatic badge fills are translucent in source (`theme/status.css:26-64`), whereas the contract says resting colors are solid (`~/dev/agent-contracts-justin/skills/mastra-ui-contract/SKILL.md:325-329`). They otherwise pass the measured hue-pair checks. Record the deliberate source exception or seek a design decision; do not silently repaint them. |
| Spacing/radius | 4px multiplier; control heights 28/30/32px; icon heights 12/14/16/20px; base radii 4/6/10/14px (`theme/scale.css:7-41`). | Component-owned geometry also exists outside named rungs: badge 18px height/7px radius (`src/ds/components/Badge/Badge.tsx:110-112,161`) and tabbed-container 296px query/34x20px filter (`src/ds/layout/tabbed-container/tabbed-container.css:40-48,93-100,130-134`). Retuning the global scale misses these shapes. Name the repeated family dimensions where retuning is useful, preserving current values; do not round them to a generic 8px grid. |
| Typography | Role size/line-height/weight, selected tracking, families, explicit Factory exceptions (`theme/typography.css:16-106`). | Partial role modifiers remain, finding 12. The contract's exception list trails source, finding 10. Not every inherited text slot needs a new prop. |
| Motion | 150/200/300ms state durations and resize tokens (`theme/motion.css:1-25`). | Shimmer/pulse/drawer durations are local and reduction coverage is uneven, finding 6. Inventory continuous animations and own their reduction behavior before adding more motion tokens. Distinct physical drawer or brand timings need not equal button-hover timings. |
| Theme targeting | Document-root class theming with system preference support (`src/ds/components/ThemeProvider/theme-provider.tsx:14-53`). | API suggests subtree theming that CSS does not implement, finding 9. Resolve that contract before adding scoped theme tokens. |
| Contrast coverage | Existing gates for foreground/muted on sidebar/background/card/muted and placeholder at 3:1 (`src/theme-export.test.ts:547-574`). | No equivalent text-pair gates there for the warning alias, custom highlights, or the full strong/subtle badge matrix. Expand the current suite rather than introducing another testing framework. |

### Calculated text-pair inventory

Normal-size text threshold used here: **4.5:1**. All values are source-derived ratios, not screenshots or results from running the package tests.

#### Neutral inks on named surfaces

| Surface | Dark ink | Dark muted | Dark faint | Light ink | Light muted | Light faint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| sidebar | 19.11 | 6.17 | 3.63 | 18.16 | 6.83 | 4.40 |
| background | 18.62 | 6.01 | 3.54 | 19.30 | 7.26 | 4.68 |
| card | 17.65 | 5.70 | 3.36 | 20.14 | 7.57 | 4.88 |
| popover | 17.65 | 5.70 | 3.36 | 20.14 | 7.57 | 4.88 |
| dialog | 17.65 | 5.70 | 3.36 | 19.30 | 7.26 | 4.68 |
| muted | 16.67 | 5.38 | 3.17 | 17.05 | 6.41 | 4.13 |
| surface-panel | 16.41 | 5.30 | 3.12 | 17.11 | 6.43 | 4.15 |
| field-on-surface | 16.67 | 5.38 | 3.17 | 20.14 | 7.57 | 4.88 |

#### Every badge hue, both emphases

Each cell is the minimum across the eight surfaces above after alpha compositing. Dark minima occur on surface-panel; light minima occur on muted. `warning` is the public semantic recipe, not the ordinary amber recipe. Neutral uses its actual fill/fill-subtle recipe.

| Badge recipe | Dark strong | Dark subtle | Light strong | Light subtle |
| --- | ---: | ---: | ---: | ---: |
| neutral | 13.91 | 14.76 | 5.69 | 5.93 |
| green | 8.55 | 10.82 | 6.70 | 7.22 |
| red | 9.13 | 10.89 | 7.00 | 7.68 |
| amber | 7.99 | 11.01 | 4.78 | 5.03 |
| blue | 8.66 | 10.69 | 7.11 | 7.70 |
| purple | 8.75 | 10.59 | 7.39 | 8.05 |
| orange | 8.52 | 10.49 | 7.09 | 7.74 |
| cyan | 8.54 | 10.74 | 6.76 | 7.32 |
| pink | 8.90 | 10.65 | 7.29 | 8.01 |
| warning | 6.77 | 9.33 | **3.41** | **3.59** |

The success/destructive/info semantic aliases use the corresponding green/red/blue foregrounds. The warning override is the exception (`src/ds/components/Badge/Badge.tsx:70-80`).

#### Matched status and product surfaces

| Matched status subtle pair | Dark | Light |
| --- | ---: | ---: |
| success | 15.43 | 14.17 |
| destructive | 15.36 | 13.97 |
| warning | 15.83 | 5.42 |
| info | 15.52 | 14.22 |

The destructive active-subtle pair also passes: dark 12.16, light 11.46. This supports reusing matched status foregrounds rather than making a new warning palette.

| Product foreground on strong/subtle | Dark strong | Dark subtle | Light strong | Light subtle |
| --- | ---: | ---: | ---: | ---: |
| studio | 9.19 | 11.89 | 14.17 | 15.42 |
| server | 9.22 | 11.79 | 14.22 | 15.55 |
| observability | 9.20 | 11.96 | 14.17 | 15.39 |
| factory | 9.19 | 11.66 | 14.23 | 15.61 |
| workers | 10.19 | 12.98 | 12.07 | 13.00 |
| persistent-server | 9.27 | 11.67 | 14.29 | 15.71 |

The destructive button's normal foreground also passes its rest/hover/active ladder in both themes: **4.76 / 6.60 / 9.08** (`theme/surfaces.css:56-61`). Disabled controls were not judged as normal active text.

**State-layer caution, not a separate proven component defect:** Muted text over dark card plus `fill-hover` calculates to 4.49, and over `fill-active` to 4.07. Some components promote active labels to ink, others use only the subtler hover rung. These numbers identify combinations worth gating; they do not establish that every active control fails. No blanket state-layer repaint is recommended without tracing the actual rendered recipe.

## Component API, duplication, and deprecation assessment

- **New composition is the stronger direction.** Base UI `render`, semantic field parts, compound PageHeader, and DataPanel's discriminated modes are preferable to another round of application-local wrappers. Keep the package's no-new-`asChild` rule (`AGENTS.md:30`), but do not break intentional deprecated adapters.
- **Native-prop support is not uniform.** Finding 11 is a concrete Card type mismatch. Notice also has a closed custom prop interface and cannot forward a caller's `role` or ARIA properties (`src/ds/components/Notice/notice-root.tsx:32-38,53-59`). Do not make every static notice a live region. If dynamic validation/server feedback is a supported use, add a narrow role/live-region path and document when to use it. Static source alone does not prove that an existing live update is currently unannounced.
- **There is measurable duplication without proof of dead code.** Compare `src/ds/components/DataDetailsPanel/data-details-panel-key-value-list.tsx:17-38` with `src/ds/components/DataKeysAndValues/data-keys-and-values-key.tsx:8-9` and `data-keys-and-values-header.tsx:8-10`. The key markup is the same and the header differs mainly in grid spanning. The placeholder contrast and tracking decisions therefore need fixing twice. Both are exported compound surfaces (`src/ds/components/DataDetailsPanel/index.ts:11-19`; `src/ds/components/DataKeysAndValues/data-keys-and-values.tsx:9-15`). Smallest useful cleanup: share the corrected key/header recipe behind the current exports, not remove a public family or merge the drawer and inline-panel shells.
- **Panel loading/empty states have drifted.** `src/ds/components/DataDetailsPanel/data-details-panel-loading-data.tsx:8-11` and `src/ds/components/DataPanel/data-panel-loading-data.tsx:8-11` differ in padding, minimum height, and ink for the same loading role. Their no-data slots likewise differ in padding while sharing faint copy (`data-details-panel-no-data.tsx:6-9`; `data-panel-no-data.tsx:6-9`). Context may justify geometry; it does not justify duplicating the contrast defect. Share the corrected state text/indicator recipe while leaving layout ownership local.
- **No public-export deletion is justified by this audit.** Local search cannot prove a published export has no external consumers. `TextFieldBlock`, the deprecated aliases, and legacy tables should be tracked as migration surfaces, not declared dead merely because newer alternatives exist.

## Generic Pro Max recommendations Mastra should deliberately ignore

1. **Do not replace Mastra's density with a generic 16px-body SaaS template.** The source deliberately uses 13px controls/body-sm, 12px supporting roles, and 10px meta (`theme/typography.css:48-87`). Fix the wrong role or contrast, not the whole type scale. Browser/mobile zoom behavior still warrants a separate real-device check; desktop density is not a blanket accessibility waiver.
2. **Do not make every desktop control 44-48px tall or impose an 8px-only grid.** Mastra's control rungs are 28/30/32px and its base spacing multiplier is 4px (`theme/scale.css:7,30-32`). Preserve desktop composition. Test pointer-target size, spacing exceptions, and coarse-pointer journeys separately rather than replacing the rungs with native-mobile dimensions.
3. **Do not add a thicker colored focus halo everywhere.** Mastra explicitly uses a 1px neutral focus edge that preserves elevation (`README.md:342`; `src/ds/primitives/form-element.ts:47-55`). Pro Max's generic 2-4px guidance is not a mandate to overwrite that system. Focus visibility and applicable non-text contrast still need to hold in actual states.
4. **Do not default to Radix/shadcn `asChild` composition.** The package is moving toward Base UI `render`, and the local instruction forbids new `asChild` (`AGENTS.md:30`). No dependency migration is needed to get keyboard behavior.
5. **Do not layer extra shadows, borders, or rounded cards onto every section.** Raised/overlay recipes already own rim, lip, and drops (`src/ds/primitives/raised-surface.ts:15-21,30-48`). Extra edges can double the boundary. A token architecture is not a reason to box every region.
6. **Do not derive the light palette by mechanically inverting dark ramps or replacing product hues with a generated palette.** Current status/product pairings are theme-specific and most pass comfortably. Repair wrong pair selection rather than recoloring the system.
7. **Do not add explanatory subtitles or tooltips to every label.** Mastra's copy contract requires explanations to earn their place (`~/dev/agent-contracts-justin/skills/mastra-ui-copy/SKILL.md:39-72`). Keep required constraints/recovery information; remove label restatements rather than moving them into a decorative tooltip.
8. **Do not replace every loading state with a page-sized skeleton, virtualize every list at an arbitrary threshold, or add hover motion to every control.** Mastra keeps known structure visible and lets components own their loading state. Apply virtualization and motion only where behavior and measured load justify them. Reduced motion and keyboard access are obligations, not optional aesthetic recommendations to ignore.

## Three highest-leverage fixes

1. **Repair and gate actual text recipes.** Fix search highlight pairs and the warning badge alias; move informative faint text to muted. Extend the existing tests across both themes, named surfaces, public aliases, and composited strong/subtle fills. Most fixes reuse tokens already present.
2. **Close the keyboard/name gaps at the shared component boundary.** Retain visually hidden labels, preserve full truncated values, reveal CopyButton on focus, and let validation errors wrap. Regression-test the real component composition rather than a mocked tooltip or field helper.
3. **Finish reduced-motion behavior in shared loaders and drawers.** Guard continuous skeleton/brand animations and fix the drawer cascade. Then align the written contract with the current source so later work does not reintroduce deprecated forms or duplicate helpers.

### Verification still needed before implementing or shipping fixes

A permitted implementation pass should exercise both themes with keyboard-only navigation, a screen reader, reduced motion, narrow widths, and zoom. In particular: a named hidden-label field, a long validation fix, a shortened ID with copy, direct/indirect search matches, warning badges on raised and muted surfaces, and a resizing/closing DataPanel. This audit did not start that runtime verification or change the implementation.
