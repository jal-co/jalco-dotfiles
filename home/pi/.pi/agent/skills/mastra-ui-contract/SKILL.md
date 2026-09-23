---
name: mastra-ui-contract
description: The contract for building Mastra product UI with @mastra/playground-ui. It covers which layout to use for a page, which control and variant to use for an input, choice, or action, which text role to use for each piece of copy, and the rule against restyling design-system components. Use before building or reviewing any page, form, toolbar, settings screen, dialog, or component in playground, playground-ui, platform frontend, or factory UI. Triggers include "which input", "which variant", "which button", "text size", "page layout", "settings page", "restyle", "override the style", "className on Button", "build this page", "new form", and any Mastra UI work.
---

<overview>
Mastra UI is composed from design-system parts, never painted by hand. Every decision in this file already has an answer in the code, so an agent that walks these trees builds the same screen a teammate would. When a tree has no branch for the case, the fix is a design-system change agreed with Justin. Local styling is never the fix.
</overview>

<context>
The code is the source of truth. This contract names the decisions; the files below hold the current values. If this file and the code disagree, the code wins: build from the code and tell Justin which line here drifted.

| Concern | Source |
| --- | --- |
| Text roles | `packages/playground-ui/theme/typography.css`, `src/ds/components/Txt/Txt.tsx` |
| Control sizes | `src/ds/primitives/control-size.ts` |
| Field and button surfaces | `src/ds/primitives/form-element.ts` |
| Page frame | `src/ds/components/PageLayout`, `src/ds/components/ActionRow`, `src/ds/new/layout/page-header` |
| Settings pages | `src/ds/new/settings` |
| Current variants | the `cva` block in each component; Storybook titles under `Deprecated/` mark what not to use |

Reference pages: a `narrow` page is `mastracode/factory-ui/src/ui/pages/ActivityPage.tsx`; settings on `narrow` are `mastracode/factory-ui/src/ui/pages/SettingsPage.tsx` and `SlackConnectionPage.tsx` (PR #24838); a detail page is `packages/playground/src/pages/mcps/[serverId]/index.tsx`; a `fit` list page is `packages/playground/src/pages/tools/index.tsx`. Studio's `/settings` still uses the older `SettingsLayout` frame, so do not copy it.

Release status: Studio builds `playground-ui` from the workspace, so everything on `main` is available there. Platform and Factory install the published package, so an API from a pending `.changeset/*.md` for `@mastra/playground-ui` does not exist for them yet. Before using an API outside Studio, check the installed version (`node_modules/@mastra/playground-ui/package.json`) for it. If the API is missing, use the released fallback named below and tell Justin which upgrade would replace it. Never copy the unreleased markup locally. In `platform`, existing pages use a local layout layer in `frontend/src/shared/ui/layouts/`: `PageShell`, `PageFrame`, and a local `PageLayout` (`constrained`, `fullwidth`). It exists because Platform installs a playground-ui from before #24643, whose `PageLayout` had no `header` slot, `narrow` variant, or body padding. It is legacy:
- Check the `@mastra/playground-ui` version in `frontend/package.json`. The first release with `PageLayout` `header` and `narrow` is the one after `57.0.0`.
  - Version `57.0.0` or lower: new pages use `PageShell` (wide with a title) or the local `PageLayout` (`constrained` for one column, `fullwidth` for indexes), matching the nearest existing page.
  - Version above `57.0.0`: new pages MUST NOT add `PageShell`, `PageFrame`, or the local `PageLayout`. Use playground-ui `PageLayout` directly with this contract's tree. Confirm first that the installed types list `narrow` in `node_modules/@mastra/playground-ui/dist/src/ds/components/PageLayout/page-layout.d.ts`, and tell Justin the existing pages are ready for `/migrate-platform-layout`.
- Do not copy `PageShell`'s patterns: it builds on `fit` and re-adds padding and a scroll container by hand (which `container` already does), takes header props instead of composing `PageHeader`, and restyles `PageHeader.Action` from outside.
- Editing an existing legacy page does not require migrating it. Migration is its own task, run with the `/migrate-platform-layout` prompt. The mapping is `PageShell` to `PageLayout variant="container" header={<PageHeader>…</PageHeader>}`, `constrained` to `narrow`, and `fullwidth` to `container`. `frontend/src/studio/pages/ProjectSettings.tsx` is the settings reference, and the `platform-settings-sections` skill applies.
</context>

<workflow>
1. Find the closest existing page in the same product area and open it. Note its shell, layout variant, header, toolbar, and control sizes. Use it as the reference.
2. Choose the page frame with the layout tree.
3. Choose each control with the control trees.
4. Assign every piece of text a role with the text tree.
5. Put `className` only on layout, per the restyling rules.
6. If no tree branch fits, stop and propose a design-system change to Justin. Do not work around it.
7. Walk the checklist, then verify the route in a browser at desktop and mobile widths.
</workflow>

<instructions>

## 1. Do not restyle

A DS component's look belongs to the component; its placement belongs to the caller. This split is what lets one token change fix every screen. A local override opts that screen out of every future fix, and the drift only surfaces when someone notices two "identical" controls that no longer match.

`className` on a DS component MAY set:
- position and flow: `flex`, `grid`, `col-span-*`, `self-*`, `order-*`
- size constraints: `w-*`, `max-w-*`, `min-w-*`, `flex-1`, `shrink-0`
- outer spacing: `m*-*`; prefer `gap-*` on the parent

`className` on a DS component MUST NOT set: background, text color, text size, weight, line-height, border, radius, shadow, height, padding, opacity, or transition. The same ban covers `style`, CSS variable overrides, and wrapper elements that paint a surface around a component.

When the look is wrong:
1. Use a different variant, size, or `tone` prop on the same component.
2. Use a different DS component whose job matches, such as `Txt` instead of a styled `span`.
3. Compose DS parts: a slot, `render`, `InputGroup`, `ButtonsGroup`.
4. Otherwise stop. Tell Justin what is missing and propose the variant or component, naming at least two real call sites that need it. Do not change a token or a variant's classes without his explicit approval for that specific change.

Arbitrary values (`text-[13px]`, `bg-[#111]`, `h-[29px]`) are never correct in product code. A token for the value exists, or the missing token is a design-system question.

## 2. App shell and page frame

Every app and every page uses the same two layers. Never build either by hand.

```tsx
import { AppShell, MainCard } from '@mastra/playground-ui/new/layout/app-shell';
import { SidebarNew } from '@mastra/playground-ui/new/sidebar';
import { PageLayout } from '@mastra/playground-ui/components/PageLayout';

<SidebarNew.Provider>
  <AppShell sidebar={<AppSidebar />} mobileHeader={<MobileHeader />}>
    <MainCard>
      <Outlet />            {/* each route renders exactly one <PageLayout> */}
    </MainCard>
  </AppShell>
</SidebarNew.Provider>
```

- **The app shell** is `AppShell` with a `SidebarNew` sidebar and `MainCard` around the routes, mounted once at the router level. `AppShell` owns the spacing around the card. `MainCard` is unreleased (after `57.0.0`); on the released package, keep the app's existing card and swap it when the upgrade lands. Studio (#24697), Factory (#24806), and Mastra Code web (#24718) all use this.
- **The sidebar** is `SidebarNew` and its parts: `SidebarNew.Header` or `.CommandHeader`, `.Brand`, `.Nav`, `.Sections` (preferred, data-driven) or `.NavSection` > `.NavList` > `.NavLink`, `.NavStack` for drill-in views, `.Footer`, and `.Trigger` / `.MobileTrigger`. Never use `MainSidebar` in new code, and never import `MainSidebar.*` parts next to `SidebarNew`, because every part has a `SidebarNew.*` name. Agent Builder's `MainSidebar` and Factory's `MainSidebar.Nav*` calls are legacy.
- **Every route renders one `PageLayout`.** It is the only thing that renders the header row, breadcrumbs, header actions, toolbar, and scroll owner. Never write a page wrapper, header bar, or local width container around or instead of it, and never render a second `PageLayout` for a loading, error, or empty branch; switch the body inside one `PageLayout` instead.

## 3. Page layout

Pick width first, then the header. They are separate choices: `header` works on every variant.

```text
Width
Is it a workspace for one entity: panels, editor, graph, board, or chat that scroll on their own?
|-- Yes -> fit
|-- Is it an index of many entities (Agents, Tools, Traces, Logs, Datasets)?
|   \-- Yes -> container (the default)
|-- Is it a dashboard whose content sits side by side (panels, charts, metric cards in columns)?
|   \-- Yes -> container
\-- Otherwise it is one column read top to bottom (stacked overview blocks, feed, settings, simple detail, wizard)
    -> narrow

Header
Is this page a destination with a title of its own (a narrow page, a dashboard, a named entity overview)?
|-- Yes -> header={<PageHeader>…</PageHeader>}
\-- No (an index or a one-entity workspace) -> breadcrumbs only; indexes add an actionRow, workspaces add routed tabs
```

`container` gives lists and dashboards the full width, `fit` hands the body to panels that manage their own scroll, and `narrow` caps reading width. Pick by the content's shape. "Overview" is not a layout: Factory's overview is stacked blocks (`narrow`), and Platform's project overview is a side-by-side dashboard (wide, with a header).

### Narrow pages: the frame owns width and title

A `narrow` page is one `max-w-5xl` column, so page edges and titles line up across pages, and one `h1` from `PageHeader.Title`.
- Page content MUST NOT set `mx-auto`, `max-w-*`, or its own width wrapper. Delete any it has.
- Page content MUST NOT render a title block: no `<h1>`, no `Txt variant="heading"` title, no `sr-only` h1, and no custom shell with a title prop. A settings section name, a connection name (with `PageHeader.Icon`), and a wizard name are page titles. A wizard's step title labels the step's control instead, so the page keeps one `h1`.
- `PageHeader` (`@mastra/playground-ui/components/PageHeader`) is the only page header. Every `narrow` page and every dashboard has one, passed through `header`. Indexes and workspaces have none, and their breadcrumbs name them. The Agent Builder index pages currently add one to `container`. Never use `MainHeader`, `EntityHeader`, or a hand-built heading row on a new page. The 7 Studio pages still using them (datasets, workflow entity header, experiment panels) are legacy; do not copy them.
- Use the compound API only. The props form (`<PageHeader title="…" description="…" />`) is legacy; nothing uses it, and new code must not start.
- `PageHeader` parts: `.Title`, `.Description` (one sentence of user task), `.Meta beside` for a version or status `Badge`, `.Icon`, and `.Action` (top-aligned, never re-aligned with classes). Pass loading through `PageHeader.Title isLoading`, not a skeleton of your own.
- A "Back to X" button becomes a `breadcrumbs` trail (`X › Current`). Header buttons go in `headerActions` as `Button variant="ghost" size="sm"`.
- **Breadcrumbs:** pass one breadcrumb element to `PageLayout`'s `breadcrumbs` prop. Never render crumbs anywhere else on the page. In Studio, never assemble `Breadcrumb` and `Crumb` by hand; use the existing helper so icons and labels match the sidebar:
  ```tsx
  import { PageBreadcrumbs } from '@/components/ui/page-breadcrumbs';
  import { agentCrumb, navCrumb } from '@/domains/navigation/crumbs';

  <PageLayout breadcrumbs={<PageBreadcrumbs crumbs={[navCrumb('/agents'), agentCrumb]} />} />
  ```
  - **One crumb per level from the origin.** Build the trail from the route, not from what feels useful: start at the sidebar section the page lives under, then add one crumb for each level below it down to the current page. A trail with only the section crumb is correct only on the section's own index page. Every page below it has at least two crumbs, and the missing second crumb is the most common mistake.

    ```text
    /agents                      [navCrumb('/agents')]
    /agents/:id                  [navCrumb('/agents'), agentCrumb]
    /scorers/create              [navCrumb('/scorers'), { id: 'create-scorer', label: 'Create scorer' }]
    /datasets/:id/versions       [navCrumb('/datasets'), datasetCrumb, { id: 'dataset-versions', label: 'Versions' }]
    /experiments/review-queue    [navCrumb('/experiments'), navCrumb('/experiments/review-queue')]
    ```

    Before finishing a page, count its route segments below the section and check the trail has that many crumbs after the section crumb. Tabs of one entity (`/agents/:id/traces`) are the exception: the tab bar names the view, so the trail stops at the entity.
  - The first crumb is a section from the nav registry: `navCrumb('/agents')`. It takes its label and icon from the sidebar item and throws on an unknown URL.
  - An entity crumb is a predefined `CrumbDef` (`agentCrumb`, `workflowCrumb`, `toolCrumb`, `datasetCrumb`, …) that renders the entity's name and an icon-only switcher. Add a new one to `crumbs.ts` next to the others; do not inline it in a page.
  - Deeper crumbs are plain defs: `{ id: 'versions', label: 'Versions' }`. Use `decodeRouteParam` or `truncateItemIdCrumb` for route IDs.
  - The last crumb is the current page and never links; `PageBreadcrumbs` handles that.
  - Outside Studio (Factory, Platform), compose `Breadcrumb` and `Crumb` the way `PageBreadcrumbs` does: `<Breadcrumb label="Breadcrumb" className="min-w-0 flex-1 overflow-hidden">`, parent crumbs as `<Crumb as={Link} to=…>`, and the last as `<Crumb as="span" isCurrent>`.
- Sub-views of one entity are routed tabs under the breadcrumbs, `TabList variant="pill-ghost"`, as on the agent and workflow pages. Do not use header buttons that jump to a global page.
- On a `container` index page, search, filters, and toggles go in `actionRow` as `<ActionRow><ActionRow.Start/><ActionRow.End/></ActionRow>`: search and filters in `Start`, view options and the primary action in `End`.
- `SettingsLayout` is replaced by `narrow` + `PageHeader`. Do not add it to new pages. Studio's `/settings` still uses it and will migrate.

### The page owns the gap below the header

`PageLayout` adds no space between the header and the body (#24817). The body's first element sets it, and ends with bottom padding so the last block clears the frame: `<div className="mt-6 flex flex-col gap-6 pb-16">`. Use `mt-6`, the Factory value. Studio's MCP page uses `pt-4`. Report the mismatch; do not add a third value.

### Inside the body

```text
A group of settings?                  -> settings group (below)
A list of entities?                   -> DataList (+ ListSearch above it; FilterBar when filters exist)
One bounded object with its own actions or tabs (Connect card)? -> Card > CardHeader (CardTitle) + CardContent
A labelled region of a dashboard or feed (Pipeline, Today)? -> <section> with an in-page section label, no surface
Nothing to show, or a failure?        -> EmptyState variant="fill"
```

- **Settings group**: `SettingsGroup` > `SettingsHeader` (`SettingsTitle`, optional `accessory` and `action`) > `SettingsContainer` > `SettingsRow label description` with the control as its child. Factory wraps the header in `SettingsSubsection` to add a scope badge; reuse that wrapper there, without its `description`.
- **No section descriptions.** A section is its title and its content. Never put a description line under a section title (`SettingsDescription`, `CardDescription`, or a caption after an in-page section label). Explanation belongs to the thing it explains: a row's `description`, a field's `helpText`, or the page's `PageHeader.Description`. A line under the title repeats the rows below it, and every section that has one pushes its content further down. `SettingsRow` takes `htmlFor` for a bare control, `tone="destructive"`, and `viewOnly`. A control that should span the row's field (a model `Combobox`) gets `w-full` at the call site, because triggers are content-sized.
- **Lists**: `DataList` owns the row hover (one gliding highlight shared with menus), sorting (`DataList.SortableTopCell`), and row links. Never paint `hover:bg-*` on a row or hand-roll a grid list. Filters go through `FilterBar`, not a row of selects.
- **Cards**: a `Card` takes the same radius as `DataList`. Tabs inside a card header are `TabList variant="pill-ghost" size="sm"`, and each `TabContent` is `flush`. Do not stack several cards for what is one object with modes; use tabs inside one card. Do not wrap a `DataList` or a field in a `Card`, because each already has its own rim.
- **Sections without a surface**: space them with `gap-*` on the parent (`gap-6` default, larger for a dashboard). A section needs a label, not a box.
- **States never move the frame.** Loading, empty, error, and ready share the same breadcrumbs, `PageHeader`, header actions, `actionRow`, and routed tabs. Only the body changes. When one of these disappears in a state, everything below it jumps. On error, keep the `PageHeader`, with the route's ID as the title when the name failed to load; never drop to an `sr-only` `h1`.
- **Static structure renders while data loads.** Section titles, row and field labels, card headers, tab lists, KPI labels, and column headers are known before the request returns, so they render immediately. Only data-driven parts load: a `Skeleton` sized to the control it replaces, `MetricsKpiCard.Loading` for a value, `DataListSkeleton` with the same `columns` and the expected row count, and a disabled picker that reads "Loading models…". Never replace a whole section with one generic block; the ready content will not match its height.
- **An empty state does not repeat the header's primary action.** Its description points to that action instead.
- Empty and error states are `EmptyState variant="fill"` (`tone="error"` for failures), and loading is `Spinner fill`. The `narrow` body fills the page height, so they center below the header. Never pass an icon size or color; `EmptyState` fixes the icon at 32px.
- Spacing around the app card belongs to `AppShell`, and the card surface is `MainCard`.

Release status: `narrow`, `header`, the full-height `narrow` body, `MainCard`, and `EmptyState tone` are unreleased (#24806, #24817, #24838, #24799). In Studio, use them. Outside Studio on the released package, use the `container` variant with `PageHeader` as the body's first child and `ErrorState` for errors. Never recreate `max-w-5xl mx-auto` locally.

## 4. Controls

### Text entry

```text
Does the user filter a list on this page?
|-- Yes -> ListSearch (debounce and Cmd+Shift+F built in; one per page, others get shortcutDisabled)
\-- No
    |-- Is it a search field inside a form or panel? -> SearchFieldBlock
    |-- Multi-line? -> TextareaFieldBlock, or Textarea when the label lives elsewhere
    |-- Needs an icon, prefix, suffix, inline button, or stepper? -> InputGroup + InputGroupInput + InputGroupAddon / InputGroupButton
    \-- Single line -> TextFieldBlock, or Input when the label lives elsewhere
```

- Prefer the `*FieldBlock` version. It wires `label`, `helpText`, `errorMsg`, `required`, and `aria-describedby` together, and hand-wiring those is how a field loses its accessible error. Use a bare `Input` only when something else already labels it: a `SettingsRow` with `htmlFor`, a table cell with `aria-label`, or an `InputGroup`.
- `variant` is `default`. `unstyled` is only for a field inside a component that already draws the surface, such as a composer or chat textarea. `filled` is a deprecated alias for `default`. `outline` no longer exists.
- Validation uses `error` plus `errorMsg`. Never recolor the border yourself.
- Never use `type="number"` with the browser spinner. For incrementing, compose `InputGroup` with minus and plus `InputGroupButton`s.

### Choices

```text
Does the change take effect immediately, as an on/off setting?  -> Switch
Is it a yes/no answer submitted with a form, or one item of a multi-select? -> Checkbox
One of a few options that should all stay visible (2 to 4)?     -> RadioGroup
Switching between views of the same content?                    -> Tabs
One of many options, or options that need search?               -> Combobox
Otherwise, one of a short fixed list                            -> Select
```

- `SelectTrigger` and `Combobox` use the `default` variant, the same field surface as `Input`, so a select and a text field in one row read as the same kind of thing. `ghost` is only for dense toolbars and inline pickers. `primary` is not valid on a field, because a field is not a call to action.
- `Tabs` use `pill-ghost` for page sub-views and card headers, where the surrounding surface already frames them. Use `pill` for a mode switch inside a panel body.

### Actions

```text
Is it the one action this view exists for (Save, Create, Run)? -> variant="primary", at most one per view
Is it the confirm button in a destructive dialog?              -> variant="destructive"
Is it a destructive trigger inside a row or list?              -> variant="ghost" with a confirmation dialog
Is it in a page header, toolbar, or table row?                 -> variant="ghost"
Otherwise (Cancel, Back, pagination, secondary)                -> variant="default"
```

- Red is reserved for the moment of commitment. A list of rows each showing a red button reads as an alarm, not as an option.
- Size `md` is the default everywhere. Use `sm` in page headers and dense toolbars and `lg` for onboarding or hero CTAs. Heights are fixed by the size, and the label is `text-label` at every size, so never set `h-*`, `px-*`, or a text size on a control.
- Icon-only actions use `size="icon-sm|icon-md|icon-lg"` with a `tooltip` and an `aria-label`. For an icon next to a label, use the `icon` prop, never an `<svg>` inside the children.
- For links, use `render={<Link to="…" />}`. `as`, `href`, and `to` on `Button` are deprecated, and so is new `asChild`.
- Controls sitting side by side in one row go in `ButtonsGroup size="…"`. The group sets the height for every segment, so the segments cannot drift apart.

### Status and color

- `Badge` is for status, counts, versions, and priority, with `variant` for hue and `emphasis="muted"` inside dense rows. Priority and severity are a badge, not a colored row, so every item keeps one shape.
- `Notice` (`info`, `warning`, `destructive`, `success`, `note`) is the only boxed message. Never style a `div` as a callout. The `notice-*-fg` inks belong inside a `Notice` only; on a plain background they turn near-white.
- A status hue goes on the icon, not the sentence. `warning` and `positive` fall to about 3:1 on white, which passes for an icon and fails for text. A message with no icon uses `text-error`, the only status ink above 4.5:1 in both themes.
- Status tokens have no digit: `warning`, `positive`, `negative` (#24680). `warning1` and friends are being removed, and a misspelled token renders nothing without an error, so copy names from `theme.css`.
- A disclosure (chevron, collapsible) appears only when the hidden body says more than the visible line. Text that fits its line wraps instead.
- An element never owns its width in a flow context such as a chat column or card list. The container sets it.

## 5. Text roles

Pick text by role, never by size. The role carries size, line-height, weight, and tracking together. A hand-picked size breaks the pairing and stops following when the scale is retuned.

```text
Onboarding hero?                                   -> display
Page title?                                        -> PageHeader.Title owns it (heading, ink)
Page description?                                  -> PageHeader.Description owns it (caption, muted)
Settings group or card title?                      -> SettingsTitle / CardTitle own it (subheading, ink)
In-page section label (Pipeline, Today, Mentions)? -> column, muted, on an h2/h3
Prose or a description paragraph?                  -> body (muted when it explains)
Table cell, menu item, field value, dense list?    -> body-sm
Field label, control label, nav item?              -> label
Column header?                                     -> column
Helper text, validation, row or option description, secondary line? -> caption, muted
Badge, count pill, keycap?                         -> meta
```

- When a DS part owns a text slot (`PageHeader`, `SettingsTitle`, `SettingsRow`, `CardTitle`, `EmptyState` slots), pass plain text into it. Never wrap it in `Txt` or add a size, because the part already applies the role.
- `meta` (10px) is only for badges, count pills, and keycaps. An option or row description is `caption`, even when it looks too big next to a label (#24677).
- An in-page section label is quieter than a card title on purpose. `column` + muted marks a region without competing with the page title. Do not add `font-semibold`: the role is already medium.

- Render text with `<Txt as="…" variant="…" tone="…">`. The same role as a utility (`text-label`, `text-caption`) is allowed inside a component's own markup. Never add `leading-*`, `font-*` weight, or `tracking-*` next to a role, since the role already sets them.
- Ink comes from `tone`: `ink` (foreground), `muted` (secondary), `faint` (placeholder level); as utilities, `text-foreground`, `text-muted-foreground`, `text-placeholder`. There are three inks, not a ramp (#24645). Omit `tone` to inherit. `text-neutral*` no longer exists and renders nothing. Never use palette colors or `opacity-*` to dim text, because opacity dims differently depending on what sits behind it.
- A field label is `label` (13px, medium) and the value inside the control is `body-sm` (13px, regular). They match in size and differ in weight, because the label names the control. Helper and error text are `caption` because they explain the control. A label is never `caption`.
- A required marker inherits the label's role. A disabled field changes only color, to `muted`, and never size or weight.
- Heading elements (`h1` to `h6`) follow document order regardless of the visual role. Never shrink a heading to `caption` or `meta` to fit.
- Roles do not change at breakpoints. A page title on mobile is still a page title; change wrapping or layout instead.
- A reusable component that shows text at more than one level exposes a `children` or text slot, with its most common role as the default.
- Raw `text-xs|sm|base|lg|xl` and `text-[Npx]` fail lint and are never correct.

</instructions>

<constraints>
- MUST NOT change `theme.css`, `theme/*`, `src/ds/tokens/*`, or any variant's class string without Justin's explicit approval for that change.
- MUST NOT use deprecated APIs in new code: `Section.*Row`, `components/SettingsRow`, `Button as|href|to`, `asChild`, `variant="filled"`, anything marked `@deprecated`, or anything under Storybook `Deprecated/`.
- MUST NOT add a new shared component for a single call site. Compose locally, and extract once a second real call site exists.
- MUST import from the owning module path (`@mastra/playground-ui/components/Button`), never from a barrel.
</constraints>

<quality-checklist>
- [ ] The reference page is named, and the new screen uses its frame and control sizes
- [ ] No `className` on a DS component sets color, size, radius, shadow, padding, height, or text styling
- [ ] No arbitrary values, palette colors, `text-neutral*`, or opacity used to dim text
- [ ] Every field uses a `*FieldBlock`, or a bare control labelled by its container
- [ ] At most one `primary` button per view; red appears only at commitment
- [ ] Every text node has a role from the tree, and tones come from `tone`
- [ ] The variant matches the content's shape (index or side-by-side dashboard: `container`, one-entity workspace: `fit`, one column: `narrow`), and the header decision was made separately
- [ ] `narrow` pages have a compound `PageHeader` in `header`; no `MainHeader`, `EntityHeader`, or hand-built title; content sets no width and renders no `h1`
- [ ] The body's first element sets `mt-6` below the header and `pb-16` at the end
- [ ] Lists are `DataList`, settings are `SettingsGroup` > `SettingsContainer` > `SettingsRow`, and cards are not nested around rims
- [ ] Status hues sit on icons; boxed messages are `Notice`
- [ ] The app uses `AppShell` + `SidebarNew` + `MainCard`; no `MainSidebar` in new code
- [ ] The route renders exactly one `PageLayout`, and no state branch renders another
- [ ] The breadcrumb trail has the section crumb plus one crumb per route level below it
- [ ] No section has a description line under its title
- [ ] Switching between loading, empty, error, and ready does not move the header, toolbar, tabs, or section titles
- [ ] Empty, error, and loading states use `EmptyState variant="fill"` / `Spinner fill`
- [ ] No deprecated API appears in the diff
- [ ] Anything this contract could not express was raised with Justin, not styled around
</quality-checklist>
