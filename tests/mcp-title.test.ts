import assert from "node:assert/strict";
import test from "node:test";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import claudeCodeStyleExtension from "../extensions/renderer/index.ts";
import { installToolGrouping, ToolGroupComponent } from "../extensions/renderer/tool/grouping.ts";
import { renderToolSummary } from "../extensions/renderer/tool/names.ts";
import { isMcpToolDefinition, mcpToolTitle } from "../extensions/renderer/tool/mcp-title.ts";

initTheme("dark");
const GATEWAY = { name: "mcp", label: "MCP", renderCall() {}, renderResult() {} };
const SCRIPT = { name: "mcpScript", label: "MCP Script", renderCall() {}, renderResult() {} };
const NAMESPACE = { name: "mcp__github_search_code", label: "MCP: search_code", renderCall() {} };
const DIRECT = { name: "github_search_code", label: "MCP: search_code", renderCall() {} };
const plain = (rows: string[]) =>
	rows.map((row) => row.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")).filter((row) => row.trim());
const ui = () =>
	({
		theme: { fg: (_slot: string, text: string) => text },
		setStatus() {},
		requestRender() {},
		getToolsExpanded: () => false,
	}) as any;
const make = (definition: any, id: string, args: any, context: any) =>
	new ToolExecutionComponent(
		definition.name,
		id,
		args,
		{},
		definition,
		context,
		process.cwd(),
	) as any;
const succeed = (tool: any, args: any, text = "1 hit") => {
	tool.updateArgs(args);
	tool.markExecutionStarted();
	tool.updateResult({ content: [{ type: "text", text }], isError: false });
	return tool;
};

test("MCP identity comes from a real prefix/adapter label, never a description guess", () => {
	for (const name of [
		"mcp",
		"mcpScript",
		"mcp__github_search_code",
		"mcp__chrome_devtools",
		"mcp:github/list",
	])
		assert.equal(isMcpToolDefinition({}, name), true);
	for (const name of ["github_search_code", "search_code"])
		assert.equal(isMcpToolDefinition({ label: "MCP: search_code" }, name), true);
	assert.equal(isMcpToolDefinition({ label: "read" }, "read"), false);
	assert.equal(isMcpToolDefinition({ description: "Model Context Protocol" }, "remote"), false);
});

test("MCP names retain real registration names under namespace, direct and gateway configurations", () => {
	assert.equal(mcpToolTitle({ toolName: "mcp" }), "MCP");
	assert.equal(mcpToolTitle({ toolName: "mcpScript" }), "MCP Script");
	assert.equal(mcpToolTitle({ toolName: NAMESPACE.name }), NAMESPACE.name);
	assert.equal(mcpToolTitle({ toolName: DIRECT.name, definition: DIRECT }), DIRECT.name);
	assert.equal(mcpToolTitle({ toolName: "read", definition: { label: "read" } }), undefined);
});

test("semantic summaries retain distinct tool/input colors and bounded payloads", () => {
	const fg = (slot: string, text: string) => `<${slot}>${text}</${slot}>`;
	const summary = { main: "MCP call github_search_code", detail: "", payload: '{"query":"pi"}' };
	assert.equal(
		renderToolSummary(summary, 100, fg as any),
		'<toolTitle>MCP call github_search_code</toolTitle><mdCode> {"query":"pi"}</mdCode>',
	);
	assert.equal(
		renderToolSummary({ ...summary, main: "MCP" }, 6, fg as any),
		"<toolTitle>MCP</toolTitle>",
	);
	assert.match(
		renderToolSummary(
			{ main: "MCP", detail: "", payload: JSON.stringify({ query: "x".repeat(60) }) },
			40,
			fg as any,
		),
		/^<toolTitle>MCP<\/toolTitle><mdCode> \{"query":"x+…<\/mdCode>$/,
	);
});

async function boot(context: any) {
	const events = new Map<string, Function>();
	claudeCodeStyleExtension({
		registerCommand() {},
		registerShortcut() {},
		registerTool() {},
		on(name: string, handler: Function) {
			events.set(name, handler);
		},
	} as any);
	const ctx = { mode: "tui", hasUI: true, ui: context } as any;
	await events.get("session_start")?.({}, ctx);
	return async () => {
		await events.get("session_shutdown")?.({}, ctx);
	};
}

test("native MCP cards use one title control and preserve gateway actions, safe input and actual output", async () => {
	const context = ui();
	const shutdown = await boot(context);
	const cases: [any, any, RegExp, RegExp?][] = [
		[NAMESPACE, { query: "pi" }, /MCP · mcp__github_search_code/, /pi/],
		[DIRECT, { query: "pi" }, /MCP · github_search_code/, /pi/],
		[
			GATEWAY,
			{ tool: "github_search_code", args: { query: "pi" } },
			/MCP/,
			/call github_search_code.*query/,
		],
		[GATEWAY, { server: "chrome-devtools" }, /MCP/, /list chrome-devtools/],
		[
			GATEWAY,
			{ search: "screenshot", server: "chrome-devtools", regex: true },
			/MCP/,
			/search screenshot @ chrome-devtools \(regex\)/,
		],
		[GATEWAY, { describe: "take_screenshot" }, /MCP/, /describe take_screenshot/],
		[GATEWAY, {}, /MCP/, /status/],
		[GATEWAY, { foo: 1 }, /MCP/, /\{"foo":1\}/],
		[NAMESPACE, {}, /MCP · mcp__github_search_code/],
		[NAMESPACE, { tool: "list_pages", args: {} }, /MCP · mcp__github_search_code/, /list_pages/],
		[SCRIPT, { code: "emit(1)", timeoutMs: 30000 }, /MCP Script/, /emit\(1\)/],
		[
			{ name: "customTranslate", label: "Custom Translate" },
			{ text: "hi" },
			/Tool · customTranslate/,
			/hi/,
		],
	];
	try {
		for (const [index, [definition, args, identity, input]] of cases.entries()) {
			const original = structuredClone(args);
			const tool = succeed(make(definition, String(index), {}, context), args);
			const rows = plain(tool.render(120));
			const text = rows.join("\n");
			assert.match(rows[0]!, identity);
			if (input) assert.match(text, input);
			assert.match(text, /1 hit/);
			assert.doesNotMatch(text, /lines? returned/);
			assert.ok(rows.filter((row) => /Expand|to show more/.test(row)).length <= 1);
			if (rows.some((row) => /Expand|to show more/.test(row)))
				assert.match(rows[0]!, /Expand|to show more/);
			assert.deepEqual(tool.args, original);
		}
	} finally {
		await shutdown();
	}
});

test("MCP group identity stays Multiple Tools and each child retains its actual name/action", () => {
	const context = ui();
	const hooks = installToolGrouping(() => true);
	const groupRows = (parent: any) => plain((parent.children[0] as ToolGroupComponent).render(100));
	try {
		for (const [definition, args, child] of [
			[NAMESPACE, { query: "pi" }, "MCP · mcp__github_search_code pi"],
			[GATEWAY, { tool: "github_search_code", args: {} }, "MCP call github_search_code"],
		] as const) {
			const parent = new Container() as any;
			for (const id of ["a", "b"])
				parent.addChild(succeed(make(definition, id, {}, context), args));
			const rows = groupRows(parent);
			assert.match(rows[0]!, /^ ● Multiple Tools · 2 done/);
			assert.deepEqual(rows.slice(1), [` ├ ✓ ${child}`, ` └ ✓ ${child}`]);
		}
		const mixed = new Container() as any;
		mixed.addChild(
			succeed(make(GATEWAY, "x", {}, context), { tool: "github_search_code", args: {} }),
		);
		mixed.addChild(succeed(make(NAMESPACE, "y", {}, context), { query: "pi" }));
		const rows = groupRows(mixed);
		assert.match(rows[0]!, /Multiple Tools · 2 done/);
		assert.match(rows[1]!, /MCP call github_search_code/);
		assert.match(rows[2]!, /mcp__github_search_code pi/);
	} finally {
		hooks.shutdown();
	}
});
