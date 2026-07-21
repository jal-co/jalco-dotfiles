# Local fork of `@juicesharp/rpiv-todo`

Forked from upstream **v1.19.0**. Pinned as a local-path pi package in
`~/.pi/agent/settings.json`:

```json
"packages": [
  "./packages/rpiv-todo",   // was: "npm:@juicesharp/rpiv-todo"
  ...
]
```

## Why this fork exists

Same root cause as the `rpiv-ask-user-question` fork (see that package's
`PATCH.md`): the runtime / model adapter delivers nested container tool
arguments **JSON-encoded as a string** (double-encoded nested tool args).

For `todo` the impact is **narrower** than for `ask_user_question`. The scalar
core (`create`/`update`/`list`/`get`/`delete`/`clear` with `subject`,
`status`, `id`, etc.) works fine. Only the container-typed params break:

- `blockedBy`, `addBlockedBy`, `removeBlockedBy` (number arrays)
- `metadata` (record)

A call like `todo create … blockedBy:[1]` failed with:

```
Validation failed for tool "todo":
  - blockedBy.0: must be number
Received arguments: { ..., "blockedBy": "[1]" }
```

because `blockedBy` arrived as the string `"[1]"`.

## What was changed

1. **`tool/types.ts`** — added `TodoParamsWireSchema`, which accepts
   `blockedBy` / `addBlockedBy` / `removeBlockedBy` as `number[] | string` and
   `metadata` as `record | string`, so validation passes regardless of how the
   runtime serialized the argument. Added `coerceTodoParams()` which
   `JSON.parse`-coerces any stringified container field back to its structure
   and validates the result (arrays of numbers / object), plus the
   `COERCIBLE_FIELDS` list.

2. **`todo.ts`** — `registerTool` now uses `TodoParamsWireSchema`. `execute()`
   runs `coerceTodoParams()` before the reducer and **throws** on malformed
   input (the tool contract signals failure via throw, not an `isError` flag —
   `AgentToolResult` has no `isError` field). Scalar-only calls are unaffected.

3. **`config.ts`** — vendored the helpers used from `@juicesharp/rpiv-config`
   (`configPath`, `loadJsonConfig`, `validateGuidanceFields`) inline, since pi
   does not run `npm install` for local-path packages. Byte-for-byte from
   rpiv-config@1.19.0.

4. **`package.json`** — version `1.19.0-local.1`; removed the
   `@juicesharp/rpiv-config` dependency (now vendored). Only pi-bundled peer
   deps remain.

## Upstream fix

The proper fix belongs in the pi runtime / model adapter: stop stringifying
nested tool arguments (or coerce them before TypeBox validation). If/when that
lands, this fork can be dropped and the settings entry reverted to
`npm:@juicesharp/rpiv-todo`.
