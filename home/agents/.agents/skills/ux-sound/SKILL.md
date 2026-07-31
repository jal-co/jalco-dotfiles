---
name: ux-sound
description: "Decide whether an interface element should make a sound, which kind, how loud, and where the audio comes from (synthesis, recording, or ElevenLabs generation). Use when adding sound to a UI, choosing between synthesizing and sampling, levelling sounds against each other, syncing audio to animation, or auditing an existing sound layer. Triggers on: ui sound, ux sound, sonic ux, audio feedback, micro feedback, earcon, auditory icon, notification sound, alert sound, hover sound, click sound, sound effect, sfx, should this have sound, too loud, sounds cheap, sound doesn't fire, elevenlabs, sound generation."
license: MIT
metadata:
  author: jal-co
  version: "1.0.0"
---

# UX Sound

Sound design for interfaces. This skill decides **whether, what, how loud, and from where**. For the Web Audio mechanics of building a specific sound (oscillators, envelopes, filters, recipes), use the `ui-sound-design` skill alongside this one.

The distinction that organizes everything below:

- **UX sound** — the purpose and behaviour principles. Why, when, and where a sound exists at all.
- **UI sound** — the specific artifact attached to a specific element. What it is.

Most bad interface audio is a UI sound problem caused by skipping the UX sound question.

## 1. Should this element make a sound?

Walk this before writing any audio code. Most elements exit at the first branch.

```
Does the sound carry information the user cannot already see?
├── No
│   ├── Is the element the product's signature moment (one per product)?
│   │   ├── Yes → sound allowed, budget it against the one-per-product rule
│   │   └── No  → NO SOUND. Stop here.
│   └──
└── Yes
    ├── Did the user initiate this?
    │   ├── Yes → ACTIVE sound (micro feedback). Fires on their action.
    │   └── No  → PASSIVE sound (notification). System-initiated.
    └── Does it need intervention within seconds?
        ├── Yes → ALERT. Escalation level 3.
        └── No  → level 1 or 2 (see §4).
```

**Always** delete decorative sound that survives this tree by accident. A sound that does not inform is a sound the user will turn off, and they cannot turn off yours specifically — they turn off the tab.

**Never** play sound on page load, route change, or scroll. None of those are user-initiated at the moment they occur, and the browser will block them anyway (§6).

## 2. Which type

| Type | Trigger | Length | Use when |
|---|---|---|---|
| Micro feedback | User action | 10–120ms | Confirming a tap, toggle, send, copy |
| Earcon | Either | 200–600ms | An abstract motif that *means* something by convention (brand-owned) |
| Auditory icon | Either | 100–800ms | A recorded real-world sound whose source explains it (paper, camera, trash) |
| Notification | System | 300–900ms | New message, job finished, state changed |
| Identification | App start | 800–2500ms | Once per session, maximum |
| Alert | System | 400–1200ms | Requires intervention now |

**Earcon vs auditory icon** decides your sourcing route in §3. An earcon is learned, so it can be synthesized freely. An auditory icon claims to be a real object, so listeners hold it to a physical standard and synthesis usually loses (§3).

**Implicit vs explicit:** implicit sounds (touch feedback, indicators) must be quiet enough to be felt rather than heard. Explicit sounds (ringtone, alert) are meant to be noticed across a room. Never level them the same way.

## 3. Where the audio comes from

Three routes. Choose by measuring, not by taste.

```
Run the analyzer first:
  node <ui-sound-design skill>/tools/analyze-sound.mjs reference.mp3

Is noise_percent > 80% AND fewer than 4 harmonics?
├── Yes → SYNTHESIZE. It is filtered noise; a file adds bytes and buys nothing.
└── No
    ├── Does the sound need to last an unknown duration (hover, hold, drag)?
    │   ├── Yes, and it never changes with UI state
    │   │   → SYNTHESIZE, or generate with `loop: true` and play it looped.
    │   └── Yes, and it must react to state (dim as a light dims, tighten
    │       as a value rises)
    │       → SYNTHESIZE. A loop is a fixed recording; you cannot modulate
    │         its level or timbre from the interface without it sounding
    │         like a fader on a tape.
    └── Is it an auditory icon (claims to be a real object)?
        ├── Yes → RECORD or GENERATE. See the rule below.
        └── No  → SYNTHESIZE.
```

**The rule that costs the most time if ignored:** a real recording of a physical object beats a synthesis of it, even a synthesis built from the recording's own measured envelope and spectrum. Physical objects carry instability that survives being described accurately. Budget one attempt at synthesizing an auditory icon; if it loses the A/B against the reference, ship the recording and stop.

**Never layer synthesized transients on top of a recording of the same event.** The recording already contains them, and every tick doubles.

### Generating with ElevenLabs

**The user must set `ELEVENLABS_API_KEY` themselves.** The SDK reads it from the
environment with no arguments. Never hardcode it, never write it into a file,
never echo it. If it is missing, stop and ask:

```bash
[ -n "$ELEVENLABS_API_KEY" ] || echo "Set ELEVENLABS_API_KEY (elevenlabs.io/app/settings/api-keys)"
```

Install the official skill; it tracks the API:

```bash
npx skills add elevenlabs/skills --skill sound-effects
```

JavaScript — use `@elevenlabs/*` packages only:

```javascript
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createWriteStream } from "fs";

const client = new ElevenLabsClient(); // reads ELEVENLABS_API_KEY
const audio = await client.textToSoundEffects.convert({
  text: "single dry mechanical latch click, close mic, no room",
  duration_seconds: 0.5,
  prompt_influence: 0.8,
});
audio.pipe(createWriteStream("/tmp/candidate.mp3"));
```

Python:

```python
from elevenlabs import ElevenLabs

client = ElevenLabs()  # reads ELEVENLABS_API_KEY
audio = client.text_to_sound_effects.convert(
    text="single dry mechanical latch click, close mic, no room",
    duration_seconds=0.5,
    prompt_influence=0.8,
)
with open("/tmp/candidate.mp3", "wb") as f:
    for chunk in audio:
        f.write(chunk)
```

| Param | Range | Set it to |
|---|---|---|
| `duration_seconds` | 0.5–30, null = auto | Always set it. Auto picks a length for video, not for a button |
| `prompt_influence` | 0–1, default 0.3 | **0.8** for UI sound. The default is loose enough to wander off a short, specific brief |
| `loop` | boolean, v2 only | `true` only for continuous beds (§3 tree) |
| `output_format` | query param or SDK arg | `mp3_44100_128`. `pcm_44100` is pointless once you trim to 60ms |

Errors: `401` bad key, `422` out-of-range params (check duration and
prompt_influence), `429` rate limited — back off, do not retry in a loop.

**The 0.5s floor shapes this whole route.** Micro feedback is 10–120ms and the
API will not go below 500ms. Generation is therefore always two steps: generate,
then find the transient and cut.

```bash
scripts/trim-to-transient.sh /tmp/candidate.mp3 public/sfx/click.mp3 0.06
```

It finds the onset, cuts 4ms before it so the attack is never clipped,
compresses and limits, and writes mono 44.1kHz. Clipping the attack is what
turns a click into a thud.

**Never ship the raw generation.** It arrives padded with silence and a room
tail, at a length chosen for video.

### Prompting for an animated element

If the element animates, the sound and the animation are one event, and the
prompt is where that starts. Put the storyboard in the text.

```
Storyboard the beats first:
  strike → flicker ×3 → settle
  0ms      90-300ms     by 700ms

Then prompt the structure, not just the object:
  "fluorescent tube striking on: one sharp electrical crack, then three
   unstable flickers within the next 300ms, settling to a steady hum by
   700ms. Close mic, dry, no room."

And set duration_seconds to the animation's total length.
```

**Always name the beats and their timing in the prompt.** A generator asked for
"a fluorescent light" returns an unstructured 3-second wash you cannot animate
to. Asked for the rhythm, it returns something with transients where you need
them.

**Then invert the authority: once generated, the audio is the source of truth.**
Measure where the transients actually landed and re-time the animation to them
(§7). The prompt is how you ask for a shape; the waveform is what you got.

Prompt rules, because generators default to cinematic:

- **Always** name mic distance and room ("close mic, dry, no reverb"). Interface sounds have no room.
- **Always** say "single" or "one" for micro feedback. Generators love giving you a sequence.
- **Never** use emotional adjectives ("satisfying", "premium"). Name the object and material: "small metal latch", "thin plastic tab", "paper edge".
- Generate 3 candidates per prompt and analyze all three. Pick by measurement, not by first impression.

## 4. Levels

Level by **measured dBFS peak**, never by gain number. Gain values are not comparable across sources: `0.05` on a synthesized 12ms burst and `0.5` on a normalized 700ms sample can be 30dB apart in perceived loudness.

Measure by rendering through an `OfflineAudioContext` with the real signal chain and comparing peaks:

```js
const peak = (buf) => {
  const d = buf.getChannelData(0);
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  return 20 * Math.log10(m + 1e-12);
};
```

Escalation ladder. Each step is a target peak, and the gaps are what make escalation legible:

| Level | Class | Target peak |
|---|---|---|
| 0 | Continuous (hum, drone, hold) | −40 dBFS |
| 1 | Implicit micro feedback (hover) | −38 dBFS |
| 1 | Explicit micro feedback (press, send) | −27 dBFS |
| 2 | Notification | −20 dBFS |
| 3 | Alert | −12 dBFS |

**Continuous sounds sit below every transient**, because they are present the whole time the user is reading. A drone at the level of a click is unbearable within ten seconds.

**A deliberate gesture may sit up to 9dB above the ambient one it accompanies, never more.** Beyond that the two stop reading as the same instrument and the louder one feels like a different app.

## 5. Personality

Pick one per product and write it down. It resolves every later argument about whether a sound is "too much".

- **The butler** — discreet, never speaks first. Only ever confirms what the user did. Micro feedback only, level 1 maximum, no notifications without an explicit setting.
- **The buddy** — offers help. Notifications allowed, warmer timbres, wider pitch variation.

The personality sets the default answer for §1's first branch. A butler product answers "no sound" far more often than a buddy product.

## 6. Implementation rules

These are failure modes, each of which will cost an hour if rediscovered.

**Arm the gesture unlock at module import, not on first use.** An `AudioContext` starts suspended and only a real gesture resumes it. Hovering is not a gesture. If the unlock listener is installed lazily on first hover, a user who loads the page and moves the mouse never unlocks anything and nothing ever plays.

```js
if (typeof window !== "undefined") {
  document.addEventListener("pointerdown", unlock);
  document.addEventListener("keydown", unlock);
}
```

**Decode every clip on the unlock gesture, not on first hover.** A clip that starts loading when it is needed is silent the first time it is needed. Every clip added later must be added to this prefetch — this is the single most repeated bug in sound layers.

**Check readiness before spending the retrigger guard.** Guard order matters:

```js
if (!ctx || !buffer) { prime(); return; }   // bail without spending it
if (!allowed(key, minGapMs)) return;         // now spend it
```

Reversed, the first hover (which can only ever start the fetch) also blocks the next one.

**Always debounce identical sounds by 90ms minimum.** `pointerenter` fires again as the pointer crosses child elements inside one row, so one visual hover becomes two plays. For sounds longer than 300ms, debounce by the sound's own length instead.

**Hover sounds are mouse-only.** `if (event.pointerType !== "mouse") return;` — a coarse pointer has no hover, so on touch the hover sound fires on the tap that also navigates.

**Never ramp gain to 0.** `exponentialRampToValueAtTime(0)` throws. Ramp to `0.0001`.

**Stop and disconnect long-lived nodes.** Oscillators for a continuous sound must be `stop()`ed and their gain node `disconnect()`ed after the fade, or they accumulate on every hover.

**Re-entry must not stack.** A continuous sound needs a singleton guard (`if (running) return`), or three hovers create three drones.

## 7. Syncing sound to animation

Sound and animation are one event. The authority passes between them in one
direction, and going the other way costs you the sound.

```
1. STORYBOARD    Write the beats and their times before either exists.
                   strike 0ms → flicker ×3 by 300ms → settle by 700ms

2. PROMPT        Put that rhythm in the generation prompt (§3), and set
                 duration_seconds to the total.

3. MEASURE       scripts/transients.mjs clip.mp3 --keyframes
                 Prints each transient as a keyframe percentage of the
                 clip length, ready to paste.

4. RE-TIME       Convert those milliseconds to keyframe percentages and
                 replace the animation's timings with them. Set the
                 animation duration to the clip length exactly.
```

**Step 4 is not optional and it always overrides step 1.** The generator will
not hit your storyboard precisely, and a 40ms drift between a flicker and its
tick is audible as wrongness even though nobody can name it. The waveform wins.

**Never re-time the audio to fit an existing animation.** Stretching changes
pitch, trimming cuts the tail, and both are irreversible. Keyframe percentages
are free to move; recordings are not. If the animation is already built, treat
its beats as the storyboard for step 1 and regenerate.

**A flicker with no tick reads as a CSS animation. A tick with no flicker reads
as a glitch.** Both halves come from the same table of measured times, so keep
that table in one file and derive both from it.

## 8. Verification

Never claim a sound works without one of these:

- **Did it play?** Patch `createBufferSource`/`createOscillator` and count `start()` calls. Console silence is not evidence.
- **How loud, in dBFS?** Render offline and measure. "Sounds about right" is not a level.
- **Does it double?** Fire the trigger three times in 200ms and assert the play count is 1.
- **A/B against the reference.** Build a preview page with both, 400ms apart, before defending a synthesis.

Synthetic `pointerover` events dispatched by test harnesses frequently do not reach React's `onPointerEnter`. Call the handler directly through the element's react props when verifying, or you will chase a bug that does not exist.

## Scripts

| Script | Does |
|---|---|
| `scripts/transients.mjs` | Lists transient times in ms, or `--keyframes` for CSS percentages. Also prints peak dBFS for §4 levelling |
| `scripts/trim-to-transient.sh` | Turns a raw generation into a shippable UI sound: onset detection, 4ms pre-roll, compress, limit, mono 44.1kHz |

Both degrade with a message if `ffmpeg` is missing.

## Checklist

- [ ] Every sound survives §1's tree; decorative ones deleted
- [ ] Type chosen from §2; implicit and explicit levelled differently
- [ ] Route chosen by analyzer output, not preference
- [ ] No synthesized transients layered over a recording of the same event
- [ ] Levels set by measured dBFS peak against the §4 ladder
- [ ] Continuous sounds below every transient sound
- [ ] Unlock armed at import; every clip decoded on first gesture
- [ ] Readiness checked before the retrigger guard is spent
- [ ] Hover sounds mouse-only; identical sounds debounced ≥90ms
- [ ] Continuous sounds are singletons and disconnect on stop
- [ ] `ELEVENLABS_API_KEY` set by the user, never hardcoded
- [ ] Generation prompt names the beats and their timings, not just the object
- [ ] Raw generations trimmed to the transient before shipping
- [ ] Animation keyframes derived from measured audio transients, not the reverse
- [ ] Playback verified by counting `start()` calls, not by absence of errors
