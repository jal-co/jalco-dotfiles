# p3 model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` as a value: the role runs on the parent thread's model (omit the delegate_task model). Entries in a panel list still count toward its fan-out.
# Low-Claude mode (Oct 20, 2026): Claude usage is nearly out. Non-Claude models first, medium thinking. Previous config: /tmp/p3-models.md.bak-*
# budget: medium (medium)

Temporary override for October 21 through October 25, 2026: prefer pi/openai/gpt-6-astra with medium thinking for most new dispatched tasks and single-model p3 roles. Reserve GPT 6.1 Sol for genuinely difficult work or an explicit model request. Keep cross-model review panels diverse. Do not switch already-running threads. This override expires on October 26; the role defaults below then apply again.

feature, refactoring: pi/openai/gpt-6.1-sol (medium)
bug-fix: pi/xai/grok-4.7 (medium)
perf-issue: pi/openai/gpt-6.1-sol (medium)
hillclimb: pi/xai/grok-4.7 (medium)
judgment and prose: pi/openai/gpt-6.1-sol (medium)
hardest tasks: pi/openai/gpt-6.1-sol (high)
how explorer: pi/xai/grok-4.7 (medium)
how explainer: pi/openai/gpt-6.1-sol (medium)
why investigators: pi/xai/grok-4.7 (medium)
why synthesizer: pi/openai/gpt-6.1-sol (medium)
reflect tooling: pi/xai/grok-4.7 (medium)
reflect judgment, divergent, synthesizer: pi/openai/gpt-6.1-sol (medium)
arena runners: pi/openai/gpt-6.1-sol (medium), pi/xai/grok-4.7 (medium), pi/openai/gpt-6-astra (medium)
arena cross-judge pool: pi/openai/gpt-6-astra (medium), pi/xai/grok-4.7 (medium), pi/deepseek/deepseek-v4-pro (high)
swarm workers: pi/xai/grok-4.7 (medium), pi/openai/gpt-6.1-sol (medium)
architect runners: pi/openai/gpt-6.1-sol (medium), pi/xai/grok-4.7 (medium), pi/openai/gpt-6-astra (medium)
interrogate reviewers: pi/openai/gpt-6.1-sol (medium), pi/xai/grok-4.7 (medium), pi/openai/gpt-6-astra (medium), pi/claude-bridge/claude-sonnet-5-5 (medium)
scope reviewer: pi/xai/grok-4.7 (medium)
