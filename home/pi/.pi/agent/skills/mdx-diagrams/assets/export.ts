import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { colors, layout } from "./Diagram.tsx";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: "string" },
    font: { type: "string", default: '"JetBrains Mono", "GeistMono Nerd Font", "Geist Mono", ui-monospace, Menlo, monospace' },
  },
});
const [input, output] = positionals;
if (!values.title || !input || !output) {
  console.error('Usage: bun export.ts --title "Title" <content.txt | -> <out.png> [--font "Family"]');
  process.exit(1);
}

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const source = input === "-" ? await Bun.stdin.text() : await Bun.file(input).text();
const rows = layout(values.title, source)
  .map((line) => line.map((s) => `<span style="color:${colors[s.tone]}">${escape(s.text)}</span>`).join(""))
  .join("\n");

const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #121211; }
  figure { display: inline-block; margin: 0; padding: 72px 80px; background: #121211; }
  pre { margin: 0; font: 16px/1.9 ${values.font}; letter-spacing: 0.02em; }
</style><figure><pre>${rows}</pre></figure>`;

const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(html, { headers: { "content-type": "text/html" } }) });
const browser = resolve(homedir(), ".pi/agent/browser-testing/task-browser");
const run = async (...args: string[]) => {
  const child = Bun.spawn([browser, "--session", "mdx-diagram-export", ...args], { stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error(`task-browser ${args[0]} failed`);
};

try {
  await run("open", server.url.href);
  await run("set", "viewport", "1600", "1200", "2");
  await run("eval", "document.fonts.ready.then(() => true)");
  await run("screenshot", "figure", resolve(output));
} finally {
  await Bun.spawn([browser, "--session", "mdx-diagram-export", "close"]).exited;
  server.stop();
}
