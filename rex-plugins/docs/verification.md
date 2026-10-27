# Verification

Checked on macOS with Node 24 and a local Rex server reporting API revision 7.

## Passed

- `npm test`: 37 tests. Includes real deterministic child processes, SIGTERM stop requests, duplicate runner rejection, failed executable handling, captured output, worktree creation, separate-process stdio MCP calls and execution through a symlinked checkout.
- `npm run test:live`: a disposable three-panel Rex task completed, emitted a native `rex-task` / `done` status record and retained terminal output. A second task stopped through its runner. A fresh manager read the stopped result. Both fixture sessions were closed, and unrelated session IDs remained.
- Optional Pi extension: loaded through the installed extension loader, registered six tools, passed Pi's argument validator and returned adapter capabilities. No coding-agent process or model request was started.
- State privacy: shared-permission state directories and non-local Rex launch targets are refused in tests. Public source publication was authorized separately; private runtime data is not published. No installed coordinator configuration or service was modified.

## Not yet verified or implemented

- Real model calls through the Pi adapter. Its argv contract and output capture were checked without using a provider.
- Linux process identity handling on a Linux machine.
- Dedicated Claude Code, Codex or ACP adapters.
- Persistent follow-up, conversation resume, automatic model wakeup, worktree reuse/removal and descendant-process cleanup.
- Extracted pin watcher in a live user session. Its unit tests pass; it was deliberately not activated alongside the existing pin service.
- A custom Rex GUI block or widget API. The panels use supported terminal layouts.

The package is a development milestone, not an approved replacement for the current coordinator.
