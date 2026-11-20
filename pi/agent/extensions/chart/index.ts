import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), "runner.mjs");
const TIMEOUT_MS = 60000;

const DESCRIPTION = `Render a chart to PNG with mpljs, a JavaScript port of matplotlib 3.11 with the same calls and the same pixels.

\`code\` is the body of an async function that receives \`mpl\` (the library) and \`data\` (the \`data\` argument), and MUST return the Figure:

  const [fig, ax] = mpl.subplots({ style: "pro-dark", rc: { "figure.figsize": [6, 3.5] } });
  ax.plot(data.x, data.y, { label: "p50" });
  ax.set_xlabel("minute"); ax.legend(); fig.tight_layout();
  return fig;

Keyword arguments go in a trailing object (\`ax.bar(names, values, { color: "C1" })\`); unknown keywords throw. For a grid: \`const [fig, axes] = mpl.subplots(2, 2)\`.
Plots: plot, step, scatter, bar, barh, hist, errorbar, boxplot, fill_between, imshow with colorbar, axhline/axvline/axhspan/axvspan, text, annotate. Scales: linear, log, date. Also twinx, shared axes, legends.
Not supported: pie, violinplot, stem, stairs, subplot_mosaic, mathtext.
Styles: pro-dark, pro-slate, pro-mono, pro-ember, and matplotlib's own (ggplot, fivethirtyeight, seaborn-v0_8-whitegrid, dark_background, ...). Use pro-dark or pro-slate unless asked otherwise.
The code runs in Node with full access, not in the codemode sandbox, so compute the data in the script and pass it through \`data\`.
From a codemode script: \`const chart = await tools.chart({ code, data }); image(chart.image);\``;

type RenderRequest = { code: string; data: unknown; scale: number; path: string };

function render(input: RenderRequest, signal: AbortSignal | undefined): Promise<string> {
	return new Promise((resolvePromise) => {
		const child = spawn(process.execPath, [RUNNER], { stdio: ["pipe", "ignore", "pipe"], signal, timeout: TIMEOUT_MS });
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => resolvePromise(String(error)));
		child.on("close", (code, killSignal) => {
			if (code === 0) return resolvePromise("");
			const lines = stderr.trim().split("\n");
			const message = lines.find((line) => /Error/.test(line)) ?? lines[0] ?? "";
			resolvePromise(killSignal ? `chart code did not finish within ${TIMEOUT_MS / 1000}s` : message || `runner exited with code ${code}`);
		});
		child.stdin.end(JSON.stringify(input));
	});
}

export default function chart(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "chart",
		label: "Chart",
		description: DESCRIPTION,
		exposure: "codemode",
		parameters: Type.Object({
			code: Type.String({ description: "Async function body using `mpl` and `data`; must return the Figure" }),
			data: Type.Optional(Type.Unknown({ description: "JSON passed to the code as `data`" })),
			scale: Type.Optional(Type.Number({ description: "Pixel density multiplier, default 2", minimum: 1, maximum: 4 })),
			path: Type.Optional(Type.String({ description: "Where to save the PNG; default is a temp file" })),
		}),
		outputSchema: Type.Object({
			image: Type.Object({ type: Type.Literal("image"), data: Type.String(), mimeType: Type.Literal("image/png") }),
			path: Type.String(),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx): Promise<any> {
			const cwd = ctx.sessionManager.getCwd();
			const path = params.path ? (isAbsolute(params.path) ? params.path : resolve(cwd, params.path)) : join(tmpdir(), "pi-charts", `${randomUUID()}.png`);
			mkdirSync(dirname(path), { recursive: true });
			const error = await render({ code: params.code, data: params.data, scale: params.scale ?? 2, path }, signal);
			if (error) throw new Error(error);
			const image = { type: "image" as const, data: readFileSync(path).toString("base64"), mimeType: "image/png" as const };
			return { content: [{ type: "text", text: `Chart saved to ${path}` }, image], structuredContent: { image, path }, details: { path } };
		},
	});
}
