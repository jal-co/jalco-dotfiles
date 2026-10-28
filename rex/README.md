# pi-rex-agents

A Rex-native fork of [pi-herdr-agents](https://github.com/giuseppecrj/pi-herdr-agents), based on version **3.3.1**, with Justin's existing Rex session, recovery and worktree integration. This is a fork, not a clean-room implementation. The upstream MIT license and source attribution are retained in [`host/LICENSE`](host/LICENSE) and [`host/PROVENANCE.md`](host/PROVENANCE.md).

The local Pi package owns its host source under `host/`; it does not import or patch the installed Herdr package. Herdr remains installed separately for fallback use.

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
| `package.json` | Local `pi-rex-agents` package manifest |
| `coordinator/settings.json` | Loads this package and disables only the upstream Herdr host in the coordinator |
| `host/` | Package-owned agent host |
| `src/pull-requests.mjs`, `src/pull-requests.ts` | Durable PR discovery, merge notifications and cleanup status |
| `src/index.ts` | Pi extension entry for the package |
| `src/history.mjs` | Private task/coordinator transcript archives and searchable metadata |
| `src/provider.mjs` | Rex session, terminal and process adapter |
| `src/runtime.mjs` | Preserves the provider and supervision together across Pi reloads |
| `src/tasks.ts`, `src/recovery.ts`, `src/recovery-events.lua` | Saved task facts, verified reattachment and event-driven results |
| `src/overview*.mjs`, `config/task-overview.lua` | Native Task Overview action and read-only live view |
| `src/task.ts` | Package-owned child process attestation and native status indicators |
| `../pi/agent/extensions/rex-task.ts` | Native status entry for ordinary Pi sessions and older task agents |
| `src/worktrees.mjs` | Durable checkout ownership, leases, reuse and explicit cleanup |
| `src/pinned.mjs`, `bin/pinned` | The `pinned` launcher |
| `config/modules.json` | Independent recovery and overview switches |
| `config/init.lua` | Native Rex command-palette actions |
| `plugins/session-pins/` | Persistent pins, event-driven order enforcement and the Lua actions |
| `launchd/` | Headless pin watcher at login |
| `appearance/` | Rex appearance backup and the script that captures and restores it |
| `task-runtime/` | Agent-independent task CLI, MCP server and optional Pi adapter. See its [README](task-runtime/README.md) |
| `test/`, `test/live/` | Unit tests and live Rex proofs |

`mise dot apply` installs the launcher, bundled Rex CLI and coordinator configuration links. Rex Beta must already be installed at `/Applications/Rex Beta.app`; set `REX_BIN` when using another location. The launcher does not install Rex or restart its server.

The coordinator loads normal Pi extensions, tools, MCP configuration, skills, model preferences and the Pi theme. Project settings load the local `pi-rex-agents` package and disable the stock Herdr host extension only for this coordinator. The runtime lives in this package, so upstream package updates no longer replace or patch it. Shared model preferences remain in `pi/agent/herdr-agents/config.json` for compatibility with pstack and the fallback host; there is no second model-routing configuration to keep synchronized.

Run `/reload` in the coordinator to load package changes. This does not restart task agents. New children load the fork's child protocol and `task.ts`; existing children keep their original protocol until they exit. Compatible sidecar names and policy hashes are retained so recovery can verify existing processes without changing their identity.

## Tasks and worktrees

An approved implementation request authorizes one persistent task agent without another dispatch-permission question. Rex uses one session per repository, named after the repository. Each task opens a background tab with its own Pi conversation and, except for the existing dotfiles and local-only repository exceptions, an isolated worktree. Task names belong on tabs, not the shared session.

The persistent-completion fix is built into the fork's child handler. Repeated `subagent_done`, completion after automatic settlement, and completion after reload keep persistent agents alive. Only an explicit stop shuts them down. Ordinary agents still exit normally. Startup no longer modifies the installed Herdr host.

Use `subagent` with `persistent:true`, `interactive:true` and `worktree:{branch,base}`. Use `subagent_send` for follow-up work on the same idle agent. Results arrive automatically, including after `/reload`; do not poll session logs. Task completion does not stop the agent or authorize cleanup. Approved task cleanup closes only that task's terminal, never the shared repository session.

Repository session bindings live under `~/.rex/repositories`, keyed by canonical repository path. They survive coordinator reloads and restarts. Repositories with the same name remain separate. Non-Git directories group by their canonical directory path. Existing task sessions remain unchanged; only new task launches use repository grouping. A closed repository session is recreated on the next launch.

Checkouts live under `~/.rex/worktrees`. Ownership records, terminal bindings, manifests and coordinator leases live under `~/.rex/registry`. These runtime files are not committed. A matching retained task can reuse its checkout and shell after the previous owner confirms exit. Another task's branch, an unmanaged checkout, a closed pull request, unknown process state or a live lease blocks reuse.

`worktree_list` is read-only. `worktree_remove` requires explicit approval and a confirmation dialog. It checks ownership, processes and Git state before removal. Dirty checkouts block removal unless `preserve:true` creates a preservation commit. Ignored files are not included in that commit. Branches and commits remain after removal. Cleanup is limited to source repositories inside the home directory.

## PR tracking and retained memory

The coordinator checks managed task branches through read-only `gh` queries once a minute while it is running. After authorized publication, `rex_pr_track` registers a task ID and canonical GitHub PR URL explicitly; automatic discovery also catches PRs created in task sessions. Repository and head branch must match the managed task. Multiple matching PRs require explicit selection rather than a guess.

PR records live in `~/.rex/pull-requests`, outside Git. Watches resume on coordinator reload or restart and check immediately. They do not run while the coordinator is closed. GitHub authentication or network failures are reported and do not count as merges. Closed-but-unmerged PRs do not trigger cleanup prompts.

A verified merge sends one coordinator message asking whether to clean up the task. Nothing is stopped or removed automatically. `/rex-prs` shows PR state, notification delivery and cleanup state. `/rex-pr-retain <URL>` records a decision to keep the task without further cleanup prompts. After approval, the coordinator follows the existing process-ownership and worktree-removal checks; successful removal updates the saved cleanup state.

Notification receipts prevent routine replay after restart. If the coordinator crashes between queuing a notification and saving its receipt, it reports delivery as uncertain rather than silently sending it again. A busy or stale PR-check lock is reported with its path; verify the recorded PID/start time before recovering it.

Before approved checkout removal, the extension copies the task's Pi JSONL logs and the coordinator's current transcript into `~/.rex/history`, with private permissions, SHA-256 verification and an index linking the task, branch, checkout and tracked PRs. Original Pi logs stay untouched. Failed or missing archives block cleanup for launched tasks. Snapshots capture the transcript before removal; the original coordinator log continues recording afterward.

Use `rex_task_history` to find archived logs by task name, branch, checkout or PR URL. The tool returns metadata and paths, not customer data or transcript contents. History is retained independently of terminal sessions, checkouts and PR state; no automatic pruning is installed.

## Appearance

No Rex appearance settings were changed. Capture or check the dotfiles backup with:

```sh
python3 ~/dotfiles/rex/appearance/preferences.py capture
python3 ~/dotfiles/rex/appearance/preferences.py check
```

To restore that appearance on another installation, run `python3 ~/dotfiles/rex/appearance/preferences.py restore`. It merges the saved appearance into existing preferences without importing session history, connection data or window positions. Reopen Rex when convenient; the script does not stop it.

## Recovery and task overview

`config/modules.json`, linked at `~/.config/rex/modules.json`, has two independent boolean switches:

```json
{
  "recovery": true,
  "overview": false
}
```

After editing these switches, run `/reload` in the coordinator. Turning either off leaves task agents, worktrees, labels and session pinning alone. Turning both off stops the coordinator's task observers. The pin service remains separate.

Recovery saves task metadata under `~/.rex/tasks`. After a coordinator process restart in the same directory, it verifies the old coordinator has exited, checks each child's immutable process attestation, saved generation and tool policy, and transfers only matching worktree leases. It reconnects the existing processes and delivers results from file and Rex events. It never launches replacements. Recovered persistent agents support `subagent_send`, graceful `subagent_stop` and `subagent_interrupt`. They still count toward the configured specialist limit. Ordinary recovered agents support interruption, not force cancellation.

On first installation, reload the coordinator and any already-running task agents before relying on restart recovery. Old children without process attestation remain unverified. Reloading a task agent publishes its identity without starting a new process. This does not restore agents whose Rex terminals or processes have been destroyed.

Task Overview is disabled and its command-palette action is no longer loaded by `config/init.lua`. Task recovery, existing agents and session pinning remain enabled. `/rex-tasks` still shows the saved task list in Pi.

New or reloaded Pi sessions in Rex emit native idle, working, blocked, done and error indicators independently of both module switches. This covers the coordinator, managed task agents and ordinary Pi sessions. Questions and confirmation dialogs stay blocked until answered. An open overview still stops its own watchers when disabled; agents continue running.

Receipts prevent routine completion replay across restarts. If the coordinator dies between queuing a result and recording its receipt, recovery flags delivery as uncertain instead of blindly sending it again. A partially written dispatch is also held for inspection rather than retried. Transcript summaries read at most the last 128 KiB instead of scanning session history.

A failed command, unknown terminal status or unreachable Rex server is not proof of a crash. If supervision reports a crash while Pi remains alive, keep the task and investigate instead of launching a replacement.

A stale operation lock is not removed automatically. Its `owner.json` records the PID, Rex session and creation time. Verify that owner has exited before arranging manual recovery. A failed launch retains its checkout and registry evidence rather than guessing that cleanup is safe.

The launcher does not restart a running coordinator or adopt its tasks behind its back. If multiple live coordinators use the same directory, it refuses to choose. Keep older coordinator sessions until their work is accounted for.

## Checks

```sh
cd ~/dotfiles/rex && npm test
node --experimental-strip-types --test ~/dotfiles/pi/agent/extensions/tests/git-interceptor.test.ts
```

Run `node ~/dotfiles/rex/test/live/package-live-test.mjs` for a model-free check that the coordinator's package configuration loads exactly one set of agent, PR and memory tools before and after `/reload`. It creates and closes only a disposable Rex session and retains its evidence under `~/.local/state/pi-rex-package-proof-*`.

Run `node ~/dotfiles/rex/test/live/recovery-live-test.mjs` for the model-free restart proof. It uses real Pi coordinator processes and a deterministic Node worker in disposable Rex sessions. It checks reconnection to the same PID, two automatic results, follow-up, native status, opening the overview and confirmed graceful stop. It closes its own sessions and retains the report under `~/.local/state/rex-recovery-proof`.

Run `node ~/dotfiles/rex/test/live/session-pins-live-test.mjs` before installing the production pin service, or with that service stopped. It uses an isolated pin file, creates only disposable test sessions, verifies native actions and event-driven ordering across a watcher restart, then closes those sessions and stops its test watchers. It preserves the relative order of existing sessions.

`test/live/live-test.mjs` runs in a dedicated Rex terminal with `REX_PROOF_DIR` set to a fresh report directory inside the home directory. It creates a disposable Git repository and managed worktree, receives three automatic results across a coordinator reload and a confirmed-stop checkout/terminal reuse, rejects duplicate acquisition, checks inventory, verifies dirty-cleanup refusal, then preserves and removes its own checkout. It uses the configured model preferences and incurs model usage. Reports contain the event transcript, diagnostics and `result.json`; no user task sessions are closed.
