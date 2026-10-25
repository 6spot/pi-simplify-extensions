import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as stripAnsi } from "node:util";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import {
	installDefaultMode,
	installToolExpandedBackground,
} from "../extensions/renderer/default-mode.ts";
import { setMessageDisplayTheme } from "../extensions/renderer/tool/message-display.ts";
import { WriteExecutionMetadataStore } from "../extensions/renderer/tool/diff/index.ts";
import subagents from "../subagent/index.ts";
import { createSyncTaskView, type SingleResult } from "../subagent/sync-view.ts";

initTheme("dark");
const slots: string[] = [];
const theme = {
	fg: (_slot: string, text: string) => text,
	bold: (text: string) => text,
	bg: (slot: string, text: string) => {
		slots.push(slot);
		return text;
	},
} as any;
const tools = new Map<string, any>();
subagents({
	on() {},
	registerTool: (tool: any) => tools.set(tool.name, tool),
	registerMessageRenderer() {},
} as any);
const definition = tools.get("subagent");
const task =
	"Active task: .trellis/tasks/10-25-console-redesign-zh\nYou are implementing the requested changes.";
const assistant = (text: string): any => ({ role: "assistant", content: [{ type: "text", text }] });
const row = (): SingleResult => ({
	agent: "trellis-implement",
	agentSource: "project",
	task,
	exitCode: 0,
	messages: Array.from({ length: 100 }, (_, index) =>
		assistant(`Report ${index}\n${"Long report ".repeat(40)}\nThird line\nFourth line`),
	),
	stderr: "",
	usage: {
		input: 142000,
		output: 21000,
		cacheRead: 2300000,
		cacheWrite: 0,
		cost: 0.1,
		contextTokens: 60000,
		turns: 55,
	},
	model: "provider/model",
});
const result = (rows: SingleResult[], mode = "single", isError = false) => ({
	content: [{ type: "text", text: "raw preserved result" }],
	details: { mode, results: rows },
	isError,
});
const render = (component: any, width = 120): string =>
	component.render(width).map(stripAnsi).join("\n");
function component(toolDefinition = definition) {
	return new ToolExecutionComponent(
		"subagent",
		"sync-subagent",
		{ agent: "trellis-implement", task },
		{},
		toolDefinition,
		{ theme, requestRender() {}, setStatus() {} } as any,
		process.cwd(),
	) as any;
}
function install() {
	setMessageDisplayTheme(theme);
	const hooks = installDefaultMode(new WriteExecutionMetadataStore());
	const background = installToolExpandedBackground();
	slots.length = 0;
	return () => {
		background();
		hooks.shutdown();
		setMessageDisplayTheme(undefined);
	};
}

test("synchronous long-running Subagent stays compact and transparent, using real partial/final/error states", () => {
	const cleanup = install();
	try {
		const tool = component();
		tool.markExecutionStarted();
		const running = row();
		tool.updateResult(result([running]), true);
		const collapsed = render(tool);
		assert.match(
			collapsed,
			/○ trellis-implement[^\n]*running[^\n]*(?:Expand|ctrl\+o to show more)/,
		);
		assert.match(collapsed, /Progress: Report 99/);
		assert.doesNotMatch(collapsed, /✓|Report 98|earlier items|55 turns|142000|Source:|0\.0s/);
		assert.ok(collapsed.split("\n").filter((line) => line.trim()).length <= 2);
		assert.equal(slots.length, 0);
		tool.setExpanded(true);
		const expanded = render(tool);
		assert.match(expanded, /Collapse|ctrl\+o to collapse/);
		assert.match(expanded, /Task[\s\S]*You are implementing/);
		assert.match(expanded, /Details[\s\S]*turns: 55/);
		assert.match(expanded, /Reports[\s\S]*Report 0[\s\S]*Report 99/);
		assert.ok(slots.includes("toolPendingBg"));
		tool.setExpanded(false);
		slots.length = 0;
		const completed = {
			...running,
			messages: [
				...running.messages,
				assistant("Final result\nSecond fact\nThird fact\nFourth fact"),
			],
			stderr: "non-fatal process warning",
		};
		tool.updateResult(result([completed]));
		const settled = render(tool);
		assert.match(settled, /✓ trellis-implement[^\n]*completed/);
		assert.match(settled, /Final result[\s\S]*Second fact[\s\S]*Third fact/);
		assert.doesNotMatch(settled, /Fourth fact|Report 99|non-fatal process warning/);
		assert.equal(slots.length, 0);
		tool.updateResult(
			result([{ ...completed, exitCode: 7, errorMessage: "Actual child failure" }], "single", true),
		);
		assert.match(render(tool), /✗ trellis-implement[^\n]*failed/);
		assert.match(render(tool), /Error: Actual child failure/);
		assert.equal(slots.length, 0);
		tool.setExpanded(true);
		render(tool);
		assert.ok(slots.includes("toolErrorBg"));
		tool.setExpanded(false);
		slots.length = 0;
		render(tool);
		assert.equal(slots.length, 0);
		assert.equal(running.messages.length, 100);
		assert.equal(running.usage.turns, 55);
	} finally {
		cleanup();
	}
});

test("background dispatch and management cards are transparent in every collapsed state", () => {
	const cleanup = install();
	try {
		for (const name of ["subagent", "subagent_task"]) {
			for (const status of ["running", "completed", "failed", "cancelled"]) {
				const task = {
					id: "background-fixture",
					agent: "reader",
					task: "Inspect fixture",
					cwd: process.cwd(),
					status,
					elapsed_ms: 1000,
					last_activity_at: "2026-10-25T00:00:00Z",
					events: [],
					result: status === "completed" ? "Actual result" : undefined,
					error: status === "failed" ? "Actual error" : undefined,
				};
				const tool = new ToolExecutionComponent(
					name,
					name,
					name === "subagent"
						? { agent: "reader", task: task.task, background: true }
						: { action: "get", id: task.id },
					{},
					tools.get(name),
					{ theme, requestRender() {}, setStatus() {} } as any,
					process.cwd(),
				) as any;
				tool.updateResult({
					content: [],
					details: name === "subagent" ? { backgroundTask: task, results: [] } : { tasks: [task] },
					isError: status === "failed",
				});
				slots.length = 0;
				assert.match(render(tool), new RegExp(status));
				assert.equal(slots.length, 0);
				tool.setExpanded(true);
				render(tool);
				assert.ok(slots.length > 0);
				tool.setExpanded(false);
				slots.length = 0;
				render(tool);
				assert.equal(slots.length, 0);
			}
		}
		const cancelled = component();
		cancelled.updateResult({
			content: [{ type: "text", text: "Subagent was aborted" }],
			isError: true,
		});
		assert.match(render(cancelled), /cancelled[\s\S]*Cancelled: Subagent was aborted/);
	} finally {
		cleanup();
	}
});

test("parallel and chain cards preserve per-process completion, cancellation and missing historical timing", () => {
	const first = {
		...row(),
		messages: [assistant("First completed")],
		status: "completed" as const,
	};
	const second = {
		...row(),
		agent: "reviewer",
		status: "running" as const,
		messages: [assistant("Latest progress")],
	};
	for (const mode of ["parallel", "chain"] as const) {
		const view = createSyncTaskView([first, second], theme, false, { partial: true, mode });
		const text = render(view);
		assert.match(text, /✓ trellis-implement[^\n]*completed/);
		assert.match(text, /○ reviewer[^\n]*running/);
		assert.doesNotMatch(text, /\d+\.\ds/);
		for (const width of [1, 22, 44, 80, 120])
			for (const line of view.render(width)) assert.ok(visibleWidth(line) <= width);
	}
	const cancelled = createSyncTaskView(
		[{ ...row(), stopReason: "aborted", exitCode: 1, errorMessage: "Interrupted by user" }],
		theme,
		false,
		{ partial: false },
	);
	assert.match(render(cancelled), /– trellis-implement[^\n]*cancelled/);
	assert.match(render(cancelled), /Cancelled: Interrupted by user/);
});

test("Subagent cards created before renderer registration repaint once after the definition becomes available", () => {
	const cleanup = install();
	try {
		const tool = new ToolExecutionComponent(
			"subagent",
			"deferred-subagent",
			{ agent: "trellis-implement", task },
			{},
			undefined,
			{ theme, requestRender() {}, setStatus() {} } as any,
			process.cwd(),
		) as any;
		tool.updateResult(result([row()]));
		let updates = 0;
		const updateDisplay = tool.updateDisplay;
		tool.updateDisplay = function (...args: any[]) {
			updates++;
			return updateDisplay.apply(this, args);
		};
		render(tool);
		render(tool);
		assert.equal(updates, 0, "a missing definition does not rebuild on every paint");
		tool.toolDefinition = definition;
		assert.match(render(tool), /✓ trellis-implement/);
		render(tool);
		assert.equal(updates, 1);
		assert.equal(slots.length, 0);
	} finally {
		cleanup();
	}
});

test("dedicated Subagent cards created before installation adopt current rendering once and clear the collapsed native background", () => {
	const old = {
		...definition,
		renderCall: () => new Text("OLD_SUBAGENT_CALL", 0, 0),
		renderResult: () => new Text("OLD_SUBAGENT_LOG", 0, 0),
	};
	const tool = component(old);
	tool.updateResult(result([row()]));
	assert.match(render(tool), /OLD_SUBAGENT_LOG/);
	let calls = 0;
	old.renderCall = (...args: any[]) => {
		calls++;
		return definition.renderCall(...args);
	};
	old.renderResult = definition.renderResult;
	const cleanup = install();
	try {
		assert.match(render(tool), /✓ trellis-implement/);
		assert.doesNotMatch(render(tool), /OLD_SUBAGENT|Report 98/);
		assert.equal(calls, 1);
		render(tool);
		render(tool);
		assert.equal(calls, 1);
		assert.equal(slots.length, 0);
	} finally {
		cleanup();
	}
});
