import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const POOL_CONFIG = join(homedir(), "dotfiles", "pi", "agent", "packages", "pi-claude-pool", "config.ts");

async function loadPool() {
  try {
    return await import(pathToFileURL(POOL_CONFIG).href);
  } catch {
    throw new Error("The pi-claude-pool package is not installed here. Run npm ci --ignore-scripts --legacy-peer-deps in pi/agent/packages/pi-claude-pool.");
  }
}

export function stageFiles(entries) {
  const directory = mkdtempSync(join(tmpdir(), "boat-offload-"));
  chmodSync(directory, 0o700);
  const files = entries.map(({ name, content }) => {
    const path = join(directory, name);
    writeFileSync(path, content, { mode: 0o600 });
    return { name, path };
  });
  return { files, remove: () => rmSync(directory, { recursive: true, force: true }) };
}

export function createAccounts(configPath = join(homedir(), ".pi", "agent", "claude-pool.json")) {
  let reader;
  const pool = async () => {
    const module = await loadPool();
    reader ??= module.createOpReader();
    return module;
  };
  return {
    async resolve() {
      const module = await pool();
      return module.resolveAccounts(module.readSources(configPath), process.env, reader);
    },
    stage: (accounts) => {
      const staged = stageFiles(accounts.map(({ id, token }) => ({ name: `claude-${id}.token`, content: token })));
      return { files: staged.files.map((file, index) => ({ id: accounts[index].id, path: file.path })), remove: staged.remove };
    },
    async readSecret(reference) {
      await pool();
      return (await reader(reference)).trim();
    },
    stageSecret(name, content) {
      const staged = stageFiles([{ name, content }]);
      return { path: staged.files[0].path, remove: staged.remove };
    },
  };
}
