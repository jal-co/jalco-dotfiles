import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostLabel, offloadKey } from "./state.mjs";
import { REMOTE, gitSummaryScript, listeningScript, prepareScript, provisionScript, quote, rexStartScript, tokenPath } from "./scripts.mjs";

export const DOTFILES = join(homedir(), "dotfiles");
const SYNC_SCRIPT = fileURLToPath(new URL("./remote/sync-pi.cjs", import.meta.url));
export const ENVIRONMENT = "offload";

const sandboxName = ({ repo, branch }) => `${repo}-${branch}`.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 100);

async function waitFor(check, attempts, delayMs) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function ensureSandbox(deps, options, repo, entry) {
  const { boat, log } = deps;
  if (entry) {
    const info = await boat.info(entry.id);
    if (info && !["deleted", "deleting"].includes(info.state)) {
      if (["stopped", "stopping", "archived"].includes(info.state)) {
        log(`Resuming sandbox ${entry.id}`);
        await boat.resume(entry.id);
      }
      return { ...entry, fresh: false };
    }
    log(`Sandbox ${entry.id} no longer exists; creating a new one`);
  }
  if (await boat.ensureEnvironment(ENVIRONMENT)) log(`Created Boat environment "${ENVIRONMENT}" (GitHub access only; no account secrets, agent logins or Boat credentials)`);
  log(`Creating a ${options.type} sandbox`);
  const created = await boat.create({ name: sandboxName(repo), type: options.type, environment: ENVIRONMENT, hostPorts: [] });
  return { id: created.id, url: created.url, fresh: true };
}

async function connect(deps, sandbox, label, entry, tailscale) {
  const { boat, rex, forward, freePort, log } = deps;
  const started = await boat.exec(sandbox.id, rexStartScript({ tailscale }), { timeoutSeconds: 120 });
  if (started.code !== 0) throw new Error(`Starting Rex on the sandbox failed:\n${started.stderr.trim() || started.stdout.trim()}`);
  const listening = await waitFor(async () => (await boat.exec(sandbox.id, listeningScript(REMOTE.rexPort), { timeoutSeconds: 30 })).stdout.includes("listening"), 20, 1000);
  if (!listening) throw new Error("Rex on the sandbox is not listening.");
  let port = entry?.localPort;
  const alive = entry?.forwardPid && port && await forward.isForwarding(entry.forwardPid, sandbox.id);
  let pid = entry?.forwardPid;
  if (!alive) {
    port = await freePort();
    pid = forward.start(sandbox.id, port, REMOTE.rexPort);
  }
  const startedHere = !alive;
  try {
    if (!await rex.waitReachable(port)) throw new Error("Rex is not reachable through the Boat port forward. See ~/.local/state/boat-offload/forward.log.");
    await rex.registerHost(label, port);
  } catch (error) {
    if (startedHere) forward.stop(pid);
    throw error;
  }
  log(`Rex host "${label}" ready at http://127.0.0.1:${port}`);
  return { localPort: port, forwardPid: pid };
}

export async function up(deps, options) {
  const { boat, rex, repoInfo, state, saveState, accounts, log } = deps;
  const repo = await repoInfo();
  if (!repo.remoteBranchExists || !repo.pushed) {
    throw new Error(`Branch ${repo.branch} has commits origin does not have. Push it first (git push -u origin ${repo.branch}); the sandbox clones from GitHub.`);
  }
  if (repo.dirty) log("Warning: uncommitted changes stay on this Mac. Commit and push them if the sandbox needs them.");
  if (!existsSync(join(DOTFILES, "pi", "agent", "packages", "pi-claude-pool", "package.json"))) throw new Error(`pi-claude-pool is missing from ${DOTFILES}.`);

  const key = offloadKey(repo);
  const label = hostLabel(repo);
  const sandbox = await ensureSandbox(deps, options, repo, state.offloads[key]);
  const previous = sandbox.fresh ? undefined : state.offloads[key];
  const entry = {
    id: sandbox.id, url: sandbox.url, repo: repo.repo, owner: repo.owner, branch: repo.branch, label,
    createdAt: previous?.createdAt ?? deps.now(), localPort: previous?.localPort, forwardPid: previous?.forwardPid,
  };
  state.offloads[key] = entry;
  saveState(state);

  log("Preparing the sandbox");
  const prepared = await boat.exec(sandbox.id, prepareScript(), { timeoutSeconds: 60 });
  if (prepared.code !== 0) throw new Error(`Preparing the sandbox failed:\n${prepared.stderr.trim()}`);
  log("Copying your Pi setup (tracked and unignored files of ~/dotfiles/pi and ~/dotfiles/agents)");
  await boat.copyDirectory(sandbox.id, join(DOTFILES, "pi"), `${REMOTE.dotfiles}/pi`);
  await boat.copyDirectory(sandbox.id, join(DOTFILES, "agents"), `${REMOTE.dotfiles}/agents`);
  await boat.copy(sandbox.id, SYNC_SCRIPT, REMOTE.sync);

  const resolved = await accounts.resolve();
  const staged = accounts.stage(resolved);
  try {
    for (const file of staged.files) await boat.copy(sandbox.id, file.path, tokenPath(file.id));
  } finally {
    staged.remove();
  }
  log(`Delivered ${resolved.length} Claude subscription token files (mode 600) to the sandbox`);

  let tailscale;
  if (options.tailscaleKeyRef) {
    const key = await accounts.readSecret(options.tailscaleKeyRef);
    const stagedKey = accounts.stageSecret("tailscale.key", key);
    try {
      tailscale = { hostname: label, keyFile: `${REMOTE.tokens}/tailscale.key` };
      await boat.copy(sandbox.id, stagedKey.path, tailscale.keyFile);
    } finally {
      stagedKey.remove();
    }
  }

  log("Installing Rex and Pi, cloning the repository, linking your Pi setup");
  const provision = await boat.exec(sandbox.id, provisionScript({
    owner: repo.owner, repo: repo.repo, branch: repo.branch, gitName: repo.name, gitEmail: repo.email,
    accounts: resolved.map(({ id }) => ({ id, file: tokenPath(id) })), plan: options.plan, today: deps.today(),
  }), { timeoutSeconds: 900 });
  if (provision.code !== 0) throw new Error(`Provisioning failed:\n${(provision.stderr || provision.stdout).trim().split("\n").slice(-12).join("\n")}`);

  const connection = await connect(deps, sandbox, label, entry, tailscale);
  Object.assign(entry, connection);
  saveState(state);

  const checkout = `${REMOTE.work}/${repo.repo}`;
  const created = await rex.ensureSession(entry.localPort, repo.repo, checkout, ["pi"]);
  log(created ? `Started Pi in Rex session "${repo.repo}"` : `Rex session "${repo.repo}" already running`);

  if (options.dev) {
    await rex.runBlock(entry.localPort, repo.repo, `cd ${quote(checkout)} && ${options.dev}`);
    log(`Started dev command in Rex session "${repo.repo}"`);
  }
  if (options.preview) entry.previewUrl = await boat.host(sandbox.id, options.preview);
  saveState(state);
  return entry;
}

export async function attach(deps, entry) {
  const { boat, saveState, state } = deps;
  const info = await boat.info(entry.id);
  if (!info) throw new Error(`Sandbox ${entry.id} no longer exists. Run boat-offload up from the repository to create a new one.`);
  if (["stopped", "stopping", "archived"].includes(info.state)) await boat.resume(entry.id);
  Object.assign(entry, await connect(deps, entry, entry.label, entry, undefined));
  saveState(state);
  return entry;
}

export async function preview(deps, entry, port) {
  const url = await deps.boat.host(entry.id, port);
  entry.previewUrl = url;
  deps.saveState(deps.state);
  return url;
}

export async function down(deps, key, entry, { remove }) {
  const { boat, rex, forward, saveState, state, log } = deps;
  forward.stop(entry.forwardPid);
  if (entry.label) await rex.removeHost(entry.label);
  const info = await boat.info(entry.id);
  if (info) {
    if (remove) {
      await boat.remove(entry.id);
      log(`Deleted sandbox ${entry.id}`);
    } else if (!["stopped", "stopping"].includes(info.state)) {
      await boat.stop(entry.id);
      log(`Stopped sandbox ${entry.id}. Data is kept for 14 days; run boat-offload up to resume.`);
    }
  }
  if (remove || !info) delete state.offloads[key];
  else Object.assign(entry, { forwardPid: undefined, localPort: undefined, previewUrl: undefined });
  saveState(state);
}

export async function summary(deps, entry) {
  const result = await deps.boat.exec(entry.id, gitSummaryScript(entry.repo), { timeoutSeconds: 30 });
  return result.code === 0 ? result.stdout.trim() : "";
}
