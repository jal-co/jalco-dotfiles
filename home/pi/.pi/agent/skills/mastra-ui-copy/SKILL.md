---
name: mastra-ui-copy
description: The words on screen in Mastra product UI - page descriptions, row and field text, tooltips, placeholders, button labels, empty and error states, and tone. Use with mastra-ui-contract whenever a Mastra UI change adds or edits visible text, numbers, or timestamps, or when reviewing copy. Triggers include "copy", "microcopy", "button label", "description", "tooltip text", "placeholder", "empty state text", "error message", "too much text", "repetitive", "meta text", "sounds like AI", and any Mastra UI work that writes words.
---

<overview>
Product UI copy is part of the interface, and every word competes with the controls for attention. The style is plain and direct: short sentences that say what happened or what to do, with no filler, no reassurance, and no marketing. The default is fewer words: a label, a control, and nothing else. This skill decides when words are allowed, where they go, and how they read. `mastra-ui-contract` decides which component renders them. For prose tells in any sentence you do write, load `emil-unslop-writing`.
</overview>

<workflow>
1. List every string the change adds or edits.
2. Run each explanatory string through the "is it needed" test. Delete what fails. Do not move it somewhere quieter.
3. Put what survives in its one correct place (the placement table).
4. Write each string with the pattern for its surface, then check it against the mechanics table.
5. Run `emil-unslop-writing` over every full sentence.
</workflow>

<instructions>

## 1. Voice

1. **Direct.** Say the thing: `Delete production-agent?`, not `Are you sure you want to delete production-agent?`.
2. **Specific.** Name the consequence (`Requests using it will stop working.`), not a vague warning (`This may cause issues.`). Use real names and numbers (`3 environments`, not `several environments`).
3. **Calm.** No exclamation marks, `please`, or `successfully`. Errors state the cause and the fix. Never `Oops` or `Something went wrong`.
4. **Address the user as "you", in the present tense.** `Traces appear here.`, not `Traces will appear here once your agent runs.`
5. **No jargon for internals.** `Creating`, not `Provisioning`; `saved`, not `persisted`; `deploy`, not `rollout`.
6. **No marketing.** Never `simply`, `just`, `easily`, `seamlessly`, `powerful`, `unlock`, or `get started with`.

## 2. Is it needed

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

## 3. Where it goes

| What survives | Where |
| --- | --- |
| What the page is for | `PageHeader.Description`, one sentence |
| Why a row or field matters, a unit, a schedule, why it is view-only | An info icon with a tooltip, right after the label (component in `mastra-ui-contract`) |
| What each option of a choice means | The option's `description` inside the `Combobox` menu, visible only while choosing |
| What good input looks like | The field's placeholder |
| What went wrong with input | The field's `errorMsg`, inline |
| The consequence of a destructive action | Its confirmation dialog, not the row |

Validation errors and destructive consequences are the only explanations that stay visible, because the user must see them without hovering.

## 4. By surface

| Surface | Pattern | Examples |
| --- | --- | --- |
| Button | The verb alone when the title or page names the object. Keep the object only when nothing nearby names it (a toolbar or list button). | `Create`, `Delete`, `Retry`, `Save`; toolbar: `New agent` |
| Title | The object, or the question being asked | `Delete production-agent?`, `Create license key`, `New agent` |
| Description | New information only, or delete it. Never restate the title. | `Requests using it will stop working. This cannot be undone.` |
| Empty state | Title plus one sentence that points to the action. Never a second copy of the header's primary button. | `No deploys yet` / `Push to your linked branches to deploy.` |
| Error | `Couldn’t {action}` plus the cause, when known, and the next step | `Couldn’t load agents` / `The server at localhost:4111 returned 503. Check that it is running and try again.` |
| Validation | How to fix the input, not that it is wrong | `Give the agent a name, for example “Support triage”.` Never `Invalid input` or `This field is required`. |
| Toast | Past tense, object first, no period | `API key created`, `Thread cloned`, `Settings saved` |
| Progress | The -ing verb, no ellipsis | `Deploying`, `Linking branches`, `Loading models`, `Creating` (never `Loading...` or `Loading…`) |
| Placeholder | A realistic example of good input, or `Search {things}…`. Never a question, never instructions, never a restated label. | Name `Support triage`; Instructions `You triage support tickets. Label each one by product area and urgency, reply in a short, friendly tone, and never promise refunds.`; `Search agents…`; picker `Choose a model…` |

A destructive confirmation is a title that asks (`Delete production-agent?`), a description that names the consequence and, only for permanent actions, `This cannot be undone.`, and a confirm button with the verb alone (`Delete`). The title already names the object.

A placeholder never replaces the label and never carries anything the user needs after typing starts, because it disappears then.

## 5. Mechanics

| Rule | Standard |
| --- | --- |
| Case | Sentence case everywhere: titles, labels, buttons, tabs, menu items, toasts. Capitals only for proper nouns. |
| Errors | Start with `Couldn’t` |
| Irreversible actions | `This cannot be undone.`, on permanent actions only |
| Terms | deploy · repository · API key · environment variable · docs · organization · canceled |
| Ellipses | The single character `…`, never `...`. Use it for truncation (CSS `truncate`) and in `Search {things}…` and `Choose {thing}…` placeholders. Never on an action in progress: `Loading`, not `Loading…`. |
| Apostrophes and quotes | Curly: `’`, `“ ”`. Type them in the source string. |
| Dashes | No em dashes |
| Exclamation marks | None |
| Periods | On full sentences (descriptions, tooltips, empty and error sentences), not on titles, labels, buttons, toasts, or fragments |

## 6. Numbers and times

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

</instructions>

<quality-checklist>
- [ ] Every explanatory string passed the "is it needed" test; failures were deleted, not moved
- [ ] At most one page description; no section, row, or field descriptions
- [ ] Each surviving explanation is in its one place from the placement table
- [ ] Every string follows its surface pattern: verb-alone buttons, `Couldn’t` errors, past-tense toasts, -ing progress
- [ ] No ellipsis on progress text; `…` (not `...`) only for truncation and search or picker placeholders; no em dashes or exclamation marks; curly apostrophes and quotes
- [ ] Sentence case; periods only on full sentences
- [ ] Terms match the list: deploy, repository, API key, environment variable, docs, organization, canceled
- [ ] Quantities to scan use `CompactNumber` and every moment in time uses `RelativeTimestamp`, each with the exact value on hover; IDs, names, short counts, durations, and labels do not
- [ ] No `please`, `successfully`, reassurance, internal jargon, or marketing words
</quality-checklist>
