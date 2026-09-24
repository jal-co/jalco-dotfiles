---
name: mastra-ui-copy
description: The words on screen in Mastra product UI - page descriptions, row and field text, tooltips, placeholders, button labels, empty and error states, and tone. Use with mastra-ui-contract whenever a Mastra UI change adds or edits visible text, numbers, or timestamps, or when reviewing copy. Triggers include "copy", "microcopy", "button label", "description", "tooltip text", "placeholder", "empty state text", "error message", "too much text", "repetitive", "meta text", "sounds like AI", and any Mastra UI work that writes words.
---

<overview>
Product UI copy is part of the interface, and every word competes with the controls for attention. The default is fewer words: a label, a control, and nothing else. This skill decides when words are allowed, where they go, and how they read. `mastra-ui-contract` decides which component renders them. For prose tells in any sentence you do write, load `emil-unslop-writing`.
</overview>

<workflow>
1. List every string the change adds or edits.
2. Run each explanatory string through the "is it needed" test. Delete what fails. Do not move it somewhere quieter.
3. Put what survives in its one correct place (the placement table).
4. Check labels and buttons for repetition against the page title and breadcrumbs.
5. Write the remaining sentences, then run `emil-unslop-writing` over them.
</workflow>

<instructions>

## 1. Is it needed

A line of explanatory text earns its place only if it tells the user something the label, title, or control does not: a consequence, a constraint, a schedule or unit, a hidden cost, or why something is disabled or view-only. A line that restates a label ("Theme: Color scheme for the interface"), introduces a section, or reassures ("You can change this later") is deleted.

Default to no text. Section, row, and field descriptions are absent unless one passes the test. The page is the one exception: `PageHeader.Description` may hold one sentence saying what the page is for, because it orients the user once at the top instead of repeating on every block.

| Candidate | Verdict | Why |
| --- | --- | --- |
| Theme: "Color scheme for the interface." | cut | restates the label |
| Settings section: "Stored in this browser." | cut | introduces a section; put scope in a badge if it matters |
| Model: "You can change the model after creating the agent." | cut | reassurance; the user picks either way |
| Tools: Web search, "Searches the public web" | cut | the name says it |
| Memory: No memory, "Each run starts fresh." | cut as a tooltip; keep as a menu description | alone it is obvious, but beside two harder options it tells them apart |
| Notifications: Run failures, "Emails the owners when a run fails" | cut | the toggle's label is enough |
| Input: "JSON matching the input schema" | cut | the validation error says it when it matters |
| Observational memory: "Adds a model call every 30k tokens." | keep | hidden cost |
| Temperature: "Higher values make output more varied." | keep | the setting's meaning is not obvious |
| Signing key: "Only organization owners can rotate it." | keep | explains why it is view-only |
| Connect: which transport to use | keep | a choice users get wrong |
| Page: "Agents are saved as drafts until you publish them." | keep | one sentence of page context |

When unsure, cut it. A missing tooltip costs a hover; an extra line costs every user every visit.

## 2. Where it goes

| What survives | Where |
| --- | --- |
| What the page is for | `PageHeader.Description`, one sentence |
| Why a row or field matters, a unit, a schedule, why it is view-only | An info icon with a tooltip, right after the label (component in `mastra-ui-contract`) |
| What each option of a choice means | The option's `description` inside the `Combobox` menu, visible only while choosing |
| What good input looks like | The field's placeholder |
| What went wrong with input | The field's `errorMsg`, inline |
| The consequence of a destructive action | Its confirmation dialog, not the row |

Validation errors and destructive consequences are the only explanations that stay visible, because the user must see them without hovering.

## 3. Labels and buttons

- **Never repeat what the view already says.** The page title and breadcrumbs name the object, so labels and buttons on that page do not repeat it. On "New agent", the submit button is `Create`, not `Create agent`; a section on the Agent page is `Settings`, not `Agent settings`.
- **Buttons are a verb, plus an object only when the context does not name it.** A form's submit button is the verb (`Create`, `Save`, `Run`). A button that opens or starts something from a list or toolbar keeps its object, because the list does not say what it creates (`New agent` on the Agents index). Confirmation dialogs repeat the object on the confirm button (`Delete project`), because a destructive confirm must be unambiguous even if read alone.
- **Busy states use the gerund and an ellipsis character:** `Creating…`, `Saving…`, `Loading models…`. Use `…`, never `...`.
- **Sentence case everywhere**: titles, labels, buttons, tabs, menu items. No trailing period on labels, buttons, titles, or tabs; full sentences in descriptions and tooltips end with one.

## 4. Placeholders

Free-text fields whose expected content is not obvious get a short, realistic example of good input, not a restated label and not instructions: Name `Support triage`; Instructions `You triage support tickets. Label each one by product area and urgency, reply in a short, friendly tone, and never promise refunds.` A placeholder never replaces the label and never carries anything the user needs after typing starts, because it disappears then. Pickers use a verb (`Choose a model…`) or a state (`Loading models…`).

## 5. Numbers and times

Quantities and moments are shown in a short form that scans, with the exact value one hover away. Both components are unreleased (#24979, #25001) and ship after `@mastra/playground-ui` 58.0.0; before that, use the existing formatting in the surface and swap when they land.

### CompactNumber

- **Use for** KPI totals, chart axis ticks, dense metric cells, and money meant to scan fast.
- **Never use for** IDs, model names, anything that is not a quantity, or counts that are already short (under 4 digits and readable). Those render as-is.
- Surface: about 3 significant digits, compact: `12310` shows `12.3K`, `6000` shows `6K`.
- Money: keep cents when the amount is small (`$4.37`); at 3 or more dollar digits, round to the dollar (`$128.40` shows `$128`).
- Hover: the exact input with separators (`12,310`, `$1,284.17`), always, through the existing `Tooltip`. The component owns the tooltip; never add a second one.
- Proportional type, not mono.
- Pass the raw number plus an optional currency and locale. Never pass a pre-formatted string, because the tooltip needs the exact value.

### RelativeTimestamp

- **Use for** every displayed moment in time: deploys, activity, logs, created and updated.
- **Never use for** durations or ranges that are not a point in time (`3.4s`, `p95 latency`), or for labels. In "Last updated 3m", only `3m` is the component; the label stays proportional text.
- Surface: relative and monospace: `3m`, `1h`, `1d`, `2w`.
- Hover: the precise time since (counting up), the viewer's local time, and UTC. The component owns this content through the existing `Tooltip`.
- Pass a real `Date` or ISO string, plus an optional `className`. Never pass a pre-formatted string.

## 6. Empty and error states

- Say what happened and what to do next, with the real names and values: `Failed to load agents` / `The Mastra server at localhost:4111 returned 503 Service Unavailable.` Never `Something went wrong` or `Oops`.
- An empty state explains the absence in one sentence and points to the way out. It does not repeat the header's primary action as a second button; the description points to it instead.
- Validation errors say how to fix the input: `Give the agent a name, for example "Support triage".` Never `Invalid input` or `This field is required`.

## 7. Tone

Plain, specific, and quiet. The interface states facts; it does not sell, apologize, or cheer. Never use exclamation marks, `please`, `simply`, `just`, `easily`, `seamlessly`, `powerful`, `unlock`, `get started with`, or `Oops`. Never use em dashes. Use numbers and names instead of adjectives (`3 environments`, not `several environments`). Run `emil-unslop-writing` over every sentence you write.

</instructions>

<quality-checklist>
- [ ] Every explanatory string passed the "is it needed" test; failures were deleted, not moved
- [ ] At most one page description; no section, row, or field descriptions
- [ ] Each surviving explanation is in its one place from the placement table
- [ ] No label or button repeats the page title's object; submit buttons are a verb
- [ ] Free-text fields have an example placeholder
- [ ] Errors and empty states name what happened and what to do, with real values
- [ ] Quantities to scan use `CompactNumber` and every moment in time uses `RelativeTimestamp`, each with the exact value on hover; IDs, names, short counts, durations, and labels do not
- [ ] Sentence case, `…` not `...`, no exclamation marks, no em dashes, no marketing words
</quality-checklist>
