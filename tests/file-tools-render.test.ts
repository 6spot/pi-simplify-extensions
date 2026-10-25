import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as stripAnsi } from "node:util";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { expandedIoForTool } from "../extensions/renderer/tool/tool-io.ts";
import { config } from "../extensions/config/config.ts";
import {
	installDefaultMode,
	installToolExpandedBackground,
} from "../extensions/renderer/default-mode.ts";
import { fileToolView } from "../extensions/renderer/tool/file-tools.ts";
import { installToolGrouping } from "../extensions/renderer/tool/grouping.ts";
import { setMessageDisplayTheme } from "../extensions/renderer/tool/message-display.ts";
import { WriteExecutionMetadataStore } from "../extensions/renderer/tool/diff/index.ts";

initTheme("dark");
const slots: string[] = [];
const theme = {
	fg: (_slot: string, text: string) => text,
	bg: (slot: string, text: string) => {
		slots.push(slot);
		return text;
	},
};
const ui = { theme, requestRender() {}, setStatus() {} } as any;
const output = (text: string, extra: any = {}) => ({
	content: [{ type: "text", text }],
	isError: false,
	...extra,
});
const tool = (name: string, args: any, id = name) =>
	new ToolExecutionComponent(name, id, args, {}, undefined, ui, process.cwd()) as any;
const render = (component: any, width = 110) => component.render(width).map(stripAnsi).join("\n");
function install() {
	setMessageDisplayTheme(theme);
	const hooks = installDefaultMode(new WriteExecutionMetadataStore());
	const background = installToolExpandedBackground();
	return () => {
		background();
		hooks.shutdown();
		setMessageDisplayTheme(undefined);
	};
}

test("Grep counts native matching lines, not context or native limit notices, and preserves unknown/error results", () => {
	const text =
		"src/a.ts-2- before\nsrc/a.ts:3: needle\nsrc/a.ts-4- after\nsrc/a.ts:5: second needle\n\n[2 matches limit reached. Use limit=4 for more, or refine pattern. Some lines truncated to 500 chars. Use read tool to see full lines]";
	const result = output(text, { details: { matchLimitReached: 2, linesTruncated: true } });
	const view = fileToolView("grep", {}, result);
	assert.equal(view.summary, "2 matches shown · limit reached · lines truncated");
	assert.equal(view.body.split("\n").length, 4);
	assert.equal(result.content[0].text, text);
	assert.equal(fileToolView("grep", {}, output("No matches found")).summary, "No matches");
	assert.equal(
		fileToolView("grep", {}, output("No matches found", { isError: true })).summary,
		undefined,
	);
	assert.equal(fileToolView("grep", {}, output("unknown result format")).summary, undefined);
	for (const name of ["grep", "find", "read"])
		assert.equal(
			fileToolView(name, {}, { content: [], details: { explanation: "metadata only" } }).summary,
			undefined,
		);
	assert.equal(
		fileToolView(
			"grep",
			{},
			output("a.ts:1: first\n\n[50KB limit reached]", {
				details: { truncation: { truncated: true } },
			}),
		).summary,
		"1 match shown · truncated",
	);
});

test("Find counts returned paths including directories, with truthful empty and limit states", () => {
	assert.equal(
		fileToolView("find", {}, output("No files found matching pattern")).summary,
		"No paths found",
	);
	const view = fileToolView(
		"find",
		{},
		output("src/\nsrc/a.ts\n\n[2 results limit reached. Use limit=4 for more]"),
	);
	assert.equal(view.summary, "2 paths shown · limit reached");
	assert.equal(view.body, "src/\nsrc/a.ts");
	assert.equal(fileToolView("find", {}, output("a.ts")).summary, "1 path");
});

test("Read derives accepted ranges without counting continuation notices, preserving empty lines and invalid notices", () => {
	const args = { path: "src/a.ts", offset: 20, limit: 3 };
	const view = fileToolView(
		"read",
		args,
		output("one\n\nthree\n\n[12 more lines in file. Use offset=23 to continue.]"),
	);
	assert.equal(view.summary, "lines 20–22");
	assert.equal(view.body, "one\n\nthree");
	assert.deepEqual(view.notices, ["More available · offset=23"]);
	const truncated = fileToolView(
		"read",
		{ offset: 2 },
		output("a\nb\n\n[Showing lines 2-3 of 80 (50KB limit). Use offset=4 to continue.]", {
			details: { truncation: { truncated: true } },
		}),
	);
	assert.equal(truncated.summary, "lines 2–3");
	assert.deepEqual(truncated.notices, ["More available · offset=4", "Read limit reached"]);
	const malformed = output("a\nb\n\n[Showing lines 2-8 of 80. Use offset=9 to continue.]");
	assert.equal(fileToolView("read", { offset: 2 }, malformed).summary, undefined);
	assert.equal(fileToolView("read", { offset: 2 }, malformed).body, malformed.content[0].text);
	// A file can itself contain native-looking prose. Without the matching request, keep it as unknown text.
	const prose = output("actual file content\n\n[3 more lines in file. Use offset=2 to continue.]");
	assert.equal(fileToolView("read", {}, prose).summary, undefined);
	assert.equal(fileToolView("read", {}, prose).body, prose.content[0].text);
	assert.equal(
		fileToolView(
			"read",
			{ offset: 2 },
			output("a\nb\n\n[Showing lines 2-3 of 1. Use offset=4 to continue.]"),
		).summary,
		undefined,
	);
	assert.equal(
		fileToolView("read", {}, output("a\n\n[3 more lines in file. Use offset=2.5 to continue.]"))
			.summary,
		undefined,
	);
	assert.equal(fileToolView("read", {}, output("")).summary, "0 lines");
	assert.equal(fileToolView("read", {}, output("one\n")).summary, "lines 1–2");
	assert.equal(
		fileToolView(
			"read",
			{},
			output("[Line 1 is 90KB, exceeds 50KB limit. Use bash: head -c 51200 x]"),
		).summary,
		"Line exceeds read limit",
	);
});

test("Read images and SoL-Pi stored observations never turn into fabricated line/path counts", () => {
	const image = { type: "image", mimeType: "image/png", data: "unchanged" };
	const result = { content: [{ type: "text", text: "Read image file [image/png]" }, image] };
	assert.equal(fileToolView("read", {}, result).summary, "Image");
	assert.equal(result.content[1], image);
	assert.equal(
		fileToolView(
			"read",
			{},
			output(
				"Read image file [image/png]\n[Image omitted: could not be resized below the inline image size limit.]",
			),
		).summary,
		"Image omitted",
	);
	for (const name of ["read", "grep", "find"]) {
		const stored = output(
			"[large tool result replaced after its first 2 provider requests]\nid: obs_123\noriginal_lines: 1000\nexcerpt",
		);
		assert.equal(fileToolView(name, {}, stored).summary, "Stored result");
	}
});

test("file panels preview arguments, stream output without accepting counts early, and replace final/error states", () => {
	const cleanup = install();
	try {
		const search = tool("grep", { pattern: "needle", path: "src/" });
		assert.match(render(search), /○ Grep/);
		assert.match(render(search), /Receiving arguments…/);
		assert.doesNotMatch(render(search), /matches|lines returned/);
		search.markExecutionStarted();
		assert.match(render(search), /Searching…/);
		search.updateResult(output("a.ts:2: needle"), true);
		assert.match(render(search), /○ Grep · [^\n]*Expand/);
		assert.equal(render(search).match(/Expand/g)?.length, 1);
		assert.doesNotMatch(render(search), /1 match/);
		assert.match(render(search), /a.ts:2: needle/);
		search.updateResult(output("No matches found"));
		assert.match(render(search), /✓ Grep · No matches · [^\n]*Expand/);
		assert.doesNotMatch(render(search), /a.ts:2: needle|1 line/);
		assert.equal(search.render(110), search.render(110), "settled renders reuse cache");
		search.updateResult(output("Operation aborted", { isError: true }));
		assert.match(render(search), /– Grep · cancelled · [^\n]*Expand/);
		assert.match(render(search), /Operation aborted/);
		assert.doesNotMatch(render(search), /No matches|✓ Grep/);
		const read = tool("read", { path: "src/a.ts", offset: 10, limit: 2 });
		read.markExecutionStarted();
		assert.match(render(read), /offset=10 · limit=2/);
		assert.match(render(read), /Reading…/);
		read.updateResult(output("a\nb\n\n[9 more lines in file. Use offset=12 to continue.]"));
		assert.match(render(read), /✓ Read · lines 10–11 · [^\n]*Expand/);
		assert.equal(render(read).match(/Expand/g)?.length, 1);
		assert.match(render(read), /More available · offset=12/);
		assert.doesNotMatch(render(read), /offset=10|lines loaded/);
		const metadataError = tool("read", { path: "unavailable.ts" });
		metadataError.updateResult({
			content: [],
			isError: true,
			details: { reason: "ACTUAL_METADATA_ERROR" },
		});
		assert.match(render(metadataError), /ACTUAL_METADATA_ERROR/);
		metadataError.setExpanded(true);
		assert.match(render(metadataError), /✗ Read · Collapse/);
		assert.match(render(metadataError), /ACTUAL_METADATA_ERROR/);
		assert.ok(!slots.includes("toolPendingBg"), "collapsed file panels are transparent");
		assert.ok(slots.includes("toolErrorBg"));
	} finally {
		cleanup();
	}
});

test("file panels expand full available input/output, preserve controls safely, and fit narrow Unicode widths", () => {
	const cleanup = install();
	const original = config.expandedOutputMaxLines;
	config.expandedOutputMaxLines = 1000;
	try {
		const incoming = tool("grep", {
			pattern: `${"long_pattern_".repeat(20)}UNIQUE_QUERY_TAIL`,
			path: "src",
		});
		assert.match(render(incoming, 40), /○ Grep · [^\n]*Expand/);
		assert.doesNotMatch(render(incoming, 40), /UNIQUE_QUERY_TAIL/);
		incoming.setExpanded(true);
		assert.match(render(incoming, 40), /Input · Open preview/);
		assert.ok(expandedIoForTool(incoming)?.getInputBody().includes("UNIQUE_QUERY_TAIL"));
		for (const name of ["grep", "find", "read"]) {
			const args =
				name === "read"
					? { path: "目录/中文🧪.ts", offset: 2, limit: 80 }
					: { pattern: "中文🧪", path: "目录", limit: 80 };
			const body = Array.from({ length: 80 }, (_, index) =>
				name === "grep"
					? `中文🧪.ts:${index + 1}: value_${index}`
					: name === "find"
						? `目录/中文🧪_${index}.ts`
						: `const value_${index} = ${index};`,
			).join("\n");
			const result = output(body);
			const component = tool(name, args);
			component.updateResult(result);
			assert.match(
				render(component),
				new RegExp(`✓ ${name[0].toUpperCase()}${name.slice(1)}[^\\n]* · [^\\n]*Expand`),
			);
			assert.equal(render(component).match(/Expand/g)?.length, 1);
			assert.doesNotMatch(render(component), /value_79|中文🧪_79/);
			component.setExpanded(true);
			const expanded = render(component);
			assert.match(expanded, / · Collapse/);
			assert.match(expanded, /Input/);
			assert.match(expanded, /Output/);
			assert.match(expanded, name === "find" ? /中文🧪_79/ : /value_79/);
			component.setExpanded(false);
			for (const width of [12, 24, 40, 110])
				for (const line of component.render(width))
					assert.ok(visibleWidth(line) <= width, `${name} ${width}: ${stripAnsi(line)}`);
			assert.equal(result.content[0].text, body);
		}
		const malicious = tool("find", { pattern: "*.ts\x1b[2J", path: "." });
		malicious.updateResult(output("safe.ts\x1b[2J"));
		assert.ok(!malicious.render(110).join("\n").includes("\x1b[2J"));
	} finally {
		config.expandedOutputMaxLines = original;
		cleanup();
	}
});

test("grouped file tools keep one-row summaries with actual result ranges, empty states, limits, and expansion", () => {
	const cleanup = install();
	const grouping = installToolGrouping(() => true);
	grouping.setTheme(theme);
	try {
		const parent = new Container();
		const grep = tool("grep", { pattern: "needle", path: "src" });
		const read = tool("read", { path: "src/a.ts", offset: 3, limit: 2 });
		const find = tool("find", { pattern: "*.ts", path: "src" });
		for (const item of [grep, read, find]) parent.addChild(item);
		assert.match(render(parent), /○ Grep "needle" in src/);
		grep.updateResult(output("a.ts:2: needle"));
		read.updateResult(output("one\ntwo\n\n[6 more lines in file. Use offset=5 to continue.]"));
		find.updateResult(output("No files found matching pattern"));
		const grouped = render(parent);
		assert.match(grouped, /├ ✓ Grep "needle" in src · 1 match/);
		assert.match(grouped, /├ ✓ Read src\/a.ts · lines 3–4/);
		assert.match(grouped, /└ ✓ Find "\*\.ts" in src · No paths found/);
		assert.doesNotMatch(grouped, /a.ts:2: needle|More available|1 line/);
		(parent.children[0] as any).setExpanded(true);
		assert.match(render(parent), /a.ts:2: needle/);
		assert.match(render(parent), /Use offset=5 to continue/);
	} finally {
		grouping.shutdown();
		cleanup();
	}
});

test("restored file cards adopt a new rendering installation without raw JSON or repeated recomposition", () => {
	const result = output("a.ts:2: needle");
	const restored = tool("grep", { pattern: "needle", path: "src" });
	restored.updateResult(result);
	const originalUpdate = restored.updateDisplay.bind(restored);
	let updates = 0;
	restored.updateDisplay = () => {
		updates++;
		return originalUpdate();
	};
	let cleanup = install();
	try {
		assert.match(render(restored), /✓ Grep · 1 match/);
		assert.doesNotMatch(render(restored), /"pattern"|"path"/);
		assert.equal(updates, 1);
		render(restored);
		assert.equal(updates, 1);
		cleanup();
		cleanup = install();
		assert.match(render(restored), /✓ Grep · 1 match/);
		assert.equal(updates, 2);
	} finally {
		cleanup();
	}
});
