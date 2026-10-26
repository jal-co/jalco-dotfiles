# Rex coordinator

`pinned` starts or finds the coordinator in Rex. Select the **pinned** session in Rex's session picker. The launcher never steals focus or starts a second coordinator with that label.

`pinned-rex` is the same launcher. `pinned-herdr` retains the previous Herdr setup. Herdr's configuration, launcher and existing sessions are unchanged. The pre-migration snapshot is commit `efdcf6f`.

## Configuration

| File | Purpose |
| --- | --- |
| `coordinator/AGENTS.md` | Dispatch, follow-up, ownership and cleanup rules |
| `coordinator/settings.json` | Inherits normal Pi resources and replaces only the Herdr host extension with the Rex wrapper |
| `index.ts` | Injects Rex infrastructure into the shared agent host |
| `provider.mjs` | Rex session, terminal and process adapter |
| `runtime.mjs` | Preserves the provider and supervision together across Pi reloads |
| `worktrees.mjs` | Durable checkout ownership, leases, reuse and explicit cleanup |
| `appearance.plist` | Rex appearance backup, including the custom theme |

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

## Limits and recovery

Keep the coordinator process alive while it owns task agents. `/reload`, `/new`, `/resume` and `/fork` retain its infrastructure and live host state. A full process restart does not recover persistent agents. Durable leases and process inspection prevent unsafe duplicate acquisition, but cannot restore the old host's delivery state.

A failed command, unknown terminal status or unreachable Rex server is not proof of a crash. If supervision reports a crash while Pi remains alive, keep the task and investigate instead of launching a replacement.

A stale operation lock is not removed automatically. Its `owner.json` records the PID, Rex session and creation time. Verify that owner has exited before arranging manual recovery. A failed launch retains its checkout and registry evidence rather than guessing that cleanup is safe.

The older proof coordinator, `rex-coordinator`, is not restarted or adopted by this launcher. It may still own existing task sessions. Use **pinned** for new tasks; keep the old session until its existing work is accounted for.

## Checks

```sh
node --test ~/dotfiles/rex/provider.test.mjs ~/dotfiles/rex/runtime.test.mjs ~/dotfiles/rex/worktrees.test.mjs
node --experimental-strip-types --test ~/dotfiles/pi/agent/extensions/tests/git-interceptor.test.ts
```

`live-test.mjs` runs in a dedicated Rex terminal with `REX_PROOF_DIR` set to a fresh report directory inside the home directory. It creates a disposable Git repository and managed worktree, receives three automatic results across a coordinator reload and a confirmed-stop checkout/session reuse, rejects duplicate acquisition, checks inventory, verifies dirty-cleanup refusal, then preserves and removes its own checkout. It uses the configured model preferences and incurs model usage. Reports contain the event transcript, diagnostics and `result.json`; no user task sessions are closed.
