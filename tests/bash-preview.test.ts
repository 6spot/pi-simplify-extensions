import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as stripAnsi } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	bashOutputText,
	createBashCallComponent,
	createBashResultComponent,
} from "../extensions/renderer/tool/bash.ts";

const theme = { fg: (_slot: string, text: string) => text };
const result = (text: string, extra = {}) => ({ content: [{ type: "text", text }], ...extra });
function rows(text: string, width = 100, args: any = { command: "echo test" }, partial = false) {
	return createBashResultComponent({ args, result: result(text), theme, isPartial: partial })
		.render(width)
		.map((line) => stripAnsi(line).trimEnd());
}

test("Bash shows the actual last four lines and explicitly discloses earlier lines", () => {
	assert.deepEqual(rows("one\ntwo\nthree\nfour\nfive\nsix"), [
		"  $ echo test",
		"  three",
		"  four",
		"  five",
		"  six",
		"  … 2 earlier lines hidden",
	]);
	assert.deepEqual(rows("one\ntwo\nthree\nfour"), [
		"  $ echo test",
		"  one",
		"  two",
		"  three",
		"  four",
	]);
	const narrow = rows("界🙂".repeat(50) + "TAIL", 28);
	assert.match(narrow.join("\n"), /TAIL/);
	assert.match(narrow.join("\n"), /Earlier output hidden/);
	assert.doesNotMatch(narrow.join("\n"), /\d+ earlier lines/);
	assert.ok(narrow.every((line) => visibleWidth(line) <= 28));
});

test("multiline commands have two visible rows and an explicit clipping notice in all states", () => {
	const args = { command: "first command\nsecond command\nthird hidden command" };
	const command = createBashCallComponent({
		args,
		context: {},
		theme,
		elapsed: () => undefined,
		isHovered: () => false,
	});
	const pending = command.render(100).map((line) => stripAnsi(line).trimEnd());
	assert.deepEqual(pending.slice(1), [
		"  $ first command",
		"  second command",
		"  … More command hidden",
	]);
	const returned = rows("real output", 100, args);
	assert.deepEqual(returned, [
		"  $ first command",
		"  second command",
		"  … More command hidden",
		"  real output",
	]);
	assert.equal(args.command, "first command\nsecond command\nthird hidden command");
});

test("native Bash limits and full-output paths remain complete outside the output preview", () => {
	const notice =
		"[Showing lines 20-25 of 25 (50KB limit). Full output: /tmp/a-very-long-output-path-that-wraps-on-a-small-terminal.txt]";
	const original = "one\ntwo\nthree\nfour\nfive\nsix\n\n" + notice;
	const output = result(original, { details: { truncation: { truncated: true } } });
	const rendered = createBashResultComponent({
		args: { command: "run" },
		result: output,
		theme,
		isPartial: false,
	})
		.render(35)
		.map(stripAnsi);
	const flat = rendered.join("").replace(/\s/g, "");
	assert.ok(flat.includes(notice.replace(/\s/g, "")));
	assert.match(rendered.join("\n"), /2 earlier lines hidden/);
	assert.equal(output.content[0].text, original);
	assert.equal(bashOutputText(output), original);
	assert.ok(rendered.every((line) => visibleWidth(line) <= 35));
});

test("empty, waiting and stored output do not invent status or source counts", () => {
	assert.deepEqual(rows(""), ["  $ echo test", "  No output"]);
	assert.deepEqual(rows("", 100, undefined, true), ["  $ echo test", "  Waiting for output…"]);
	const stored =
		"[large tool result replaced after its first 2 provider requests]\nid: obs_123\noriginal_lines: 1000\nexcerpt\nmore\nexcerpt";
	const rendered = rows(stored).join("\n");
	assert.match(rendered, /Earlier output hidden/);
	assert.doesNotMatch(rendered, /\d+ earlier lines/);
	const whitespace = "first\n\nlast\n";
	assert.equal(bashOutputText(result(whitespace)), whitespace);
	assert.deepEqual(rows(whitespace), ["  $ echo test", "  first", "", "  last", ""]);
});

test("shell titles humanize the supplied tool name and preserve cancellation state", () => {
	for (const [toolName, label] of [
		[undefined, "Bash"],
		["powershell", "PowerShell"],
		["zsh", "Zsh"],
	] as const) {
		const component = createBashCallComponent({
			toolName,
			args: { command: "run" },
			theme,
			context: { result: result("Command aborted", { isError: true }) },
			elapsed: () => undefined,
			isHovered: () => false,
		});
		const title = stripAnsi(component.render(100)[0]);
		assert.ok(title.startsWith(`– ${label} · Cancelled`));
		assert.doesNotMatch(title, /exit 0/);
	}
});
