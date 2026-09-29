---
description: Draft a Mastra Linear ticket from a rough note
argument-hint: "<what's wrong or what to add>"
---
Write a Mastra Linear ticket for: $ARGUMENTS

Write tickets the user can understand in five seconds. A long or clever ticket is one nobody reads.

- One ticket, one thing. If it needs "and also", split it into two tickets.
- No epics or big project tickets. Work goes ticket by ticket; write the next ticket when the current one is done.
- Title: plain words saying what is wrong or what to add, like "Save button does nothing on settings page". No codenames, component or file names, prefixes, or jargon.
- Body: short sections, each one to three lines, most important line first:
  - **What's wrong** (or **What we want**): say it in everyday words. Keep the technical facts, but explain any term a teammate outside this code might not know.
  - **Where**: the page link or exact spot, like "Settings → API keys".
  - **Steps** (bugs only): up to three numbered steps to see it.
  - **Done when**: one checkable sentence.
  - **Screenshot**: attach one when the ticket is about something visible.
- Skip background, root-cause theory, and implementation plans unless the user asks. Bullets over paragraphs.
- No filler like "It would be great if", "Currently", or "As a user". Just say the thing.

Show the draft and name any gap the note leaves open, such as the exact page or what the user sees. Create the issue in the Linear Platform team, assigned to me, only after I confirm.
