import assert from "node:assert/strict";
import test from "node:test";
import { redact, touchesSensitivePath } from "../lib/redact.ts";
import { makeSpan } from "../mastra-traces.ts";

const cases: [string, string][] = [
	["key sk_w" + "abcdefghijklmnopqrstuvwx1234", "sk_w"],
	["sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv", "sk-ant"],
	["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "ghp_"],
	["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def", "eyJ"],
	["Authorization: Bearer abcdef1234567890xyz", "abcdef1234567890xyz"],
	["AWS AKIAIOSFODNN7EXAMPLE here", "AKIAIOSFODNN7EXAMPLE"],
	["mail me at jane.doe+x@example.co.uk now", "jane.doe"],
	["DATABASE_PASSWORD=hunter2hunter2", "hunter2"],
	['{"apiKey": "plainvalue99"}', "plainvalue99"],
	["-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----", "MIIEvQ"],
	["blob aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5hJ7kL9", "aB3dE5gH7jK9"],
];

for (const [input, leaked] of cases) {
	test(`redacts ${leaked.slice(0, 12)}`, () => {
		assert.ok(!redact(input).includes(leaked), redact(input));
	});
}

test("ordinary text, paths, commit hashes and uuids are untouched", () => {
	const text = "git show 43acad9f1eb88d0123456789abcdef0123456789 in /Users/justin/dotfiles/pi/agent/extensions/mastra-traces.ts id ce391ea5-0269-4319-a7c2-f221538ec6ae";
	assert.equal(redact(text), text);
});

test("sensitive paths are recognised, ordinary ones are not", () => {
	for (const path of ["cat .env", "/Users/j/.ssh/id_rsa", "read ~/.config/mastra-observability/access-token", "server.pem", "auth.json", "cat .env.local"]) assert.ok(touchesSensitivePath(path), path);
	for (const path of ["src/environment.ts", "cat README.md", "ls node_modules/envify"]) assert.ok(!touchesSensitivePath(path), path);
});

test("spans are redacted before they are clipped, so a cut secret cannot leak", () => {
	const secret = ["sk_w", "abcdefghijklmnopqrstuvwx1234"].join("");
	const span = makeSpan({
		traceId: "a".repeat(32), name: "x", type: "tool_call", start: 1, end: 2, content: "previews",
		metadata: { sessionId: "s", repo: "r", host: "h", rexAgent: false },
		input: `${"x".repeat(90)} ${secret}`, output: secret, error: `failed with ${secret}`,
	});
	const sent = JSON.stringify(span);
	assert.ok(!sent.includes("sk_w"), sent);
});
