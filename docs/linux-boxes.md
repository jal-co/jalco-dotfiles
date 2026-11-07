# Two Linux boxes: plan

Status: planning. Nothing here is built yet.

## Goal

Two always-on Linux boxes in a closet. Every repo is available on both, files are real and persistent, and one coordinator dispatches tasks to either box. The Mac and phone are clients.

## Decisions

- Drop `~/fleet`. It was built around T3 Code, CLIProxyAPI and a Mac agentbox, which Rex and the Claude pool replaced.
- Model the boxes on `tools/boat-offload`, which already runs Rex server and Pi on Linux, joins the tailnet and registers as a Rex host. The boxes are a permanent version of that.
- Clone repos and dotfiles with git. Copy only what git cannot carry (secrets, `.env`), once per box.
- No shared filesystem. NFS breaks file watchers and makes one box depend on the other. Syncthing can corrupt `.git` under concurrent writes. Git push and fetch is the sync.

## Hardware and closet

- One JetKVM per box, for BIOS, frozen kernels and reinstalls.
- BIOS set to power on after AC loss. A smart plug per box for hard resets.
- Wired Ethernet.
- Airflow for two machines under agent load.
- Optional UPS so a power blip does not corrupt a repo mid-write.

## Per-box setup

1. Install Linux and Tailscale with Tailscale SSH.
2. Install Rex server (`curl -fsSL https://pkgs.superlogical.com/rex/install.sh | sudo sh -s -- --tarball`) and Pi (`npm install -g @earendil-works/pi-coding-agent`). See `tools/boat-offload/src/scripts.mjs`.
3. `git clone` dotfiles to `~/dotfiles` and link the Linux-safe parts: `pi`, `agents`, `rex`, `tools/anti-slop`. Then `pi update --extensions`.
4. Claude pool tokens as mode 600 files, or a 1Password service account.
5. Rex server as a systemd unit. Check whether Rex ships one first.
6. Add each box as a remote host in the Mac and phone Rex apps.
7. Clone every repo into `~/dev`. Put `.env` and other untracked config in place.

Mac-only pieces that do not carry over: `brew:` packages in `mise.toml` (use apt or mise tools) and the session-pins LaunchAgent.

## Single dispatcher

The `pinned` coordinator runs on box A so dispatch works with the laptop closed.

Each task records its box. The coordinator picks the box you name, otherwise the less busy one, runs `git fetch`, creates the worktree there and opens the tab there.

| Situation | Handling |
| --- | --- |
| New task | Fetch, worktree and tab on the chosen box |
| Move a running task | Commit and push the branch, create a worktree on the other box, fork the Pi session like `boat-offload session` |
| Untracked files | Placed on each box at setup |
| `node_modules`, builds | Per worktree, as today |

### Fork changes (`rex/`)

Today the provider assumes everything is local: the Rex CLI with no host, `git worktree` on local paths, local `ps`, and the registry in local `~/.rex`. Results come only from the local server's events.

1. Store a host on each task and worktree record.
2. Pass `-S <host>` on Rex calls in `src/provider.mjs`.
3. Run git and `ps` for the remote box over Tailscale SSH in `src/provider.mjs` and `src/worktrees.mjs`. The registry stays on box A.
4. Subscribe to both Rex servers' events for results and recovery.
5. Later: task handoff between boxes. `~/fleet` handoff logic is worth reusing.

A Boat sandbox can stand in for box B while building this, since boat-offload already registers sandboxes as Rex hosts.

## Open questions

- Do the boxes share a spec, or is one stronger? That affects the default box choice.
- Does Rex ship a systemd unit for Linux?
- Should the fork work run under pstack? It touches provider, worktrees, recovery and config.
