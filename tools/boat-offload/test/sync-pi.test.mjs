import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { sync } = createRequire(import.meta.url)("../src/remote/sync-pi.cjs");

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sync-pi-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dotfiles = join(root, "dotfiles");
  const home = join(root, "home");
  const agent = join(dotfiles, "pi", "agent");
  mkdirSync(join(agent, "skills", "core", "mine"), { recursive: true });
  mkdirSync(join(agent, "extensions"), { recursive: true });
  mkdirSync(join(dotfiles, "agents"), { recursive: true });
  writeFileSync(join(agent, "AGENTS.md"), "rules");
  writeFileSync(join(agent, "extensions", "footer.ts"), "x");
  writeFileSync(join(agent, "extensions", "rex-markdown.ts"), "x");
  writeFileSync(join(agent, "extensions", "white-logo-header.ts"), "x");
  writeFileSync(join(agent, "settings.json"), JSON.stringify({
    defaultProvider: "openai", defaultModel: "gpt-6.1-sol", theme: "pierre-dark", packages: ["./packages/pi-claude-pool", "npm:thing"],
    enabledModels: ["openai/gpt-6.1-sol", "claude-bridge/claude-opus-5-5", "claude-bridge/claude-sonnet-5-5"],
  }));
  writeFileSync(join(agent, "mcp.json"), JSON.stringify({ mcpServers: { linear: { url: "https://x" } } }));
  mkdirSync(join(home, ".pi", "agent", "skills", "boat"), { recursive: true });
  writeFileSync(join(home, ".pi", "agent", "mcp.json"), JSON.stringify({ mcpServers: { computer: { command: "py" }, linear: { url: "old" } } }));
  writeFileSync(join(home, ".pi", "agent", "settings.json"), JSON.stringify({ packages: ["npm:pi-mcp-extension"] }));
  return { dotfiles, home, agentDir: join(home, ".pi", "agent"), args: { accounts: [{ id: "one", tokenFile: "/t/one" }], plan: "max", today: "2026-11-05" } };
}

const read = (file) => JSON.parse(readFileSync(file, "utf8"));

test("links the dotfiles Pi setup and merges skills without losing Boat's own", (t) => {
  const { dotfiles, home, agentDir, args } = fixture(t);
  assert.deepEqual(sync({ dotfiles, home, ...args }), []);
  assert.equal(readlinkSync(join(agentDir, "AGENTS.md")), join(dotfiles, "pi", "agent", "AGENTS.md"));
  assert.equal(readlinkSync(join(agentDir, "extensions", "footer.ts")), join(dotfiles, "pi", "agent", "extensions", "footer.ts"));
  assert.ok(lstatSync(join(agentDir, "skills", "boat")).isDirectory());
  assert.equal(readlinkSync(join(agentDir, "skills", "core")), join(dotfiles, "pi", "agent", "skills", "core"));
  assert.equal(readlinkSync(join(home, ".agents")), join(dotfiles, "agents"));
});

test("macOS-only extensions are not linked", (t) => {
  const { dotfiles, home, agentDir, args } = fixture(t);
  sync({ dotfiles, home, ...args });
  for (const name of ["rex-markdown.ts", "white-logo-header.ts"]) assert.equal(lstatSync(join(agentDir, "extensions", name), { throwIfNoEntry: false }), undefined);
});

test("settings come from dotfiles but default to the Claude pool only", (t) => {
  const { dotfiles, home, agentDir, args } = fixture(t);
  sync({ dotfiles, home, ...args });
  const settings = read(join(agentDir, "settings.json"));
  assert.equal(settings.theme, "pierre-dark");
  assert.deepEqual(settings.packages, ["./packages/pi-claude-pool", "npm:thing"]);
  assert.equal(settings.defaultProvider, "claude-bridge");
  assert.equal(settings.defaultModel, "claude-sonnet-5-5");
  assert.deepEqual(settings.enabledModels, ["claude-bridge/claude-opus-5-5", "claude-bridge/claude-sonnet-5-5"]);
});

test("mcp servers merge with dotfiles winning and the sandbox's own kept", (t) => {
  const { dotfiles, home, agentDir, args } = fixture(t);
  sync({ dotfiles, home, ...args });
  assert.deepEqual(read(join(agentDir, "mcp.json")).mcpServers, { computer: { command: "py" }, linear: { url: "https://x" } });
});

test("pool and bridge config reference token files and the plan", (t) => {
  const { dotfiles, home, agentDir, args } = fixture(t);
  sync({ dotfiles, home, ...args });
  assert.deepEqual(read(join(agentDir, "claude-pool.json")), { accounts: [{ id: "one", tokenFile: "/t/one" }] });
  assert.deepEqual(read(join(agentDir, "claude-bridge.json")), { startupNoticeShown: "2026-11-05", provider: { plan: "max" } });
});

test("running again replaces links, keeps real files and is idempotent", (t) => {
  const { dotfiles, home, agentDir, args } = fixture(t);
  writeFileSync(join(agentDir, "AGENTS.md"), "vm-owned");
  assert.deepEqual(sync({ dotfiles, home, ...args }), ["AGENTS.md"]);
  assert.equal(readFileSync(join(agentDir, "AGENTS.md"), "utf8"), "vm-owned");
  assert.deepEqual(sync({ dotfiles, home, ...args }), ["AGENTS.md"]);
  assert.equal(readlinkSync(join(agentDir, "extensions", "footer.ts")), join(dotfiles, "pi", "agent", "extensions", "footer.ts"));
});
