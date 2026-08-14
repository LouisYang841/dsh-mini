// DeepSeek-blue ASCII banner, printed once at TTY startup.
//
// Two lines — DEEPSEEK over HARNESS — in the hermes banner style:
// ANSI-Shadow glyphs on wide terminals, a 5-wide block fallback for narrow
// ones (Termux phone portrait). Coloring is a per-row luminance gradient,
// light blue at the top down through the DeepSeek brand #4D6BFE into dark
// navy, restarted for each line. Letters are separated by one space.
//
// Color support: truecolor (Termux default) > xterm-256 ramp > plain.
// Disable entirely with DSH_NO_BANNER=1; NO_COLOR drops colors only.

// ---- wide: ANSI Shadow, 8 rows per glyph (H/A/R/N verbatim from the
// ---- hermes banner art; D/P/K in the same figlet font) -------------------
const WIDE = {
	D: ["██████╗ ", "██╔══██╗", "██║  ██║", "██║  ██║", "██║  ██║", "██║  ██║", "██████╔╝", "╚═════╝ "],
	E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
	P: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔═══╝ ", "██║     ", "██║     ", "██║     ", "╚═╝     "],
	S: ["███████╗", "██╔════╝", "███████╗", "╚════██║", "     ██║", "     ██║", "███████║", "╚══════╝"],
	K: ["██╗  ██╗", "██║ ██╔╝", "█████╔╝ ", "██╔═██╗ ", "██║  ██╗", "██║  ██║", "██║  ██║", "╚═╝  ╚═╝"],
	H: ["██╗  ██╗", "██║  ██║", "███████║", "██╔══██║", "██║  ██║", "██║  ██║", "██║  ██║", "╚═╝  ╚═╝"],
	A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "██║  ██║", "██║  ██║", "╚═╝  ╚═╝"],
	R: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "██║  ██║", "██║  ██║", "╚═╝  ╚═╝"],
	N: ["███╗   ██╗", "████╗  ██║", "██╔██╗ ██║", "██║╚██╗██║", "██║ ╚████║", "██║  ╚███║", "██║   ╚██║", "╚═╝    ╚═╝"],
};

// ---- compact fallback (phone): 5 cols x 6 rows of solid blocks ------------
const COMPACT = {
	D: ["####.", "#...#", "#...#", "#...#", "#...#", "####."],
	E: ["#####", "#....", "####.", "#....", "#....", "#####"],
	P: ["####.", "#...#", "#...#", "####.", "#....", "#...."],
	S: [".####", "#....", "####.", "....#", "....#", "####."],
	K: ["#...#", "#..#.", "##...", "##...", "#..#.", "#...#"],
	H: ["#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
	A: [".###.", "#...#", "#####", "#...#", "#...#", "#...#"],
	R: ["####.", "#...#", "#...#", "####.", "#..#.", "#...#"],
	N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"],
};

const LINES = ["DEEPSEEK", "HARNESS"];

// Per-row gradient, top -> bottom: light blue -> brand -> dark navy.
const RAMP_WIDE = [
	[181, 201, 255],
	[157, 182, 255],
	[131, 159, 255],
	[104, 139, 254],
	[77, 107, 254], // #4D6BFE brand
	[58, 86, 216],
	[42, 63, 168],
	[28, 44, 120],
];
const RAMP_COMPACT = [
	[168, 188, 255],
	[139, 163, 255],
	[109, 139, 254],
	[77, 107, 254], // #4D6BFE brand
	[58, 86, 216],
	[42, 63, 168],
];
const RAMP_WIDE_256 = [153, 147, 111, 75, 63, 27, 21, 20];
const RAMP_COMPACT_256 = [153, 117, 75, 63, 27, 21];

const TAGLINE = "dsh-mini · portable DeepSeek Harness";

function colorMode() {
	if (process.env.NO_COLOR) return "plain";
	const term = process.env.TERM || "";
	if (process.env.COLORTERM === "truecolor" || /truecolor/.test(term)) return "true";
	if (/256color/.test(term)) return "x256";
	return term && term !== "dumb" ? "x256" : "plain";
}

function renderRow(row, ramp, ramp256, mode) {
	if (mode === "plain") return row.replace(/\s+$/, "");
	const color = mode === "true"
		? `\x1b[38;2;${ramp[0]};${ramp[1]};${ramp[2]}m`
		: `\x1b[38;5;${ramp256}m`;
	let out = "";
	let run = "";
	const flush = () => {
		if (run.length) out += color + run + "\x1b[0m";
		run = "";
	};
	for (let i = 0; i < row.length; i++) {
		if (row[i] === " ") {
			if (run.length) flush();
			out += " ";
		} else {
			run += row[i];
		}
	}
	flush();
	return out.replace(/\s+$/, "");
}

export function renderBanner() {
	const mode = colorMode();
	const cols = process.stdout.columns || 80;
	const wide = cols >= 72; // wide DEEPSEEK line = 71 cols
	const font = wide ? WIDE : COMPACT;
	const ramp = wide ? RAMP_WIDE : RAMP_COMPACT;
	const ramp256 = wide ? RAMP_WIDE_256 : RAMP_COMPACT_256;
	const height = wide ? 8 : 6;

	const lines = [];
	LINES.forEach((text, li) => {
		if (li > 0) lines.push(""); // blank row between the two words
		for (let r = 0; r < height; r++) {
			const glyph = (ch) => (wide ? font[ch][r] : font[ch][r].replace(/#/g, "█").replace(/\./g, " "));
			lines.push(text.split("").map(glyph).join(" "));
		}
	});

	const out = [];
	let r = 0;
	for (const line of lines) {
		if (line === "") {
			out.push("");
			continue;
		}
		out.push(renderRow(line, ramp[r % height], ramp256[r % height], mode));
		r++;
	}

	const tag = mode === "plain" ? TAGLINE : `\x1b[38;2;130;140;175m${TAGLINE}\x1b[0m`;
	const width = Math.max(...lines.map((l) => l.length));
	const pad = Math.max(0, Math.floor((width - [...TAGLINE].length) / 2));
	out.push(" ".repeat(pad) + tag);
	return out.join("\n") + "\n";
}
