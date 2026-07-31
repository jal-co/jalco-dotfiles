import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cloakText, loadState } from "./index.ts";

test("cloaks configured environment values without exposing their length", () => {
  const configPath = join(tmpdir(), `pi-cloak-${process.pid}.json`);
  writeFileSync(configPath, JSON.stringify({ enabled: true, cloakLength: 8, patterns: [{ filePattern: "**/*.env", cloakPattern: "(=).+", replace: "$1" }] }));
  const result = cloakText("API_KEY=super-secret", "/repo/.env", "/repo", loadState(configPath));
  assert.equal(result, "API_KEY=*******");
});

test("leaves unrelated files unchanged", () => {
  const configPath = join(tmpdir(), `pi-cloak-none-${process.pid}.json`);
  writeFileSync(configPath, JSON.stringify({ enabled: true, patterns: [{ filePattern: "**/*.env", cloakPattern: "(=).+", replace: "$1" }] }));
  assert.equal(cloakText("public=true", "/repo/config.txt", "/repo", loadState(configPath)), "public=true");
});
