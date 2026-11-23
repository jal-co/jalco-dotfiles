#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { parseArgs } from "node:util";

const CHANGED = 48;
const PAD = 120;

export function decodePng(bytes) {
	if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error("Not a PNG file");
	let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
	const data = [];
	for (let at = 8; at < bytes.length; ) {
		const length = bytes.readUInt32BE(at);
		const kind = bytes.toString("ascii", at + 4, at + 8);
		const body = bytes.subarray(at + 8, at + 8 + length);
		if (kind === "IHDR") {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			depth = body[8];
			type = body[9];
			interlace = body[12];
		}
		if (kind === "IDAT") data.push(body);
		at += 12 + length;
	}
	const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
	if (depth !== 8 || !channels || interlace) throw new Error("Only 8-bit, non-interlaced grey, RGB or RGBA PNGs are supported");
	const raw = inflateSync(Buffer.concat(data));
	const stride = width * channels;
	const rows = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		for (let x = 0; x < stride; x++) {
			const left = x >= channels ? rows[y * stride + x - channels] : 0;
			const up = y > 0 ? rows[(y - 1) * stride + x] : 0;
			const corner = x >= channels && y > 0 ? rows[(y - 1) * stride + x - channels] : 0;
			let value = line[x];
			if (filter === 1) value += left;
			else if (filter === 2) value += up;
			else if (filter === 3) value += (left + up) >> 1;
			else if (filter === 4) {
				const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
				value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
			}
			rows[y * stride + x] = value;
		}
	}
	const rgb = new Uint8ClampedArray(width * height * 3);
	const alpha = new Uint8ClampedArray(width * height);
	for (let p = 0; p < width * height; p++) {
		const s = p * channels;
		const [r, g, b] = channels < 3 ? [rows[s], rows[s], rows[s]] : [rows[s], rows[s + 1], rows[s + 2]];
		alpha[p] = channels === 4 ? rows[s + 3] : channels === 2 ? rows[s + 1] : 255;
		const a = alpha[p] / 255;
		rgb[p * 3] = r * a + 255 * (1 - a);
		rgb[p * 3 + 1] = g * a + 255 * (1 - a);
		rgb[p * 3 + 2] = b * a + 255 * (1 - a);
	}
	return { width, height, rgb, alpha, pixels: rows, channels };
}

const CRC = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function chunk(kind, body) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(body.length, 0);
	head.write(kind, 4, "ascii");
	let crc = 0xffffffff;
	for (const byte of Buffer.concat([head.subarray(4), body])) crc = CRC[(crc ^ byte) & 255] ^ (crc >>> 8);
	const tail = Buffer.alloc(4);
	tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
	return Buffer.concat([head, body, tail]);
}

export function encodePng({ width, height, rgb }) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 2;
	const raw = Buffer.alloc((width * 3 + 1) * height);
	for (let y = 0; y < height; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

export function changedBox(before, after) {
	let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
	for (let y = 0; y < after.height; y++) {
		for (let x = 0; x < after.width; x++) {
			const i = (y * after.width + x) * 3;
			const delta = Math.max(Math.abs(before.rgb[i] - after.rgb[i]), Math.abs(before.rgb[i + 1] - after.rgb[i + 1]), Math.abs(before.rgb[i + 2] - after.rgb[i + 2]));
			if (delta <= CHANGED) continue;
			x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
		}
	}
	if (x1 < 0) return undefined;
	const x = Math.max(0, x0 - PAD), y = Math.max(0, y0 - PAD);
	return { x, y, width: Math.min(after.width, x1 + PAD + 1) - x, height: Math.min(after.height, y1 + PAD + 1) - y };
}

const lightness = (rgb, i) => (0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2]) / 255;

function isDark(image, box) {
	let sum = 0, count = 0;
	for (let y = box.y; y < box.y + box.height; y += 4) for (let x = box.x; x < box.x + box.width; x += 4) { sum += lightness(image.rgb, (y * image.width + x) * 3); count++; }
	return sum / count < 0.5;
}

export function ghost(before, after, box) {
	const dark = isDark(after, box);
	const ink = (rgb, i) => (dark ? lightness(rgb, i) : 1 - lightness(rgb, i));
	const rgb = new Uint8ClampedArray(box.width * box.height * 3);
	for (let y = 0; y < box.height; y++) {
		for (let x = 0; x < box.width; x++) {
			const i = ((y + box.y) * after.width + x + box.x) * 3, o = (y * box.width + x) * 3;
			const old = ink(before.rgb, i), now = ink(after.rgb, i);
			const same = Math.min(old, now), onlyOld = Math.max(0, old - now), onlyNow = Math.max(0, now - old);
			rgb[o] = 255 - same * 235 - onlyNow * 230 - onlyOld * 10;
			rgb[o + 1] = 255 - same * 235 - onlyNow * 140 - onlyOld * 120;
			rgb[o + 2] = 255 - same * 235 - onlyNow * 10 - onlyOld * 120;
		}
	}
	return { width: box.width, height: box.height, rgb };
}

function crop(image, box, scale) {
	const width = Math.floor(box.width / scale), height = Math.floor(box.height / scale);
	const rgb = new Uint8ClampedArray(width * height * 3);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			for (let c = 0; c < 3; c++) {
				let sum = 0;
				for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) sum += image.rgb[((box.y + y * scale + dy) * image.width + box.x + x * scale + dx) * 3 + c];
				rgb[(y * width + x) * 3 + c] = sum / (scale * scale);
			}
		}
	}
	return { width, height, rgb };
}

const PILLS = {
	newLarge: "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",
	oldLarge: "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",
	newSmall: "iVBORw0KGgoAAAANSUhEUgAAADQAAAAaCAYAAAD43n+tAAAFFElEQVR4AdRYfUyVVRj/nffeK5dPNRBdmUHcq7IaQkPC7GO1PiRWUtmWqy3j0lqmyZa25tTyD2db68MVfYlorT8aLrBmM5QZY3ytZpBCNLiolSlxQYzvC9z39DznvRfvhdi9sUnw7j1fz/k95/x+7/Ocwx0agjxJjg6bLbdjuy3XddLm6Gi1Ozp67Q6XnJ7S0Uv7tthzXSeSHK6tCRs6lwehi0kFJea6lpGAYxpEqxBijxC4V0DYABGFaXtEFO1rh8D9GvCWxSSbmRNzm4wC4QKnFjv+vo6c3jcLNJKANYGz//+IOTE3e27nPuY6nlGAIFte1+Jw6f6anDYR0Exlpr5mCPmyVQ6XJOb1LfQnOSYoYYO0QvcUQ4g7/QEzuU/peI9JDnyluHuJjgmyaK4vhBCrvPZZ01A2rTabXJ/7CCtBSY7OHIrMEz7jbGtJ1JNKAxFXgjSpv0H9Wf0KyF0sQKOLIJOis4IHwcqjmWFoKYxTZe2qsAD4J5tjlP3t56MD7NM1EEAaa9HoIsiZyqb5OZEIs0zF8xr66PoaTrnUqWxxQ6yGF7MjpuJ6DX1kpkahWvRfdxj1AO4R4LkHI8DCJvN/IG0OSnbOQ0OBkaYH8ucieYkZFhNQ/0GsStGMZUaYd6yPVOOju+er5Uz0qRs/NvxSbzYrW7CKtWhSiIRgQN+8lEZvhAQVHR9A+Bxg27pIwziuviPZgoKXYkiwCd+dcqP1ogd33WrB/i0xiI4Q+LGVvgj5pNsNQSmJRmu73oSocAG2zyEdnT0SDWdHCRn8ZS30HaQ1OHQi4sOjA7jYpSMrPQwrl1omABwPGen4WfkgXivqRfaubpw+N4r4uRqeuS8c1U2GoBWJZnA0li82469uHZwy6TYL0pIsas3qpmHVhlqRINEeKtgfxym3t7iPLkhgx/qrv1d9UVwST0uTQ35OhEolvh1TiDyZkLjIhBP1bu4ihSJzGwmwUrQPVw0pW2qSGSu8aVb9S+iChES7xpVaJYRKCAPkbVB2ahi1zSNIvtGEdG+UfBhdGth3SwewsaAnoBw8Pqii66Q0jI0RyF4ZpsDf/uDGlX6pRN5ykxkeHTj5c+iCaMt2TReiTq02xepNihJfEtGU9/5LtFygg0YGC52D8vphcFk4T0MGCfdha3810o7/pnX3SbRd8qDpt1FKNzMWzdfU2ekZIJq0TigvnaEGTQjxZSjgyTDNf3hQXGmkij+GLw0ev/BwBPY8G4VP6TJ4/ekoZFE0zrYbYqsaja8faRVoPG8cfBbEY/atbTbmuR9K0Tz6Ic1ZGFsHKatCcZgM805pPzhV/Ofr20ax+aMecFo9crsVfOhLatx4au8VXLpMuUTgKjrw/UOSesCZ80a0zpwzWjZWnA5dkJSypvVQfIM6uVITO3mBYOWbOjeW5nUiZWNnAJTTImNLl5p7ZX/v2ByfsbW7uxX+7m2X1W33J92MPgBf/2mbDL/3jgwoc9lPw2od3odvRWUMqTJtZZgS5CxcUKFD7GPDbCzM3VkUW8vclSDutLXFssJK7s+yUunlrmiPCUKFGJW6dR3lYgdmyUOn73fmDOIO73NVEBmcB6NdQ70LEkjUMRrO6Jc4lg31xC1nzv5EAwTxxIXDYtBZtCCb8vIxcqph20wqzEmX4nHimMVcx3ObIMgACNl2IO6Isyh+9YhHJEvI7fST5nsqrYDsMzDTUcs+tadEOSRe1SHtzKmtKK4U9G8f/MvzDwAAAP//8WHZxQAAAAZJREFUAwBBOx6ckAy+9wAAAABJRU5ErkJggg==",
	oldSmall: "iVBORw0KGgoAAAANSUhEUgAAAC0AAAAaCAYAAAAjZdWPAAAE1klEQVR4AcxVfUzUZRz/PL87OBBIIALh7uhcMGW51BlNQ4cRcDBcIkGt+bK1wlxkq0ZvbFqWVltuDjXdnBvO4SzKjGJxiCtjirX+Ycvm5lnCvXGIksLBAffy9DwP3O3uB9cdm9g9u+/3+b58nuf7+X3v+T0/CWGGWaPPMan1Db0a/U99Gr2RyUiftozeM9HoR9ie1/q0+s5ebWm9Lat0aRhKCEnamlW2hBFt9xJipBLZRwh5CoTkMEkMt+mc8oQksj1zAVJMIH3uUkhXeV1eHyHGDNKss6kmjf6QW6JXCCFlIdbNa5jX5fX7NGWNnI+8WBBpi7pcwzrbSgl5jT29Ug6+rz4hShC87gH5diD96YzA2n7SN3Tr49zE28KSa5lEzY8QFI6rYs5wfj5SftKSW9VMCFnjS0TZXCB54k76OAnSJm1pJQh51heM0rlG8GTkBGkvJR8yO+p/Xirt5iQl9vKtZsdiOXcilcRtG5B+6hNo/vga6ksnkHb4PaieeDRouWpVHtKONiBlz46geKATk7cYKbu3Y+HOFwLDIW1CsJLzlTzEWxkSJUtIyUlY1HYQqXvrELduJaSFiVBoM7DgmUJkfLMfqfvq/CsUWQ9hQcU6xBeu8sfkRsxiNZJe3oSE50vlqZA+58uOB1kREiFL8K7EPsa+AxMu/PPRMVjzN6Nf/yocpw0Cmbh1g3gA4cybIiskCroIEQzeuYTqYoG8e/A0Ro6fhWdgCK6rNzD0biPGL/aI3AM7asQ8m1I9uRyZnUehNbYi0/AFlNqISgdtxflKINAhghHLzp+AUYrhplZhBirHVx3CjcnRiFmulDlapDftQcwSHeioEwp1OpLf3iaHhfcZXwkgcYhgKDVTHyXPzSFQx9iMFe6+fhEjcSrwf0U4ASr5zS0g8SqMff8LLPlbYH18M5zT/04ALCJTAoU9EqTbNihgirQUgL3GkA0l6xwP0fEJeKax3PdJ7LJHhDna1gW43KATk3AaLonYnBQldtZpGhHpySvXp/ZWSEjcWjFlB+iEqiLhuXttYp5HZZcI8GskBTz9t+A8/5uApuyqRdJLlVBkpILftQ/ufwvxJatFbqT5RzHL1eSff4vQgpI1YuYqvqyAT3MSAtojKaj0ZaSrht4/BPdfFhBVLFI+eAXq308hs+MIEp4rEVuM/dAFx8k2YcvV3QPN4C9gQk0xMtsPi1skvihfDgvrK6j3hKSxtvNOXwyLZgDPwG30V+zEaMs5uE128HNJh0fhvm7Gnb3HcavuU4aa/ecymmDf+AacHd1Q6rIAL7uFjrTMDg4VpbRbY+3sYWcakCh2hcLJ43RsHLfrD8C29kWYczfCvKwatqLtGD52JgjKu27KLodtfa0/7rpmwmDtxzDnVYmP0p3PmiAwbC8/6D8MSkk9TwvSWovhAiht5IGoFcZPZzVc5vwEaW5kWybqGXF2H3EvyoTSLsFvmpafNMEFd6xbqqaU3pzOzc80x10ZHxPnxfn5lvpJ80CmvX1QgWEdA7Zz/38Xig7GZynnFcgliDRPaC2XnQ9bOioIvJvYcenmsfsu7JZgl0NVtsVQzvnI688gzQEEoNnmc98x8gUxHm8evGhg3f+ZPYSRiYNj7plQ6mB7GlnJ85TiHYnSXF6XXQ5nOY/Z6vwLAAD//2RaaMsAAAAGSURBVAMAZjzUXALXwoEAAAAASUVORK5CYII=",
};

function stamp(image, name, right, bottom) {
	const pill = decodePng(Buffer.from(PILLS[name], "base64"));
	const channels = pill.channels;
	const left = right - pill.width, top = bottom - pill.height;
	for (let y = 0; y < pill.height; y++) {
		for (let x = 0; x < pill.width; x++) {
			const px = left + x, py = top + y;
			if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
			const a = pill.alpha[y * pill.width + x] / 255, s = (y * pill.width + x) * channels, o = (py * image.width + px) * 3;
			for (let c = 0; c < 3; c++) image.rgb[o + c] = pill.pixels[s + c] * a + image.rgb[o + c] * (1 - a);
		}
	}
	return left;
}

export function encodeGif(frames, delay) {
	const { width, height } = frames[0];
	const counts = new Map();
	for (const frame of frames) for (let i = 0; i < frame.rgb.length; i += 3) {
		const key = ((frame.rgb[i] >> 3) << 10) | ((frame.rgb[i + 1] >> 3) << 5) | (frame.rgb[i + 2] >> 3);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const palette = [...counts.entries()].sort((p, q) => q[1] - p[1]).slice(0, 256).map(([key]) => [((key >> 10) & 31) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4]);
	while (palette.length < 256) palette.push([0, 0, 0]);
	const nearestCache = new Map();
	const nearest = (r, g, b) => {
		const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
		const hit = nearestCache.get(key);
		if (hit !== undefined) return hit;
		let best = 0, bestDistance = Infinity;
		palette.forEach(([pr, pg, pb], index) => {
			const distance = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
			if (distance < bestDistance) { bestDistance = distance; best = index; }
		});
		nearestCache.set(key, best);
		return best;
	};
	const out = [];
	const push = (...bytes) => { for (const byte of bytes) out.push(byte & 255); };
	const word = (value) => push(value, value >> 8);
	push(..."GIF89a".split("").map((c) => c.charCodeAt(0)));
	word(width); word(height); push(0xf7, 0, 0);
	for (const color of palette) push(...color);
	push(0x21, 0xff, 11, ..."NETSCAPE2.0".split("").map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
	for (const frame of frames) {
		push(0x21, 0xf9, 4, 0, delay & 255, delay >> 8, 0, 0, 0x2c);
		word(0); word(0); word(width); word(height); push(0, 8);
		const codes = new Uint8Array(width * height);
		for (let p = 0; p < codes.length; p++) codes[p] = nearest(frame.rgb[p * 3], frame.rgb[p * 3 + 1], frame.rgb[p * 3 + 2]);
		let dictionary = new Map(), next = 258, size = 9, buffer = 0, bits = 0;
		const bytes = [];
		const emit = (code) => {
			buffer |= code << bits;
			bits += size;
			while (bits >= 8) { bytes.push(buffer & 255); buffer >>>= 8; bits -= 8; }
		};
		emit(256);
		let prefix = codes[0];
		for (let p = 1; p < codes.length; p++) {
			const key = prefix * 4096 + codes[p], found = dictionary.get(key);
			if (found !== undefined) { prefix = found; continue; }
			emit(prefix);
			if (next < 4096) {
				dictionary.set(key, next++);
				if (next > 1 << size && size < 12) size++;
			} else {
				emit(256);
				dictionary = new Map(); next = 258; size = 9;
			}
			prefix = codes[p];
		}
		emit(prefix);
		emit(257);
		if (bits > 0) bytes.push(buffer & 255);
		for (let i = 0; i < bytes.length; i += 255) push(Math.min(255, bytes.length - i), ...bytes.slice(i, i + 255));
		push(0);
	}
	push(0x3b);
	return Buffer.from(out);
}

function legend(image) {
	const oldLeft = stamp(image, "oldLarge", image.width - 24, image.height - 24);
	stamp(image, "newLarge", oldLeft - 12, image.height - 24);
}

export function ghostDiff(before, after, scale = 2) {
	if (before.width !== after.width || before.height !== after.height) throw new Error(`Sizes differ: ${before.width}x${before.height} and ${after.width}x${after.height}. Recapture at the same viewport and crop.`);
	const box = changedBox(before, after);
	if (!box) return undefined;
	const overlay = ghost(before, after, box);
	legend(overlay);
	const old = crop(before, box, scale), now = crop(after, box, scale);
	stamp(old, "oldSmall", old.width - 12, old.height - 12);
	stamp(now, "newSmall", now.width - 12, now.height - 12);
	return { ghost: encodePng(overlay), flip: encodeGif([old, now], 90) };
}

function main(argv) {
	const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { out: { type: "string" }, scale: { type: "string", default: "2" } } });
	if (positionals.length !== 2 || !values.out) throw new Error("Usage: ghost-diff.mjs <before.png> <after.png> --out <prefix> [--scale 2]");
	const result = ghostDiff(decodePng(readFileSync(positionals[0])), decodePng(readFileSync(positionals[1])), Number(values.scale));
	if (!result) return console.log("No visible difference. Nothing written.");
	writeFileSync(`${values.out}-ghost.png`, result.ghost);
	writeFileSync(`${values.out}-flip.gif`, result.flip);
	console.log(`${values.out}-ghost.png\n${values.out}-flip.gif`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").at(-1))) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}
}
