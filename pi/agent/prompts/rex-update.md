---
description: Update Rex on b1 and Mac and recover coordinators and sessions
---

Update Rex on both hosts, b1 and the Mac, then bring back every coordinator, task and session that was running before.

<scope>
Running this command authorizes upgrading Rex through each host's existing trusted install channel and the Rex server restarts that upgrade requires, on both hosts. It authorizes nothing else: no Pi, extension, package or project dependency updates, no reboots, no cleanup, no commits or pushes, no new agents. Anything outside that scope needs its own request.
</scope>

<workflow>

1. **Read the current procedure.** Load the `rex` and `b1-admin` skills, the Recovery after a restart, Program resume and Stashed tasks sections of `~/dotfiles/rex/README.md`, and the live `--help` of `rex`, `rex server`, `rex-recover` and `rex-remote`. They name the trusted install channel per host and the supported recovery commands. Where they disagree with this prompt, they win, because this prompt does not track Rex releases.

2. **Inventory both hosts before changing anything.** Confirm SSH and the host link with `rex-remote status`. Record, per host, the Rex CLI version, the version the running server reports, and on the Mac the app version, kept separate because they upgrade separately. A host that is offline, asleep or asks for a password stops the run before any change; report it and ask Justin to wake or unlock it.

3. **Write a private checkpoint per host** outside Git, mode `0600`, such as `~/.rex/update-checkpoints/{host}-{time}.json`. Record:
   - each coordinator: PID, process start time, saved conversation file, session and tab IDs
   - each task: logical ID, generation, owner coordinator, session and tab, branch, checkout, dirty state, and phase (working, idle, finished, waiting on review, stashed, stopped, crashed)
   - each ordinary Pi pane's `program_resume_records`
   - review servers and port forwards, with the task that owns each

   Read the files back to confirm they saved. Store identities and paths only, never secrets, tokens or transcript text, and read each conversation's tail rather than scanning full transcripts.

4. **Reach a safe pause.** Let each working task finish its current tool call, or ask its owner to pause at a step boundary. Never kill an operation you cannot identify and never stash tasks in bulk; an unknown live operation blocks that host until it is accounted for.

5. **Update one host at a time, the Mac first and b1 last**, unless the docs give a concrete reason for another order. Restarting a Rex server ends every program in it, including this conversation if it runs there. Before restarting the server that hosts this session, hand the restart to something outside that server (SSH from the other host, a transient `systemd-run --user` unit on b1, `launchd` on the Mac), and write the next step into the checkpoint so the conversation can continue after program resume reopens it. Use only the host's existing install. Never fetch a second copy, sideload a build or pull dotfiles to get one.

6. **Verify the upgrade on the running server**, not the CLI. When a step fails or its outcome is uncertain, recover that host to a working server before touching the other host, and find out what happened before rerunning anything.

7. **Recover the host.** Run `rex-recover --dry-run`, compare its plan with the checkpoint, then run `rex-recover` on the host that owns the tasks. Keep the saved coordinator conversation, labels and worker topology, with exactly one coordinator per host.
   - A live agent whose identity attests against the checkpoint is reconnected. Check liveness with `rex_task_probe`, never `ps` or `kill -0`.
   - Ordinary Pi panes come back through program resume. Managed tasks come back only through `subagent_resume` or the owning host's remote controls, which keep their ownership, generation and checkout checks.
   - Finished, idle, review-waiting, stashed and stopped tasks stay inactive.
   - For tasks confirmed gone mid-work, ask Justin once which to resume, then resume only those. An interrupted tool call is never replayed and nothing is published.

8. **Reconcile against the checkpoint, entry by entry.** Both servers run the new version, each host has one coordinator, and the link is up. Every task keeps its identity, branch and dirty state with no duplicate writer. Review servers and forwards are restored only when the checkpoint names their owner and the service still exists.

</workflow>

<constraints>
- Unverifiable identity, policy or ownership blocks that item. Report it rather than launching a replacement writer, injecting input into a raw terminal, bypassing ownership or taking a task over.
- No `sudo` password workarounds and no reaching past the host's own trusted install.
- Claim full recovery only when every checkpoint entry is accounted for.
</constraints>

<format>
Report per host, briefly: version before and after (CLI, server, and Mac app), what was recovered, reconnected, left inactive, and blocked, each with its reason. End with the one action Justin needs to take, if any.
</format>
