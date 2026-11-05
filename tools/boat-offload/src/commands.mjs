import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findSecrets, sessionId } from "./session.mjs";
import { hostLabel, offloadKey } from "./state.mjs";
import { REMOTE, gitSummaryScript, listeningScript, prepareScript, provisionScript, quote, rexStartScript, tailscaleLogoutScript, tailscaleOnScript, tailscalePairScript, tailscaleRenameScript, tailscaleStatusScript, tokenPath } from "./scripts.mjs";

export const DOTFILES = join(homedir(), "dotfiles");
const SYNCED_DIRECTORIES = ["pi", "agents", "rex", "tools/anti-slop"];
const IGNORED_BUT_NEEDED = ["tools/anti-slop/package.json", "tools/anti-slop/package-lock.json"];
const SYNC_SCRIPT = fileURLToPath(new URL("./remote/sync-pi.cjs", import.meta.url));
export const ENVIRONMENT = "offload";
export const ALLOWED_HOSTS = "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.on.boat.dev";

export const money = (dollars) => `$${dollars < 0.1 ? dollars.toFixed(3) : dollars.toFixed(2)}`;

export async function costLine(boat, id, hours) {
  const usage = await boat.usage(id);
  if (!usage) return "Cost: unavailable";
  const stop = hours ? ` Stops on its own after ${hours} hour${hours === 1 ? "" : "s"} of lifetime, at most ${money(usage.perHour * hours)} more.` : "";
  return `Cost: ${money(usage.perHour)}/hour while running, ${money(usage.dollars)} so far.${stop}`;
}

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
      await boat.extend(entry.id, options.hours);
      return { ...entry, fresh: false };
    }
    log(`Sandbox ${entry.id} no longer exists; creating a new one`);
  }
  if (await boat.ensureEnvironment(ENVIRONMENT)) log(`Created Boat environment "${ENVIRONMENT}" (GitHub access only; no account secrets, agent logins or Boat credentials)`);
  log(`Creating a ${options.type} sandbox`);
  const created = await boat.create({ name: sandboxName(repo), type: options.type, environment: ENVIRONMENT, hostPorts: [], ttlSeconds: options.hours * 3600 });
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
  log("Copying your Pi setup to ~/dotfiles on the sandbox (tracked and unignored files of pi, agents, rex and tools/anti-slop)");
  for (const directory of SYNCED_DIRECTORIES) await boat.copyDirectory(sandbox.id, join(DOTFILES, directory), `${REMOTE.dotfiles}/${directory}`);
  for (const file of IGNORED_BUT_NEEDED) if (existsSync(join(DOTFILES, file))) await boat.copy(sandbox.id, join(DOTFILES, file), `${REMOTE.dotfiles}/${file}`);
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
  log(await costLine(boat, sandbox.id, options.hours));

  const checkout = `${REMOTE.work}/${repo.repo}`;
  const created = await rex.ensureSession(entry.localPort, repo.repo, checkout, ["pi"]);
  log(created ? `Started Pi in Rex session "${repo.repo}"` : `Rex session "${repo.repo}" already running`);

  if (options.dev) {
    await rex.runBlock(entry.localPort, repo.repo, `export ${ALLOWED_HOSTS}; cd ${quote(checkout)} && ${options.dev}`);
    log(`Started dev command in Rex session "${repo.repo}"`);
  }
  if (options.tailnet !== false) {
    const address = await joinTailnet(deps, entry, { waitSeconds: tailscale ? 60 : 15, intervalMs: options.pollMs });
    if (address) {
      await rex.registerHost(label, entry.localPort, [address]);
      log(`Rex host "${label}" is also reachable on your tailnet at ${address}`);
    } else {
      log("Tailnet access is not set up yet. Sign in with the link above, then run boat-offload phone.");
    }
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
  if (entry.phoneAddress) await deps.rex.registerHost(entry.label, entry.localPort, [entry.phoneAddress]);
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
    const usage = await boat.usage(entry.id);
    if (usage) log(`Total cost of sandbox ${entry.id}: ${money(usage.dollars)}`);
    if (remove) {
      if (entry.phoneAddress && info.state !== "stopped") await boat.exec(entry.id, tailscaleLogoutScript(), { timeoutSeconds: 30 }).catch(() => {});
      await boat.remove(entry.id);
      log(`Deleted sandbox ${entry.id}`);
      if (entry.phoneAddress && deps.tailscale) {
        const removed = await deps.tailscale.removeDevice(entry.phoneAddress).catch((error) => {
          log(`Could not remove the Tailscale device: ${error.message}. Delete it in the Tailscale admin page.`);
          return 0;
        });
        if (removed) log("Removed the sandbox's Tailscale device");
      }
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

const tailnetAddress = (value) => (/^https:\/\/[A-Za-z0-9.-]+$/.test(value?.url ?? "") ? value.url : undefined);

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function joinTailnet(deps, entry, { waitSeconds, intervalMs = 3000 }) {
  const { boat, log } = deps;
  const started = await boat.exec(entry.id, tailscaleOnScript(entry.label), { timeoutSeconds: 60 });
  if (started.code !== 0) throw new Error(`Enabling Tailscale in Rex failed:\n${(started.stderr || started.stdout).trim()}`);
  const deadline = Date.now() + waitSeconds * 1000;
  let announced = false;
  let renamed = false;
  do {
    const status = parseJson((await boat.exec(entry.id, tailscaleStatusScript(), { timeoutSeconds: 30 })).stdout)?.tailscale;
    if (status?.state === "needs_login" && status.auth_url && !announced) {
      log(`Sign in to your tailnet so Rex on your phone can reach this sandbox:\n  ${status.auth_url}`);
      announced = true;
    }
    if (status?.dns_name && !status.dns_name.startsWith(`${entry.label}.`) && !renamed) {
      await boat.exec(entry.id, tailscaleRenameScript(entry.label), { timeoutSeconds: 30 });
      renamed = true;
    }
    const pair = await boat.exec(entry.id, tailscalePairScript(), { timeoutSeconds: 30 });
    const address = pair.code === 0 ? tailnetAddress(parseJson(pair.stdout)) : undefined;
    if (address) {
      entry.phoneAddress = address;
      deps.saveState(deps.state);
      return address;
    }
    if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);
  return undefined;
}

export async function phone(deps, entry, options) {
  const address = await joinTailnet(deps, entry, options);
  if (!address) throw new Error(`Tailscale did not come up within ${options.waitSeconds} seconds. Run boat-offload phone again after signing in.`);
  await deps.rex.registerHost(entry.label, entry.localPort, [address]);
  return address;
}

export async function offloadSession(deps, entry, sessionPath) {
  const { boat, rex, log } = deps;
  const found = findSecrets(sessionPath);
  if (found.length) throw new Error(`${sessionPath} contains text that looks like a credential (${found.length} pattern(s) matched). Remove it or pick another session; nothing was copied.`);
  if (!entry.localPort || !await rex.reachable(entry.localPort)) throw new Error("Rex is not reachable. Run boat-offload attach first.");
  const name = sessionPath.split("/").pop();
  const remote = `${REMOTE.sessions}/${name}`;
  await boat.exec(entry.id, `mkdir -p ${quote(REMOTE.sessions)}`, { timeoutSeconds: 30 });
  await boat.copy(entry.id, sessionPath, remote);
  const label = `${entry.repo}-fork-${sessionId(sessionPath)}`;
  const created = await rex.ensureSession(entry.localPort, label, `${REMOTE.work}/${entry.repo}`, ["pi", "--fork", remote]);
  log(created ? `Forked the session into Rex session "${label}" on the sandbox. The original is untouched.` : `Rex session "${label}" already exists on the sandbox.`);
  return label;
}

export async function overview(deps) {
  const { boat, state, log } = deps;
  const tracked = new Set();
  for (const [key, entry] of Object.entries(state.offloads)) {
    tracked.add(entry.id);
    const info = await boat.info(entry.id);
    const usage = info ? await boat.usage(entry.id) : null;
    const cost = usage ? ` ${money(usage.dollars)} so far, ${money(usage.perHour)}/hour while running` : "";
    const stops = info?.archiveAfter ? `, auto-stops ${new Date(info.archiveAfter).toLocaleTimeString()}` : "";
    log(`${key}  ${entry.id}  ${info ? info.state : "gone"}${stops}\n  rex host ${entry.label}${cost}${entry.previewUrl ? `\n  preview ${entry.previewUrl}` : ""}`);
  }
  if (!tracked.size) log("No offloads.");
  const live = (await boat.list()).filter((sandbox) => !tracked.has(sandbox.id) && !["stopped", "deleted", "archived"].includes(sandbox.state));
  if (live.length) log(`\nNot tracked by boat-offload and still on: ${live.map((sandbox) => `${sandbox.id} (${sandbox.name ?? "unnamed"}, ${sandbox.state})`).join(", ")}. These are billed too.`);
}

export async function extend(deps, entry, hours) {
  await deps.boat.extend(entry.id, hours);
  deps.log(await costLine(deps.boat, entry.id, hours));
}
