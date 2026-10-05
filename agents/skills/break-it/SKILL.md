---
name: break-it
description: Try to break a feature you just built by feeding the running app worst-case data through its real inputs, such as huge lists, long names, unusual emails, emoji labels, and hostile strings, then report every surface that visibly broke. Use when the user asks to "break it", "try to break this", "stress test", "throw bad data at it", "worst case", "edge cases", "fill it with junk", or "what happens with 500 items".
---

# Break It

A feature built against demo data looks finished until a real user named `Maximilian Alexander Wolfeschlegelsteinhausenbergerdorff` pastes a 400-character label into it. This skill plays that user. It enters worst-case data through the app's own inputs, then looks everywhere that data shows up.

The deliverable is a findings table plus the seeded data left in place for the user to see. The skill does not fix anything unless asked.

## 1. Scope and environment

- Name the feature in one sentence: what it takes in and where that input is shown again.
- Run only against local or disposable environments: localhost, a local database, a preview branch database. **Never** seed production or a shared staging environment without explicit permission, because junk records there reach real people.
- Use the task's dev server. If none is running, start one and track it. Drive the browser with `$HOME/.pi/agent/browser-testing/task-browser` (the Mastra wrapper in Mastra repos), per the frontend workflow.

## 2. Map inputs to surfaces

Read the code before generating data. List each input the feature accepts, including form fields, API params, imported files, and URL params. Next to each, list **every** surface that renders it again: lists, tables, detail headers, breadcrumbs, page titles, tabs, menus, toasts, emails, avatars and initials, search results, and exports.

Breaks usually happen away from the form. The input field handles a long name, while the breadcrumb three pages later does not. A run that only checks the form misses most findings.

Read the server validation too: max lengths, allowed characters, uniqueness. Test values at the limit and one past it, because that is where the client and server disagree.

## 3. Pick the hostile values

Walk the catalog and keep only the rows whose input exists. Write the plan down in one line per value before entering anything, and name the dropped rows in one line.

| Input kind | Values to enter |
| --- | --- |
| Names, titles, labels | Empty; 1 char; the max length; max + 1; one 80-char unbroken word; `Ωmega 🚀 Łódź`; RTL `مرحبا بالعالم`; leading/trailing spaces; only spaces; `<b>bold</b>`; `'; DROP TABLE x;--`; `{{name}}`; a duplicate of an existing name differing only in case |
| Emails | `a@b.co`; `first.last+tag@sub.domain.co.uk`; `"quoted name"@example.com`; `用户@例子.广告`; `UPPER@EXAMPLE.COM` next to `upper@example.com`; a 254-char address; trailing space |
| Numbers and money | 0; negative; `1e21`; 9,999,999,999.99; many decimals; a pasted value with commas |
| Dates and times | Feb 29; year 1900 and 9999; a date across a DST change; the user's timezone differing from the server's |
| Long text and descriptions | Several paragraphs; a single 2,000-char line; only newlines; a pasted URL of 300 chars; markdown and code fences |
| Collections | 0 items; 1 item; 10x the realistic count, seeded via the API or a seed script rather than clicking; 30+ tags or labels on one record |
| Files and images | 0-byte file; the max size; a wrong extension; a very tall or very wide image; a filename with emoji and spaces |
| Actions | Double-submit; submit, then press back; two tabs editing the same record; delete a record that another view is showing |

The why for each group: long and unbroken strings catch overflow and truncation; unicode and RTL catch layout and encoding; markup and template strings catch escaping bugs, which are security findings; case duplicates catch uniqueness gaps between the client and database; volume catches missing pagination, scroll, and performance collapse.

## 4. Enter the data and look

- Enter values through the UI for forms. Seed volume through the API or a seed script so the run takes minutes, not an hour of clicking.
- Visit every surface from step 2 once. Check a 320px viewport and the default desktop width.
- Record only what visibly happened or what an error, log, or response showed. Write "The name pushes the Delete button off the card at 320px" instead of "Spacing may be tight." A predicted failure is not a finding. Render it or leave it out.
- Watch the console and server logs while entering data. A 500 error or unhandled exception counts as a finding even if the UI looks fine.

## 5. Report

Lead with one line that gives the number of breaks and the number of values tried. Then:

| Value | Where | Observed | Severity |
| --- | --- | --- | --- |
| 80-char unbroken name | Project breadcrumb | Overflows the header and hides the menu button | break |
| `<b>bold</b>` label | Toast | Renders as bold HTML | security |
| 500 projects | Sidebar | No scroll; items past the viewport cannot be reached | break |

- Severity is **security** (escaping, injection, or data exposure), **data** (lost, corrupted, or duplicated records), **break** (unusable or visibly broken), or **rough** (works but looks wrong).
- Sort by severity in that order.
- "Nothing broke" with the list of values tried is a complete report. Do not pad it with suggestions.

## 6. Leave the data, clean up on request

The seeded records are half the report, since the user will want to see them. List how to delete them, such as the IDs, a name prefix like `break-it-`, or the reset command, and delete them only when the user says so. Stop any dev server or process this run started once the user is done looking.

## Mistakes

| Mistake | Fix |
| --- | --- |
| Checked only the form that accepts the input | Visit every surface from the input-to-surface map |
| Clicked through 500 creates by hand | Seed volume through the API or a seed script |
| Seeded a shared or production environment | Local or disposable only, unless the user gives explicit permission |
| Reported a guess | Enter it and observe it, or drop it |
| Fixed breaks unasked | Report; fix only on request, then re-enter the failing values to confirm |
| Ran every catalog row against every input | Keep rows whose input exists and name the dropped ones |
