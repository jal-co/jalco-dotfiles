# Host provenance

This directory is an owned fork of the runtime sources shipped in `pi-herdr-agents` 3.3.1, https://github.com/giuseppecrj/pi-herdr-agents. The original MIT license is retained in `LICENSE`. Existing source comments are preserved from that snapshot.

The fork includes `maestro`, `pi-extension`, and the example configuration. It does not import or modify the installed upstream package. The persistent-completion fix previously applied at startup is part of this source snapshot.

Local changes expose the runtime state used by the Rex coordinator, require an explicitly supplied surface provider rather than falling back to Herdr, load the package-owned Rex child extension on fresh launches and resumes, pass the resumed child's surface identity, and remove Herdr cleanup override guidance. The Rex layer stores new process attestations per run ID while retaining read support for pre-fork attestations, so a resumed session does not overwrite the previous process's evidence.

The existing `pi-herdr-subagent` sidecar filenames, environment variables, shared `~/.pi/agent/herdr-agents/config.json` preferences, and pstack event names remain protocol compatibility contracts. Keeping them allows existing task sessions and saved recovery records to continue without rewriting their identity or policy. They do not require the installed Herdr host at runtime.

Herdr transport source retained in the fork is not the coordinator's placement implementation. `index.ts` supplies the Rex provider, launch operations, supervision and worktree manager. Transport extraction can be narrowed later without changing task ownership or on-disk protocols.
