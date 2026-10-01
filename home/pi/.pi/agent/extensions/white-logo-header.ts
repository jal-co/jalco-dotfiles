import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPackageDir } from "@earendil-works/pi-coding-agent";

const LOGO_COLORS = /228,138,122|79,142,179|234,182,93/g;

export default function () {
	const chunks = join(getPackageDir(), "dist", "bundle", "chunks");
	for (const name of readdirSync(chunks)) {
		const path = join(chunks, name);
		const source = readFileSync(path, "utf8");
		if (LOGO_COLORS.test(source)) writeFileSync(path, source.replace(LOGO_COLORS, "255,255,255"));
		LOGO_COLORS.lastIndex = 0;
	}
}
