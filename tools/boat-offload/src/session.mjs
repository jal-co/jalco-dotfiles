import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /ops_[A-Za-z0-9]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /tskey-[A-Za-z0-9-]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{10,}\./,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:\\n|\\r|\s)*[A-Za-z0-9+/=]{40,}/,
];

export const sessionDirectory = (cwd, agentDir = join(homedir(), ".pi", "agent")) =>
  join(agentDir, "sessions", `--${cwd.replace(/^\//, "").replace(/[/:\\]/g, "-")}--`);

export function newestSession(directory) {
  let newest;
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".jsonl")) continue;
    const modified = statSync(join(directory, name)).mtimeMs;
    if (!newest || modified > newest.modified) newest = { path: join(directory, name), modified };
  }
  if (!newest) throw new Error(`No Pi sessions found in ${directory}.`);
  return newest.path;
}

export function findSecrets(path) {
  const text = readFileSync(path, "utf8");
  return SECRET_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

export const sessionId = (path) => /_([0-9a-f-]{8})[0-9a-f-]*\.jsonl$/.exec(basename(path))?.[1] ?? "fork";
