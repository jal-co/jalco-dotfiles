---
name: plain-writing
description: |-
  Cut AI writing tells from prose. Use when drafting, editing, or reviewing any text a human will read —
  documentation, README files, blog posts, commit bodies, PR descriptions, release notes, emails, marketing
  copy, changelogs, or a rewrite request. Provides a banned-word list, empty-phrase list, and the sentence
  patterns that make writing sound machine-generated, each with the fix.

  Triggers on: write, draft, rewrite, edit, revise, polish, proofread, tighten, copy, prose, blog post,
  article, README, documentation, changelog, release notes, announcement, landing page copy, email,
  "make this sound human", "sounds like AI", "too wordy", AI tells, slop, tone, voice.
---

<overview>
Rules for prose that a human reads. They remove the vocabulary and sentence shapes that mark text as machine-generated. Every rule states the fix, not only the ban.

Section 5 of the global AGENTS.md carries a compressed version of the pattern rules, which applies to all output. This file is the full list, for when text is the deliverable.
</overview>

<constraints>

Cut the tell, do not replace it with a better tell. When a rule says delete a closing metaphor, delete it. Do not rewrite it into a sharper metaphor or preserve its rhythm.

Voice beats the list. An empty adverb that carries the writer's natural speech is not an error. Judge whether the word does work in that sentence.

</constraints>

<words>

## Banned outright

delve, foster, leverage, utilize, facilitate, empower, streamline, robust, cutting-edge, paradigm shift, game changer, this is huge, this changes everything, tapestry, realm, beacon, multifaceted, meticulous, intricate, paramount, transformative, elevate, embark, supercharge, harness, ever-evolving

## Often-empty adverbs

just, literally, honestly, simply, actually, truly, fundamentally, importantly, crucially, inherently, inevitably

Cut them when they add nothing. Keep them when they carry emphasis, uncertainty, contrast, or the writer's spoken rhythm.

## Often-empty phrases

it's worth noting, it's important to note, at the end of the day, when it comes to, at its core, in today's world, in the age of, in the world of, the reality is, the truth is, in terms of, with regard to, in order to, going forward, in this article, let's dive in

Cut them when they delay the point. Keep an occasional one when it belongs to the writer's recognizable voice and the sentence still earns its place.

</words>

<patterns>

## Binary contrasts

"This is not X. It's Y." / "The question isn't X, it's Y." / "It's not just X but Y." State Y directly.

> The question isn't the model. It's the eval.

becomes

> The eval matters more than the model.

## Throat-clearing openers

"Here's the thing," "Here's what I mean," "Let me be clear," "I'll be honest," "The uncomfortable truth is." Cut them and state the point.

## Faux-insight setups

"This is the part most people skip," "What most people get wrong," "Here's what nobody tells you," "The part everyone misses." They flatter the writer as the lone expert. Cut the setup and let the claim stand.

> The part everyone misses: distribution is the real moat.

becomes

> Distribution is the moat.

## Colon reveals

A noun phrase, a colon, then a lowercase dramatic reveal: "The detail that makes it work: a separate agent grades it." Rewrite as a plain sentence. Use colons for lists, labels, and quotes. Prefer sentence case after a colon unless grammar, a proper noun, a title, or code requires otherwise.

> The detail that makes it work: a separate agent grades it.

becomes

> A separate agent does the grading, which is what makes it work.

## Superficial analysis

Trailing `-ing` clauses that pretend to explain meaning: highlighting, underscoring, reflecting, showcasing. Replace with the concrete consequence.

> The launch adds file search, highlighting the team's commitment to better workflows.

becomes

> The launch adds file search, so users can find old drafts without leaving the editor.

## Importance puffery

"Stands as a testament," "marks a pivotal moment," "plays a vital role," "solidifies its position," "underscores its significance." State the fact and let the reader judge.

> The launch marks a pivotal moment for the company.

becomes

> The launch is the company's first paid product.

## Weasel attribution

"Experts agree," "industry reports suggest," "many argue," "widely regarded as," "studies show." Name the source or cut the claim. With no source, ask rather than invent one.

## Fake-strong verbs

Prefer "is" and "has" when they are clearer.

> The app serves as a centralized hub for sponsor management.

becomes

> The app tracks sponsors, drafts, due dates, and approvals in one place.

## Synonym cycling

Repeat the clear word. Do not rotate terms for style.

> The agent reviews the draft. The assistant scores the piece. The tool suggests fixes.

becomes

> The agent reviews the draft, scores it, and suggests fixes.

## Negative listing

"Not a X. Not a Y. A Z." Say Z.

## Dramatic fragmentation

"X. And Y. And Z." or "That's it. That's the whole thing." Use complete sentences.

## Robotic rhythm

Repeated sentence shapes, identical paragraph structures, and stacked punchy fragments. Vary the shape only when it helps the point.

## Rhetorical setups

"What if I told you," "Think about it:", "Plot twist:", and self-answered question-answer pairs. Drop them and make the point.

## Fake-profound kickers

Cut the final deep line when it turns the point into a metaphor, aphorism, or mic drop. Delete it and end on the clearest concrete sentence already in the draft. If the ending needs closure, add a plain takeaway or next action.

## Summary-recap endings

"In conclusion," "Ultimately," "Overall," or a closing paragraph that restates the piece. The reader was just there. End on the last concrete point, takeaway, or next action.

</patterns>

<formatting>

Emoji in headings, bold sprinkled mid-sentence, bullet lists where two sentences of prose read better, and headers over two-sentence sections are all decoration. Format follows the content.

Em dashes are not a default rhythm crutch. Use none in short copy. In a longer draft, one or two are fine when they clearly beat commas, periods, or parentheses. Remove clusters and decorative dashes.

</formatting>

<reference>

- [references/tropes.md](references/tropes.md) — the long catalogue from tropes.fyi, with more examples per category

</reference>
