import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { browserArguments, browserEnvironment, createTickets, readTicket, resolveMarkdownPath, rewriteMarkdown } from "./bridge.mjs";

const require = createRequire(new URL("../../pi/agent/extensions/rex-markdown.ts", import.meta.url));
const { lexer } = createRequire(require.resolve("@earendil-works/pi-tui"))("marked");
const context = { session: "session:1234-abcd", block: "block:5678-abcd", server: "unix:///tmp/rex.sock" };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "rex-markdown-"));
  const file = join(directory, "Review 🐕 (draft).md");
  writeFileSync(file, "# A review\n");
  t.after(() => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        for (const child of readdirSync(path)) unlinkSync(join(path, child));
        rmdirSync(path);
      } else unlinkSync(path);
    }
    rmdirSync(directory);
  });
  return { directory, file };
}

test("resolve relative, absolute, escaped, encoded, and file-URL Markdown paths", (t) => {
  const { directory, file } = fixture(t);
  const name = "Review 🐕 (draft).md";
  for (const href of [name, name.replaceAll("(", "\\(").replaceAll(")", "\\)"), encodeURIComponent(name), file, pathToFileURL(file).href, `${encodeURIComponent(name)}#notes`, `${encodeURIComponent(name)}?view=1`]) {
    assert.equal(resolveMarkdownPath(href, directory), file, href);
  }
});

test("repair a leading slash only when the absolute target is missing", (t) => {
  const { directory } = fixture(t);
  mkdirSync(join(directory, ".reviews"));
  const target = join(directory, ".reviews", "report.md");
  writeFileSync(target, "# Report");
  assert.equal(resolveMarkdownPath("/.reviews/report.md", directory), target);
  assert.equal(resolveMarkdownPath(target, "/"), target);
});

test("leave remote, missing, malformed, non-Markdown, and directory targets alone", (t) => {
  const { directory } = fixture(t);
  mkdirSync(join(directory, "folder.md"));
  writeFileSync(join(directory, "not-md.txt"), "text");
  for (const href of ["https://example.com/a.md", "http://localhost/a.md", "//example.com/a.md", "file://remote/a.md", "rex-md://open/foo", "missing.md", "bad%xx.md", "folder.md", "not-md.txt", "#section"]) {
    assert.equal(resolveMarkdownPath(href, directory), undefined, href);
  }
});

test("rewrite inline and reference links while preserving text, titles, and web links", () => {
  const source = '[**Review**](<file with spaces.md> "draft") and [web](https://example.com/a.md).\n\n[ref][report]\n\n[report]: a.md\n';
  const result = rewriteMarkdown(source, lexer(source), (href) => href.startsWith("https:") ? undefined : "rex-md://open/test");
  assert.equal(result, '[**Review**](rex-md://open/test "draft") and [web](https://example.com/a.md).\n\n[ref](rex-md://open/test)\n\n[report]: a.md\n');
});

test("rewrite links in headings, lists, blockquotes, and tables", () => {
  const source = "# [a](a.md)\n\n- **[b](b.md)**\n\n> [c](c.md)\n\n| name |\n| --- |\n| [d](d.md) |\n";
  const result = rewriteMarkdown(source, lexer(source), () => "rex-md://open/test");
  assert.equal((result.match(/rex-md:\/\/open\/test/g) ?? []).length, 4);
});

test("do not rewrite code, images, HTML blocks, or an unfinished streamed link", () => {
  for (const source of ["`[a](a.md)`", "```md\n[a](a.md)\n```", "    [a](a.md)\n", "![a](a.md)", "<pre>\n[a](a.md)\n</pre>\n", "[a](a.md"]) {
    assert.equal(rewriteMarkdown(source, lexer(source), () => "rex-md://open/test"), source);
  }
  const source = "`[a](a.md)` and [a](a.md)";
  assert.equal(rewriteMarkdown(source, lexer(source), () => "rex-md://open/test"), "`[a](a.md)` and [a](rex-md://open/test)");
});

test("preserve multiline quote and list prefixes without rewriting their code examples", () => {
  for (const prefix of ["> ", "- ", "- [ ] "]) {
    const continuation = prefix.startsWith(">") ? "> " : "  ";
    const source = `${prefix}First line\n${continuation}[link](a.md)\n`;
    assert.equal(rewriteMarkdown(source, lexer(source), () => "rex-md://open/test"), source.replace("[link](a.md)", "[link](rex-md://open/test)"));
    const code = `${prefix}First line\n${continuation}\n${continuation}\`\`\`md\n${continuation}[link](a.md)\n${continuation}\`\`\`\n${continuation}\n${continuation}[link](a.md)\n`;
    const result = rewriteMarkdown(code, lexer(code), () => "rex-md://open/test");
    const last = code.lastIndexOf("[link](a.md)");
    assert.equal(result, code.slice(0, last) + code.slice(last).replace("[link](a.md)", "[link](rex-md://open/test)"));
  }
});

test("ticket URLs are opaque, stable per file, private, and revoked on close", (t) => {
  const { directory, file } = fixture(t);
  const registry = join(directory, "tickets");
  const tickets = createTickets(context, registry);
  const url = tickets.link(file);
  assert.match(url, /^rex-md:\/\/open\/[a-f0-9]{64}$/);
  assert.equal(tickets.link(file), url);
  assert.equal(readdirSync(registry).length, 1);
  assert.equal(statSync(registry).mode & 0o777, 0o700);
  assert.equal(statSync(join(registry, readdirSync(registry)[0])).mode & 0o777, 0o600);
  assert.deepEqual(readTicket(url, registry), { ...context, path: file });
  tickets.close();
  tickets.close();
  assert.throws(() => readTicket(url, registry), { code: "ENOENT" });
});

test("reject arbitrary URLs, traversal, unknown tickets, and invalid destinations", (t) => {
  const { directory, file } = fixture(t);
  const registry = join(directory, "tickets");
  const tickets = createTickets(context, registry);
  const url = tickets.link(file);
  for (const invalid of ["https://example.com", "rex-md://open/../../etc/passwd", `${url}?path=/tmp/a.md`, `${url}#x`, "rex-md://open/" + "0".repeat(64)]) {
    assert.throws(() => readTicket(invalid, registry));
  }
  const record = join(registry, readdirSync(registry)[0]);
  for (const changes of [{ session: "$(touch /tmp/pwn)" }, { block: "--help" }, { server: "https://remote" }, { path: "relative.md" }, { path: join(directory, "missing.md") }]) {
    writeFileSync(record, JSON.stringify({ ...context, path: file, ...changes }));
    assert.throws(() => readTicket(url, registry));
  }
});

test("pass filenames as literal argv, preserve Pi focus, and do not start a shell", () => {
  const file = "/tmp/$(touch hacked); review.md";
  const argv = browserArguments({ ...context, path: file }, "/opt/homebrew/bin/terminal-browser");
  const url = `terminal-browser-file://file${pathToFileURL(file).pathname}`;
  assert.equal(argv.at(-1), url);
  assert.equal(decodeURIComponent(new URL(url).pathname), file);
  assert.equal(argv.filter((value) => value === url).length, 1);
  assert.ok(argv.includes("--shell=none"));
  assert.ok(argv.includes("--focus=false"));
  assert.equal(argv[argv.indexOf("--cwd") + 1], "/tmp");
  assert.deepEqual(argv.slice(-4), ["/opt/homebrew/bin/terminal-browser", "open", "--no-merge", url]);
  assert.equal(argv[argv.indexOf("--") + 1], "/usr/bin/env");
});

test("Markdown browsers have a separate profile and daemon with telemetry disabled", () => {
  const environment = browserEnvironment();
  assert.equal(environment.TERMINAL_BROWSER_NO_TELEMETRY, "1");
  assert.equal(environment.TERMINAL_BROWSER_PRESENT, "animation");
  assert.equal(execFileSync(process.execPath, ["-p", 'require("node:os").homedir()'], { env: { ...process.env, ...environment }, encoding: "utf8" }).trim(), environment.HOME);
  for (const [key, value] of Object.entries(environment)) {
    if (!["TERMINAL_BROWSER_NO_TELEMETRY", "TERMINAL_BROWSER_PRESENT"].includes(key)) assert.ok(value.startsWith(join(homedir(), ".local/state/rex-markdown-browser/")), key);
  }
  const argv = browserArguments({ ...context, path: "/tmp/review.md" }, "/opt/homebrew/bin/terminal-browser");
  for (const [key, value] of Object.entries(environment)) assert.ok(argv.includes(`${key}=${value}`));
});

test("dispatcher rejects an unregistered URL before invoking Rex", () => {
  assert.throws(() => execFileSync(process.execPath, [new URL("./open.mjs", import.meta.url).pathname, "rex-md://open/../../tmp/a"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), (error) => error.status === 1 && error.stderr.includes("Invalid Rex Markdown link"));
});

test("Pi rewrites presentation only and revokes tickets at session shutdown", async (t) => {
  const { directory, file } = fixture(t);
  const { createJiti } = createRequire(new URL("../../pi/agent/extensions/node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url))("jiti");
  const jiti = createJiti(import.meta.url);
  const { default: extension } = await jiti.import(join(homedir(), ".pi/agent/extensions/rex-markdown.ts"));
  const handlers = new Map();
  const notices = [];
  const oldSession = process.env.REX_SESSION;
  const oldBlock = process.env.REX_BLOCK;
  process.env.REX_SESSION = context.session;
  process.env.REX_BLOCK = context.block;
  t.after(() => {
    if (oldSession === undefined) delete process.env.REX_SESSION;
    else process.env.REX_SESSION = oldSession;
    if (oldBlock === undefined) delete process.env.REX_BLOCK;
    else process.env.REX_BLOCK = oldBlock;
  });
  let transform;
  await extension({
    registerMarkdownTransformer(fn) { transform = fn; },
    on(name, fn) { handlers.set(name, fn); },
    exec: async () => ({ code: 0, stdout: JSON.stringify({ endpoint: context.server, session_id: context.session, block_id: context.block }), stderr: "" }),
  });
  const source = `[review](${pathToFileURL(file).href})`;
  assert.equal(transform(source, { messageType: "assistant" }), source);
  const ctx = { mode: "tui", cwd: directory, ui: { notify: (...args) => notices.push(args) } };
  await handlers.get("session_start")({}, ctx);
  assert.deepEqual(notices, []);
  const output = transform(source, { messageType: "assistant" });
  const url = /rex-md:\/\/open\/[a-f0-9]{64}/.exec(output)?.[0];
  assert.ok(url);
  assert.equal(readTicket(url).path, file);
  assert.equal(transform(source, { messageType: "assistant-thinking" }), source);
  await handlers.get("session_shutdown")();
  assert.throws(() => readTicket(url), { code: "ENOENT" });
  assert.equal(transform(source, { messageType: "assistant" }), source);
  await handlers.get("session_start")({}, { ...ctx, mode: "rpc" });
  assert.equal(transform(source, { messageType: "assistant" }), source);
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file, "utf8"), "# A review\n");
});
