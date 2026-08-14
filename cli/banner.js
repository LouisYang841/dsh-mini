// DeepSeek-blue ASCII banner, printed once at TTY startup.
//
// Style: ANSI-Shadow glyphs (the hermes banner font) when the terminal is
// wide enough; a 5-wide block fallback for narrow terminals (Termux phone
// portrait). Coloring is a simple per-row luminance gradient — light blue
// at the top down through the DeepSeek brand #4D6BFE into dark navy.
//
// Color support: truecolor (Termux default) > xterm-256 ramp > plain.
// Disable entirely with DSH_NO_BANNER=1; NO_COLOR drops colors only.

// ---- wide: ANSI Shadow, 8 rows x 8 cols per glyph (E/S verbatim from the
// ---- hermes banner art; D/P/K in the same figlet font) -------------------
const WIDE = {
	D: ["██████╗ ", "██╔══██╗", "██║  ██║", "██║  ██║", "██║  ██║", "██║  ██║", "██████╔╝", "╚═════╝ "],
	E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
	P: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔═══╝ ", "██║     ", "██║     ", "██║     ", "╚═╝     "],
	S: ["███████╗", "██╔════╝", "███████╗", "╚════██║", "     ██║", "     ██║", "███████║", "╚══════╝"],
	K: ["██╗  ██╗", "██║ ██╔╝", "█████╔╝ ", "██╔═██╗ ", "██║  ██╗", "██║  ██║", "██║  ██║", "╚═╝  ╚═╝"],
};

// ---- compact fallback: 5 cols x 6 rows of solid blocks --------------------
const COMPACT = {
	D: ["####.", "#...#", "#...#", "#...#", "#...#", "####."],
	E: ["#####", "#....", "####.", "#....", "#....", "#####"],
	P: ["####.", "#...#", "#...#", "####.", "#....", "#...."],
	S: [".####", "#....", "####.", "....#", "....#", "####."],
	K: ["#...#", "#..#.", "##...", "##...", "#..#.", "#...#"],
};

const TEXT = "DEEPSEEK";

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

function renderRows(rows, ramp, ramp256, mode) {
	const lines = [];
	for (let r = 0; r < rows.length; r++) {
		const row = rows[r];
		if (mode === "plain") {
			lines.push(row.replace(/\s+$/, ""));
			continue;
		}
		const color = mode === "true"
			? `\x1b[38;2;${ramp[r][0]};${ramp[r][1]};${ramp[r][2]}m`
			: `\x1b[38;5;${ramp256[r]}m`;
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
		lines.push(out.replace(/\s+$/, ""));
	}
	return lines;
}

export function renderBanner() {
	const mode = colorMode();
	const cols = process.stdout.columns || 80;
	const wide = cols >= 72; // ANSI Shadow DEEPSEEK with gaps = 71 cols
	const font = wide ? WIDE : COMPACT;
	const rows = [];
	for (let r = 0; r < 8; r++) {
		if (!wide && r >= 6) break;
		const glyph = (ch) => (wide ? font[ch][r] : font[ch][r].replace(/#/g, "█").replace(/\./g, " "));
		rows.push(TEXT.split("").map(glyph).join(wide ? " " : ""));
	}
	const lines = renderRows(rows, wide ? RAMP_WIDE : RAMP_COMPACT, wide ? RAMP_WIDE_256 : RAMP_COMPACT_256, mode);
	const tag = mode === "plain" ? TAGLINE : `\x1b[38;2;130;140;175m${TAGLINE}\x1b[0m`;
	const width = rows[0].length;
	const pad = Math.max(0, Math.floor((width - [...TAGLINE].length) / 2));
	lines.push(" ".repeat(pad) + tag);
	return lines.join("\n") + "\n";
}
