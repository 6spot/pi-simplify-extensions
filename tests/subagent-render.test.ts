import assert from "node:assert/strict";
import test from "node:test";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters as stripAnsi } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { installDefaultMode } from "../extensions/renderer/default-mode.ts";
import { WriteExecutionMetadataStore } from "../extensions/renderer/tool/diff/index.ts";
import subagents from "../subagent/index.ts";
import { createTaskView } from "../subagent/view.ts";
import type { TaskSnapshot } from "../subagent/tasks.ts";

initTheme("dark");

const snapshot = (): TaskSnapshot => ({
	id: "structured-task-id",
	agent: "reader",
	task: "检查中文路径 🧪\nThen verify the result.",
	cwd: "/tmp/project",
	status: "running",
	started_at: new Date().toISOString(),
	last_activity_at: new Date().toISOString(),
	elapsed_ms: 1200,
	idle_duration: 0,
	revision: 0,
	events: [],
	auto_reports_suppressed: 0,
});

test("Subagent native cards stay nonempty while running, expand structurally and repaint live state without a new tool result", () => {
	const tools = new Map<string, any>();
	subagents({
		on() {},
		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerMessageRenderer() {},
	} as any);
	const hooks = installDefaultMode(new WriteExecutionMetadataStore());
	try {
		for (const name of ["subagent", "subagent_task"]) {
			let current = snapshot();
			let available = true;
			const definition = tools.get(name);
			const originalRenderer = definition.renderResult;
			// Exercise the real renderer and shell first, then the live lookup path independently.
			const details =
				name === "subagent" ? { backgroundTask: current, results: [] } : { tasks: [current] };
			const component = new ToolExecutionComponent(
				name,
				name,
				name === "subagent"
					? { agent: "reader", task: current.task, background: true }
					: { action: "get", id: current.id },
				{},
				definition,
				{ requestRender() {}, setStatus() {} } as any,
				process.cwd(),
			) as any;
			const render = (width = 110) => component.render(width).map(stripAnsi).join("\n");
			component.markExecutionStarted();
			assert.match(render(), new RegExp(name));
			component.setExpanded(true);
			assert.match(render(), new RegExp(name), "pending tool with no result remains visible");
			component.updateResult({
				content: [{ type: "text", text: JSON.stringify(current) }],
				details,
			});
			assert.match(render(), /├ Task[\s\S]*检查中文路径/);
			assert.match(render(), /Waiting for first report/);
			assert.match(render(), /ID: structured-task-id/);
			assert.doesNotMatch(render(), /"backgroundTask"|"elapsed_ms"|"tasks"/);
			for (const expanded of [false, true, false, true]) {
				component.setExpanded(expanded);
				assert.match(render(), /reader · 检查中文路径/);
				assert.equal(
					(render().match(/Expand|Collapse|ctrl\+o to (?:show more|collapse)/g) ?? []).length,
					1,
				);
			}
			definition.renderResult = (_result: unknown, options: { expanded: boolean }, theme: any) =>
				createTaskView([snapshot()], theme, options.expanded, () =>
					available ? current : undefined,
				);
			component.updateResult({ content: [], details });
			const report = {
				kind: "decision" as const,
				message: "选择输出语言",
				at: new Date().toISOString(),
				sequence: 1,
			};
			current = { ...current, status: "blocked", events: [report], revision: 1 };
			assert.match(render(), /waiting for parent/);
			assert.match(
				render(),
				/选择输出语言/,
				"settled tool repaint reads new child data without invalidation",
			);
			current = { ...current, status: "completed", result: "最终结果\n第二个事实" };
			assert.match(render(), /Result[\s\S]*最终结果/);
			assert.match(render(), /第二个事实/);
			for (const width of [22, 44, 110])
				for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
			current = { ...current, status: "failed", error: "Actual process failure" };
			assert.match(render(), /Error[\s\S]*Actual process failure/);
			current = { ...current, status: "cancelled", error: undefined, result: undefined };
			assert.match(render(), /cancelled/);
			available = false;
			assert.match(
				render(),
				/cancelled/,
				"a disappearing registry does not revert the last painted terminal state",
			);
			assert.doesNotMatch(render(), /running/);
			definition.renderResult = originalRenderer;
		}
	} finally {
		hooks.shutdown();
	}
});
