import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as stripAnsi } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	createFileToolCallComponent,
	createFileToolResultComponent,
} from "../extensions/renderer/tool/file-tools.ts";

initTheme("dark");
const theme = { fg: (_slot: string, text: string) => text };
const result = (text: string, extra = {}) => ({ content: [{ type: "text", text }], ...extra });
function rows(name: string, text: string, width = 100, args: any = { path: "src/a.ts" }) {
	return createFileToolResultComponent(name, args, result(text), theme)
		.render(width)
		.map((line) => stripAnsi(line).trimEnd());
}

test("Read discloses exactly 173 omitted source lines only when its four source lines fit", () => {
	const source = Array.from({ length: 177 }, (_, index) => `line ${index + 1}`).join("\n");
	const wide = rows("read", source);
	assert.deepEqual(wide, [
		"  src/a.ts",
		"  line 1",
		"  line 2",
		"  line 3",
		"  line 4",
		"  … 173 more lines in result",
	]);
	const narrow = rows("read", "x".repeat(100) + "\n" + source, 25);
	assert.match(narrow.join("\n"), /More output hidden/);
	assert.doesNotMatch(narrow.join("\n"), /\d+ more lines/);
	assert.ok(narrow.every((line) => visibleWidth(line) <= 25));
	assert.doesNotMatch(rows("read", "one\ntwo\nthree\nfour").join("\n"), /hidden|more lines/);
	assert.deepEqual(rows("read", "one\n\nthree"), ["  src/a.ts", "  one", "", "  three"]);
});

test("Read preserves native continuation and long-line limits separately from preview loss", () => {
	const source = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join("\n");
	const original = source + "\n\n[80 more lines in file. Use offset=201 to continue.]";
	const output = result(original);
	const rendered = createFileToolResultComponent(
		"read",
		{ path: "src/a.ts", limit: 200 },
		output,
		theme,
	)
		.render(100)
		.map(stripAnsi)
		.join("\n");
	assert.match(rendered, /196 more lines in result/);
	assert.match(rendered, /More available · offset=201/);
	assert.equal(output.content[0].text, original);
	const limit = "[Line 1 is 90KB, exceeds 50KB limit. Use bash: head -c 51200 x]";
	const limited = rows("read", limit, 100).join("\n");
	assert.match(limited, /Line 1 is 90KB/);
	assert.doesNotMatch(limited, /more lines in result/);
});

test("stored excerpts and unknown search text use nonnumeric omission notices", () => {
	const stored =
		"[large tool result replaced after its first 2 provider requests]\nid: obs_123\noriginal_lines: 1000\nexcerpt\nmore\nexcerpt";
	for (const name of ["read", "grep", "find"]) {
		const rendered = rows(name, stored, 100).join("\n");
		assert.match(rendered, /More output hidden/);
		assert.doesNotMatch(rendered, /\d+ more (?:lines|paths|matches)/);
	}
	const unknown = rows("grep", "unknown result format\nformat\nwith\nfive\nrows").join("\n");
	assert.match(unknown, /More output hidden/);
	assert.doesNotMatch(unknown, /more matches/);
});

test("Grep omission counts match lines rather than context, while Find counts returned paths", () => {
	const grep = rows(
		"grep",
		"a.ts:1: hit\na.ts-2- context\na.ts:3: hit\na.ts-4- context\na.ts:5: hit\na.ts-6- context\na.ts:7: hit\na.ts-8- context",
	).join("\n");
	assert.match(grep, /2 more matches in result/);
	assert.doesNotMatch(grep, /4 more matches/);
	const find = rows("find", "a/\na/b.ts\na/c.ts\na/d.ts\na/e.ts\na/f.ts").join("\n");
	assert.match(find, /2 more paths in result/);
	const longPath = rows("find", "very/".repeat(30) + "file.ts\na.ts\nb.ts\nc.ts\nd.ts", 30).join(
		"\n",
	);
	assert.match(longPath, /More output hidden/);
	assert.doesNotMatch(longPath, /more paths/);
});

test("long file subjects have two visible rows and disclose clipping without a decorative blank", () => {
	const args = { path: "long-directory/".repeat(15) + "file.ts" };
	const component = createFileToolCallComponent(
		"read",
		args,
		{ executionStarted: true },
		theme,
		() => false,
	);
	const preview = component.render(40).map((line) => stripAnsi(line).trimEnd());
	assert.equal(preview.length, 5);
	assert.match(preview.join("\n"), /More input hidden/);
	assert.equal(preview.at(-1), "  Reading…");
	assert.ok(preview.every((line) => line !== ""));
	assert.ok(preview.every((line) => visibleWidth(line) <= 40));
	const returned = createFileToolResultComponent("read", args, result("actual source"), theme)
		.render(40)
		.map(stripAnsi)
		.join("\n");
	assert.match(returned, /More input hidden/);
	assert.match(returned, /actual source/);
});
