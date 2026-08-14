// pi-tui host: the real @earendil-works/pi-tui shell on top of the DSH core.
// Renders the DSH session event stream into pi-tui components (differential
// rendering, ScrollView with follow-end, single-line Input).
import {
	ProcessTerminal,
	TuiMainScreen,
	Text,
	Input,
	ScrollView,
	VStack,
	TruncatedText,
	matchesKey,
} from "@earendil-works/pi-tui";

/**
 * @param hooks.onLine - user-submitted input line (commands or prompts)
 * @param hooks.onInterrupt - Ctrl+C while a turn is running
 */
export function createTuiHost({ onLine, onInterrupt }) {
	const terminal = new ProcessTerminal();
	const tui = new TuiMainScreen(terminal);
	const status = new TruncatedText("dsh-mini", 0, 0);
	const lines = new VStack([], { gap: 0 });
	const scroll = new ScrollView(lines, { follow: "end", primary: true, scrollbar: "auto" });
	const input = new Input();
	let busy = false;

	let assistantBuffer = "";
	let assistantText = null;

	const addLine = (text) => {
		lines.addChild(new Text(text, 0, 0));
	};
	const endAssistant = () => {
		assistantText = null;
		assistantBuffer = "";
	};

	input.onSubmit = (value) => {
		if (busy || !value.trim()) return;
		addLine("you> " + value);
		onLine(value.trim());
	};

	tui.addChild(status);
	tui.addChild(scroll);
	tui.addChild(input);
	tui.setFocus(input);
	tui.addInputListener((data) => {
		if (matchesKey(data, "ctrl+c")) {
			if (busy) {
				onInterrupt();
			} else {
				tui.stop();
				process.exit(0);
			}
		}
	});
	tui.start();

	return {
		setBusy(value) {
			busy = value;
		},
		setStatus(line) {
			status.setText(line);
		},
		appendAssistant(delta) {
			if (!assistantText) {
				assistantText = new Text("", 0, 0);
				lines.addChild(assistantText);
			}
			assistantBuffer += delta;
			assistantText.setText(assistantBuffer);
		},
		endAssistant,
		addTool(line) {
			endAssistant();
			addLine("⚙ " + line);
		},
		addToolResult(text, isError) {
			addLine((isError ? "✗ " : "✓ ") + text);
		},
		addError(text) {
			addLine("[error] " + text);
		},
		focus() {
			tui.setFocus(input);
		},
		stop() {
			tui.stop();
		},
	};
}
export default createTuiHost;
