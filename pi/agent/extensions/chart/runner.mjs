import { writeFileSync } from "node:fs";
import * as mpl from "mpl";
import { allFonts } from "mpl/fonts/all";

const AsyncFunction = (async () => {}).constructor;

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { code, data, scale, path } = JSON.parse(input);

mpl.registerFonts(...allFonts);
const figure = await new AsyncFunction("mpl", "data", code)(mpl, data);
if (typeof figure?.toPNGSync !== "function") {
	throw new Error("the chart code must return the Figure, for example: const [fig, ax] = mpl.subplots(); ...; return fig");
}
writeFileSync(path, figure.toPNGSync({ scale }));
