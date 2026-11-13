import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as strip } from "node:util";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Text, visibleWidth } from "@earendil-works/pi-tui";
import {
	installDefaultMode,
	installToolExpandedBackground,
} from "../extensions/renderer/default-mode.ts";
import { setMessageDisplayTheme } from "../extensions/renderer/tool/message-display.ts";
import { WriteExecutionMetadataStore } from "../extensions/renderer/tool/diff/index.ts";
import { createToolCard } from "../extensions/renderer/tool/tool-card.ts";
import { toolCardStatus, toolWasCancelled } from "../extensions/renderer/tool/tool-state.ts";
import { installToolGrouping, ToolGroupComponent } from "../extensions/renderer/tool/grouping.ts";
import { installToolMouseInteraction } from "../extensions/renderer/mouse/interaction.ts";
import { toolCardFamily } from "../extensions/renderer/tool/card-family.ts";
import { expandedIoForTool } from "../extensions/renderer/tool/tool-io.ts";
import { resultTextView } from "../extensions/renderer/tool/result.ts";
import { createTaskView, createTaskFallbackView, isTaskCardSnapshot } from "../subagent/view.ts";
import { createSyncTaskView, isSyncTaskRows } from "../subagent/sync-view.ts";

initTheme("dark");
const theme = {
	fg: (_slot: string, text: string) => text,
	bg: (_slot: string, text: string) => text,
	bold: (text: string) => text,
} as any;
const ui = { theme, requestRender() {}, setStatus() {} } as any;
const output = (text: string, extra: any = {}) => ({
	content: [{ type: "text", text }],
	isError: false,
	...extra,
});
const paint = (view: any, width = 110): string[] =>
	view
		.render(width)
		.map(strip)
		.filter((row: string) => row.trim());
function install(store = new WriteExecutionMetadataStore()) {
	setMessageDisplayTheme(theme);
	const hooks = installDefaultMode(store);
	const background = installToolExpandedBackground();
	return () => {
		background();
		hooks.shutdown();
		setMessageDisplayTheme(undefined);
	};
}

test("all native cards retain one title control through success/error/expansion; disclosures are passive", () => {
	const store = new WriteExecutionMetadataStore();
	store.set("write", { fileExistedBeforeWrite: false });
	const dispose = install(store);
	try {
		for (const [name, args] of [
			["read", { path: "a.ts" }],
			["grep", { pattern: "needle" }],
			["find", { pattern: "*.ts" }],
			["bash", { command: "echo ready" }],
			["powershell", { command: "Get-Date" }],
			["edit", { path: "a.ts", oldText: "old", newText: "new" }],
			["write", { path: "a.ts", content: "one\ntwo\nthree\nfour\nfive\nsix" }],
			["vendor_probe", { query: "needle" }],
		] as const) {
			const tool = new ToolExecutionComponent(
				name,
				name,
				args,
				{},
				undefined,
				ui,
				process.cwd(),
			) as any;
			tool.markExecutionStarted();
			const details = name === "edit" ? { diff: "@@ -1 +1 @@\n-old\n+new" } : undefined;
			tool.updateResult(output("one\ntwo\nthree\nfour\nfive\nsix", { details, durationMs: 1200 }));
			const rows = paint(tool);
			assert.match(rows[0]!, /Expand|to show more/, name);
			assert.equal(rows.filter((row) => /Expand|to show more/.test(row)).length, 1, name);
			assert.equal(tool.contentBox.bgFn, undefined, `${name} collapsed shell is transparent`);
			assert.ok(rows.every((row) => visibleWidth(row) <= 110));
			tool.setExpanded(true);
			assert.match(paint(tool)[0]!, /Collapse|to collapse/, name);
			assert.ok(tool.contentBox.bgFn, `${name} expanded native Box has its semantic background`);
			tool.setExpanded(false);
			tool.updateResult(output("NATIVE_FAILURE", { isError: true }));
			const failed = paint(tool);
			assert.match(failed[0]!, /✗.*(?:Expand|to show more)/, name);
			assert.match(failed.join("\n"), /NATIVE_FAILURE/, name);
			assert.equal(tool.contentBox.bgFn, undefined);
		}
	} finally {
		dispose();
	}
});

test("generic and MCP previews do not evaluate input getters/toJSON or change execution arguments", () => {
	for (const name of ["new_vendor_tool", "mcp__server_lookup"]) {
		let getterReads = 0,
			jsonCalls = 0,
			executed: any;
		const args = {
			payload: { value: "ORIGINAL_VALUE" },
			get forbidden() {
				getterReads++;
				throw Error("getter ran");
			},
			toJSON() {
				jsonCalls++;
				throw Error("toJSON ran");
			},
		};
		const original = {
			name,
			execute: async (_id: string, input: any) => {
				executed = input;
				return output("ok");
			},
		};
		const tool = createToolCard(original, new WriteExecutionMetadataStore(), name);
		const result = output("first\nsecond\nthird\nfourth\nfifth");
		const context = { args, result, state: {}, isPartial: false, isError: false, toolCallId: name };
		const call = paint(tool.renderCall(args, theme, context)).join("\n");
		const body = paint(
			tool.renderResult(result, { expanded: false, isPartial: false }, theme, context),
		).join("\n");
		assert.match(call, /ORIGINAL_VALUE/);
		assert.match(body, /1 more line/);
		assert.equal(getterReads, 0);
		assert.equal(jsonCalls, 0);
		void tool.execute("id", args);
		assert.equal(executed, args);
	}
});

test("generic expanded delegation preserves a valid plugin view; broken presentation falls back without changing outcome", () => {
	const args = { query: "source" },
		result = output("ORIGINAL_RESULT");
	for (const fail of [false, true]) {
		const original = {
			name: "external_tool",
			renderResult() {
				if (fail) throw Error("render failure");
				return new Text("PLUGIN_RESULT", 0, 0);
			},
		};
		const tool = createToolCard(original, new WriteExecutionMetadataStore(), original.name);
		const context = { args, result, state: {}, isPartial: false, isError: false };
		const rows = paint(
			tool.renderResult(result, { expanded: true, isPartial: false }, theme, context),
		).join("\n");
		assert.match(rows, fail ? /ORIGINAL_RESULT/ : /PLUGIN_RESULT/);
		assert.equal(result.isError, false);
	}
});

test("known native cancellation differs from failed abort prose and unrelated business status", () => {
	assert.equal(
		toolWasCancelled("bash", output("partial\nCommand aborted", { isError: true })),
		true,
	);
	assert.equal(toolWasCancelled("read", output("Operation aborted", { isError: true })), true);
	assert.equal(toolWasCancelled("vendor", output("Operation aborted")), false);
	assert.equal(toolWasCancelled("vendor", output("Operation aborted", { isError: true })), false);
	assert.equal(
		toolWasCancelled("read", output("Operation aborted", { isError: true }), true, false),
		false,
	);
	assert.equal(
		toolWasCancelled(
			"vendor",
			output("request aborted due to invalid credentials", { isError: true }),
		),
		false,
	);
	assert.equal(
		toolWasCancelled("vendor", output("updated ticket", { details: { status: "cancelled" } })),
		false,
	);
	assert.equal(
		toolCardStatus({ toolName: "read", result: output("Operation aborted", { isError: true }) }),
		"cancelled",
	);
	assert.equal(
		toolCardStatus({ toolName: "codemode", result: output("", { details: { calls: [{}] } }) }),
		"unknown",
	);
});

test("cancelled native results stay neutral when folded or expanded, while failures and MCP abort prose stay errors", () => {
	const errorText: string[] = [];
	const colorTheme = {
		...theme,
		fg: (slot: string, text: string) => {
			if (slot === "error") errorText.push(text);
			return text;
		},
	};
	for (const name of [
		"read",
		"grep",
		"find",
		"bash",
		"powershell",
		"edit",
		"write",
		"ask_user_question",
	]) {
		for (const mcp of [false, true]) {
			const definition = { name, label: mcp ? `MCP: remote_${name}` : name };
			const tool = createToolCard(definition, new WriteExecutionMetadataStore(), name);
			for (const cancelled of [true, false]) {
				const result = output(cancelled ? "Operation aborted" : "Permission denied", {
					isError: true,
					...(name === "ask_user_question" && cancelled ? { details: { cancelled: true } } : {}),
				});
				for (const expanded of [false, true]) {
					const context = {
						toolName: name,
						simplifyMcpSource: mcp,
						args: { path: "a.ts", command: "echo ready" },
						result,
						state: {} as any,
						isError: true,
						isPartial: false,
						expanded,
					};
					errorText.length = 0;
					const body = paint(
						tool.renderResult(result, { expanded, isPartial: false }, colorTheme, context),
					).join("\n");
					const title = paint(tool.renderCall(context.args, colorTheme, context)).join("\n");
					const neutral = cancelled && !mcp;
					const label = `${name} ${mcp ? "MCP" : "native"} ${expanded ? "expanded" : "folded"}`;
					assert.equal(
						context.state.toolVisualState,
						neutral ? "cancelled" : "error",
						label,
					);
					assert.match(title, neutral ? /–/ : /✗/, label);
					assert.equal(errorText.length === 0, neutral, label);
					if (name !== "ask_user_question" || mcp)
						assert.ok(body.includes(result.content[0].text), label);
					else if (cancelled) assert.match(body, expanded ? /Declined/ : /Cancelled/, label);
					assert.equal(result.isError, true, label);
				}
			}
		}
	}
});

test("groups bound six summaries, retain failed/cancelled counts while running and expose details under one parent control", () => {
	const dispose = install();
	const grouping = installToolGrouping(() => true);
	try {
		const parent = new Container() as any;
		for (let i = 0; i < 9; i++) {
			const tool = new ToolExecutionComponent(
				"bash",
				String(i),
				{ command: `echo TASK_${i}` },
				{},
				undefined,
				ui,
				process.cwd(),
			) as any;
			tool.markExecutionStarted();
			if (i !== 8)
				tool.updateResult(
					output(i === 0 ? "Command aborted" : i === 1 ? "NATIVE_FAILURE" : "ok", {
						isError: i < 2,
					}),
				);
			parent.addChild(tool);
		}
		const group = parent.children[0] as ToolGroupComponent;
		const rows = paint(group, 160);
		assert.match(rows[0]!, /○ Multiple Tools.*1 running.*1 failed.*1 cancelled/);
		assert.equal(rows.filter((row) => /^ [├└] /.test(row)).length, 6);
		assert.match(rows.at(-1)!, /3 more tools/);
		group.setExpanded(true);
		const expanded = paint(group, 160);
		assert.match(expanded[0]!, /Collapse|to collapse/);
		assert.equal(expanded.filter((row) => /Collapse|to collapse/.test(row)).length, 1);
		assert.match(expanded.join("\n"), /TASK_8/);
	} finally {
		grouping.shutdown();
		dispose();
	}
});

test("failed/stopped synchronous tasks retain actual partial results in expanded details", () => {
	const source = {
		agent: "reviewer",
		task: "Review layout",
		status: "cancelled" as const,
		errorMessage: "Operation cancelled",
		exitCode: 1,
		messages: [{ role: "assistant", content: [{ type: "text", text: "PARTIAL_FINDING" }] }],
		stderr: "",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			contextTokens: 0,
			turns: 1,
		},
	} as any;
	const before = structuredClone(source);
	const folded = paint(createSyncTaskView([source], theme, false, { partial: false })).join("\n");
	assert.match(folded, /– Subagent.*cancelled[\s\S]*Partial result hidden/);
	const expanded = paint(createSyncTaskView([source], theme, true, { partial: false })).join("\n");
	assert.match(
		expanded,
		/Cancelled[\s\S]*Operation cancelled[\s\S]*Result \(partial\)[\s\S]*PARTIAL_FINDING/,
	);
	assert.deepEqual(source, before);
});

test("result display limits are metadata, not guessed from result words; unsupported payloads remain honest", () => {
	const literal = output("[Display limit reached · output excerpt]\none\ntwo\nthree\nfour");
	assert.equal(resultTextView(literal).displayLimited, false);
	assert.equal(resultTextView(output("x".repeat(20000))).displayLimited, true);
	assert.equal(
		resultTextView({ content: [], structuredContent: { file: "report.csv" } }).text,
		'{"file":"report.csv"}',
	);
	assert.equal(
		resultTextView({ content: [], details: Buffer.from([1, 2, 3]) }).text,
		"Binary result",
	);
	assert.equal(
		resultTextView({ content: [{ type: "resource_link", uri: "example://data" }] }).text,
		"Result preview unavailable",
	);
});

test("native nonzero command exits remain failures even when the transport returned successfully", () => {
	const dispose = install();
	try {
		const native = new ToolExecutionComponent(
			"bash",
			"native-exit",
			{ command: "exit 2" },
			{},
			undefined,
			ui,
			process.cwd(),
		) as any;
		native.markExecutionStarted();
		native.updateResult(output("Actual output", { structuredContent: { exit_code: 2 } }));
		assert.match(paint(native).join("\n"), /✗ Bash · exit 2/);
		assert.equal(toolCardStatus(native), "error");
		assert.equal(native.result.isError, false);
		const domain = new ToolExecutionComponent(
			"bash",
			"mcp-exit",
			{ query: "x" },
			{},
			{ name: "bash", label: "MCP: domain_bash" } as any,
			ui,
			process.cwd(),
		) as any;
		domain.markExecutionStarted();
		domain.updateResult(output("Domain data", { structuredContent: { exit_code: 2 } }));
		assert.equal(toolCardStatus(domain), "success");
		assert.match(paint(domain).join("\n"), /✓ MCP/);
	} finally {
		dispose();
	}
});

test("expanded pending calls expose bounded Input before the first result and retain partial output detail", () => {
	const dispose = install();
	try {
		for (const [name, key] of [
			["preview_probe", "value"],
			["bash", "command"],
			["grep", "pattern"],
		]) {
			const original = "x".repeat(20_000) + "ORIGINAL_END";
			const args = { [key!]: original };
			const tool = new ToolExecutionComponent(
				name!,
				`pending-${name}`,
				args,
				{},
				undefined,
				ui,
				process.cwd(),
			) as any;
			tool.markExecutionStarted();
			tool.setExpanded(true);
			const rows = paint(tool);
			assert.match(rows.join("\n"), /Input[\s\S]*Waiting for output/);
			const view = expandedIoForTool(tool);
			assert.ok(view);
			assert.ok(view.getInputBody().length < 20_000);
			assert.doesNotMatch(view.getInputBody(), /ORIGINAL_END/);
			assert.equal(tool.args[key!], original);
			if (name === "preview_probe") {
				tool.updateResult(
					output(Array.from({ length: 8 }, (_, i) => `PARTIAL_ROW_${i}`).join("\n")),
					true,
				);
				assert.match(paint(tool).join("\n"), /PARTIAL_ROW_7/);
			}
		}
	} finally {
		dispose();
	}
});

test("MCP collisions retain generic identities, grouping and operation states without native result summaries", () => {
	const dispose = install();
	const hooks = installToolGrouping(() => true);
	try {
		const parent = new Container() as any;
		for (const name of [
			"read",
			"bash",
			"update_plan",
			"ask_user_question",
			"codemode",
			"subagent",
		]) {
			const definition = { name, label: `MCP: remote_${name}` };
			const tool = new ToolExecutionComponent(
				name,
				`remote-${name}`,
				{ query: "domain" },
				{},
				definition as any,
				ui,
				process.cwd(),
			) as any;
			tool.markExecutionStarted();
			tool.updateResult(
				output("DOMAIN_OUTPUT", {
					structuredContent: { exit_code: 2, wall_time_seconds: 999 },
					details: {
						steps: [{ id: "s", goal: "BUSINESS_GOAL", status: "completed" }],
						calls: [{ status: "error" }],
						answers: [],
					},
				}),
			);
			assert.match(paint(tool).join("\n"), new RegExp(`✓ MCP · ${name}`));
			assert.doesNotMatch(paint(tool).join("\n"), /16m39s|exit 2|BUSINESS_GOAL/);
			tool.resultRendererComponent.simplifyVisualState = () => "cancelled";
			assert.equal(toolCardStatus(tool), "success");
			parent.addChild(tool);
		}
		assert.equal(parent.children.length, 1);
		const lines = paint(parent.children[0]);
		for (const name of ["read", "bash", "update_plan", "ask_user_question", "codemode", "subagent"])
			assert.ok(lines.some((row) => row.includes(`✓ MCP · ${name}`)));
		assert.doesNotMatch(
			lines.slice(1).join("\n"),
			/BUSINESS_GOAL|exit 2|999s|16m39s|Declined|No answer|1\/1/,
		);
	} finally {
		hooks.shutdown();
		dispose();
	}
});

test("task history without a registered renderer has a bounded common fallback", () => {
	const dispose = install();
	try {
		const tool = new ToolExecutionComponent(
			"subagent",
			"unregistered-task",
			{ task: "Original request" },
			{},
			undefined,
			ui,
			process.cwd(),
		) as any;
		tool.updateResult(output(Array.from({ length: 12 }, (_, i) => `ORIGINAL_${i}`).join("\n")));
		const rows = paint(tool);
		assert.match(rows.join("\n"), /Tool · subagent/);
		assert.match(rows.join("\n"), /More output hidden|more lines/);
		assert.doesNotMatch(rows.join("\n"), /ORIGINAL_11/);
	} finally {
		dispose();
	}
});

test("explicit private renderers keep their components, mouse actions and independent layout", () => {
	assert.equal(toolCardFamily("read", { label: "MCP: remote_read" }), "generic");
	const dispose = install();
	const grouping = installToolGrouping(() => true);
	let chosen = 0;
	const widget = {
		render: (_width: number) => ["PRIVATE_CHOICE"],
		invalidate() {},
		handleMouse(event: any) {
			if (event.type === "click") {
				chosen++;
				return { handled: true };
			}
		},
	};
	const definition = { name: "private_picker", renderShell: "self", renderCall: () => widget };
	const tool = new ToolExecutionComponent(
		definition.name,
		"private",
		{ value: "x" },
		{},
		definition as any,
		ui,
		process.cwd(),
	) as any;
	const tui = { terminal: { columns: 100, write() {} }, mode: "tui", requestRender() {} };
	try {
		installToolMouseInteraction({
			mode: "tui",
			hasUI: true,
			ui: {
				setWidget(_key: string, factory: any) {
					factory?.(tui, theme);
				},
				onTerminalInput() {
					return () => {};
				},
			},
		});
		tool.markExecutionStarted();
		tool.updateResult(output(""));
		tool.setExpanded(true);
		paint(tool, 100);
		assert.equal(tool.getCallRenderer(), definition.renderCall);
		assert.equal(tool.callRendererComponent, widget);
		tool.handleMouse({ type: "click", button: "left", x: 0, y: 1, width: 100, height: 10 });
		assert.equal(chosen, 1);
		assert.equal(tool.expanded, true);
		const parent = new Container();
		parent.addChild(tool);
		parent.addChild(
			new ToolExecutionComponent(
				"read",
				"other",
				{ path: "a.ts" },
				{},
				undefined,
				ui,
				process.cwd(),
			),
		);
		assert.equal(parent.children.length, 2);
		assert.ok(!(parent.children[0] instanceof ToolGroupComponent));
	} finally {
		installToolMouseInteraction({});
		grouping.shutdown();
		dispose();
	}
});

test("unexpected task payloads use a bounded honest fallback, preserving available input and original output", () => {
	for (const value of [
		null,
		{},
		"wrong",
		[null],
		[{ agent: "reader", task: "Inspect", messages: [{ role: "assistant", content: [null] }] }],
	])
		assert.equal(isSyncTaskRows(value), false);
	assert.equal(isTaskCardSnapshot({ id: "a", status: "completed" }), false);
	const args = { agent: "reviewer", task: "Active task: /tmp/task\nReview actual changes" };
	const result = output(Array.from({ length: 8 }, (_, i) => `ACTUAL_ROW_${i}`).join("\n"), {
		details: { results: "unexpected" },
	});
	const original = structuredClone(result);
	const folded = paint(createTaskFallbackView(args, result, theme, false), 60).join("\n");
	assert.match(folded, /○ Subagent.*unknown[\s\S]*ACTUAL_ROW_0[\s\S]*More output hidden/);
	assert.doesNotMatch(folded, /Active task:|ACTUAL_ROW_4|completed|✓/);
	const expanded = paint(createTaskFallbackView(args, result, theme, true)).join("\n");
	assert.match(expanded, /Input[\s\S]*Active task:[\s\S]*ACTUAL_ROW_7[\s\S]*unexpected/);
	assert.deepEqual(result, original);
});

test("a background task changes its expanded title and background from live state without rewriting the dispatch snapshot", () => {
	const slots: string[] = [];
	const local = {
		...theme,
		bg: (slot: string, text: string) => {
			slots.push(slot);
			return text;
		},
	};
	const initial: any = {
		id: "live-card",
		agent: "reviewer",
		task: "Review layout",
		cwd: process.cwd(),
		status: "running",
		elapsed_ms: 100,
		started_at: "2026-10-25T00:00:00Z",
		last_activity_at: "2026-10-25T00:00:00Z",
		idle_duration: 0,
		revision: 1,
		events: [],
		auto_reports_suppressed: 0,
	};
	let current = initial;
	const view = createTaskView([initial], local, true, () => current);
	const dispose = install();
	setMessageDisplayTheme(local);
	try {
		const definition = {
			name: "subagent",
			renderCall: () => new Text("", 0, 0),
			renderResult: () => view,
		};
		const tool = new ToolExecutionComponent(
			"subagent",
			"live",
			{ agent: "reviewer" },
			{},
			definition as any,
			ui,
			process.cwd(),
		) as any;
		tool.updateResult({ content: [], details: { tasks: [initial] }, isError: false });
		tool.setExpanded(true);
		paint(tool);
		slots.length = 0;
		current = {
			...initial,
			status: "failed",
			error: "LIVE_FAILURE",
			result: "PARTIAL_RESULT",
			revision: 2,
		};
		const failed = paint(tool).join("\n");
		assert.match(failed, /✗ Subagent[\s\S]*PARTIAL_RESULT[\s\S]*LIVE_FAILURE/);
		assert.ok(slots.includes("toolErrorBg"));
		slots.length = 0;
		current = { ...current, status: "cancelled", error: "PARENT_STOPPED", revision: 3 };
		assert.match(paint(tool).join("\n"), /– Subagent[\s\S]*PARENT_STOPPED/);
		assert.ok(slots.includes("toolPendingBg"));
		assert.ok(!slots.includes("toolErrorBg"));
		assert.equal(initial.status, "running");
		assert.equal(tool.result.isError, false);
	} finally {
		dispose();
	}
});
