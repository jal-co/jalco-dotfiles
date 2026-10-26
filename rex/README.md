# Rex coordinator

`pinned` starts or finds the coordinator in Rex. New sessions default to **pinned**. The launcher finds a running coordinator by its process and directory, even after a label change. It never steals focus, renames an existing session or starts a second writer when inspection is uncertain.

`pinned-rex` is the same launcher. `pinned-herdr` retains the previous Herdr setup. Herdr's configuration, launcher and existing sessions are unchanged. The pre-migration snapshot is commit `efdcf6f`.

## Pin sessions

Select a session, open Rex's command palette and choose **Pin Session**. Use **Unpin Session** to allow normal reordering again. Multiple pins stay in the order they were pinned. There is no new keybinding, renamed label or custom sidebar section.

Pins live in `~/.rex/session-pins.json`, outside Git. They use session IDs, so destroying and recreating a session requires pinning it again. Unpinning leaves the session where it is unless another pin needs to move above it.

A headless LaunchAgent, `com.jalco.rex-session-pins`, listens for session creation, destruction and movement. It restores the pinned group after a drag without polling or opening a terminal. It does not create, close, select or rename sessions. launchd reconnects it after the Rex server restarts; it never starts Rex itself.

`mise dot apply` links the native Lua config and LaunchAgent. On another Mac, load them once after applying the links:

```sh
rex config check
rex config reload
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.jalco.rex-session-pins.plist"
```

The service starts at subsequent logins. It uses the existing mise Node shim and logs to `~/.rex/session-pins.log`. After changing the watcher implementation, restart only that service with `launchctl kickstart -k "gui/$(id -u)/com.jalco.rex-session-pins"`. To disable enforcement, use `launchctl bootout "gui/$(id -u)/com.jalco.rex-session-pins"`; this does not close any Rex session.

A corrupt pin file is reported rather than overwritten. An interrupted pin edit can leave `session-pins.json.lock/owner.json`; check its recorded PID before arranging manual recovery.

## Configuration

| File | Purpose |
| --- | --- |
| `coordinator/AGENTS.md` | Dispatch, follow-up, ownership and cleanup rules |
| `coordinator/settings.json` | Inherits normal Pi resources and replaces only the Herdr host extension with the Rex wrapper |
| `index.ts` | Injects Rex infrastructure into the shared agent host |
| `provider.mjs` | Rex session, terminal and process adapter |
| `runtime.mjs` | Preserves the provider and supervision together across Pi reloads |
| `modules.json` | Independent recovery and overview switches |
| `tasks.mjs`, `recovery.mjs`, `recovery-events.lua` | Saved task facts, verified reattachment and event-driven results |
| `task-overview.lua`, `overview*.mjs` | Native Task Overview action and read-only live view |
| `../pi/agent/extensions/rex-task.ts` | Child process attestation and optional native status indicators |
| `worktrees.mjs` | Durable checkout ownership, leases, reuse and explicit cleanup |
| `appearance.plist` | Rex appearance backup, including the custom theme |
| `init.lua`, `session-pins.lua` | Native Rex command-palette actions and event subscription |
| `session-pins.mjs` | Persistent pins and event-driven order enforcement |
| `com.jalco.rex-session-pins.plist` | Headless pin watcher at login |

`mise dot apply` installs the launcher, bundled Rex CLI and coordinator configuration links. Rex Beta must already be installed at `/Applications/Rex Beta.app`; set `REX_BIN` when using another location. The launcher does not install Rex or restart its server.

The coordinator loads normal Pi extensions, tools, MCP configuration, skills, model preferences and the Pi theme. Project settings disable the stock Herdr host extension only for the Rex coordinator. The wrapper reuses `pi-herdr-agents` 3.3.1 for the agent protocol and rejects other versions because its injection interfaces are private. Shared model preferences remain in `pi/agent/herdr-agents/config.json`; there is no second model-routing configuration to keep synchronized.

## Tasks and worktrees

An approved implementation request authorizes one persistent task agent without another dispatch-permission question. Each task gets its own Rex session and, except for the existing dotfiles and local-only repository exceptions, an isolated worktree.

Use `subagent` with `persistent:true`, `interactive:true` and `worktree:{branch,base}`. Use `subagent_send` for follow-up work on the same idle agent. Results arrive automatically, including after `/reload`; do not poll session logs. Task completion does not stop the agent or authorize cleanup.

Checkouts live under `~/.rex/worktrees`. Ownership records, terminal bindings, manifests and coordinator leases live under `~/.rex/registry`. These runtime files are not committed. A matching retained task can reuse its checkout and shell after the previous owner confirms exit. Another task's branch, an unmanaged checkout, a closed pull request, unknown process state or a live lease blocks reuse.

`worktree_list` is read-only. `worktree_remove` requires explicit approval and a confirmation dialog. It checks ownership, processes and Git state before removal. Dirty checkouts block removal unless `preserve:true` creates a preservation commit. Ignored files are not included in that commit. Branches and commits remain after removal. Cleanup is limited to source repositories inside the home directory.

## Appearance

No Rex appearance settings were changed. Capture or check the dotfiles backup with:

```sh
python3 ~/dotfiles/rex/preferences.py capture
python3 ~/dotfiles/rex/preferences.py check
```

To restore that appearance on another installation, run `python3 ~/dotfiles/rex/preferences.py restore`. It merges the saved appearance into existing preferences without importing session history, connection data or window positions. Reopen Rex when convenient; the script does not stop it.

## Recovery and task overview

`modules.json`, linked at `~/.config/rex/modules.json`, has two independent boolean switches:

```json
{
  "recovery": true,
  "overview": true
}
```

After editing these switches, run `/reload` in the coordinator. Turning either off leaves task agents, worktrees, labels and session pinning alone. Turning both off stops the coordinator's task observers. The pin service remains separate.

Recovery saves task metadata under `~/.rex/tasks`. After a coordinator process restart in the same directory, it verifies the old coordinator has exited, checks each child's immutable process attestation, saved generation and tool policy, and transfers only matching worktree leases. It reconnects the existing processes and delivers results from file and Rex events. It never launches replacements. Recovered persistent agents support `subagent_send`, graceful `subagent_stop` and `subagent_interrupt`. They still count toward the configured specialist limit. Ordinary recovered agents support interruption, not force cancellation.

On first installation, reload the coordinator and any already-running task agents before relying on restart recovery. Old children without process attestation remain unverified. Reloading a task agent publishes its identity without starting a new process. This does not restore agents whose Rex terminals or processes have been destroyed.

Choose **Task Overview** in Rex's command palette to open a read-only live session showing state, blockers, branch and task session ID. It pins itself only when the separate pin actions are installed. Opening it again reuses the same view, including after a rename. It adds no sidebar section, shortcuts or appearance changes. `/rex-tasks` shows the saved task list in Pi.

New or reloaded task agents emit Rex's native working, blocked, done and error indicators when overview is enabled. Disabling overview clears only this extension's indicator on the next task event. An open overview stops its own watchers when disabled; agents continue running.

Receipts prevent routine completion replay across restarts. If the coordinator dies between queuing a result and recording its receipt, recovery flags delivery as uncertain instead of blindly sending it again. A partially written dispatch is also held for inspection rather than retried. Transcript summaries read at most the last 128 KiB instead of scanning session history.

A failed command, unknown terminal status or unreachable Rex server is not proof of a crash. If supervision reports a crash while Pi remains alive, keep the task and investigate instead of launching a replacement.

A stale operation lock is not removed automatically. Its `owner.json` records the PID, Rex session and creation time. Verify that owner has exited before arranging manual recovery. A failed launch retains its checkout and registry evidence rather than guessing that cleanup is safe.

The launcher does not restart a running coordinator or adopt its tasks behind its back. If multiple live coordinators use the same directory, it refuses to choose. Keep older coordinator sessions until their work is accounted for.

## Checks

```sh
node --test ~/dotfiles/rex/*.test.mjs
node --experimental-strip-types --test ~/dotfiles/pi/agent/extensions/tests/git-interceptor.test.ts
```

Run `node ~/dotfiles/rex/recovery-live-test.mjs` for the model-free restart proof. It uses real Pi coordinator processes and a deterministic Node worker in disposable Rex sessions. It checks reconnection to the same PID, two automatic results, follow-up, native status, opening the overview and confirmed graceful stop. It closes its own sessions and retains the report under `~/.local/state/rex-recovery-proof`.

Run `node ~/dotfiles/rex/session-pins-live-test.mjs` before installing the production pin service, or with that service stopped. It uses an isolated pin file, creates only disposable test sessions, verifies native actions and event-driven ordering across a watcher restart, then closes those sessions and stops its test watchers. It preserves the relative order of existing sessions.

`live-test.mjs` runs in a dedicated Rex terminal with `REX_PROOF_DIR` set to a fresh report directory inside the home directory. It creates a disposable Git repository and managed worktree, receives three automatic results across a coordinator reload and a confirmed-stop checkout/session reuse, rejects duplicate acquisition, checks inventory, verifies dirty-cleanup refusal, then preserves and removes its own checkout. It uses the configured model preferences and incurs model usage. Reports contain the event transcript, diagnostics and `result.json`; no user task sessions are closed.
