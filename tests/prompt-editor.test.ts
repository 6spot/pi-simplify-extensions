import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import {
	applyPromptEditor,
	clearPromptEditor,
	inputTextIndent,
	PromptEditor,
} from "../extensions/feature/shell/prompt-editor.ts";
import { stripAnsi } from "../extensions/utils/ansi-text.ts";

test("Codex-style editor uses a separate Working row and restores the previous editor", () => {
	let factory: any = () => ({ native: true });
	const original = factory;
	const ctx = {
		hasUI: true,
		ui: {
			getEditorComponent: () => factory,
			setEditorComponent: (next: any) => { factory = next; },
			theme: { bg: (_color: string, text: string) => text },
			notify: () => {},
		},
	} as unknown as ExtensionContext;
	applyPromptEditor(ctx);
	assert.notEqual(factory, original);
	const editor = factory({ requestRender() {} }, { borderColor: (text: string) => text }, {});
	assert.equal(editor.embedWorkingStatus, false);
	clearPromptEditor(ctx);
	assert.equal(factory, original);
});

function promptEditor() {
	return new PromptEditor(
		{ terminal: { rows: 20, columns: 80 }, requestRender() {} } as any,
		{ borderColor: (text: string) => text } as any,
		{ matches: () => false } as any,
		{ embedWorkingStatus: false },
	);
}

const plain = (line: string) => stripAnsi(line.replaceAll(CURSOR_MARKER, ""));

test("rounded input frame preserves width, text and native scroll indicators without a prompt symbol", () => {
	const editor = promptEditor();
	editor.setText("你好 hello 🙂");
	const lines = editor.render(24).map(plain);
	assert.equal(lines[0], `╭${"─".repeat(22)}╮`);
	assert.equal(lines.at(-1), `╰${"─".repeat(22)}╯`);
	assert.match(lines[1], /^│ 你好 hello 🙂/);
	assert.ok(lines.every((line) => visibleWidth(line) === 24));
	assert.ok(lines.every((line) => !line.includes("❯")));
	assert.equal(editor.getText(), "你好 hello 🙂");

	editor.setText(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"));
	const scrolled = editor.render(24).map(plain);
	assert.match(scrolled[0], /^╭.*↑.*╮$/);
	assert.ok(scrolled.every((line) => visibleWidth(line) === 24));
});

test("input padding stays consistent for rendering, hardware cursor, mouse clicks and editing", () => {
	const editor = promptEditor();
	editor.setPaddingX(0);
	assert.equal(editor.getPaddingX(), 2);
	editor.focused = true;
	editor.setText("abc");
	let line = editor.render(20)[1];
	assert.equal(visibleWidth(line.slice(0, line.indexOf(CURSOR_MARKER))), 5);
	assert.equal(inputTextIndent(), 2);
	editor.handleMouse({
		type: "click", button: "left", x: 3, y: 1, width: 20, height: 3,
		screenX: 3, screenY: 1, shift: false, alt: false, ctrl: false,
	});
	assert.equal(editor.getCursor().col, 1);
	editor.handleInput("Z");
	assert.equal(editor.getText(), "aZbc");
	editor.handleInput("\x1b[D");
	editor.handleInput("Q");
	assert.equal(editor.getText(), "aQZbc");

	editor.setPaddingX(5);
	editor.setText("a");
	line = editor.render(20)[1];
	assert.equal(visibleWidth(line.slice(0, line.indexOf(CURSOR_MARKER))), 6);
	assert.equal(inputTextIndent(), 5);
	assert.match(plain(line), /^│ {4}a/);
});

test("rounded frame and background stop before autocomplete and preserve its mouse geometry", () => {
	const editor = promptEditor();
	const background = "\x1b[48;2;37;40;45m";
	editor.setBackgroundPainter((line) => `${background}${line}\x1b[49m`);
	let click: any;
	Object.assign(editor, {
		autocompleteState: "prefix",
		autocompleteList: {
			render: () => ["completion"],
			handleMouse(event: any) {
				click = event;
				return { handled: true };
			},
		},
	});
	const lines = editor.render(20);
	assert.equal(lines.length, 4);
	assert.ok(lines.slice(0, 3).every((line) => line.includes(background)));
	assert.equal(plain(lines[2]), `╰${"─".repeat(18)}╯`);
	assert.equal(lines[3], `  completion${" ".repeat(8)}`);
	assert.ok(!lines[3].includes(background));
	assert.ok(!lines[3].includes("│"));
	assert.ok(lines.every((line) => visibleWidth(line) === 20));
	editor.handleMouse({
		type: "click", button: "left", x: 4, y: 3, width: 20, height: 4,
		screenX: 4, screenY: 3, shift: false, alt: false, ctrl: false,
	});
	assert.equal(click.x, 2);
	assert.equal(click.y, 0);
	assert.equal(click.width, 16);
});

test("input frame handles narrow widths and a cursor overflowing into padding", () => {
	const editor = promptEditor();
	editor.setText("abc");
	assert.deepEqual(editor.render(0), []);
	for (const width of [3, 4, 5, 6, 7, 8]) {
		const lines = editor.render(width).map(plain);
		assert.ok(lines.every((line) => visibleWidth(line) === width), `width ${width}`);
		assert.equal(lines[0].startsWith("╭"), width >= 5);
		assert.equal(editor.getText(), "abc");
	}
});
