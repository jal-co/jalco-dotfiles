# Pierre Dark

Pi loads `pierre-dark` from `pi/agent/themes/pierre-dark.json`. Its UI and syntax roles map directly to the [official Pierre Dark editor theme](https://github.com/pierrecomputer/theme/blob/main/themes/pierre-dark.json), not Pierre Dark Soft or the ANSI terminal palette. Pi has fewer syntax roles than VS Code, so language-specific distinctions cannot all carry over.

Ghostty loads `Pierre Dark` from `ghostty/themes/Pierre Dark`. It uses Pierre Dark's editor background `#0A0A0A` and foreground `#FAFAFA` so the Pi canvas matches the editor preview. Cursor and selection colors use the corresponding upstream roles. Its 16 ANSI colors come from Pierre Dark's terminal palette.

Herdr remains on `terminal`, with no custom palette overrides. Geist Mono, font size, keybindings, notification delivery, and the wider sidebar are unchanged.

Rex is the default coordinator terminal. Its existing appearance is backed up in `rex/appearance.plist`, separately from the Pi theme. The migration does not write Rex appearance settings. See [Rex configuration](../rex/README.md#appearance) for capture, check and restore commands.

## Apply to running sessions

1. In Ghostty, press Cmd+Shift+, to reload its configuration.
2. In Herdr, use the global menu's `reload config` action.
3. In Pi, run `/reload`, then choose `pierre-dark` under `/settings` > Theme. New sessions use the saved setting.

These steps do not stop the server or its panes. The Pi theme file hot-reloads once selected.
