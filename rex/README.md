# pi-rex-agents

A Rex-native fork of [pi-herdr-agents](https://github.com/giuseppecrj/pi-herdr-agents), based on version **3.3.1**, with Justin's existing Rex session, recovery and worktree integration. This is a fork, not a clean-room implementation. The upstream MIT license and source attribution are retained in [`host/LICENSE`](host/LICENSE) and [`host/PROVENANCE.md`](host/PROVENANCE.md).

The local Pi package owns its host source under `host/`; it does not import or patch the installed Herdr package. Herdr remains installed separately for fallback use.

`pinned` starts or finds the coordinator in Rex. New sessions are named **Command**, with the coordinator in one tab and the command center in another. The launcher finds a running coordinator by its process and directory, even after a label change. It renames only a session still called `pinned`, the old default, to `Command`. It never steals focus or starts a second writer when inspection is uncertain.

`pinned-rex` is the same launcher. The Herdr setup was removed; the pre-migration snapshot is commit `efdcf6f`.

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
| `src/pull-request-watcher.ts`, `src/pull-requests.ts` | Durable PR discovery, merge notifications and cleanup status |
| `src/index.ts` | Pi extension entry for the package |
| `src/history.ts` | Private task/coordinator transcript archives and searchable metadata |
| `src/provider.ts` | Rex session, terminal and process adapter |
| `src/runtime.ts` | Preserves the provider and supervision together across Pi reloads |
| `src/tasks.ts`, `src/recovery.ts`, `src/recovery-events.lua` | Saved task facts, verified reattachment and event-driven results |
| `src/overview*.mjs`, `config/task-overview.lua` | Native Task Overview action and read-only live view |
| `src/linear.mjs`, `src/linear-tui.mjs`, `bin/rex-linear` | Standalone command center for the inbox, Linear issues and task sessions |
| `src/repositories.mjs` | Picks the repository for a launch from linked PRs, history and code matches |
| `src/requests.ts` | Request inbox the coordinator uses to launch, message, stop and resume tasks for other tools |
| `src/task.ts` | Package-owned child process attestation and native status indicators |
| `../pi/agent/extensions/rex-task.ts` | Native status entry for ordinary Pi sessions and older task agents |
| `src/worktrees.ts` | Durable checkout ownership, leases, reuse and explicit cleanup |
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

Run `/reload` in the coordinator to load package changes. Pi re-reads TypeScript modules on reload, but Node keeps `.mjs` modules cached for the life of the process, so every module the coordinator imports is `.ts`; a package test enforces this. Standalone entry points such as `linear-tui.mjs` and `pinned.mjs` are not loaded by the coordinator and stay `.mjs`. This does not restart task agents. New children load the fork's child protocol and `task.ts`; existing children keep their original protocol until they exit. Compatible sidecar names and policy hashes are retained so recovery can verify existing processes without changing their identity.

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

## Command center

`pinned` opens the command center as a second tab, `󰔖 linear`, in the coordinator's `Command` session, and pins that session. The tab name uses a Nerd Font ticket glyph, since Nerd Fonts has no Linear logo. Running it again leaves an open tab alone and reopens it when missing. It also folds older layouts in: a `command-center` pane in another session is closed, and the separate `󰔖 linear` session from `~/.rex/command-center-session.json` is closed. When a `Command` or `pinned` session exists but no coordinator runs in it, `pinned` starts the coordinator in a new tab there instead of refusing; it still refuses when several such sessions exist or a terminal cannot be inspected. Run `rex-linear` to open the command center anywhere else; it is a standalone terminal app and does not need Pi to be running. It is built on Pi's own terminal library, `@earendil-works/pi-tui`, pinned in `package.json`; run `npm install --prefix ~/dotfiles/rex` once per Mac. Inside the coordinator, Pi maps that package to its built-in copy, so the install affects only the command center. Typing uses pi-tui's `Input` and `Editor`: arrow keys, word movement and paste work as in Pi, and messages and briefs are multi-line (`shift+enter` for a new line, `enter` to send). `mise dot apply` links it into `~/.local/bin`.

| Tab | Shows |
| --- | --- |
| Inbox | What needs you, in order: the coordinator's unanswered question or open confirmation dialog, agents asking a question, merged PRs to approve for cleanup, failed or crashed agents, and finished work ready for review. It opens first when it has anything |
| Issues | Linear issues assigned to you, in progress and todo, sorted by priority |
| Backlog | Assigned backlog and triage issues, grouped by Linear project |
| Sessions | The coordinator's tasks from `~/.rex/tasks`, grouped by repository, with agent and PR state |
| Today | Brief: in progress, up next and done since yesterday, including merged PRs. `←` `→` switches to a flat list |
| Archive | Every cleaned-up task, newest first, titled by its Linear issue or the goal in its brief. `enter` reopens its conversation as a new Pi session (`pi --fork`) in a tab of the repository's session; the archive itself is never changed. `v` opens the transcript in the browser via Pi's HTML export, `/` filters |
| Search | Linear search results, after `/` |

The bottom bar lists only the keys that apply to the selected row, with what each will do (for example `enter open PR` or `d stop`), followed by the global keys. `?` lists every key.

| Key | Action |
| --- | --- |
| `↑` `↓` or `j` `k` | Move |
| `tab`, `shift+tab`, `1` to `6` | Switch tabs |
| `enter` | Focus a running task's Rex tab, open its PR, or launch an agent for an issue |
| `n` | New task from a one-line goal, with or without a Linear issue |
| `/` | Search Linear. Pasting an issue link or ID goes straight to launching it |
| `c` | Type to the coordinator. On a merged PR, the cleanup request is prefilled |
| `o` | Open the PR, or the Linear issue when there is no PR |
| `l` | Open the Linear issue |
| `s` | Send a message to a running task. A mid-turn agent queues one message |
| `u` | Resume a crashed task. A closed tab is reopened in its repository session |
| `d` | Stop or retire a task after confirmation. Logs, branch and checkout are kept |
| `D` | Clean up a task: stop its agent if running, archive its logs and remove its checkout. Branch and commits stay. `p` instead of `enter` first commits uncommitted work |
| `a` | On a merged PR in the Inbox, clean up every merged task waiting on cleanup, with progress and a summary of any that need attention |
| `h` | Hide the selected row everywhere. In the Hidden menu, unhide it |
| `H` | Open or close the Hidden menu |
| `r` | Reload Linear and the task registry |
| `x` | Show or hide stopped tasks |
| `?` | Show every key. Any key closes it |
| `q` or `ctrl+c` | Quit. `esc` only cancels prompts and confirmations, or leaves the Hidden menu |

A working agent's row and the header show Pi's own spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, every 80 ms); the animation runs only while something is working and redraws without recomputing the views. Agent state comes from Rex's live program status, the same `rex-task` indicator the sidebar shows, read every 3 seconds for every task that is not stopped. The task registry is the fallback when a tab is gone. Once a Linear issue is done or canceled, its row says so whatever its PR shows; `merged` and `in review` appear only while the issue is still open. The detail line shows both the Linear state and the PR state.

The tab bar shows a count on each tab and highlights the active one. When a Linear-linked agent is running, the command center names its Rex tab once after the issue, such as `PLTFRM-3240 Billing page shows "Upgrade…`; a name you or the agent set afterwards is kept. Named tabs are recorded in `~/.rex/command-center.json`.

The coordinator's questions come to the Inbox too. When its last finished turn ends on a question you have not answered, "Coordinator asks" shows it: `enter` writes an answer in a multi-line editor and `y` replies "Yes."; either arrives as if you typed it in the coordinator. A confirmation dialog waiting in the coordinator shows there as well, and `enter` opens its tab. Merged PRs appear under "Approve cleanup": `enter` approves the cleanup and `K` keeps the task without further cleanup prompts. The coordinator no longer asks about cleanup in chat; it says in one line that a PR merged and leaves the approval to the Inbox.

Agents ask you their questions in their own tab. Briefs from the command center and the coordinator tell them to use `ask_user_question` there and wait, and to use `caller_ping` only when the coordinator must act. A waiting agent shows as blocked in the Rex sidebar and under "Agents asking" in the Inbox; `enter answer` opens its tab. When a help request still reaches the coordinator and is really a question for you, the coordinator tells you which tab needs you instead of answering for you.

Launching works out the repository instead of asking for a path. It ranks every repository directly under `~/dev` plus the checkouts Rex already knows from repository sessions, managed worktrees and earlier picks, searching each one in a single `git grep` pass, eight at a time. A repository without a remote runs directly in its checkout, like dotfiles. When nothing fits, `N` on the launch screen creates a new project under `~/dev` (a fresh local repository) and launches there. The evidence, strongest first:

1. GitHub PRs linked to the issue.
2. The repository you picked for that Linear team before.
3. Earlier tasks and linked PRs from the same team.
4. Distinctive phrases from the title and description, such as `code spans`, hyphenated names and word pairs, found with `git grep`. Phrases found in only one checkout count most.

The launch screen names the pick and why, and marks a close call as a best guess. `tab` cycles to the next candidate, `t` takes a typed path, `e` edits the brief in `$VISUAL` or `$EDITOR` and `enter` launches. Linear issues use their branch name. Free-form tasks get a short slug from the goal and a `jal/` branch. The base is the repository's `origin/HEAD`, fetched first. Dotfiles tasks run directly in the checkout without a worktree. Confirming a launch remembers the repository for that Linear team in `~/.rex/linear.json`. A full agent cap shows a message and launches nothing.

Launch, send, stop, resume and coordinator messages go to the running coordinator, so the cap, single-writer checks and recovery rules apply exactly as when the coordinator calls those tools itself. The command center writes a request to `~/.rex/requests`; the coordinator whose directory matches claims it once, runs `subagent`, `subagent_send`, `subagent_stop` or `subagent_resume`, or delivers your message as if typed, then writes the result back. Tool requests also leave a note for its next turn. Requests expire after 60 seconds, so a coordinator that starts later never runs stale work. Reading Linear, focusing tabs and opening links happen in the command center directly.

Cleanup from the command center runs as one coordinator request per task. Your confirmation stands in for the coordinator's removal dialog through a one-shot internal approval the model cannot set; every other removal check still applies: ownership, leases, processes, Git state and the log archive. A running agent is stopped first and its exit confirmed within 30 seconds; otherwise nothing is removed. Requests are claimed when they arrive, so a long cleanup queue never expires the requests behind it. Hidden rows are stored as row keys in `~/.rex/command-center.json`; hiding changes nothing about the task.

Removing a checkout moves it into `~/.rex/trash` (an instant rename on the same disk), deletes only that checkout's Git registration under the repository's `.git/worktrees`, and deletes the moved folder in the background, so the coordinator never waits on deleting `node_modules`. It still refuses uncommitted or untracked changes and locked worktrees. Tracked files that are only deleted, as left by an interrupted removal, do not count as uncommitted work. The branch and its commits stay.

`worktree_list` shares one Git worktree listing per repository and one process snapshot for the whole inventory, and skips counting ignored files, which can number in the hundreds of thousands per checkout. Removal still inspects freshly and counts ignored files. With 65 checkouts the inventory went from about 210 seconds to about 24. At startup, uncertain merge notifications are summarized in one line and skip PRs whose cleanup is already decided.

Retiring an agent that predates process attestation requires evidence that it exited: its Rex tab must be gone, and no process may have its working directory inside the task's checkout. `lsof` reports working directories whatever a process calls itself; Pi renames its process to `pi`, which hides its environment from `ps`, so environment variables are not used as evidence. Leftover processes in the checkout, such as a dev server the agent started, block retirement until they stop. The Sessions tab breaks agent slots down into working, idle, not running and hidden, and the header shows dead agents holding slots.

Linear access uses a personal API key in the `Agents / Dev` vault. `~/.rex/linear.json` holds its reference, never the key:

```json
{ "tokenRef": "op://VAULT_ID/ITEM_ID/credential", "repositories": { "PLTFRM": "/Users/justin/dev/platform" } }
```

The key is read with `op read` at startup and kept in memory only. Without a reference, or when 1Password or Linear is unavailable, the issue tabs explain why and Sessions still works. Set `REX_COORDINATOR_CWD` to target a coordinator outside `~/rex-coord`.

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

Recovery saves task metadata under `~/.rex/tasks`. After a coordinator process restart in the same directory, it verifies the old coordinator has exited, checks each child's immutable process attestation, saved generation and tool policy, and transfers only matching worktree leases. It reconnects the existing processes and delivers results from file and Rex events. It never launches replacements. Recovered persistent agents support `subagent_send`, graceful `subagent_stop` and `subagent_interrupt`. A mid-turn specialist accepts one queued follow-up, sent when its turn ends. They still count toward the configured specialist limit. Ordinary recovered agents support interruption, not force cancellation.

On first installation, reload the coordinator and any already-running task agents before relying on restart recovery. Old children without process attestation remain unverified. Reloading a task agent publishes its identity without starting a new process. This does not restore agents whose Rex terminals or processes have been destroyed.

`rex_task_probe` reports whether a task's recorded PID still has the recorded start time and command line. Absence or a mismatch is a crash. `subagent_stop` retires a confirmed-crashed task, attached or not, clearing its lease and capacity and closing its tab. `subagent_resume` with the task's session file restarts the same session, generation and identity in its retained tab and worktree instead. A closed tab is reopened in the repository session. Neither runs automatically, and both refuse while the process is alive or unverifiable. Confirmed stops close the task tab, resolving its window from the terminal at close time. Managed tasks cannot rename the shared repository session.

Task Overview is disabled and its command-palette action is no longer loaded by `config/init.lua`. Task recovery, existing agents and session pinning remain enabled. `/rex-tasks` still shows the saved task list in Pi.

New or reloaded Pi sessions in Rex emit native idle, working, blocked, done and error indicators independently of both module switches. This covers the coordinator, managed task agents and ordinary Pi sessions. Questions and confirmation dialogs stay blocked until answered. An open overview still stops its own watchers when disabled; agents continue running.

Receipts prevent routine completion replay across restarts. If the coordinator dies between queuing a result and recording its receipt, recovery flags delivery as uncertain instead of blindly sending it again. A partially written dispatch is also held for inspection rather than retried. Transcript summaries read at most the last 128 KiB instead of scanning session history.

A failed command, unknown terminal status or unreachable Rex server is not proof of a crash. If supervision reports a crash while Pi remains alive, keep the task and investigate instead of launching a replacement.

The worktree operation lock (`~/.rex/worktree-operation.lock`) waits up to two minutes while another live operation holds it, instead of failing at once. Its `owner.json` records the PID, process start time, Rex session and creation time. A lock whose owner process is gone, or whose PID now belongs to a different process, is reclaimed automatically; a live owner's lock never is. Other operation locks are not removed automatically; verify their recorded owner has exited before arranging manual recovery. A failed launch retains its checkout and registry evidence rather than guessing that cleanup is safe.

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
