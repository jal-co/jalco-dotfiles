import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const tryGit = (cwd, args) => { try { return git(cwd, args); } catch { return null; } };

const report = JSON.parse(readFileSync(0, "utf8"));
const cache = new Map();

const changedFor = (file) => {
  const cwd = dirname(file);
  const root = tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return null;
  if (!cache.has(root)) {
    const candidates = [process.env.ANTI_SLOP_BASE, "origin/HEAD", "origin/main", "origin/master"].filter(Boolean);
    const base = candidates.map((ref) => tryGit(root, ["merge-base", "HEAD", ref])).find(Boolean) ?? "HEAD";
    const untracked = new Set(git(root, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean).map((f) => resolve(root, f)));
    const ranges = new Map();
    let current = null;
    for (const line of git(root, ["diff", "-U0", "--no-color", "--no-ext-diff", base, "--"]).split("\n")) {
      if (line.startsWith("+++ ")) {
        current = line.startsWith("+++ b/") ? resolve(root, line.slice(6)) : null;
        if (current) ranges.set(current, []);
      } else if (current && line.startsWith("@@")) {
        const m = /\+(\d+)(?:,(\d+))?/.exec(line);
        const start = Number(m[1]);
        const count = m[2] === undefined ? 1 : Number(m[2]);
        if (count > 0) ranges.get(current).push([start, start + count - 1]);
      }
    }
    cache.set(root, { untracked, ranges });
  }
  const { untracked, ranges } = cache.get(root);
  const abs = resolve(file);
  if (untracked.has(abs)) return "all";
  return ranges.get(abs) ?? [];
};

const kept = report.diagnostics.filter((d) => {
  const changed = changedFor(resolve(d.filename));
  if (changed === null || changed === "all") return true;
  const line = d.labels?.[0]?.span?.line;
  return line !== undefined && changed.some(([a, b]) => line >= a && line <= b);
});

for (const d of kept) {
  const span = d.labels?.[0]?.span ?? {};
  console.log(`${d.filename}:${span.line ?? 0}:${span.column ?? 0} ${d.severity} ${d.code}\n  ${d.message}`);
}
console.log(`anti-slop: ${kept.length} finding(s) on changed lines (${report.diagnostics.length - kept.length} on unchanged lines ignored)`);
process.exit(kept.some((d) => d.severity === "error") ? 1 : 0);
