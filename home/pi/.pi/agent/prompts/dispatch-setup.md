---
description: Turn this T3 thread into the pinned dispatch thread for the Mastra repos
argument-hint: "[extra repos]"
---
Set up this thread as my T3 dispatcher. Do not start any tasks.

1. Check that `T3_MCP_URL` is set and that `t3_worktree_status` reports no worktree. If either check fails, stop and tell me to start a thread with no project (`mod+alt+n`) and run `/dispatch-setup` there.
2. Make sure these repos are registered as T3 projects: `mastra`, `platform`, `mastra-website`, plus ${@:-no extra repos}. Read `t3_project_list` first. For each repo that is missing, register it with `t3_project_create` using `~/dev/<repo>` as the workspace root, but only if that folder is a Git checkout. Report any folder that is missing.
3. Rename this thread to `dispatch` with `t3_thread_update` and pin it with `t3_thread_organize`.
4. Load the `t3-dispatch` skill and follow it for everything I send here after this.

Reply with one line per repo (`repo | project id | registered or already there or missing`), then one line saying the dispatcher is ready.
