import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as stripAnsi } from "node:util";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import subagents from "../subagent/index.ts";
import { createTaskView, elapsedText, previewRows } from "../subagent/view.ts";
import { createSyncTaskView, type SingleResult } from "../subagent/sync-view.ts";
import type { TaskSnapshot } from "../subagent/tasks.ts";

initTheme("dark");
const theme = { fg: (_slot: string, text: string) => text, bold: (text: string) => text } as any;
const render = (view: any, width = 120): string => view.render(width).map(stripAnsi).join("\n");
const assistant = (text: string): any => ({ role: "assistant", content: [{ type: "text", text }] });
const task = (extra: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
	id: "task-id",
	agent: "reviewer",
	task: "Active task: .trellis/tasks/review\nContext: /tmp/project\n/tmp/project\n检查边界条件 🧪\nKeep full instructions",
	cwd: "/tmp/project",
	status: "completed",
	elapsed_ms: 184000,
	started_at: "2026-10-24T00:00:00Z",
	last_activity_at: "2026-10-24T00:03:04Z",
	idle_duration: 0,
	revision: 1,
	auto_reports_suppressed: 0,
	events: [],
	result:
		"\n## Review\n\n```text\nFound 2 issues\nMissing cancellation handling\nStale task state\nFull result ending\n```",
	...extra,
});
const result = (extra: Partial<SingleResult> = {}): SingleResult => ({
	agent: "reviewer",
	agentSource: "project",
	task: task().task,
	status: "completed",
	exitCode: 0,
	messages: [assistant(task().result!)],
	stderr: "",
	usage: {
		input: 200,
		output: 100,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0.02,
		contextTokens: 300,
		turns: 2,
	},
	elapsed_ms: 184000,
	...extra,
});

test("single background and synchronous cards choose the real goal and findings while retaining original expanded records", () => {
	for (const source of [task(), result()]) {
		const original = structuredClone(source);
		const view = (expanded: boolean) =>
			"id" in source
				? createTaskView([source], theme, expanded)
				: createSyncTaskView([source], theme, expanded, { partial: false });
		const text = render(view(false), 160);
		assert.match(text.split("\n")[0], /✓ Subagent · reviewer · 检查边界条件 🧪 · 3m4s/);
		assert.doesNotMatch(
			text,
			/Active task:|Context:|\.trellis|## Review|```|Full result ending|completed|passed/i,
		);
		assert.match(
			text,
			/Result: Found 2 issues[\s\S]*Missing cancellation handling[\s\S]*Stale task state/,
		);
		assert.match(text, /More result details hidden/);
		const expanded = render(view(true), 160);
		assert.match(expanded, /Active task:[\s\S]*Keep full instructions/);
		assert.match(expanded, /## Review[\s\S]*```text[\s\S]*Full result ending/);
		assert.deepEqual(source, original);
	}
	assert.equal(elapsedText(3845000), "1h04m");
	for (const value of [undefined, -1, NaN, Infinity]) assert.equal(elapsedText(value), "");
});

test("previews spend their budget on visible content rows and disclose both wrapping and later lines", () => {
	const content = "\n## Results\n```\n" + "中文🧪 findings ".repeat(30) + "\nSECOND_LINE\n```";
	for (const budget of [1, 3]) {
		const rows = previewRows("Result", content, 42, theme, budget);
		assert.equal(rows.length, budget + 1);
		assert.match(rows[0], /Result: 中文🧪 findings/);
		assert.match(rows.at(-1)!, /More result details hidden/);
		assert.doesNotMatch(rows.join("\n"), /Results|```|SECOND_LINE/);
		for (const line of rows) assert.ok(visibleWidth(line) <= 42);
	}
	const active = task({
		status: "running",
		result: undefined,
		events: [
			{ kind: "progress", message: "OLD_PROGRESS", at: "2026-10-24T00:01:00Z", sequence: 1 },
			{
				kind: "progress",
				message: "\n## Status\nLATEST_PROGRESS\nSECOND_PROGRESS_LINE",
				at: "2026-10-24T00:02:00Z",
				sequence: 2,
			},
		],
	});
	const text = render(createTaskView([active], theme, false, () => active));
	assert.match(text, /Progress: LATEST_PROGRESS/);
	assert.match(text, /More task details hidden/);
	assert.doesNotMatch(text, /OLD_PROGRESS|SECOND_PROGRESS_LINE/);
	assert.match(
		render(createTaskView([active], theme, true)),
		/OLD_PROGRESS[\s\S]*SECOND_PROGRESS_LINE/,
	);
});

test("parallel and chain containers summarize every real state and retain only the latest four one-line tasks", () => {
	const rows = Array.from({ length: 6 }, (_, index) =>
		result({
			agent: `worker-${index}`,
			status: index === 0 ? "failed" : index === 5 ? "running" : "completed",
			exitCode: index === 0 ? 1 : 0,
			errorMessage: index === 0 ? "Earlier failure" : undefined,
			messages: [assistant(`Finding ${index}\nHidden finding ${index}`)],
		}),
	);
	const original = structuredClone(rows);
	for (const mode of ["parallel", "chain"] as const) {
		const view = createSyncTaskView(rows, theme, false, { partial: true, mode });
		const text = render(view, 180);
		assert.match(
			text.split("\n")[0],
			new RegExp(`○ Subagent · ${mode} · 1 failed · 4 done · 1 running`),
		);
		assert.match(text, /2 earlier tasks/);
		assert.equal(text.split("\n").filter((line) => /^[├└] /.test(line)).length, 4);
		assert.match(text, /worker-2[^\n]*\n[^\n]*Result: Finding 2/);
		assert.match(text, /worker-5[^\n]*running[^\n]*\n[^\n]*Progress: Finding 5/);
		assert.doesNotMatch(text, /worker-0|worker-1|Hidden finding/);
		assert.match(text, /More task details hidden/);
		assert.equal((text.match(/ctrl\+o to show more/g) ?? []).length, 1);
		const full = render(createSyncTaskView(rows, theme, true, { partial: true, mode }), 180);
		assert.match(full, /worker-0[\s\S]*Earlier failure[\s\S]*Hidden finding 5/);
		for (const width of [1, 12, 42, 80])
			for (const line of view.render(width)) assert.ok(visibleWidth(line) <= width);
	}
	assert.deepEqual(rows, original);
});

test("terminal selection skips trailing protocol-only assistant messages without discarding substantive findings", () => {
	const row = result({
		messages: [assistant("Found 2 issues\nActual finding"), assistant("\n## Result\n```\n```\n")],
	});
	const text = render(createSyncTaskView([row], theme, false, { partial: false }));
	assert.match(text, /Found 2 issues[\s\S]*Actual finding/);
	assert.doesNotMatch(text, /no substantive output|passed/i);
});

test("Subagent Task send/cancel native renderers acknowledge operations without marking the task completed", () => {
	const tools = new Map<string, any>();
	subagents({
		on() {},
		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerMessageRenderer() {},
	} as any);
	for (const action of ["send", "cancel"]) {
		const snapshot = task({ status: "running", result: undefined });
		const component = new ToolExecutionComponent(
			"subagent_task",
			action,
			{ action, id: snapshot.id, message: "Follow up" },
			{},
			tools.get("subagent_task"),
			{ theme, requestRender() {}, setStatus() {} } as any,
			process.cwd(),
		);
		component.updateResult({ content: [], details: { tasks: [snapshot] }, isError: false });
		const text = render(component, 160);
		assert.match(text, new RegExp(`✓ Subagent Task · ${action} · reviewer`));
		assert.match(text, action === "send" ? /Instruction accepted/ : /Cancellation requested/);
		assert.match(text, /Acknowledged:[^\n]*task running/);
		assert.doesNotMatch(text, /Result:|Found 2 issues|task completed/);
		component.setExpanded(true);
		assert.match(render(component, 160), /Status: running/);
	}
});
