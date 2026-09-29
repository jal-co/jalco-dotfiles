import type { CSSProperties, ReactNode } from "react";

type Tone = "fg" | "accent" | "muted" | "faint" | "frame";
type Segment = { text: string; tone: Tone };
type Line = Segment[];

const PAD = 4;
const MARKUP = /\[\[(.+?)\]\]|\(\((.+?)\)\)|\{\{(.+?)\}\}/g;

export const colors: Record<Tone, string> = {
  fg: "var(--diagram-fg, #bdb8ae)",
  accent: "var(--diagram-accent, #3b8cf0)",
  muted: "var(--diagram-muted, #8a867f)",
  faint: "var(--diagram-faint, #4e4c48)",
  frame: "var(--diagram-frame, #3a3936)",
};

function parse(row: string): Line {
  const line: Line = [];
  let last = 0;
  for (const match of row.matchAll(MARKUP)) {
    if (match.index > last) line.push({ text: row.slice(last, match.index), tone: "fg" });
    const [, accent, muted, faint] = match;
    if (accent !== undefined) line.push({ text: accent, tone: "accent" });
    else if (muted !== undefined) line.push({ text: muted, tone: "muted" });
    else line.push({ text: faint, tone: "faint" });
    last = match.index + match[0].length;
  }
  if (last < row.length) line.push({ text: row.slice(last), tone: "fg" });
  return line;
}

const width = (line: Line) => line.reduce((sum, segment) => sum + segment.text.length, 0);

const dashes = (length: number) =>
  Array.from({ length }, (_, i) => (i % 2 ? "-" : " ")).join("");

function dedent(source: string) {
  const rows = source.replace(/^\s*\n|\n\s*$/g, "").split("\n");
  const indent = Math.min(
    ...rows.filter((row) => row.trim()).map((row) => row.match(/^ */)![0].length),
  );
  return rows.map((row) => row.slice(indent).trimEnd());
}

export function layout(title: string, source: string): Line[] {
  const rows = dedent(source);
  const body = rows.map((row) => (row === "---" ? null : parse(row)));
  const contentWidth = Math.max(title.length + 4, ...body.map((line) => (line ? width(line) : 0)));
  let inner = contentWidth + PAD * 2;
  if (inner % 2 === 0) inner += 1;

  const label = `[ ${title.toUpperCase()} ]`;
  const rest = inner - label.length - 2;
  const left = Math.floor(rest / 4);
  const right = Math.floor((rest - 2 * left) / 2);
  const gap = " ".repeat(1 + rest - 2 * left - 2 * right);
  const frame = (text: string): Segment => ({ text, tone: "frame" });
  const blank = () => [frame("|"), { text: " ".repeat(inner), tone: "fg" as Tone }, frame("|")];

  return [
    [
      frame("+" + " -".repeat(left) + " "),
      { text: label, tone: "accent" },
      frame(gap + "- ".repeat(right) + "+"),
    ],
    blank(),
    ...body.map((line) =>
      line
        ? [
            frame("|"),
            { text: " ".repeat(PAD), tone: "fg" as Tone },
            ...line,
            { text: " ".repeat(inner - PAD - width(line)), tone: "fg" as Tone },
            frame("|"),
          ]
        : [frame("|" + dashes(inner) + "|")],
    ),
    blank(),
    [frame("+" + dashes(inner) + "+")],
  ];
}

const figureStyle: CSSProperties = {
  margin: "2rem 0",
  padding: "3rem 1.5rem",
  background: "var(--diagram-bg, #121211)",
  borderRadius: 8,
  overflowX: "auto",
};

const preStyle: CSSProperties = {
  margin: "0 auto",
  width: "max-content",
  background: "none",
  padding: 0,
  fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  fontSize: "0.875rem",
  lineHeight: 1.9,
  letterSpacing: "0.02em",
};

export function Diagram({ title, children }: { title: string; children: string }): ReactNode {
  return (
    <figure style={figureStyle}>
      <pre style={preStyle}>
        {layout(title, children).map((line, row) => (
          <div key={row}>
            {line.map((segment, i) => (
              <span
                key={i}
                style={{ color: colors[segment.tone] }}
                aria-hidden={segment.tone === "frame" || undefined}
              >
                {segment.text}
              </span>
            ))}
          </div>
        ))}
      </pre>
    </figure>
  );
}
