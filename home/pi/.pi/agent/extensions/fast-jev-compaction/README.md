# Fast Jev compaction for Pi

This extension ports `tamaratran/fast-jev-compaction` to Pi's `session_before_compact` hook.

Jev scores each old tool call and result. User and assistant text stays verbatim. Calls Jev drops are removed with their results. Results Jev drops are reduced to a short head and a re-run note. Pi keeps its normal recent-message boundary.

Pi's compaction hook accepts a summary string rather than a replacement message list. The extension therefore serializes the retained old messages into a labeled, verbatim compaction summary. Structured tool blocks become labeled text, while Pi's recent tail remains structured.

Use `/jev-compaction status`, `/jev-compaction on`, or `/jev-compaction off`. Command overrides last until `/reload`; edit `config.json` for the durable default. When disabled, missing a TypeSafe key, below the minimum reduction, or on an error, Pi's built-in compaction runs instead.

`TYPESAFE_API_KEY` stays in the environment.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the upstream license.
