import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as stripAnsi } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CustomMessageComponent } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/custom-message.js";
import { isMessageDisplayComponent } from "../extensions/renderer/tool/message-display.ts";
import { patchRegistry, TOOL_MOUSE_TUI_SLOT } from "../extensions/utils/patch-keys.ts";
import { renderTaskNotices, type TaskNotice } from "../subagent/notices.ts";
import { createTaskView } from "../subagent/view.ts";
import type { TaskSnapshot } from "../subagent/tasks.ts";

initTheme("dark");
const theme = {
	fg: (_color: string, value: string) => value,
	bold: (value: string) => value,
} as any;
const notice = (extra: Partial<TaskNotice> = {}): TaskNotice => ({
	id: "full-task-id",
	agent: "scout",
	task: "检查中文通知 🧪\n保留第二行任务",
	kind: "completed",
	status: "completed",
	elapsed_ms: 34800,
	message: "bounded event summary",
	result: "结果第一行\n第二行\n第三行\nFULL_RESULT_END",
	...extra,
});
const message = (events: TaskNotice[]) => ({
	role: "custom" as const,
	customType: "subagent-events",
	content: "original model context",
	details: { events },
	display: true,
	timestamp: Date.now(),
});
const view = (data: ReturnType<typeof message>, expanded = false) =>
	renderTaskNotices(data, { expanded } as any, theme) as any;
const text = (component: any, width = 110) => component.render(width).map(stripAnsi).join("\n");

// These exercise the persistent view and native message rebuild, rather than snapshot strings alone.
const mouseTui = { mode: "fullscreen" };
const previousMouseTui = patchRegistry.get(TOOL_MOUSE_TUI_SLOT);
test.beforeEach(() => {
	mouseTui.mode = "fullscreen";
	patchRegistry.install(TOOL_MOUSE_TUI_SLOT, mouseTui);
});
test.after(() => {
	if (previousMouseTui === undefined) patchRegistry.dispose(TOOL_MOUSE_TUI_SLOT, mouseTui);
	else patchRegistry.install(TOOL_MOUSE_TUI_SLOT, previousMouseTui);
});
test("finished notices preserve previews, native keyboard expansion and local mouse state across rebuilds", () => {
	const data = message([notice()]);
	const original = structuredClone(data);
	let component = view(data);
	assert.match(text(component), /scout · 检查中文通知 🧪 · completed · 34.8s · Expand/);
	assert.match(text(component), /Result: 结果第一行/);
	assert.doesNotMatch(text(component), /full-task-id|FULL_RESULT_END/);
	assert.ok(isMessageDisplayComponent(component));
	assert.ok(component.isCollapsedHintLine(component.render(110)[0]));
	assert.equal(component.isCollapsedHintLine("Result: Expand"), false);
	component.setExpanded(true);
	assert.match(text(component), /FULL_RESULT_END/);
	assert.match(text(component), /├ Task[\s\S]*保留第二行任务[\s\S]*├ ID[\s\S]*full-task-id/);
	component = view(data); // CustomMessageComponent.invalidate() reconstructs the renderer.
	assert.equal(component.expanded, true);
	assert.match(text(component), /Collapse/);
	view(data, true); // Native Ctrl+O expands all.
	component = view(data, false); // A following Ctrl+O collapses all.
	assert.equal(component.expanded, false);
	assert.deepEqual(data, original, "presentation never changes persisted data or model context");
	const native = new CustomMessageComponent(data, renderTaskNotices as any, {} as any) as any;
	assert.match(text(native), /结果第一行/);
	native.setExpanded(true);
	assert.match(text(native), /FULL_RESULT_END/);
	native.invalidate();
	assert.match(text(native), /FULL_RESULT_END/);
	native.setExpanded(false);
	assert.doesNotMatch(text(native), /FULL_RESULT_END/);
});

test("same-batch terminal trees retain failures and cancellation reasons, with full results behind expansion", () => {
	const data = message([
		notice(),
		notice({
			id: "failed-id",
			agent: "worker",
			kind: "failed",
			status: "failed",
			error: "ACTUAL_ERROR\nERROR_END",
		}),
		notice({
			id: "cancelled-id",
			agent: "reviewer",
			kind: "cancelled",
			status: "cancelled",
			message: "USER_CANCELLED",
			result: "PARTIAL_RESULT",
		}),
	]);
	const component = view(data);
	assert.match(text(component), /^✗ Subagents: 1 done · 1 failed · 1 cancelled/);
	assert.match(
		text(component),
		/├ ✓ scout[\s\S]*├ ✗ worker[\s\S]*Error: ACTUAL_ERROR[\s\S]*└ – reviewer[\s\S]*Cancelled: USER_CANCELLED/,
	);
	assert.equal((text(component).match(/Expand/g) ?? []).length, 1);
	assert.doesNotMatch(text(component), /FULL_RESULT_END|ERROR_END|PARTIAL_RESULT/);
	for (const expanded of [false, true]) {
		component.setExpanded(expanded);
		for (const width of [1, 2, 22, 40, 110])
			for (const row of component.render(width)) assert.ok(visibleWidth(row) <= width);
	}
	component.setExpanded(true);
	assert.match(text(component), /FULL_RESULT_END/);
	assert.match(text(component), /ERROR_END/);
	assert.match(text(component), /ERROR_END[\s\S]*Partial result[\s\S]*FULL_RESULT_END/);
	assert.match(text(component), /USER_CANCELLED[\s\S]*Partial result[\s\S]*PARTIAL_RESULT/);
	assert.match(
		text(view(message([notice({ kind: "cancelled" }), notice({ kind: "cancelled" })]))),
		/^– Subagents: 2 cancelled/,
	);
	assert.match(text(view(message([notice(), notice({ id: "other" })]))), /^● Subagents: 2 done/);
	const mixed = view(
		message([notice(), notice({ kind: "decision", status: "blocked", message: "CHOOSE_NOW" })]),
	);
	assert.doesNotMatch(text(mixed), /Subagents:/);
	assert.match(text(mixed), /waiting for parent[\s\S]*Decision: CHOOSE_NOW/);
});

test("historical notices omit unavailable fields, sanitize display and remain bounded at narrow widths", () => {
	const legacy = { agent: "reader", kind: "completed", message: "legacy result" };
	assert.match(text(view(message([legacy]))), /reader · completed[\s\S]*Result: legacy result/);
	assert.doesNotMatch(text(view(message([legacy]))), /undefined|NaN|\d\.\ds|ID|\$/);
	const data = message([
		notice({
			task: "安全标题\x1b[2J\n隐藏标题",
			result: "安全结果\x1b]52;c;bad\x07\nFULL_RESULT_END",
		}),
	]);
	const original = structuredClone(data);
	for (const expanded of [false, true]) {
		const component = view(data, expanded);
		for (const width of [1, 2, 12, 22, 40, 60, 80, 110])
			for (const row of component.render(width)) {
				assert.ok(visibleWidth(row) <= width, `width ${width}: ${JSON.stringify(row)}`);
				assert.doesNotMatch(row, /\x1b\[2J|\x1b\]52/);
			}
	}
	assert.deepEqual(data, original);
	assert.match(text(view(message([notice({ kind: "unknown_kind" })]))), /original model context/);
	assert.doesNotMatch(
		text(view(message([notice(), notice({ kind: "unknown_kind" })]))),
		/Subagents:|done/,
	);
	mouseTui.mode = "regular";
	try {
		assert.match(text(view(message([notice()]))), /ctrl\+o to show more/i);
		assert.match(text(view(message([notice()]), true)), /ctrl\+o to collapse/i);
	} finally {
		mouseTui.mode = "fullscreen";
	}
	assert.match(
		text(
			renderTaskNotices(
				{ ...message([]), content: "KEEP_UNKNOWN_RESULT" },
				{ expanded: false } as any,
				theme,
			),
		),
		/KEEP_UNKNOWN_RESULT/,
	);
});

test("task view reads new state without a new tool result and retains truthful historical snapshots", () => {
	let current: TaskSnapshot = {
		id: "live",
		agent: "scout",
		task: "检查实时任务 🧪\n完整任务",
		cwd: "/tmp",
		status: "running",
		elapsed_ms: 1200,
		events: [],
		started_at: "2026-10-24T00:00:00Z",
		last_activity_at: "2026-10-24T00:00:00Z",
		idle_duration: 0,
		revision: 1,
		auto_reports_suppressed: 0,
	};
	let available = true;
	const component = createTaskView([structuredClone(current)], theme, false, () =>
		available ? current : undefined,
	);
	assert.match(
		text(component),
		/scout · 检查实时任务 🧪 · running[\s\S]*Progress: Waiting for first report/,
	);
	current = {
		...current,
		status: "blocked",
		events: [
			{
				kind: "decision",
				message: "CHOOSE_LANGUAGE\nfull question",
				at: "2026-10-24T00:00:01Z",
				sequence: 1,
			},
		],
	};
	assert.match(text(component), /waiting for parent[\s\S]*Waiting for: CHOOSE_LANGUAGE/);
	current = { ...current, status: "completed", result: "FIRST_RESULT\n2\n3\nFULL_RESULT_END" };
	assert.match(text(component), /completed[\s\S]*Result: FIRST_RESULT/);
	assert.doesNotMatch(text(component), /Waiting for:|Progress:|FULL_RESULT_END/);
	current = { ...current, status: "failed", error: "REAL_FAILURE" };
	assert.match(text(component), /failed[\s\S]*Error: REAL_FAILURE/);
	assert.doesNotMatch(text(component), /Result:/);
	available = false;
	assert.match(text(component), /failed/);
	const historical = createTaskView([{ ...current, status: "running" }], theme, false);
	assert.match(text(historical), /running at snapshot/);
	available = true;
	current = { ...current, status: "cancelled", error: "CANCELLED_BY_PARENT", result: undefined };
	assert.match(text(component), /cancelled[\s\S]*Cancelled: CANCELLED_BY_PARENT/);
	assert.doesNotMatch(text(component), /Error:|Result:/);
	assert.match(
		text(createTaskView([current], theme, true)),
		/└ Cancelled[\s\S]*CANCELLED_BY_PARENT/,
	);
	for (const width of [1, 2, 22, 40, 80, 110])
		for (const row of component.render(width)) assert.ok(visibleWidth(row) <= width);
});
