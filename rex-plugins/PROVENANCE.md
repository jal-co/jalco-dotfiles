# Provenance

The task runtime, shared CLI/MCP tools, adapter boundary and nested task panels were written for this repository. They do not copy or depend on the bundled pi-herdr-agents host.

`plugins/session-pins/session-pins.mjs`, its tests and the Lua event subscription were extracted from the existing personal dotfiles Rex plugin at the owner's request. The extraction changes executable discovery, configuration paths and state defaults so they no longer depend on the personal installation. The action names are prefixed to avoid collisions. The original installed files are unchanged.

The current Pi-specific coordinator remains in dotfiles. Its runtime records, private session transcripts, PR database, Git checkouts, credentials and personal configuration were not copied into this repository.

Public source publication is authorized by the owner. The extracted pinning files were reviewed against their dotfiles source; this repository contains no copied Herdr host code. No distribution license has been selected. Public visibility alone does not grant an open-source license. Any later reuse of the Herdr-derived host requires its license and attribution to be retained.
