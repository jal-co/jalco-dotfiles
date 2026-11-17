# Local fork of `@ogulcancelik/pi-auto-permissions`

Forked from the published **v0.1.4**. Loaded as a local-path Pi package in
`~/.pi/agent/settings.json`:

```json
"packages": [
  "./packages/pi-auto-permissions",   // was: "npm:@ogulcancelik/pi-auto-permissions"
  ...
]
```

## Why this fork exists

With the reviewer set to `claude-bridge/claude-haiku-5-5`, every guarded command
failed closed with:

```
Automatic review failed: No API provider registered for api: claude-bridge
```

Two separate causes.

1. **Wrong dispatcher.** v0.1.4 calls `completeSimple` from
   `@earendil-works/pi-ai/compat`. That function dispatches through compat's own
   global API registry. `pi.registerProvider()` registers into Pi's
   `ModelRuntime`, and never into that registry, so any API supplied by an
   extension (such as `claude-bridge` from `pi-claude-pool`) is invisible to it.
   Built-in APIs like `openai-codex-responses` still work, which hid the bug.
   Pi's extension docs (`docs/extensions.md`, "Streaming model calls") say to
   use `ctx.modelRegistry.streamSimple()` instead of the compat functions, which
   "cannot see extension provider registrations."

2. **Bridge prompt capture.** Once routed correctly, `pi-claude-bridge` rejects
   any call whose system prompt is not one it captured from Pi's main agent
   turn (`prompt-capture: no capture for this ...-char system prompt`). Its
   supported route for one-off calls is `cacheRetention: "none"`, which runs an
   isolated, tool-less, non-persisted Claude Code query with the caller's
   system prompt. That route sends only the trailing user turn, so a cumulative
   reviewer conversation would lose earlier evidence.

## What was changed

1. **`index.ts`**: the reviewer calls
   `ctx.modelRegistry.streamSimple(...).result()` with the same options instead
   of compat `completeSimple`. Authentication, the missing-model check and every
   fail-closed path are unchanged.

2. **`index.ts`**: when the review model's API is `claude-bridge`, the reviewer
   sends `cacheRetention: "none"` and always a full evidence turn, never a
   delta on a reused reviewer conversation. Other reviewers keep
   `cacheRetention: "long"` and their cumulative conversation.

3. **`test/reviewer-provider.test.ts`**: runs actual offline Pi with a faux
   agent and a reviewer registered through `pi.registerProvider()` the same
   way the bridge does. It covers approval, the `claude-bridge` one-off route,
   a reviewer error result and a missing reviewer provider. The last two must
   block. Run with `npm test` (Node's built-in test runner, no install).

4. **`package.json`**: version `0.1.4-local.1`, `test` script switched from
   `bun test` to `node --test`. Upstream's own tests are not vendored; they mock
   the compat module this fork no longer uses.

## Upstream fix

Item 1 belongs upstream in `ogulcancelik/pi-extensions`. Item 2 is specific to
`pi-claude-bridge`. When upstream switches to `ctx.modelRegistry`, re-apply
item 2 on top or drop the fork if it is no longer needed, then revert the
settings entry to `npm:@ogulcancelik/pi-auto-permissions`.
