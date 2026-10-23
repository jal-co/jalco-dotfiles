# p3 model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` as a value: the role runs on the parent thread's model (omit the delegate_task model). Entries in a panel list still count toward its fan-out.
# Low-Claude mode (Oct 20, 2026): Claude usage is nearly out. Non-Claude models first, medium thinking. Previous config: /tmp/p3-models.md.bak-*
# budget: medium (medium)

Temporary override for October 21 through October 25, 2026: prefer pi/cliproxyapi/gpt-6-astra with medium thinking for most new dispatched tasks and single-model p3 roles. Reserve GPT 6.1 Sol for genuinely difficult work or an explicit model request. Keep cross-model review panels diverse. Do not switch already-running threads. This override expires on October 26; the role defaults below then apply again.

feature, refactoring: pi/cliproxyapi/gpt-6.1-sol (medium)
bug-fix: pi/cliproxyapi/grok-4.7 (medium)
perf-issue: pi/cliproxyapi/gpt-6.1-sol (medium)
hillclimb: pi/cliproxyapi/grok-4.7 (medium)
judgment and prose: pi/cliproxyapi/gpt-6.1-sol (medium)
hardest tasks: pi/cliproxyapi/gpt-6.1-sol (high)
how explorer: pi/cliproxyapi/grok-4.7 (medium)
how explainer: pi/cliproxyapi/gpt-6.1-sol (medium)
why investigators: pi/cliproxyapi/grok-4.7 (medium)
why synthesizer: pi/cliproxyapi/gpt-6.1-sol (medium)
reflect tooling: pi/cliproxyapi/grok-4.7 (medium)
reflect judgment, divergent, synthesizer: pi/cliproxyapi/gpt-6.1-sol (medium)
arena runners: pi/cliproxyapi/gpt-6.1-sol (medium), pi/cliproxyapi/grok-4.7 (medium), pi/cliproxyapi/gpt-6-astra (medium)
arena cross-judge pool: pi/cliproxyapi/gpt-6-astra (medium), pi/cliproxyapi/grok-4.7 (medium), pi/cliproxyapi/deepseek-v4-pro (high)
swarm workers: pi/cliproxyapi/grok-4.7 (medium), pi/cliproxyapi/gpt-6.1-sol (medium)
architect runners: pi/cliproxyapi/gpt-6.1-sol (medium), pi/cliproxyapi/grok-4.7 (medium), pi/cliproxyapi/gpt-6-astra (medium)
interrogate reviewers: pi/cliproxyapi/gpt-6.1-sol (medium), pi/cliproxyapi/grok-4.7 (medium), pi/cliproxyapi/gpt-6-astra (medium), pi/cliproxyapi/claude-sonnet-5-5 (medium)
scope reviewer: pi/cliproxyapi/grok-4.7 (medium)
