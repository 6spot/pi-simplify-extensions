import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as strip } from "node:util";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { installDefaultMode } from "../extensions/renderer/default-mode.ts";
import { WriteExecutionMetadataStore } from "../extensions/renderer/tool/diff/index.ts";
import {
	codemodeCalls,
	codemodeCollapsedLines,
	codemodeExpandedBody,
	codemodeOutputLineCount,
	codemodeCodeSummary,
	highlightCodeSummary,
	codemodeOutputText,
	codemodeSummaryParts,
	createCodemodeResultComponent,
} from "../extensions/renderer/tool/codemode.ts";
import { toolCallSummary } from "../extensions/renderer/tool/names.ts";

initTheme("dark");
const theme = { fg: (_slot: string, text: string) => text } as any;
const HEADER = "Script completed\nWall time 1.9 seconds\nOutput:\n";
const call = (extra: Record<string, unknown> = {}) => ({
	id: "c/1",
	name: "ffgrep",
	args: '{"pattern":"mcp","path":"src/"}',
	status: "ok",
	durationMs: 31,
	...extra,
});
const result = (extra: Record<string, unknown> = {}, calls: unknown[] = [call()]) => ({
	content: [
		{ type: "text", text: HEADER },
		{ type: "text", text: "--- grep ---\nnames.ts" },
	],
	details: { calls },
	...extra,
});
const preview = (value: any, width = 100, running = false, code?: string) =>
	codemodeCollapsedLines({ result: value, theme, running, isError: false, width, code }).map(strip);
const summary = (calls: any[], running = false) =>
	codemodeSummaryParts(calls, 0, running).join(" · ");

test("Codemode output excludes only the actual separate script banner and discloses display limits", () => {
	assert.equal(codemodeOutputText(result()), "--- grep ---\nnames.ts");
	assert.equal(codemodeOutputLineCount(result()), 2);
	assert.equal(codemodeOutputLineCount({ content: [{ type: "text", text: HEADER + "body" }] }), 4);
	const large = result({ content: [{ type: "text", text: "x".repeat(40000) }] });
	assert.match(codemodeOutputText(large), /Display limit reached/);
	assert.equal(codemodeOutputLineCount(large), 0, "an excerpt is not a complete result line count");
	assert.match(preview(large).join("\n"), /More output hidden[\s\S]*Display limit reached/);
});

test("Codemode counts done, failure, running, cancellation and unknown separately", () => {
	assert.equal(summary([], false), "No calls");
	assert.equal(summary([], true), "running…");
	assert.equal(summary([call()]), "1 done");
	assert.equal(
		summary(
			[
				call(),
				call({ status: "error" }),
				call({ status: "running" }),
				call({ status: "cancelled" }),
				call({ status: undefined }),
			],
			true,
		),
		"1 done · 1 failed · 1 running · 1 cancelled · 1 unknown",
	);
});

test("malformed nested data remains unknown, preserves errors, and never adds body expansion controls", () => {
	const malformed = { content: [], details: { calls: "nope" } };
	assert.deepEqual(codemodeCalls(malformed), []);
	assert.deepEqual(preview(malformed), [" No output"]);
	const value = result({}, [
		null,
		{ name: "read" },
		call({ args: 42 }),
		call({ status: "error", error: "NATIVE_FAILURE" }),
	]);
	const rows = preview(value);
	assert.match(rows[0]!, /○ Tool.*status unknown/);
	assert.match(rows[1]!, /○ Read.*status unknown/);
	assert.match(rows.join("\n"), /✗.*NATIVE_FAILURE/);
	assert.doesNotMatch(rows.join("\n"), /Expand|Collapse/);
	const component = createCodemodeResultComponent({
		result: value,
		theme,
		running: false,
		isError: false,
	});
	for (const line of component.render(100))
		assert.equal(component.isCollapsedHintLine(line), false);
});

test("collapsed Codemode keeps six most recent actual calls, a bounded result preview and explicit omissions", () => {
	const calls = Array.from({ length: 11 }, (_, i) =>
		call({ name: "read", args: JSON.stringify({ path: `src/f${i + 1}.ts` }), durationMs: 5 + i }),
	);
	const source = result({}, calls);
	const original = structuredClone(source);
	for (const running of [false, true]) {
		const rows = preview(source, 100, running);
		assert.match(rows[0]!, /5 earlier calls/);
		assert.equal(rows.filter((row) => /├ ✓ Read/.test(row)).length, 6);
		assert.match(rows[1]!, /f6\.ts/);
		assert.match(rows.join("\n"), /f11\.ts[\s\S]*--- grep ---[\s\S]*names.ts/);
		assert.doesNotMatch(rows.join("\n"), /Expand|Collapse/);
	}
	assert.deepEqual(source, original);
});

test("script-only preview uses two statements while preserving source in expanded Input", () => {
	const code = "const rows = scan()\nconst hits = grep(rows)\nreturn write(hits)";
	const rows = preview(result({}, []), 160, false, code);
	assert.match(rows[0]!, /const rows = scan\(\)/);
	assert.match(rows[1]!, /const hits = grep\(rows\)/);
	assert.match(rows[2]!, /1 more statement/);
	assert.match(rows.join("\n"), /names.ts/);
	assert.equal(
		codemodeCodeSummary(
			'// @options: {}\n/* comment */\nreturn rows.filter(row => row.includes("a"))',
		),
		'return rows.filter(row => row.includes("a"))',
	);
	assert.equal(codemodeCodeSummary("// only comment"), undefined);
	assert.equal(codemodeCodeSummary(42), undefined);
	const text = 'return rows.includes("a")';
	assert.match(highlightCodeSummary(text), /\x1b\[/);
	assert.equal(strip(highlightCodeSummary(text)), text);
});

const previewArgs = (value: unknown) => {
	const json = JSON.stringify(value) ?? "";
	return json.length > 200 ? json.slice(0, 197) + "..." : json;
};
test("truncated nested arguments retain real path/query and leave unparseable payloads visible", () => {
	const edit = previewArgs({
		path: "README.en.md",
		edits: [{ oldText: "old", newText: "x".repeat(300) }],
	});
	assert.throws(() => JSON.parse(edit));
	assert.match(
		preview(result({}, [call({ name: "edit", args: edit })]))[0]!,
		/✓ Edit README\.en\.md/,
	);
	const grep = previewArgs({
		pattern: "mcp",
		path: "src/",
		glob: "**/*.ts",
		extra: "x".repeat(300),
	});
	assert.match(preview(result({}, [call({ args: grep })]))[0]!, /Ffgrep "mcp" in src\//);
	assert.match(preview(result({}, [call({ args: '["mcp","src/…' })]))[0]!, /\["mcp","src\/…/);
});

test("expanded Codemode preserves every call, actual errors, output and output path without duplicating errors", () => {
	const source = result({}, [
		call(),
		call({ name: "fffind", args: '{"pattern":"mcp"}', status: "error", error: "boom\nbang" }),
	]);
	source.details = { ...source.details, fullOutputPath: "C:\\tmp\\out.txt" } as any;
	const body = codemodeExpandedBody(source);
	assert.match(
		body,
		/ffgrep.*31ms[\s\S]*fffind.*31ms[\s\S]*boom\n    bang[\s\S]*--- grep ---\nnames.ts[\s\S]*Full output: C:/,
	);
	assert.equal((body.match(/boom/g) ?? []).length, 1);
});

test("Codemode rows retain measured durations/costs, remain width-safe and disclose cropped output", () => {
	const source = result({ content: [{ type: "text", text: "one\ntwo\nthree\nfour\nfive\nsix" }] }, [
		call({ durationMs: 1234.5, cost: 0.0031 }),
	]);
	assert.match(preview(source)[0]!, /1\.2s \$0\.0031/);
	for (const width of [20, 40, 60, 100]) {
		const rows = preview(source, width);
		assert.ok(rows.every((row) => visibleWidth(row) <= Math.max(1, width)));
		assert.match(rows.at(-1)!, /More output hidden|…/);
	}
});

test("codemode input remains a dedicated source view rather than a script pasted into the title", () => {
	for (const args of [
		{ code: "return 1" },
		{ code: "const x = 1\nreturn x" },
		{ code: "// comment" },
	])
		assert.deepEqual(toolCallSummary("codemode", args), { main: "Codemode", detail: "" });
	assert.equal(toolCallSummary("mcpscript", { code: "return 1" }).payload, "return 1");
	assert.equal(toolCallSummary("read", { path: "a.ts" }).path?.value, "a.ts");
});

test("native Codemode title is the only expansion control through streaming, completion, failure and malformed data", () => {
	const hooks = installDefaultMode(new WriteExecutionMetadataStore());
	try {
		const tool = new ToolExecutionComponent(
			"codemode",
			"cm-state",
			{ code: "return 1" },
			{},
			undefined,
			{ theme, requestRender() {}, setStatus() {} } as any,
			process.cwd(),
		) as any;
		const paint = () =>
			tool
				.render(120)
				.map(strip)
				.filter((row: string) => row.trim());
		tool.markExecutionStarted();
		assert.match(paint()[0]!, /○ Codemode/);
		tool.updateResult(result({}, [call(), call({ status: "running" })]), true);
		assert.match(paint()[0]!, /○ Codemode.*1 done · 1 running.*(?:Expand|show more)/);
		tool.updateResult(result());
		assert.match(paint()[0]!, /● Codemode.*1 done/);
		assert.equal(paint().filter((row: string) => /Expand|to show more/.test(row)).length, 1);
		tool.setExpanded(true);
		assert.match(paint()[0]!, /Collapse|to collapse/);
		tool.setExpanded(false);
		tool.updateResult(result({}, [call({ status: "error", error: "NATIVE_FAILURE" })]));
		assert.match(paint()[0]!, /✗ Codemode.*1 failed/);
		assert.match(paint().join("\n"), /NATIVE_FAILURE/);
		tool.updateResult(result({}, [null]));
		assert.match(paint()[0]!, /unknown/);
	} finally {
		hooks.shutdown();
	}
});
