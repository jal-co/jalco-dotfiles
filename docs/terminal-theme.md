# Pierre Dark

Pi loads `pierre-dark` from `pi/agent/themes/pierre-dark.json`. Its UI and syntax roles map directly to the [official Pierre Dark editor theme](https://github.com/pierrecomputer/theme/blob/main/themes/pierre-dark.json), not Pierre Dark Soft or the ANSI terminal palette. Pi has fewer syntax roles than VS Code, so language-specific distinctions cannot all carry over.

Ghostty loads `Pierre Dark` from `ghostty/themes/Pierre Dark`. It uses Pierre Dark's editor background `#0A0A0A` and foreground `#FAFAFA` so the Pi canvas matches the editor preview. Cursor and selection colors use the corresponding upstream roles. Its 16 ANSI colors come from Pierre Dark's terminal palette.

Rex is the default coordinator terminal. Its existing appearance is backed up in `rex/appearance/appearance.plist`, separately from the Pi theme. The migration does not write Rex appearance settings. See [Rex configuration](../rex/README.md#appearance) for capture, check and restore commands.

Rex session pinning uses native Lua actions and a headless event watcher, separate from appearance settings. See [Pin sessions](../rex/README.md#pin-sessions) for usage and service setup. It does not change the theme or keyboard shortcuts.

Rex recovery and Task Overview are independently switchable in `rex/config/modules.json`. The overview uses a normal pinned session and native program-status indicators, not a custom sidebar or renamed sessions. Both leave appearance settings and the pin service alone. A guarded 3.3.1 compatibility fix keeps repeated persistent task completion from shutting down an agent; existing task sessions need `/reload` to load it. See [Recovery and task overview](../rex/README.md#recovery-and-task-overview) for activation and limits.

## Apply to running sessions

1. In Ghostty, press Cmd+Shift+, to reload its configuration.
2. In Pi, run `/reload`, then choose `pierre-dark` under `/settings` > Theme. New sessions use the saved setting.

The Pi theme file hot-reloads once selected.
