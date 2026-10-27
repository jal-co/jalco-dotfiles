# Session pins

Agent-independent session pinning extracted from the existing dotfiles plugin. It has no Pi dependency and is not automatically activated.

The default file is `~/.local/state/rex-plugins/session-pins.json`. Set `REX_PLUGINS_PIN_STATE` to override it. This is not the current coordinator's pin file.

```sh
node /absolute/path/to/rex-plugins/plugins/session-pins/session-pins.mjs pin SESSION_ID
node /absolute/path/to/rex-plugins/plugins/session-pins/session-pins.mjs unpin SESSION_ID
node /absolute/path/to/rex-plugins/plugins/session-pins/session-pins.mjs watch
```

The watcher subscribes to Rex session creation, destruction and movement events. It does not use interval polling. Ctrl+C stops only this watcher. Do not run it beside another pin watcher on the same server: both would control the same session order.

For palette actions, explicitly add the following to a separate test configuration:

```lua
dofile("/absolute/path/to/rex-plugins/plugins/session-pins/actions.lua"){
  node = "/absolute/path/to/node",
  script = "/absolute/path/to/rex-plugins/plugins/session-pins/session-pins.mjs",
}
```

This registers `rex_plugins_pin_session` and `rex_plugins_unpin_session`. It does not start the watcher, install a service, alter shortcuts or replace an existing configuration. The optional watcher must be supervised separately.

Pinning preserves the relative order of unpinned sessions. Corrupt state and concurrent edits are reported instead of overwritten. State locks are never broken automatically.
