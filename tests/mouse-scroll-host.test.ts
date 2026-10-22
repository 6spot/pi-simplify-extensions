import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { tmpdir } from "node:os";
import { CustomEditor, initTheme, InteractiveMode } from "@earendil-works/pi-coding-agent";
import {
	Container,
	getKeybindings,
	Input,
	setKeybindings,
	stripTerminalSequences,
} from "@earendil-works/pi-tui";
import {
	installToolMouseInteraction,
	teardownToolMouseInteraction,
} from "../extensions/renderer/mouse/interaction.ts";
import { createLazyProxy } from "./fixtures/lazy-tui.ts";

// Use Pi's actual renderer, chat layout, widget lifecycle and editor presentation.
const hostModule = (path: string) =>
	new URL(path, import.meta.resolve("@earendil-works/pi-coding-agent")).href;
const [
	{ createInteractiveTui },
	{ createChatViewport },
	{ getEditorTheme },
	{ KeybindingsManager },
] = await Promise.all([
	import(hostModule("./modes/interactive/tui-renderer.js")),
	import(hostModule("./modes/interactive/chat-viewport.js")),
	import(hostModule("./modes/interactive/theme/theme.js")),
	import(hostModule("./core/keybindings.js")),
]);
initTheme("dark");

const WIDTH = 80;
const theme = {
	fg: (_color: string, text: string) => `\x1b[37m${text}\x1b[39m`,
	bg: (_color: string, text: string) => `\x1b[44m${text}\x1b[49m`,
};

function realFrame(t: TestContext) {
	const bindings = getKeybindings();
	const keybindings = new KeybindingsManager();
	setKeybindings(keybindings);
	const terminal: any = {
		columns: WIDTH,
		rows: 12,
		isTTY: true,
		write() {},
		onData: () => () => {},
		setRawMode() {},
		getColorMode: () => "truecolor",
		start() {},
		stop() {},
		showCursor() {},
		hideCursor() {},
	};
	const renderer: any = createInteractiveTui({
		tuiMode: "fullscreen",
		showHardwareCursor: false,
		logDirectory: tmpdir(),
		terminal,
		fullscreenWheelScrollLines: 3,
	});
	const original = renderer.scrollToEndIndicator;
	const originalViewportInput = renderer.handleViewportInput;
	renderer.altScreenActive = true;
	// Deterministic frames, no terminal/timer loop. All layout/compositing/input code is real Pi.
	renderer.requestRender = () => {};
	const tui = createLazyProxy(() => renderer);
	const messages = new Container();
	messages.addChild({
		render: () => Array.from({ length: 80 }, (_, i) => `transcript line ${i}`),
		invalidate() {},
	});
	// Minimal host state, not a copied layout: renderWidgets owns the default spacer,
	// and setExtensionWidget owns placement, coexistence and disposal of widgets.
	const host = Object.assign(Object.create(InteractiveMode.prototype), {
		ui: tui,
		widgetContainerAbove: new Container(),
		widgetContainerBelow: new Container(),
		extensionWidgetsAbove: new Map(),
		extensionWidgetsBelow: new Map(),
	});
	host.renderWidgets();
	const editor = new CustomEditor(tui, getEditorTheme(), keybindings, {
		embedWorkingStatus: true,
	});
	const editorContainer = new Container();
	editorContainer.addChild(editor);
	const viewport = createChatViewport({
		document: messages,
		pendingMessages: new Container(),
		status: new Container(),
		widgetsAbove: host.widgetContainerAbove,
		editor: editorContainer,
		widgetsBelow: host.widgetContainerBelow,
		footer: new Container(),
		scrollbar: "always", // Avoid the native auto-scrollbar's hide timer.
	});
	const scroll = viewport.transcript;
	renderer.setLayoutRoot(viewport.root);
	renderer.setFocus(editor);
	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			theme,
			setWidget(key: string, content: any, options?: { placement: "aboveEditor" | "belowEditor" }) {
				host.setExtensionWidget(key, content, options);
			},
			onTerminalInput(handler: (data: string) => any) {
				return renderer.addInputListener(handler);
			},
		},
	};
	const owner = {};
	t.after(() => {
		teardownToolMouseInteraction(owner);
		host.clearExtensionWidgets();
		renderer.stop();
		setKeybindings(bindings);
	});
	const render = () => {
		renderer.doRender();
		return renderer.getScreenLines() as string[];
	};
	render();
	scroll.scrollTo(10, { disableFollow: true });
	render();
	return {
		renderer,
		tui,
		editor,
		widgetsAbove: host.widgetContainerAbove as Container,
		scroll,
		ctx,
		owner,
		terminal,
		original,
		originalViewportInput,
		render,
		install() {
			installToolMouseInteraction(ctx, owner);
		},
	};
}

test("rebound bottom key stays with a focused overlay and only Pi's binding follows output", async (t) => {
	const frame = realFrame(t);
	getKeybindings().setUserBindings({ "tui.altScreen.bottom": "end" });
	frame.install();
	const dockRow = () =>
		frame
			.render()
			.map(stripTerminalSequences)
			.find((line) => line.includes("Back to bottom"))
			?.trim();
	const settle = () => new Promise((resolve) => process.nextTick(resolve));
	frame.renderer.handleTerminalInput("\x1b[<64;2;2M"); // Wheel up through the real input chain.
	await settle();
	assert.equal(dockRow(), "[ ↓ Back to bottom · End ]");

	const input = new Input();
	input.setValue("abc");
	input.handleInput("\x1b[H"); // Home: cursor before abc.
	const overlay = frame.renderer.showOverlay(input, { width: 30, maxHeight: 1 });
	frame.render();
	frame.renderer.handleTerminalInput("\x1b[F"); // End
	frame.renderer.handleTerminalInput("z");
	assert.equal(input.getValue(), "abcz", "Pi defers End to the focused overlay input");
	assert.equal(frame.scroll.isFollowingEnd, false, "the transcript underneath does not move");
	overlay.hide();

	frame.renderer.handleTerminalInput("\x1b[1;5F"); // Ctrl+End
	assert.equal(frame.scroll.isFollowingEnd, false, "the old default is not a hidden shortcut");
	frame.renderer.handleTerminalInput("\x1b[F"); // End
	await settle();
	assert.equal(frame.scroll.isFollowingEnd, true, "the rebound key follows output");
	assert.equal(dockRow(), undefined, "the dock row hides at the bottom");
});

test("dock widget suppresses and restores Pi overlay through the real host lifecycle", (t) => {
	const frame = realFrame(t);
	const originalText = frame.original.call(frame.renderer);
	frame.install();
	frame.render();
	assert.equal(frame.renderer.scrollToEndIndicator, undefined);
	assert.equal(frame.renderer.scrollToEndIndicatorRect, undefined);
	teardownToolMouseInteraction(frame.owner);
	teardownToolMouseInteraction(frame.owner);
	assert.equal(frame.renderer.scrollToEndIndicator(), originalText);
	assert.equal(frame.renderer.handleViewportInput, frame.originalViewportInput);
});
