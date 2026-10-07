---
name: show-me
description: Use when a visual explanation would clarify code changes, control flow, architecture, component structure, state transitions, or interface concepts.
---

Help the user understand the current topic of conversation visually. Skip the preamble and keep prose brief. Pick the smallest view that makes the key point clear.

- Show logic or an algorithm as pseudocode:

```text
on(save)
  if content is unchanged
    return cached result
  write new content
  return fresh result
```

- Show runtime control flow as a call tree:

```text
submitForm
  createSession
    persistPrompt
    launchAgent
  navigateToSession
```

- Show UI structure as a component tree, including state and module boundaries that matter:

```tsx
<SessionPage> (apps/example/src/routes/session.tsx)
  useSessionEvents()
  <SessionToolbar>
    <RunSkillButton> (packages/ui)
```

- Show file responsibility or a broad refactor as a shallow file tree:

```text
src/
├── commands/       # parses user actions
├── sessions/       # owns session state
└── transport/      # sends API requests
```

- Show component interaction, control flow, or data flow with Mermaid:

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant Daemon
    User->>UI: choose command
    UI->>Daemon: send expanded prompt
    Daemon-->>UI: stream result
```

- Use `diff` when the point is what changes and the surrounding shape already exists. Match the diff shape to the topic.

For GitHub pull request, issue, and comment explanations, a visual that describes changed code or behavior MUST use a `diff` fence instead of `text` or a language fence. GitHub only colors lines whose first character is `+` or `-`, so every added or removed line MUST carry the correct marker. Keep a few unmarked context lines so the change remains legible.

If the behavior is entirely new, prefix the new branch or block with `+`. If behavior is replaced, show both the `-` and `+` forms. Markers MUST remain semantically accurate; do not color unchanged lines for decoration.

For a component change:

```diff
 <SessionPage>
   useSessionEvents()
   <SessionToolbar>
+    <RunSkillButton />
   <SessionTimeline>
+    <SkillResultCard />
```

For a file-layout change:

```diff
 src/
 ├── commands/
+│   └── show-me.ts       # expands the slash command
 ├── sessions/
-└── transport.ts
+└── transport/
+    ├── client.ts
+    └── stream.ts
```

For a call-tree or call-stack change:

```diff
 submitForm
   createSession
     persistPrompt
+    expandSkillMention
     launchAgent
-  navigateToSession
+  navigateToSession
+    subscribeToEvents
```

For a state or control-flow change:

```diff
 on(save)
-  write content
+  if content is unchanged
+    return cached result
+  write new content
+  invalidate cache
```

- Show the whole block when most of it is new, when omitted context would hide ownership or order, or when the user needs a copyable target shape. In a GitHub change explanation, keep the `diff` fence and prefix the new lines with `+`. Use a language fence when the primary purpose is copyable code rather than change review:

```ts
function expandSkill(command: string): string {
  const skillName = command.slice(1)
  return `use the ${skillName} skill`
}
```

- For a visual UI, layout, state comparison, chart, or concept too dense for Mermaid, write one focused, self-contained HTML document: a diagram, an infographic, or a short slide deck, whichever fits the point. Use real labels and data and support desktop and mobile.

  Inside T3 Code (the `html_preview` and `html_render` tools are available), show it inline in the thread:

  1. Style it with T3's injected theme variables (`--background`, `--foreground`, `--muted-foreground`, `--border`, `--card`, `--accent`, `--chart-1` … `--chart-6`, `--font-sans`, `--font-mono`) so it follows the user's theme and light/dark mode. Use a fluid width, no horizontal padding on the outermost element, no outer card, border, or banner title, and fixed pixel heights for charts.
  2. Check it with `html_preview` at the default width and at about 390px, fixing console errors and overflow.
  3. Publish it with `html_render`, using the preview's `contentHeight` as `height`, before writing the reply.
  4. In the reply, do not announce or restate the page; add only what it doesn't say.

  Outside T3 Code, match the product's colors, type, spacing, and components, write the file, and open it for the user:

```
Bash(open path/to/show-me-{description}.html)
```

### guidance

Place each visual next to the short text it supports. Keep only the calls, files, props, states, and boundaries needed to answer the user's current question or the options to resolve the current discussion point.

You may use one of these, you may use several, it is unlikely you will use all of them. Use your judgement and don't overwhelm the user.
