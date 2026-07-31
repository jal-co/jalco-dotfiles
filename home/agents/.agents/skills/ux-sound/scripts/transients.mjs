#!/usr/bin/env node
/**
 * transients.mjs — list the transient times in an audio file, in ms.
 *
 * These are the numbers that become animation keyframes (SKILL.md §7).
 * Prints a table to stdout and CSS-ready percentages when --duration is
 * given. Diagnostics go to stderr so stdout stays machine-readable.
 *
 *   node transients.mjs strike.mp3
 *   node transients.mjs strike.mp3 --threshold 2.5 --floor 0.06
 *   node transients.mjs strike.mp3 --keyframes
 *
 * Requires ffmpeg for anything that isn't a 16-bit PCM .wav.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const has = (name) => args.includes(`--${name}`);

if (!file) {
  console.error("usage: transients.mjs <audio> [--threshold 2] [--floor 0.05] [--keyframes]");
  process.exit(1);
}
if (!existsSync(file)) {
  console.error(`not found: ${file}`);
  process.exit(1);
}

/* Rise over the local baseline that counts as an onset. Lower catches
   more of the small re-strikes; higher keeps only the hits. */
const THRESHOLD = flag("threshold", 2);
/* Absolute floor, so noise between events doesn't register. */
const FLOOR = flag("floor", 0.05);
/* 4ms windows: short enough to place a click, long enough not to fire
   on single samples. */
const WINDOW_MS = 4;
const SR = 44100;

const raw = join(tmpdir(), `transients-${process.pid}.f32`);
const cleanup = () => {
  try {
    if (existsSync(raw)) unlinkSync(raw);
  } catch {}
};
process.on("exit", cleanup);

const ff = spawnSync(
  "ffmpeg",
  ["-v", "error", "-y", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", raw],
  { encoding: "utf8" },
);

if (ff.error) {
  console.error("ffmpeg not found — install it, or pass a mono 44.1kHz f32 raw file");
  process.exit(1);
}
if (ff.status !== 0) {
  console.error(ff.stderr.trim() || "ffmpeg failed");
  process.exit(1);
}

const buf = readFileSync(raw);
const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
const win = Math.round((SR * WINDOW_MS) / 1000);

const envelope = [];
for (let i = 0; i < samples.length; i += win) {
  let peak = 0;
  for (let j = i; j < Math.min(i + win, samples.length); j++) {
    peak = Math.max(peak, Math.abs(samples[j]));
  }
  envelope.push(peak);
}

const onsets = [];
for (let i = 2; i < envelope.length; i++) {
  const baseline = Math.max(envelope[i - 1], envelope[i - 2]);
  if (envelope[i] > FLOOR && envelope[i] > baseline * THRESHOLD) {
    onsets.push({
      ms: Math.round((i * win * 1000) / SR),
      amp: Number(envelope[i].toFixed(3)),
    });
  }
}

const durationMs = Math.round((samples.length * 1000) / SR);
const peak = Math.max(...envelope);
const peakDbfs = (20 * Math.log10(peak + 1e-12)).toFixed(1);

console.error(`duration ${durationMs}ms · peak ${peak.toFixed(3)} (${peakDbfs} dBFS) · ${onsets.length} transients`);

if (has("keyframes")) {
  /* Percentages against the clip length: paste straight into a
     @keyframes block whose animation-duration is the clip length. */
  for (const { ms, amp } of onsets) {
    const pct = ((ms / durationMs) * 100).toFixed(1);
    console.log(`  ${pct}% { /* ${ms}ms · amp ${amp} */ }`);
  }
} else {
  console.log(JSON.stringify({ durationMs, peak, peakDbfs: Number(peakDbfs), onsets }, null, 2));
}
