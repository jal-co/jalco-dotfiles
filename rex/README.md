# pi-rex-agents

A Rex-native fork of [pi-herdr-agents](https://github.com/giuseppecrj/pi-herdr-agents), based on version **3.3.1**, with Justin's existing Rex session, recovery and worktree integration. This is a fork, not a clean-room implementation. The upstream MIT license and source attribution are retained in [`host/LICENSE`](host/LICENSE) and [`host/PROVENANCE.md`](host/PROVENANCE.md).

The local Pi package owns its host source under `host/`; it does not import or patch the installed `pi-herdr-agents` package. That package stays installed, with its extensions and skills disabled in `pi/agent/settings.json`, because `pi-herdr-pstack` depends on it.

`pinned` starts or finds the coordinator in Rex. New sessions are named **Command**, with the coordinator in one tab and the command center in another. The launcher finds a running coordinator by its process and directory, even after a label change. It renames only a session still called `pinned`, the old default, to `Command`. It never steals focus or starts a second writer when inspection is uncertain.

The Herdr setup was removed; the pre-migration snapshot is commit `efdcf6f`.

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
| `src/work.ts`, `src/work-tool.ts`, `src/work-heartbeat.ts` | Durable work queue of fixes and delivery batches, the coordinator's `rex_work` tool and the heartbeat that checks it |
| `src/task.ts` | Package-owned child process attestation and native status indicators |
| `src/alerts.mjs`, `src/webpush.mjs`, `alerts/`, `systemd/rex-alerts.service` | Phone alerts when a Rex tab waits on Justin |
| `src/runs.mjs`, `bin/rex-run`, `systemd/rex-runs.service` | [Idle stop and cold start](#idle-stop-and-cold-start) for dev servers |
| `src/hosts.ts`, `src/link.mjs`, `launchd/com.jalco.rex-link.plist` | The link the Mac keeps open to b1 so one coordinator serves both machines |
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

`mise dot apply` installs the launcher, bundled Rex CLI and coordinator configuration links. Rex must already be installed at `/Applications/Rex.app`; set `REX_BIN` when using another location. The launcher does not install Rex or restart its server.

The coordinator loads normal Pi extensions, tools, MCP configuration, skills, model preferences and the Pi theme. Project settings load the local `pi-rex-agents` package and disable the stock Herdr host extension only for this coordinator. The runtime lives in this package, so upstream package updates no longer replace or patch it. Model preferences, including task routing, live in `pi/agent/rex-agents/config.json` (linked to `~/.pi/agent/rex-agents`). The old `pi/agent/herdr-agents/config.json` path is a symlink to it, only because the separately installed pstack package still reads that name; there is one file, so nothing needs synchronizing.

Run `/reload` in the coordinator to load package changes. Pi re-reads TypeScript modules on reload, but Node keeps `.mjs` modules cached for the life of the process, so every module the coordinator imports is `.ts`; a package test enforces this. Standalone entry points such as `linear-tui.mjs` and `pinned.mjs` are not loaded by the coordinator and stay `.mjs`. This does not restart task agents. New children load the fork's child protocol and `task.ts`; existing children keep their original protocol until they exit. Compatible sidecar names and policy hashes are retained so recovery can verify existing processes without changing their identity.

## Tasks and worktrees

An approved implementation request authorizes one persistent task agent without another dispatch-permission question. Rex uses one session per repository, named after the repository. Each task opens a background tab with its own Pi conversation and, except for the existing dotfiles and local-only repository exceptions, an isolated worktree. Task names belong on tabs, not the shared session.

The persistent-completion fix is built into the fork's child handler. Repeated `subagent_done`, completion after automatic settlement, and completion after reload keep persistent agents alive. Only an explicit stop shuts them down. Ordinary agents still exit normally. Startup no longer modifies the installed Herdr host.

Use `subagent` with `persistent:true`, `interactive:true` and `worktree:{branch,base}`. Use `subagent_send` for follow-up work on the same idle agent. Results arrive automatically, including after `/reload`; do not poll session logs. Task completion does not stop the agent or authorize cleanup. Approved task cleanup closes only that task's terminal, never the shared repository session.

Repository session bindings live under `~/.rex/repositories`, keyed by canonical repository path. They survive coordinator reloads and restarts. Repositories with the same name remain separate. Non-Git directories group by their canonical directory path. Existing task sessions remain unchanged; only new task launches use repository grouping. A closed repository session is recreated on the next launch.

Checkouts live under `~/.rex/worktrees`. Ownership records, terminal bindings, manifests and coordinator leases live under `~/.rex/registry`. These runtime files are not committed. A matching retained task can reuse its checkout and shell after the previous owner confirms exit. Another task's branch, an unmanaged checkout, a closed pull request, unknown process state or a live lease blocks reuse.

`worktree_list` is read-only. `worktree_remove` requires explicit approval and a confirmation dialog. It checks ownership, processes and Git state before removal. Dirty checkouts block removal unless `preserve:true` creates a preservation commit. Ignored files are not included in that commit. Branches and commits remain after removal. Cleanup is limited to source repositories inside the home directory.

## PR tracking and retained memory

The coordinator checks managed task branches through read-only `gh` queries every five minutes while it is running. After authorized publication, `rex_pr_track` registers a task ID and canonical GitHub PR URL explicitly; automatic discovery also catches PRs created in task sessions. Repository and head branch must match the managed task. Multiple matching PRs require explicit selection rather than a guess.

PR records live in `~/.rex/pull-requests`, outside Git. Watches resume on coordinator reload or restart. They do not run while the coordinator is closed. Each check asks GitHub for a repository's name once, however many tasks share it. Coordinators in the same directory share one persisted due time, kept under the watcher lock. Every watcher checks it, including the one that set it, so neither extra ticks, a reload nor a second coordinator repeats a sweep before it is due, and each watcher's timer wakes at that time. Merge notifications still go out on every tick. Explicit `rex_pr_track` registration still checks GitHub right away. An exhausted rate limit or an unreachable GitHub ends the sweep at once instead of failing every remaining task. A rate limit pauses checks for every coordinator until GitHub's reset time, or 15 minutes when it gives none; a network outage retries when the next sweep is due. Either is announced once, with one more line once GitHub actually answers again, and watches stay registered throughout. Other GitHub failures are reported once per task. None of them count as merges. Closed-but-unmerged PRs do not trigger cleanup prompts.

A verified merge sends one coordinator message asking whether to clean up the task. Nothing is stopped or removed automatically. `/rex-prs` shows PR state, notification delivery and cleanup state. `/rex-pr-retain <URL>` records a decision to keep the task without further cleanup prompts. After approval, the coordinator follows the existing process-ownership and worktree-removal checks; successful removal updates the saved cleanup state.

Notification receipts prevent routine replay after restart. If the coordinator crashes between queuing a notification and saving its receipt, it reports delivery as uncertain rather than silently sending it again. A busy or stale PR-check lock is reported with its path; verify the recorded PID/start time before recovering it.

Before approved checkout removal, the extension copies the task's Pi JSONL logs and the coordinator's current transcript into `~/.rex/history`, with private permissions, SHA-256 verification and an index linking the task, branch, checkout and tracked PRs. Original Pi logs stay untouched. Failed or missing archives block cleanup for launched tasks. Snapshots capture the transcript before removal; the original coordinator log continues recording afterward.

Use `rex_task_history` to find archived logs by task name, branch, checkout or PR URL. The tool returns metadata and paths, not customer data or transcript contents. History is retained independently of terminal sessions, checkouts and PR state; no automatic pruning is installed.

## Command center

`pinned` opens the command center as a second tab, `󰔖 linear`, in the coordinator's `Command` session, and pins that session. The tab name uses a Nerd Font ticket glyph, since Nerd Fonts has no Linear logo. Running it again leaves an open tab alone and reopens it when missing. It also folds older layouts in: a `command-center` pane in another session is closed, and the separate `󰔖 linear` session from `~/.rex/command-center-session.json` is closed. When a `Command` or `pinned` session exists but no coordinator runs in it, `pinned` starts the coordinator in a new tab there instead of refusing; it still refuses when several such sessions exist or a terminal cannot be inspected. Run `rex-linear` to open the command center anywhere else; it is a standalone terminal app and does not need Pi to be running. It is built on Pi's own terminal library, `@earendil-works/pi-tui`, pinned in `package.json`; run `npm install --prefix ~/dotfiles/rex` once per Mac. Inside the coordinator, Pi maps that package to its built-in copy, so the install affects only the command center. Typing uses pi-tui's `Input` and `Editor`: arrow keys, word movement and paste work as in Pi, and messages and briefs are multi-line (`shift+enter` for a new line, `enter` to send). `mise dot apply` links it into `~/.local/bin`.

| Tab | Shows |
| --- | --- |
| Inbox | What needs you, in order: the coordinator's unanswered question or open confirmation dialog, agents asking a question, merged PRs to approve for cleanup, failed or crashed agents, finished work ready for review, open batches ready to land, and work the heartbeat flagged for you to check. It opens first when it has anything |
| Issues | Linear issues assigned to you, in progress and todo, sorted by priority |
| Backlog | Assigned backlog and triage issues, grouped by Linear project |
| Sessions | The coordinator's tasks from `~/.rex/tasks`, grouped by repository, with agent and PR state. Stashed tasks sit in their own Stashed section at the end, newest first, followed by Partly cleaned up |
| Today | Brief: in progress, up next and done since yesterday, including merged PRs. `←` `→` switches to a flat list |
| Work | The [work queue](#work-queue): batches ready to land, batches still waiting with their fixes and steps underneath, and fixes on their own. `x` shows done and dropped work |
| Archive | Every cleaned-up task, newest first, titled by its Linear issue or the goal in its brief. `enter` reopens its conversation as a new Pi session (`pi --fork`) in a tab of the repository's session; the archive itself is never changed. `v` opens the transcript in the browser via Pi's HTML export, `/` filters |
| Search | Linear search results, after `/` |

The bottom bar lists only the keys that apply to the selected row, with what each will do (for example `enter open PR` or `d stop`), followed by the global keys. `?` lists every key.

| Key | Action |
| --- | --- |
| `↑` `↓` or `j` `k` | Move |
| `tab`, `shift+tab`, `1` to `7` | Switch tabs |
| `enter` | Focus a running task's Rex tab, open its PR, or launch an agent for an issue |
| `n` | New task from a one-line goal, with or without a Linear issue |
| `w` | Queue a fix from one sentence. Starts nothing |
| `/` | Search Linear. Pasting an issue link or ID goes straight to launching it |
| `c` | Type to the coordinator. On a merged PR, the cleanup request is prefilled |
| `o` | Open the PR, or the Linear issue when there is no PR |
| `l` | Open the Linear issue |
| `s` | Send a message to a running task. A mid-turn agent queues one message |
| `u` | Resume a crashed or stashed task. A closed tab is reopened in its repository session. `enter` on a stashed row does the same |
| `z` | Stash a running or idle task: stop its agent and close its tab, keeping its session, branch, checkout and uncommitted work for `u` later |
| `d` | Stop or retire a task after confirmation. Logs, branch and checkout are kept |
| `D` | Clean up a task: stop its agent if running, archive its logs and remove its checkout. Branch and commits stay. `p` instead of `enter` first commits uncommitted work |
| `F` | Force clean up a stuck task, best effort: on a merged PR awaiting cleanup, a failed or crashed agent, a partly cleaned task, or any row whose cleanup just failed. See [Force cleanup](#force-cleanup) |
| `a` | On a merged PR in the Inbox, clean up every merged task waiting on cleanup, with progress and a summary of any that need attention |
| `h` | Hide the selected row everywhere. In the Hidden menu, unhide it |
| `H` | Open or close the Hidden menu |
| `r` | Reload Linear and the task registry |
| `x` | Show or hide stopped tasks |
| `?` | Show every key. Any key closes it |
| `q` or `ctrl+c` | Quit. `esc` only cancels prompts and confirmations, or leaves the Hidden menu |

A working agent's row and the header show Pi's own spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, every 80 ms); the animation runs only while something is working and redraws without recomputing the views. Agent state comes from Rex's live program status, the same `rex-task` indicator the sidebar shows, read every 3 seconds for every task that is not stopped. The task registry is the fallback when a tab is gone. Once a Linear issue is done or canceled, its row says so whatever its PR shows; `merged` and `in review` appear only while the issue is still open. The detail line shows both the Linear state and the PR state.

The tab bar shows a count on each tab and highlights the active one. When a Linear-linked agent is running, the command center names its Rex tab once after the issue, such as `PLTFRM-3240 Settings page shows "Change…`; a name you or the agent set afterwards is kept. Named tabs are recorded in `~/.rex/command-center.json`.

The coordinator's questions come to the Inbox too. When its last finished turn ends on a question you have not answered, "Coordinator asks" shows it: `enter` writes an answer in a multi-line editor and `y` replies "Yes."; either arrives as if you typed it in the coordinator. A confirmation dialog waiting in the coordinator shows there as well, and `enter` opens its tab. Merged PRs appear under "Approve cleanup": `enter` approves the cleanup and `K` keeps the task without further cleanup prompts. The coordinator no longer asks about cleanup in chat; it says in one line that a PR merged and leaves the approval to the Inbox.

Agents ask you their questions in their own tab. Briefs from the command center and the coordinator tell them to use `ask_user_question` there and wait, and to use `caller_ping` only when the coordinator must act. A waiting agent shows as blocked in the Rex sidebar and under "Agents asking" in the Inbox; `enter answer` opens its tab. When a help request still reaches the coordinator and is really a question for you, the coordinator tells you which tab needs you instead of answering for you.

Launching works out the repository instead of asking for a path. It ranks every repository directly under `~/dev` plus the checkouts Rex already knows from repository sessions, managed worktrees and earlier picks, searching each one in a single `git grep` pass, eight at a time. A repository without a remote runs directly in its checkout, like dotfiles. When nothing fits, `N` on the launch screen creates a new project under `~/dev` (a fresh local repository) and launches there. The evidence, strongest first:

1. GitHub PRs linked to the issue.
2. The repository you picked for that Linear team before.
3. Earlier tasks and linked PRs from the same team.
4. Distinctive phrases from the title and description, such as `code spans`, hyphenated names and word pairs, found with `git grep`. Phrases found in only one checkout count most.

The launch screen names the pick and why, and marks a close call as a best guess. `tab` cycles to the next candidate, `t` takes a typed path, `e` edits the brief in `$VISUAL` or `$EDITOR` and `enter` launches. Linear issues use their branch name. Free-form tasks get a short slug from the goal and a `jal/` branch. The base is the repository's `origin/HEAD`, fetched first. Dotfiles tasks run directly in the checkout without a worktree. Confirming a launch remembers the repository for that Linear team in `~/.rex/linear.json`. A full agent cap shows a message and launches nothing.

Launch, send, stop, stash, resume and coordinator messages go to the running coordinator, so the cap, single-writer checks and recovery rules apply exactly as when the coordinator calls those tools itself. The command center writes a request to `~/.rex/requests`; the coordinator whose directory matches claims it once, runs `subagent`, `subagent_send`, `subagent_stop`, `rex_task_stash` or `subagent_resume`, or delivers your message as if typed, then writes the result back. Tool requests also leave a note for its next turn. Requests expire after 60 seconds, so a coordinator that starts later never runs stale work. Reading Linear, focusing tabs and opening links happen in the command center directly.

Cleanup from the command center runs as one coordinator request per task. Your confirmation stands in for the coordinator's removal dialog through a one-shot internal approval the model cannot set; every other removal check still applies: ownership, leases, processes, Git state and the log archive. A running agent is stopped first and its exit confirmed within 30 seconds; otherwise nothing is removed. Requests are claimed when they arrive, so a long cleanup queue never expires the requests behind it. Hidden rows are stored as row keys in `~/.rex/command-center.json`; hiding changes nothing about the task.

### Work queue

The work queue holds work that is not a Linear ticket yet, or spans several: a fix to make upstream later, or several upstream changes that should land downstream in one package bump and one PR. It lives in `~/.rex/work.json` (`REX_WORK_FILE` overrides it), outside Git, and survives restarts. The coordinator and the command center both write to it through a lock file, so neither loses the other's change. A corrupt file is reported and never overwritten.

A **fix** can be one sentence. Repository, Linear issue, Rex task and PR links are optional. A **batch** includes fixes and tracks what its release has to contain, not only its version:

```text
w3 batch [blocked] Update Platform playground
  delivers @mastra/playground-ui to platform
  includes: w1 Alert card alignment (done, in 1.4.0); w2 Sidebar details panel (done)
  release: 1.4.0 (npm changelog lists #101)
  steps: 1.[ ] Bump @mastra/playground-ui in platform  2.[ ] Apply the integration changes it needs  3.[ ] Verify everything together  4.[ ] Open one PR
  blocked by: w2 not confirmed in 1.4.0
```

A batch is ready to land when every included fix is done, a release is recorded, and each fix is confirmed in that version. A fix that missed the release keeps the batch blocked instead of quietly completing it. Recording a new version does not carry earlier confirmations over. Any entry can also depend on others. Every entry is open, active, done or dropped. Done is refused while a dependency, included fix, confirmation or batch step is outstanding, and the refusal names each one. A fix belongs to at most one batch that is not dropped. Dependency and membership cycles are rejected.

Ask the coordinator in plain words: "queue a fix for the toast overflow upstream", "put w1 and w2 in the next playground bump", "leave w2 out of w3", "1.4.0 is published and its changelog lists #101" or "what is ready to land?". It uses `rex_work` (`show`, `add`, `update`, `release`). It records a release only from evidence it has seen and confirms each fix by ID. `/rex-work` lists open work, `/rex-work all` everything and `/rex-work w3` one entry. `/rex-fix <sentence>` queues a fix.

#### Heartbeat

While the coordinator runs, a heartbeat checks the queue every 10 minutes, and a couple of seconds after `rex_work` changes something. It only reads from GitHub, npm and Git, so it notices work you finished outside the coordinator:

1. A fix whose linked PR merged is marked done, with the PR number, merge time and commit. A PR closed without merging is flagged.
2. A fix without a PR is searched for an existing fix, at most every six hours and five searches per check, among PRs merged in its repository since it was queued. A PR naming its exact Linear issue in the title or branch (`PLTFRM-12` as a whole token, in any case, so `PLTFRM-123` does not count) is linked and closes the fix. Any other match is only flagged ("may already be fixed by #31016"). `K` on the row, or `dismissFlag` through the coordinator, dismisses it so that PR is not flagged again.
3. A batch with a package is checked against the newest `alpha` or `latest` version on npm. The heartbeat reads that exact version's npm metadata and needs its `gitHead`, the full commit it was published from, and the same GitHub repository as the package. A fix counts as shipped only when the package's `CHANGELOG.md` at that commit lists its PR in that version's section or an older one below it; the default branch is never used, since it can list a PR that shipped later. The heartbeat records the commit as the release evidence and names each merged fix that is missing. When npm records no commit, a different repository or another version, nothing is confirmed and the batch waits until you record the release through the coordinator. Once every fix is confirmed, the release stays on that version, so a newer alpha does not move it.
4. A batch lands, with every step checked, when the downstream repository's default branch pins the package at or past the confirmed version (`git fetch`, then `git grep` of its `package.json` files), or when its linked downstream PR merges.

The coordinator gets one message per check, and only when something changed, so it tells you in a line or two. There is no daily nudge. Ready batches and flagged work wait in the Inbox. The repeated state is not announced again, and connectivity failures stay quiet. A heartbeat change never starts, publishes or cleans up anything. Package, repository and downstream names that are not plain package names, repository names or absolute paths are skipped before any command runs.

Queuing records intent only. It never launches an agent, creates or changes a Linear issue, commits, pushes, opens a PR or cleans up, and those still need your usual approval. In the Work tab, `enter` drafts a message to the coordinator (`Start w4: …`, `Land w3: …`) that you edit and send yourself. `space` checks off a fix, batch or step, `m` moves a fix into or out of a batch, `K` dismisses a heartbeat flag, `b` starts a batch, `d` drops an entry and `u` reopens it. Releases, packages and dependencies are set through the coordinator.

### Force cleanup

`F` is for a task that ordinary cleanup cannot finish: its agent's process is gone or unreadable, its checkout was deleted outside Rex, or something unrelated still holds the checkout. It asks for confirmation, then runs as one coordinator request and does what it safely can:

1. Another live coordinator owning the task, a task from another coordinator directory, or an agent this coordinator still supervises and cannot stop refuses the whole request. Nothing changes.
2. An agent proven alive by its recorded PID, start time and command line gets a graceful stop. If the stop fails or it has not exited after 30 seconds, it gets `SIGTERM`, but only while all three still match. If it still runs, nothing is retired or removed.
3. A confirmed exit retires the task as `d` does. Its tab closes only when nothing but an idle shell runs in it and no other process has its working directory in the checkout; otherwise the tab stays and the result names what runs there.
4. Unconfirmed exit (no attestation, a tab still open, unreadable process state, or processes left in the checkout) retires the task record anyway and frees its slot. Its state becomes `detached` and its reason says the exit is unconfirmed. No process is signalled and its tab stays open. Running `F` again rechecks; once the exit is confirmed the task becomes an ordinary retired one. Until then, a new task under the same name is refused.
5. A checkout that still exists goes through the normal removal: ownership, containment, leases, process holders, Git state and the log archive all still apply. Uncommitted or untracked work keeps it unless you press `p`, which commits it first. Ignored files are deleted with the checkout, as with `D`.
6. A checkout missing from disk has its logs archived first, then its registry entry is marked removed and its own Git worktree metadata is deleted. A failed archive, a live coordinator lease or a locked worktree keeps the entry. The branch and its commits stay.

The result is green when everything was cleaned up, yellow when something was kept, and red when the request was refused. A partial result lists every kept item and why. The task leaves the Inbox, moves to Partly cleaned up in Sessions with what was kept, and a merged PR's cleanup state becomes `residual` instead of `pending`, so it leaves Approve cleanup. `D` and `F` stay available there; removing the checkout later by either clears the residue and sets the PR to `removed`. Running `F` again is safe: it rechecks and reports what is left. It never runs `kill` on an unverified PID, never closes a tab with something running in it, never force-removes a Git worktree and never discards uncommitted work.

Removing a checkout moves it into `~/.rex/trash` (an instant rename on the same disk), deletes only that checkout's Git registration under the repository's `.git/worktrees`, and deletes the moved folder in the background, so the coordinator never waits on deleting `node_modules`. It still refuses uncommitted or untracked changes and locked worktrees. Tracked files that are only deleted, as left by an interrupted removal, do not count as uncommitted work. The branch and its commits stay.

`worktree_list` shares one Git worktree listing per repository and one process snapshot for the whole inventory, and skips counting ignored files, which can number in the hundreds of thousands per checkout. Removal still inspects freshly and counts ignored files. With 65 checkouts the inventory went from about 210 seconds to about 24. At startup, uncertain merge notifications are summarized in one line and skip PRs whose cleanup is already decided.

Retiring an agent that predates process attestation requires evidence that it exited: its Rex tab must be gone, and no process may have its working directory inside the task's checkout. `lsof` reports working directories whatever a process calls itself; Pi renames its process to `pi`, which hides its environment from `ps`, so environment variables are not used as evidence. Leftover processes in the checkout, such as a dev server the agent started, block retirement until they stop. The Sessions tab breaks agent slots down into working, idle, not running and hidden, and the header shows dead agents holding slots.

Linear access uses a personal API key in the `Agents / Dev` vault. `~/.rex/linear.json` holds its reference, never the key:

```json
{ "tokenRef": "op://VAULT_ID/ITEM_ID/credential", "repositories": { "PLTFRM": "/Users/justin/dev/platform" } }
```

The key is read with `op read` at startup and kept in memory only. Without a reference, or when 1Password or Linear is unavailable, the issue tabs explain why and Sessions still works. Set `REX_COORDINATOR_CWD` to target a coordinator outside `~/rex-coord`.

## One coordinator for both machines

The first host in `config/hosts.json` (b1) is the primary. Its coordinator is the only one Justin talks to. Every other host keeps a link open to it: `link.mjs work`, run by the `com.jalco.rex-link` LaunchAgent on the Mac, opens `ssh b1 … link.mjs serve --host mac` and keeps it open, reconnecting after sleep or a network change. Only the worker opens connections, so b1 needs no way into the Mac.

Over the link:

1. **Up:** every 10 seconds the Mac sends its tabs that are waiting on Justin, its tasks and its health, which b1 keeps under `~/.rex/hosts/mac/`. b1's phone alerts include those tabs, named with the Mac. Task results, help requests and crash notices are sent as they happen.
2. **Down:** b1 sends commands from `rex-remote` and the command center: `launch`, `send`, `stop`, `resume` and `stash`. Cleanup is not on the list; it runs on the machine that owns the checkout.

While the link is up, the Mac coordinator is a worker. It still supervises its own agents, because process identity, tabs and file events can only be checked on their own machine, but it records task results without starting a turn and leaves them in `~/.rex/link/outbox` until b1 acknowledges them. b1's coordinator delivers them as `rex_remote_event` messages named `mac/<task>`, claiming each file first so two coordinators cannot deliver it twice; one interrupted by a restart is delivered again with a note that it may repeat.

A Mac that has not been heard from in 30 seconds, or whose link closed, is offline. Commands to it are refused at once and nothing is queued. A command that was running when the link dropped comes back as uncertain, because it may have run. Its waiting tabs drop out of b1's alerts until it is back.

When b1 is unreachable, the Mac coordinator takes over: results are delivered to it directly and it tells Justin in one line. When the link returns, it says so once and goes back to being a worker. No task moves between machines either way.

To set up a Mac after merging:

```sh
mise dot apply
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.jalco.rex-link.plist"
tail -f ~/.rex/link.log
```

The LaunchAgent uses the same `ssh b1` as everything else on the Mac, so the key it needs must load without a prompt.

## Idle stop and cold start

`rex-runs.service` on b1 (`src/runs.mjs`) keeps dev servers from piling up and brings them back when they are needed. It tracks servers registered with `rex-run`:

- `rex-run run <id> --ports P [--name N] -- <command>` starts a server in the background, waits until it listens and registers it. With `--name` inside a Rex tab it also opens on the Mac as `https://N.localhost`.
- `mdev up` registers each app it starts with `rex-run watch`, hands a stopped app's ports back with `rex-run release` before starting it, and `mdev down` ends tracking with `rex-run forget`.

A server stops after 2 hours without a new connection (`REX_RUN_IDLE_HOURS`). Only new connections count, so a forgotten tab's open HMR socket does not keep it alive. When available memory is under 15%, the least recently used server not used in the last 15 minutes stops, one per minute. A server whose folder is gone is stopped and forgotten.

A server can also get a front port (`--front`), which proxies to its first port, WebSockets included, while it is up and shows the wake page while it is stopped. With `--cookie NAME --login CMD`, a page load through the front that lacks the cookie gets a fresh value from `CMD` (run in the server's folder, last line of its output, reused for 4 minutes) and reloads, so the app is signed in without its sign-in flow; `/_rex/logout` turns that off for the browser and `/_rex/login` turns it back on. `mdev up platform` uses this to put Platform on `https://platform.<ticket>.localhost`, signed in as the seed test user.

A stopped, crashed or failed server's ports are held by a waker on `127.0.0.1`, so the Mac's ssh forward and its portless name keep working. Opening the page from a browser shows a loading page with the log, starts the server again with its own command in a login shell in its folder, starts the other apps in that folder that stopped with it, and reloads once the server answers. Only a page a person opens starts it: fetches, iframes, WebSockets and requests without browser headers get a 503, and requests for hosts other than `localhost` names are refused. A failed start shows its error and a Start again button. `rex-run wake <id>` starts one from the terminal, `rex-run ls` lists them, and `journalctl --user -u rex-runs` says what was stopped and started and why. Records and logs live in `~/.local/state/rex-runs`; the environment a server was started with is never stored.

```sh
systemctl --user link ~/dotfiles/rex/systemd/rex-runs.service
systemctl --user enable --now rex-runs
```

## Phone alerts

`src/alerts.mjs` runs on b1 and follows `rex events --all --json`. When any tab reports that it is blocked on a question, a permission or a sign-in (the program status protocol, which Pi and Rex task agents already speak), and is still blocked 20 seconds later, it sends one Web Push alert: "fix-toast needs you", or "wants approval" for permissions, with the session and the tab's status line. A prompt answered at the desk within 20 seconds never alerts. Each tab alerts once per wait. Help requests aimed at the coordinator are skipped. When it starts or reconnects to Rex it rescans every tab, so a restart neither loses nor repeats what is waiting.

It changes nothing inside agents and never answers anything. Tap the alert, then answer in Rex, in the tab itself or through View Activity. Rex iOS has no link that opens a specific tab.

The phone side is a small Home Screen web app, Asks, served by the same process on `127.0.0.1:8787` behind Tailscale Serve. It lists what is waiting, turns alerts on and has a Send test alert button that reports whether the alert reached the phone. Only the Tailscale login that owns b1 can open it. VAPID keys and subscriptions live in `~/.rex/phone`.

```sh
systemctl --user link ~/dotfiles/rex/systemd/rex-alerts.service
systemctl --user enable --now rex-alerts
tailscale serve --bg --https=8443 http://127.0.0.1:8787
```

On the iPhone, open `https://b1.tail95e906.ts.net:8443` in Safari, Share, Add to Home Screen, open Asks from there and turn on alerts. A Pi session shows what it waits on (the question header, or the permission prompt's first line) once it has been reloaded with this version.

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

### Taking over a task from another coordinator

A task owned by another live coordinator is refused everywhere: "Another live coordinator owns this task". When that coordinator keeps running but its task agent has died, `/rex-takeover <name or ID>`, or `rex_task_takeover` when you ask the coordinator to take a task over, moves the task to this coordinator after a confirmation dialog. It refuses unless the recorded agent PID's start time or command line proves the agent gone. A live, unattested or unreadable agent is never taken over, and neither is a task whose stop or dispatch is still pending, an ordinary agent, or a retired one.

The old owner must also have published that it can hand tasks over. Every coordinator running this build writes `~/.rex/tasks/coordinators/<pid>.json` with its process start time and the tasks its own agent host still supervises, and removes it on shutdown or reload. A takeover requires that file to match the owner's PID and start time exactly and not to list the task. A coordinator started before this build has no such file, so its tasks cannot be taken over: older code writes task records and drives its supervised agents without checking for a handoff, and nothing can change that from outside. Run `/reload` in that coordinator once; it keeps its agents and tasks, and from then on its tasks can be taken over. A coordinator that exited needs none of this, because normal recovery already reclaims its tasks.

The takeover rechecks everything under the task's lock and refuses if the task changed after you confirmed. It keeps the logical identity, generation, policy, tab, session, checkout and logs, moves the checkout lease only when it belongs to that task and to the old owner or a dead process (and puts it back if the task record cannot be written), and records the old owner under `handoff`. It launches nothing. Resume the task afterwards with `subagent_resume`, which runs its normal checks.

After the handoff the old coordinator refuses to resume, send to, stop, retire or stash the task, and its task saves, result deliveries, stop confirmations, receipts and messages for it no longer write once the owner has changed.

### Stashed tasks

Stashing sets a task aside without losing anything. `z` in the command center, or asking the coordinator to "stash X", calls `rex_task_stash`: it marks the task record in `~/.rex/tasks` as stashed and runs the normal `subagent_stop`, so the agent exits gracefully and its tab closes once the exit is confirmed. The Pi session, branch, checkout and uncommitted work stay; nothing is committed, pushed or removed. The task no longer holds an agent slot or a checkout lease. If the stop request fails, the stash mark is cleared again.

Resuming a stashed task (`u` or `enter` on its row, or "resume X") runs `subagent_resume` with its session file, the same path a crashed task uses. It reopens the saved session in a new tab of the repository session and takes the checkout lease back. It refuses while the old process is alive or unverifiable, while another task holds or uses the checkout, once the checkout is gone, or when the agent cap is full. Launching a new task under a stashed task's name is refused; resume it instead.

Stashing is not cleanup. Recovery after a coordinator restart never reconnects or relaunches a stashed task. `D` and merged-PR cleanup treat it like any other task and still need approval; removing its checkout clears the stash. A stashed task without a managed checkout, such as a dotfiles task, leaves the Stashed section only by being resumed.

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
