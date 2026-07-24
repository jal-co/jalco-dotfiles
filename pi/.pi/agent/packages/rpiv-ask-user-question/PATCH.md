# Local fork of `@juicesharp/rpiv-ask-user-question`

Forked from upstream **v1.19.0**. Pinned as a local-path pi package in
`~/.pi/agent/settings.json`:

```json
"packages": [
  "./packages/rpiv-ask-user-question",   // was: "npm:@juicesharp/rpiv-ask-user-question"
  ...
]
```

## Why this fork exists

The `ask_user_question` tool **never worked** in this environment. Every
invocation failed schema validation with:

```
Validation failed for tool "ask_user_question":
  - questions.0: must be object
```

### Root cause

The runtime / model adapter delivers the nested `questions`
array-of-objects argument **JSON-encoded as a string** (double-encoded nested
tool args). Upstream registers the strict schema
`Type.Object({ questions: Type.Array(...) })`, so pre-execute validation
rejects the string before `execute()` ever runs.

This is **not** a bug in the extension's logic, nor in context-mode (its Pi
`tool_call` hook only touches `bash`). The schema and validator are correct —
the arguments are mangled upstream at the tool-call boundary. The same bug
breaks `@juicesharp/rpiv-todo` (also an array param).

## What was changed

1. **`tool/types.ts`** — added `QuestionParamsWireSchema`, a wire-level schema
   that accepts `questions` as EITHER the structured array OR a JSON string, so
   validation passes regardless of how the runtime serialized the argument.

2. **`ask-user-question.ts`** — `registerTool` now uses
   `QuestionParamsWireSchema`. `execute()` coerces a stringified `questions`
   (via `JSON.parse`) and guards that the result is an array before running the
   normal `validateQuestionnaire` guards. Normal array payloads are unaffected.

3. **`config.ts`** — vendored the three helpers used from
   `@juicesharp/rpiv-config` (`configPath`, `loadJsonConfig`,
   `validateGuidanceFields`) inline. pi does not run `npm install` for
   local-path packages, so the external dependency would be unresolved at
   runtime. Logic is byte-for-byte from rpiv-config@1.19.0.

4. **`package.json`** — version `1.19.0-local.1`; removed the
   `@juicesharp/rpiv-config` dependency (now vendored). Only pi-bundled peer
   deps remain (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`,
   `typebox`; `@juicesharp/rpiv-i18n` optional).

## Upstream fix

The proper fix belongs in the pi runtime / model adapter: stop stringifying
nested array tool arguments (or `JSON.parse`-coerce them before TypeBox
validation). If/when that lands, this fork can be dropped and the settings
entry reverted to `npm:@juicesharp/rpiv-ask-user-question`.
