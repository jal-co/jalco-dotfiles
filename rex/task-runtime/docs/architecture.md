# Architecture

## Ownership belongs to the runtime

A coding agent is a client, not the owner of the terminal registry. The CLI, MCP server and optional Pi extension all call `Manager`. The durable request, binding and runtime files survive the client that created them. There is no copy of the Herdr host in this repository.

```text
Coding agent / shell / Pi extension
                 |
            tools or CLI
                 |
              Manager
              /     \
     private records  Rex CLI / server API
              |              |
         task runner     terminal layout
              |
       adapter argv / process
```

The first implementation launches one process per task. The process is not yet a reusable specialist. A future persistent adapter must introduce a conversation identity and task outcomes without confusing them with process generations.

## Current modules

- `store.mjs`: isolated state directories, atomic JSON replacement and a single-operation lock.
- `manager.mjs`: input validation, exact checkout/name reservation, launch bindings, state projection and stop requests.
- `runner.mjs`: one-time run claim, child process ownership, status reports and outcome persistence.
- `process.mjs`: PID/start identity checks. Linux uses boot ID and proc start ticks. macOS uses `ps lstart`; same-PID reuse within its one-second precision is a known limitation. No coordinator sends signals using this evidence.
- `adapters.mjs`: explicit launch capabilities and argv construction. No terminal text parsing.
- `rex.mjs`: supported CLI calls, stable IDs, server identity checks and nested layouts.
- `status.mjs`: bounded OSC 7501 encoding.
- `tools.mjs`: one tool contract shared by MCP and Pi.
- `mcp.mjs`: bounded newline-delimited stdio JSON-RPC for initialization and tools.
- `cli.mjs`: explicit commands and a read-only file-event-driven task panel.

## Evidence and states

| State | Evidence | Reuse allowed |
| --- | --- | --- |
| starting | Launch request exists, runner identity not yet recorded | No |
| running | Original runner identity still exists | No |
| stopping | Stop requested; original runner remains | No |
| interrupted | Runner and direct child are gone, final outcome absent | No |
| unknown | Missing, conflicting or incomplete evidence | No |
| completed / failed | Final outcome recorded, runner and recorded direct child gone | Yes |
| stopped | Stop outcome recorded and exit verified, or explicit retirement verified both exits and terminal absence | Yes |

A name or directory is reserved within this registry, not globally across arbitrary user terminals. Existing sessions are never scanned for adoption. The user must choose an appropriate checkout before a direct-directory launch.

The runner alone signals its spawned child. The manager only writes a stop directive. This avoids stale coordinator PIDs and prevents a terminal-input race from typing a prompt into a shell. It also means a crashed runner cannot stop a surviving child in this version. That state remains blocked for manual investigation.

The terminal's `done` status is presentation, not an ownership release. Likewise, a process exit code of zero is not proof that the requested engineering task was correct. Protocol adapters will need task-level outcomes and explicit review separately.

## Persistence boundaries

Each run has separate files to avoid read-modify-write races between the coordinator and runner:

- `request.json`: launch input, adapter capabilities, checkout and server identity.
- `binding.json`: Rex session/block IDs returned from creation.
- `runtime.json`: runner-owned process evidence and outcome.
- `stop.json`: coordinator stop request.
- `launch-error.json`: uncertain launch diagnostics.
- `runner.claim/`: one-time claim. Never cleared automatically.

Atomic writes do not make launch transactional. A CLI timeout can happen after Rex created the terminal. The record is retained and duplicate launch is denied. Recovering a launch whose binding was never returned is deliberately not automatic yet.

The operation lock fails immediately on contention and is not broken automatically. All state is local and private. There is no network control endpoint, cross-user authentication layer, shell command interpolation or remote registry synchronization.

## Adapter contract to grow next

Launch capabilities are implemented now. A persistent adapter will need explicit operations for:

- Starting and identifying a process generation.
- Submitting exactly one task when idle, with an idempotency key.
- Emitting task completion, help requests and process exit as distinct events.
- Interrupting a turn separately from shutting down the process.
- Restoring a session only when that agent supports it.

Agents without those protocols keep process-level capabilities. Do not simulate idle detection by searching terminal output for phrases, send blind Enter/Escape sequences, or claim every agent supports the same controls.

An ACP adapter is a candidate, not a committed assumption. MCP is the coordinator-facing tool interface here; it does not replace a worker's conversation protocol or guarantee a model wakeup.

## Compatibility boundary

The existing dotfiles coordinator, recovery files, Herdr fork, services, pin state and Rex configuration remain untouched. New tools use the `rex_agent_` prefix. The optional Pi extension is never discovered through a package manifest by default. No migration command exists in this milestone.
