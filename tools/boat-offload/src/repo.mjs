import { isAbsolute, normalize, relative } from "node:path";

const NAME = /^[A-Za-z0-9._-]+$/;
const BRANCH = /^[A-Za-z0-9._/-]+$/;
const REMOTE = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

export function parseGithubRemote(url) {
  const match = REMOTE.exec(url.trim());
  if (!match || !NAME.test(match[1]) || !NAME.test(match[2])) {
    throw new Error("The origin remote must be a GitHub repository. boat-offload clones through the GitHub access Boat provides.");
  }
  return { owner: match[1], repo: match[2] };
}

export function validateBranch(branch) {
  if (!BRANCH.test(branch) || branch.startsWith("-") || branch.includes("..")) {
    throw new Error(`Branch name "${branch}" has characters boat-offload does not pass to a remote shell.`);
  }
  return branch;
}

export function safeRelativePath(root, file) {
  const resolved = isAbsolute(file) ? normalize(file) : normalize(`${root}/${file}`);
  const path = relative(root, resolved);
  if (!path || path.startsWith("..") || isAbsolute(path)) throw new Error(`${file} is outside the repository.`);
  return path;
}

export async function inspectRepo(run, cwd) {
  const git = (args) => run("git", ["-C", cwd, ...args]);
  const top = await git(["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) throw new Error(`${cwd} is not inside a Git repository.`);
  const root = top.stdout.trim();
  const branchResult = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchResult.stdout.trim();
  if (branchResult.code !== 0 || branch === "HEAD") throw new Error("Check out a branch first. A detached HEAD cannot be offloaded.");
  validateBranch(branch);
  const origin = await git(["remote", "get-url", "origin"]);
  if (origin.code !== 0) throw new Error("This repository has no origin remote.");
  const { owner, repo } = parseGithubRemote(origin.stdout);
  const sha = (await git(["rev-parse", "HEAD"])).stdout.trim();
  const status = await git(["status", "--porcelain"]);
  const remote = await git(["ls-remote", "origin", `refs/heads/${branch}`]);
  if (remote.code !== 0) throw new Error("Could not reach origin to compare branches. Check your GitHub access.");
  const remoteSha = remote.stdout.split("\t")[0].trim() || null;
  let pushed = remoteSha === sha;
  if (!pushed && remoteSha) pushed = (await git(["merge-base", "--is-ancestor", sha, remoteSha])).code === 0;
  const name = (await git(["config", "user.name"])).stdout.trim();
  const email = (await git(["config", "user.email"])).stdout.trim();
  return { root, owner, repo, branch, sha, dirty: status.stdout.trim() !== "", remoteBranchExists: Boolean(remoteSha), pushed, name, email };
}
