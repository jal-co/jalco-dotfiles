import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { otherHost, rememberSession, rsyncArgs, savedSessions } from "../session-sync.ts";

const hosts = { hosts: { b1: { ssh: "b1", hostname: "b1" }, mac: { ssh: "me@mac.example", hostname: "my-mac" } } };

test("the other machine is the host that is not this one", () => {
	assert.deepEqual(otherHost(hosts, "b1"), { name: "mac", ssh: "me@mac.example" });
	assert.deepEqual(otherHost(hosts, "My-Mac.local"), { name: "b1", ssh: "b1" });
});

test("an ssh name that could carry options or shell text is refused", () => {
	assert.equal(otherHost({ hosts: { b1: hosts.hosts.b1, mac: { ssh: "-oProxyCommand=x", hostname: "m" } } }, "b1"), undefined);
	assert.equal(otherHost({ hosts: { b1: hosts.hosts.b1, mac: { ssh: "a b;c", hostname: "m" } } }, "b1"), undefined);
	assert.equal(otherHost({ hosts: { b1: hosts.hosts.b1, mac: { ssh: "-v", hostname: "m" } } }, "b1"), undefined);
	assert.equal(otherHost(hosts, "some-laptop"), undefined);
});

test("a session is saved once, and only real session files inside the sessions folder are sent", () => {
	const root = mkdtempSync(join(tmpdir(), "session-sync-"));
	const list = join(root, "state/saved");
	mkdirSync(join(root, "--repo--"));
	const session = join(root, "--repo--/one.jsonl");
	writeFileSync(session, "{}\n");
	assert.equal(rememberSession(session, root, list), "--repo--/one.jsonl");
	rememberSession(session, root, list);
	writeFileSync(list, "--repo--/one.jsonl\n--repo--/one.jsonl\n../../etc/passwd\n--repo--/gone.jsonl\n/abs/x.jsonl\n");
	assert.deepEqual(savedSessions(root, list), ["--repo--/one.jsonl"]);
	assert.deepEqual(rsyncArgs(["--repo--/one.jsonl"], "b1").slice(-3), ["--", "--repo--/one.jsonl", "b1:.pi/agent/sessions/"]);
});
