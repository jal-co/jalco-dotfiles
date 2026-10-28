# Session pins

Keeps pinned Rex sessions above unpinned ones. Pins live in `~/.rex/session-pins.json` (override with `REX_PIN_STATE`).

```sh
node plugins/session-pins/session-pins.mjs pin SESSION_ID
node plugins/session-pins/session-pins.mjs unpin SESSION_ID
node plugins/session-pins/session-pins.mjs watch
```

`session-pins.lua` is linked to `~/.config/rex/session-pins.lua` by `mise dot apply`. It registers the **Pin Session** and **Unpin Session** palette actions. With `--watch` it subscribes to session creation, destruction and movement events, with no polling. The LaunchAgent in `../../launchd/` runs the watcher.

Pinning preserves the relative order of unpinned sessions. Corrupt state and concurrent edits are reported instead of overwritten. State locks are never broken automatically.
