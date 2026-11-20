---
name: dev-cleanup
description: Sweep a development machine for reclaimable space — stale git worktrees across every harness, orphaned agent and dev-server processes, dead node_modules and package caches, docker and build caches, and scratch artifacts in /tmp — and clean up only what is provably safe, reporting gigabytes reclaimed. Use when the disk is filling, when asked to clean up worktrees or dev artifacts, or when told to find "lost install shit".
---

# Dev cleanup

The goal is reclaimed gigabytes without losing work. Most of the space on a dev machine is not garbage; it is checkout copies, build output and caches that are safe to delete and expensive to regenerate by hand.

Measure first, delete second, verify third. A sweep that cannot say what it reclaimed is a guess.

## Hard rules

- **Never delete work that is not recoverable.** A checkout with uncommitted changes, a branch with unpushed commits, or a stash gets kept or preserved first, never removed.
- **Never touch** `~/.pi/agent/sessions`, `~/.rex/history`, `~/.rex/tasks`, `~/.rex/registry`, `~/.rex/pull-requests`. Those are memory and ownership records.
- **Never delete branches or commits.** Remove checkouts; branches stay.
- **No `rm -rf` on a git checkout** and no `git worktree remove --force`. If git refuses, report the refusal.
- **Ask before anything shared**: docker volumes in use, package stores other tools depend on, or a directory a process currently holds.
- **Stop only task-owned processes.** A process with `ppid 1` and an agent binary is orphaned; a process a human started is not yours.

## Measure

Run once at the start and keep the numbers:

```bash
df -h / | tail -1
for d in ~/.rex/worktrees ~/.herdr/worktrees ~/.t3/worktrees ~/.pi/agent/sessions ~/dev; do
  [ -d "$d" ] && du -sh "$d" 2>/dev/null
done
docker system df 2>/dev/null
```

## Sweep, in order of payoff

1. **Worktrees.** For each checkout under `~/.rex/worktrees`, `~/.herdr/worktrees`, `~/.t3/worktrees`, and each repo's `git worktree list`:
   - removable when `git status --porcelain` is empty, `git log <default-branch>..HEAD` is empty or the branch is merged, and no process holds the path
   - anything with unique commits is listed with its commit subjects and kept
   - remove with `git worktree remove <path>` from the owning repo
   - unregistered directories and plain-git companion checkouts go through the same test, then plain `git worktree remove` or a checked `rm -rf` only when nothing is dirty
2. **Orphaned processes.** `ps -axo pid,ppid,etime,comm | awk '$2==1'` filtered to `agent-browser`, `chromium`, `vite`, `next-server`, `turbo`, `esbuild`, `vitest`. Confirm `ppid 1` and the binary immediately before `kill`. `SIGTERM` first; a browser helper often ignores it, so `SIGKILL` is acceptable for these and say so.
3. **Package and build caches.** `pnpm store prune`, `npm cache clean --force` only if asked, `.turbo` and `dist` inside stale checkouts comes free with the worktree, plus Playwright browser downloads, `~/Library/Developer/Xcode/DerivedData`, and language caches (`~/.cargo/registry`, `~/.cache/*`) — caches only, never installed toolchains.
4. **Docker.** `docker system df -v` first. Report dangling images and build cache, and reclaim those. Volumes and running stacks need an explicit yes.
5. **Scratch.** `/tmp` directories older than a day from agent runs, screenshot sheets, mock APIs, and `/tmp` checkouts. Never `/tmp` files owned by another user or a running process.

## Verify

```bash
df -h / | tail -1
du -sh ~/.rex/worktrees ~/.herdr/worktrees ~/.t3/worktrees 2>/dev/null
git -C <repo> worktree list | wc -l
```

Report before and after per location, in GB, from `du` and `df`, not estimates.

## Report

- Reclaimed total, and per location.
- Removals with the proof each was safe: clean tree, and either merged or no unique commits.
- Everything kept, grouped by reason: dirty, unmerged with commit counts, held by a process, protected.
- Processes stopped, with ages.
- Caches pruned, with the command used.
- Anything the sweep could not determine, named plainly.

## Restating state each turn

One line at the top of every reply: what has been reclaimed so far and what remains. The point of the sweep is the number going up.
