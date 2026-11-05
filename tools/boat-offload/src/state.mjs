import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function defaultStatePath(home = homedir()) {
  return join(home, ".local", "state", "boat-offload", "state.json");
}

export function loadState(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { offloads: {} };
    throw error;
  }
  const state = JSON.parse(text);
  if (!Object.hasOwn(state, "offloads") || state.offloads === null || Array.isArray(state.offloads)) throw new Error(`${path} is not a boat-offload state file`);
  return state;
}

export function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

export const offloadKey = ({ owner, repo, branch }) => `${owner}/${repo}#${branch}`;

export const hostLabel = ({ repo, branch }) =>
  `boat-${repo}-${branch}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/-$/, "").slice(0, 48);
