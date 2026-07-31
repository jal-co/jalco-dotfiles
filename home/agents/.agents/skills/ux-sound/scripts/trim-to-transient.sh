#!/usr/bin/env bash
# trim-to-transient.sh — turn a raw generation into a shippable UI sound.
#
# ElevenLabs cannot generate below 0.5s, and what comes back is padded
# with silence and a room tail. This finds the first onset, cuts from
# just before it, normalises, and writes mono 44.1kHz mp3 (SKILL.md §3).
#
#   ./trim-to-transient.sh candidate.mp3 public/sfx/click.mp3 0.06
#
# Args: <input> <output> [duration-seconds, default 0.12]
# Diagnostics to stderr; the output path to stdout.

set -euo pipefail

IN="${1:-}"
OUT="${2:-}"
DUR="${3:-0.12}"

if [[ -z "$IN" || -z "$OUT" ]]; then
  echo "usage: trim-to-transient.sh <input> <output> [duration-seconds]" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found — install it (brew install ffmpeg)" >&2
  exit 1
fi

if [[ ! -f "$IN" ]]; then
  echo "not found: $IN" >&2
  exit 1
fi

# First moment the file rises above the noise floor. -45dB catches a
# quiet tick without triggering on encoder noise.
ONSET="$(ffmpeg -hide_banner -i "$IN" -af "silencedetect=noise=-45dB:d=0.02" -f null - 2>&1 \
  | awk '/silence_end/ {print $5; exit}')"

# No detected silence means it starts hot; begin at zero.
if [[ -z "${ONSET:-}" ]]; then
  ONSET=0
  echo "no leading silence detected, cutting from 0" >&2
fi

# Back up 4ms so the attack itself is never clipped. Clipping the
# attack is what makes a click sound like a thud.
START="$(awk -v o="$ONSET" 'BEGIN { s = o - 0.004; if (s < 0) s = 0; printf "%.4f", s }')"
FADE="$(awk -v d="$DUR" 'BEGIN { printf "%.4f", (d > 0.02 ? d - 0.012 : d / 2) }')"

mkdir -p "$(dirname "$OUT")"

# Fade only at the tail: a fade-in would soften the transient, which
# is the entire sound. Compress lightly and limit so short clips reach
# a usable level without clipping.
ffmpeg -v error -y -ss "$START" -t "$DUR" -i "$IN" \
  -af "afade=t=out:st=${FADE}:d=0.012,acompressor=threshold=-24dB:ratio=3:attack=1:release=80:makeup=4,alimiter=limit=0.95" \
  -ac 1 -ar 44100 -b:a 96k "$OUT"

BYTES="$(wc -c < "$OUT" | tr -d ' ')"
echo "onset ${ONSET}s · cut from ${START}s · ${DUR}s · ${BYTES} bytes" >&2
echo "$OUT"
