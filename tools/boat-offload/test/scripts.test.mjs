import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { listeningScript, provisionScript, quote, rexStartScript, tokenPath } from "../src/scripts.mjs";

const base = { owner: "o", repo: "r", branch: "feat/x", gitName: "Name O'Neil", gitEmail: "a@b.c", accounts: [{ id: "one", file: tokenPath("one") }, { id: "two", file: tokenPath("two") }], plan: "max", today: "2026-11-05" };

test("quote neutralizes shell metacharacters", () => {
  const hostile = `a'; touch /tmp/boat-offload-pwned; echo '$(id)`;
  assert.equal(execFileSync("sh", ["-c", `printf %s ${quote(hostile)}`], { encoding: "utf8" }), hostile);
});

test("provision script is valid shell and never contains token values", () => {
  const script = provisionScript(base);
  execFileSync("sh", ["-n"], { input: script });
  assert.match(script, /gh repo clone 'o\/r'/);
  assert.match(script, /npm ci --ignore-scripts/);
  assert.match(script, /git config --global user.name 'Name O'\\''Neil'/);
  assert.doesNotMatch(script, /sk-ant|CLAUDE_CODE_OAUTH_TOKEN/);
});

test("pool configuration references token files, not token values", () => {
  const script = provisionScript(base);
  assert.match(script, /--accounts/);
  assert.match(script, /tokenFile/);
  assert.match(script, /\/home\/user\/\.config\/boat-offload\/claude-one\.token/);
});

test("provision installs dependencies for the pool and extensions, then links the setup", () => {
  const script = provisionScript(base);
  assert.match(script, /dotfiles\/pi\/agent\/packages\/pi-claude-pool/);
  assert.match(script, /dotfiles\/pi\/agent\/extensions/);
  assert.match(script, /node '\/home\/user\/\.local\/share\/boat-offload\/sync-pi\.cjs' --dotfiles/);
  assert.ok(script.indexOf("npm ci") < script.indexOf("sync-pi.cjs"));
});

test("rex start script only listens on loopback and optionally enrolls tailscale then deletes the key", () => {
  const plain = rexStartScript({ tailscale: undefined });
  execFileSync("sh", ["-n"], { input: plain });
  assert.match(plain, /--extra-listen 127\.0\.0\.1:7297 --allow-anonymous/);
  assert.doesNotMatch(plain, /tailscale/);
  const joined = rexStartScript({ tailscale: { hostname: "boat-r-x", keyFile: "/k" } });
  execFileSync("sh", ["-n"], { input: joined });
  assert.match(joined, /tailscale on --hostname 'boat-r-x' --auth-key-file '\/k'/);
  assert.match(joined, /rm -f '\/k'/);
});

test("listening probe is a valid shell command", () => {
  execFileSync("sh", ["-n"], { input: listeningScript(7297) });
});

test("installer failures surface the tail of their output", () => {
  const script = provisionScript(base);
  assert.match(script, /quietly\(\) \{/);
  assert.match(script, /tail -n 8/);
  assert.doesNotMatch(script, /install\.sh \| sudo sh -s -- --tarball >\/dev\/null/);
});
