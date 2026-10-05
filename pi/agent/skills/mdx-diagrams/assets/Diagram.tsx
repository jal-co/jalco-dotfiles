import type { CSSProperties, ReactNode } from "react";

type Tone = "fg" | "accent" | "muted" | "faint" | "frame" | "bad" | "good";
type Fill = "accent" | "bad" | "good";
type Segment = { text: string; tone: Tone; fill?: Fill };
type Line = Segment[];

const PAD = 4;
const MARKUP =
  /\[\[\[(.+?)\]\]\]|!!!(.+?)!!!|\+\+\+(.+?)\+\+\+|\[\[(.+?)\]\]|\(\((.+?)\)\)|\{\{(.+?)\}\}|!!(.+?)!!|\+\+(.+?)\+\+/g;
const ROW_FILL = /\s+@(mark|bad|good)$/;
const ROW_FILLS: Record<string, Fill> = { mark: "accent", bad: "bad", good: "good" };

export const colors: Record<Tone, string> = {
  fg: "var(--diagram-fg, #bdb8ae)",
  accent: "var(--diagram-accent, #3b8cf0)",
  muted: "var(--diagram-muted, #8a867f)",
  faint: "var(--diagram-faint, #4e4c48)",
  frame: "var(--diagram-frame, #3a3936)",
  bad: "var(--diagram-bad, #e5534b)",
  good: "var(--diagram-good, #57ab5a)",
};

export function segmentStyle({ tone, fill }: Segment): CSSProperties {
  if (!fill) return { color: colors[tone] };
  return {
    color: colors[tone],
    background: `color-mix(in srgb, ${colors[fill]} 18%, transparent)`,
    display: "inline-block",
  };
}

function parse(row: string): Line {
  const line: Line = [];
  let last = 0;
  for (const match of row.matchAll(MARKUP)) {
    if (match.index > last) line.push({ text: row.slice(last, match.index), tone: "fg" });
    const [, accentBlock, badBlock, goodBlock, accent, muted, faint, bad, good] = match;
    if (accentBlock !== undefined) line.push({ text: accentBlock, tone: "accent", fill: "accent" });
    else if (badBlock !== undefined) line.push({ text: badBlock, tone: "bad", fill: "bad" });
    else if (goodBlock !== undefined) line.push({ text: goodBlock, tone: "good", fill: "good" });
    else if (accent !== undefined) line.push({ text: accent, tone: "accent" });
    else if (muted !== undefined) line.push({ text: muted, tone: "muted" });
    else if (faint !== undefined) line.push({ text: faint, tone: "faint" });
    else if (bad !== undefined) line.push({ text: bad, tone: "bad" });
    else line.push({ text: good, tone: "good" });
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
  const body = rows.map((row) => {
    if (row === "---") return null;
    const marker = row.match(ROW_FILL);
    if (!marker) return { line: parse(row) };
    return { line: parse(row.slice(0, marker.index).trimEnd()), fill: ROW_FILLS[marker[1]] };
  });
  const contentWidth = Math.max(title.length + 4, ...body.map((row) => (row ? width(row.line) : 0)));
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
    ...body.map((row) =>
      row
        ? [
            frame("|"),
            ...[
              { text: " ".repeat(PAD), tone: "fg" as Tone },
              ...row.line,
              { text: " ".repeat(inner - PAD - width(row.line)), tone: "fg" as Tone },
            ].map((segment) => (row.fill ? { ...segment, fill: row.fill } : segment)),
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
                style={segmentStyle(segment)}
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
