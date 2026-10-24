import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as stripAnsi } from "node:util";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import {
	installDefaultMode,
	installToolExpandedBackground,
} from "../extensions/renderer/default-mode.ts";
import { installToolGrouping, ToolGroupComponent } from "../extensions/renderer/tool/grouping.ts";
import { setMessageDisplayTheme } from "../extensions/renderer/tool/message-display.ts";
import { WriteExecutionMetadataStore } from "../extensions/renderer/tool/diff/index.ts";
import {
	createPlanResultComponent,
	planFromResult,
	planSummary,
} from "../extensions/renderer/tool/plan.ts";

initTheme("dark");
const steps = () => [
	{ id: "read", goal: "检查中文路径 🧪", status: "completed" },
	{ id: "build", goal: "实现计划面板", status: "in_progress" },
	{ id: "verify", goal: "验证并交付", status: "pending" },
];
const args = () => ({
	steps: steps().map((step) => ({ ...step, status: "pending" })),
	progress: {
		decisions: ["原始决策保留在展开视图"],
		files_changed: ["src/计划.ts"],
		verification: ["Typecheck passed"],
	},
});
const result = (plan = steps(), advice: string[] = []) => ({
	content: [
		{
			type: "text",
			text: `<sol-pi-plan task_status="active">${JSON.stringify({ steps: plan })}</sol-pi-plan>${advice.length ? `\n${advice.join("\n")}` : ""}`,
		},
	],
	details: { plan, task_status: "active" },
});
const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_slot: string, text: string) => text,
};
const ui = { theme, requestRender() {}, setStatus() {} } as any;
const nativeTool = (name: string, input: any, id = name) =>
	new ToolExecutionComponent(name, id, input, {}, undefined, ui, process.cwd()) as any;
const render = (component: any, width = 100) => component.render(width).map(stripAnsi).join("\n");

test("plan data uses accepted state, preserves XML-only history and advice, rejects malformed/failed snapshots", () => {
	const actual = result();
	assert.equal(planSummary(args(), actual), "1/3 done · 实现计划面板");
	assert.equal(planSummary(args(), actual, false), "1/3 done");
	assert.deepEqual(planFromResult({ content: actual.content }), { steps: steps(), advice: [] });
	const advice = [
		"Keep at most one plan step in_progress.",
		"Finish the registered steps before dropping them.",
	];
	const advised = result(steps(), advice);
	assert.deepEqual(
		planFromResult(advised)?.advice,
		advice,
		"SoL-Pi returns advice in text alongside details.plan",
	);
	assert.deepEqual(planFromResult({ content: advised.content })?.advice, advice);
	for (const bad of [[{ ...steps()[0], status: "failed" }], [steps()[0], steps()[0]], [null], []])
		assert.equal(planFromResult({ content: [], details: { plan: bad } }), undefined);
	assert.equal(
		planFromResult({ content: [{ type: "text", text: "<sol-pi-plan>broken</sol-pi-plan>" }] }),
		undefined,
	);
	assert.equal(planFromResult({ ...actual, isError: true }), undefined);
	assert.equal(planSummary(args(), { ...actual, isError: true }), "Update failed");
	assert.equal(
		planFromResult({ content: [{ type: "text", text: "Unknown execution result" }] }),
		undefined,
	);
});

test("standalone plan is a neutral native panel; partial/completed updates, expansion, errors and original data remain accurate", () => {
	const slots: string[] = [];
	setMessageDisplayTheme({
		...theme,
		bg: (slot: string, text: string) => {
			slots.push(slot);
			return text;
		},
	});
	const hooks = installDefaultMode(new WriteExecutionMetadataStore());
	const background = installToolExpandedBackground();
	const grouping = installToolGrouping(() => true);
	try {
		const tool = nativeTool("update_plan", args());
		const parent = new Container();
		parent.addChild(tool);
		tool.markExecutionStarted();
		assert.equal(tool.getRenderShell(), "default");
		assert.match(render(tool), /○ Update Plan/);
		const accepted = result();
		const original = JSON.stringify(accepted);
		tool.updateResult(accepted, true);
		assert.match(render(tool), /实现计划面板/);
		tool.updateResult(accepted, false);
		const collapsed = render(tool);
		assert.match(collapsed, /✓ Update Plan 1\/3 done/);
		for (const goal of steps().map((step) => step.goal)) assert.ok(collapsed.includes(goal));
		assert.doesNotMatch(collapsed, /sol-pi-plan|"progress"|"steps"|lines returned|Decisions/);
		assert.match(collapsed, /click to show more/);
		assert.ok(slots.includes("toolPendingBg"));
		assert.ok(
			!slots.includes("toolSuccessBg"),
			"successful plan remains on the neutral card surface",
		);
		tool.setExpanded(true);
		assert.match(render(tool), /Decisions[\s\S]*原始决策保留/);
		assert.match(render(tool), /Changed files[\s\S]*src\/计划.ts/);
		assert.match(render(tool), /Validation[\s\S]*Typecheck passed/);
		for (const width of [20, 42, 100])
			for (const line of tool.render(width)) assert.ok(visibleWidth(line) <= width);
		tool.setExpanded(false);
		assert.doesNotMatch(render(tool), /Decisions|src\/计划.ts/);
		assert.equal(JSON.stringify(accepted), original, "rendering never rewrites the tool result");
		tool.updateResult(result(steps().map((step) => ({ ...step, status: "completed" }))));
		assert.match(render(tool), /3\/3 done/);
		assert.doesNotMatch(render(tool), /○|pending/);
		tool.updateResult({
			...accepted,
			isError: true,
			content: [{ type: "text", text: "Plan rejected: unknown step id" }],
		});
		tool.setExpanded(true);
		assert.match(render(tool), /✗ Update Plan/);
		assert.match(render(tool), /Plan rejected: unknown step id/);
		assert.doesNotMatch(render(tool), /3\/3 done|1\/3 done/);
		assert.ok(slots.includes("toolErrorBg"));
		tool.updateResult({
			content: [{ type: "text", text: "Unknown execution result remains available" }],
		});
		assert.match(render(tool), /Unknown execution result remains available/);
	} finally {
		grouping.shutdown();
		background();
		hooks.shutdown();
		setMessageDisplayTheme(undefined);
	}
});

test("grouped update_plan stays lightweight, reflects accepted result, refreshes on updates and shows text on expansion", () => {
	const hooks = installDefaultMode(new WriteExecutionMetadataStore());
	const grouping = installToolGrouping(() => true);
	grouping.setTheme(theme);
	try {
		const parent = new Container();
		const search = nativeTool("tool_search", { query: "find tool" });
		search.updateResult({ content: [{ type: "text", text: "Found" }] });
		const plan = nativeTool("update_plan", args());
		plan.updateResult(result());
		parent.addChild(search);
		parent.addChild(plan);
		const group = parent.children[0] as ToolGroupComponent;
		assert.ok(group instanceof ToolGroupComponent, "plan remains groupable alongside other tools");
		const collapsed = render(group);
		assert.match(collapsed, /Update Plan 1\/3 done · 实现计划面板/);
		assert.doesNotMatch(collapsed, /"progress"|"decisions"|sol-pi-plan|检查中文路径/);
		group.setExpanded(true);
		assert.match(render(group), /检查中文路径/);
		assert.match(render(group), /验证并交付/);
		assert.doesNotMatch(
			render(group),
			/sol-pi-plan|"progress"|Input:|Decisions|Changed files|Validation/,
		);
		group.removeTool(plan);
		const standaloneParent = new Container();
		standaloneParent.addChild(plan);
		assert.match(
			render(plan),
			/Decisions/,
			"the same card regains standalone details after leaving its group",
		);
		standaloneParent.removeChild(plan);
		group.addTool(plan);
		assert.doesNotMatch(
			render(group),
			/Decisions/,
			"rejoining a group refreshes the paint cache and removes nested details",
		);
		group.setExpanded(false);
		plan.updateResult(result(steps().map((step) => ({ ...step, status: "completed" }))));
		assert.match(render(group), /Update Plan 3\/3 done/);
		plan.updateResult({
			isError: true,
			content: [{ type: "text", text: "Rejected plan" }],
			details: { plan: steps() },
		});
		assert.match(render(group), /✗ Update Plan Update failed/);
		assert.doesNotMatch(render(group), /1\/3 done|3\/3 done/);
		group.setExpanded(true);
		assert.match(render(group), /Rejected plan/);
		for (const width of [24, 48, 100])
			for (const line of group.render(width)) assert.ok(visibleWidth(line) <= width);
	} finally {
		grouping.shutdown();
		hooks.shutdown();
	}
});

test("long plans focus the active step; expansion preserves full text, advice and terminal-safe content", () => {
	const long = Array.from({ length: 15 }, (_, index) => ({
		id: String(index),
		goal: `步骤 ${index} 中文 🧪\n补充说明`,
		status: index < 10 ? "completed" : index === 10 ? "in_progress" : "pending",
	}));
	long[10].goal += "\x1b]52;c;not-a-clipboard\x07\x1b[2J";
	const plan = planFromResult(result(long, ["Actual warning"]))!;
	const collapsed = createPlanResultComponent({
		plan,
		args: args(),
		theme,
		expanded: false,
		hint: "click to show more",
	});
	assert.match(render(collapsed), /步骤 10/);
	assert.match(render(collapsed), /8 earlier steps/);
	assert.match(render(collapsed), /1 more steps/);
	assert.match(render(collapsed), /Actual warning/);
	const expanded = createPlanResultComponent({
		plan,
		args: args(),
		theme,
		expanded: true,
		hint: "↑ Collapse",
	});
	const full = render(expanded);
	assert.match(full, /步骤 0/);
	assert.match(full, /步骤 14/);
	assert.match(full, /补充说明/);
	assert.doesNotMatch(full, /not-a-clipboard/);
	for (const component of [collapsed, expanded])
		for (const width of [8, 22, 50])
			for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
});
