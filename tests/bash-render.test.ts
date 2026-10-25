import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as stripAnsi } from "node:util";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { config } from "../extensions/config/config.ts";
import {
	installDefaultMode,
	installToolExpandedBackground,
} from "../extensions/renderer/default-mode.ts";
import { expandedIoForTool } from "../extensions/renderer/tool/tool-io.ts";
import { bashStatusText } from "../extensions/renderer/tool/bash.ts";
import { installToolGrouping, ToolGroupComponent } from "../extensions/renderer/tool/grouping.ts";
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
const nativeTool = (id = "bash", args: any = { command: "npm test" }) =>
	new ToolExecutionComponent("bash", id, args, {}, undefined, ui, process.cwd()) as any;
const output = (text: string, extra: any = {}) => ({
	content: [{ type: "text", text }],
	isError: false,
	...extra,
});
const render = (component: any, width = 100) => component.render(width).map(stripAnsi).join("\n");

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

test("Bash streams a real output tail and replaces it with the final result, keeping authoritative timing", () => {
	const cleanup = install();
	const originalNow = Date.now;
	let now = 1_000;
	Date.now = () => now;
	try {
		const tool = nativeTool();
		assert.match(render(tool), /○ Bash/);
		assert.match(render(tool), /\$ npm test/);
		assert.doesNotMatch(render(tool), /exit 0|\d+ms/);
		tool.markExecutionStarted();
		now = 5_200;
		const partial = output("first hidden\nsecond hidden\nthird\nfourth\nfifth\nsixth");
		tool.updateResult(partial, true);
		const running = render(tool);
		assert.match(running, /○ Bash · 4\.2s · [^\n]*Expand/);
		assert.equal(running.match(/Expand/g)?.length, 1);
		for (const line of ["third", "fourth", "fifth", "sixth"])
			assert.match(running, new RegExp(line));
		assert.doesNotMatch(running, /first hidden|second hidden|Pending|exit 0/);
		tool.updateResult(
			output("", { durationMs: 1_200, structuredContent: { exit_code: 0, wall_time_seconds: 10 } }),
		);
		const settled = render(tool);
		assert.match(settled, /✓ Bash · exit 0 · 1\.2s · [^\n]*Expand/);
		assert.equal(settled.match(/Expand/g)?.length, 1);
		assert.match(settled, /No output/);
		assert.doesNotMatch(settled, /sixth|4\.2s|10\.0s/);
		assert.equal(tool.render(100), tool.render(100), "settled paints keep the normal cache");
		tool.updateResult(
			output("real failure\nCommand exited with code 7", { isError: true, durationMs: 1_500 }),
		);
		assert.match(render(tool), /✗ Bash · exit 7 · 1\.5s · [^\n]*Expand/);
		assert.doesNotMatch(render(tool), /✓ Bash|exit 0|No output/);
		assert.equal(slots.length, 0, "collapsed Bash including errors is transparent");
		tool.setExpanded(true);
		render(tool);
		assert.match(render(tool), /✗ Bash · exit 7 · 1\.5s · Collapse/);
		assert.ok(slots.includes("toolErrorBg"));
		assert.equal(
			partial.content[0].text,
			"first hidden\nsecond hidden\nthird\nfourth\nfifth\nsixth",
		);
	} finally {
		Date.now = originalNow;
		cleanup();
	}
});

test("Bash cancellation, timeout, and unknown errors preserve their actual reason without inventing exit codes", () => {
	const cleanup = install();
	try {
		for (const [text, label] of [
			["partial log\n\nCommand aborted", "Cancelled"],
			["partial log\n\nCommand timed out after 2 seconds", "Timed out"],
			["Command terminated without an exit code", undefined],
			["spawn ENOENT", undefined],
		] as const) {
			const result = output(text, { isError: true });
			assert.equal(bashStatusText(result, false), label);
			const tool = nativeTool();
			tool.updateResult(result);
			const painted = render(tool);
			assert.match(painted, label === "Cancelled" ? /– Bash/ : /✗ Bash/);
			assert.ok(painted.includes(text.split("\n").at(-1)!));
			assert.doesNotMatch(painted, /exit 0|✓ Bash|\d+ms/);
		}
		assert.equal(bashStatusText(output("Command aborted"), false), undefined);
		assert.equal(bashStatusText(output("Command exited with code 8"), false), undefined);
		assert.equal(
			bashStatusText(output("", { structuredContent: { exit_code: 0 } }), true),
			undefined,
		);
	} finally {
		cleanup();
	}
});

test("Bash history uses structured timing when available, and does not invent timing or an exit code for old results", () => {
	const cleanup = install();
	try {
		const tool = nativeTool();
		tool.updateResult(
			output("restored output", {
				structuredContent: { exit_code: 3, wall_time_seconds: 2.5 },
				isError: true,
			}),
		);
		assert.match(render(tool), /✗ Bash · exit 3 · 2\.5s/);
		tool.updateResult(output("old result"));
		assert.match(render(tool), /✓ Bash · [^\n]*Expand/);
		assert.doesNotMatch(render(tool), /exit 3|2\.5s|exit 0/);
	} finally {
		cleanup();
	}
});

test("expanded Bash retains long available output, native truncation notes, command arguments, and narrow Unicode widths", () => {
	const cleanup = install();
	const originalLimit = config.expandedOutputMaxLines;
	config.expandedOutputMaxLines = 1000;
	try {
		const pending = nativeTool("silent-long-command", {
			command: `${Array.from({ length: 8 }, (_, index) => `echo line_${index}`).join("\n")}\necho LONG_COMMAND_END`,
		});
		pending.markExecutionStarted();
		assert.doesNotMatch(render(pending), /LONG_COMMAND_END/);
		assert.match(render(pending), /○ Bash[^\n]* · [^\n]*Expand/);
		pending.setExpanded(true);
		assert.match(render(pending), /○ Bash[^\n]* · Collapse/);
		assert.match(render(pending), /Input · Open preview/);
		assert.doesNotMatch(render(pending), /LONG_COMMAND_END/);
		assert.match(expandedIoForTool(pending)?.getInputBody() ?? "", /LONG_COMMAND_END/);
		assert.doesNotMatch(render(pending), /Expand/);
		const tool = nativeTool("long", { command: "printf '中文路径 🧪'\nprintf second", timeout: 5 });
		const long = Array.from({ length: 80 }, (_, index) => `${index} ${"a".repeat(250)}`).join("\n");
		const actual = output(
			`${long}\nFINAL_TAIL\n[Showing last 80 lines. Full output: /tmp/bash-full.txt]`,
			{
				details: { fullOutputPath: "/tmp/bash-full.txt", truncation: { truncated: true } },
				durationMs: 1_234,
			},
		);
		tool.updateResult(actual);
		assert.match(render(tool), /FINAL_TAIL/);
		tool.setExpanded(true);
		const expanded = render(tool);
		assert.match(expanded, /FINAL_TAIL/);
		assert.match(expanded, /Full output: \/tmp\/bash-full.txt/);
		assert.match(expanded, /timeout: 5/);
		assert.equal(expanded.match(/1\.2s/g)?.length, 1, "duration belongs only to the header");
		tool.setExpanded(false);
		for (const width of [12, 24, 40, 100])
			for (const line of tool.render(width))
				assert.ok(visibleWidth(line) <= width, `${width}: ${stripAnsi(line)}`);
		assert.ok(actual.content[0].text.length > 16_000);
	} finally {
		config.expandedOutputMaxLines = originalLimit;
		cleanup();
	}
});

test("Bash grouped summaries stay on one row, tick while running, and retain complete output on expansion", () => {
	const cleanup = install();
	const grouping = installToolGrouping(() => true);
	grouping.setTheme(theme);
	const originalNow = Date.now;
	let now = 1_000;
	Date.now = () => now;
	try {
		const container = new Container();
		const bash = nativeTool("group");
		container.addChild(bash);
		container.addChild(
			new ToolExecutionComponent(
				"read",
				"read",
				{ path: "a.ts" },
				{},
				undefined,
				ui,
				process.cwd(),
			),
		);
		const group = container.children.find((child) => child instanceof ToolGroupComponent)! as any;
		bash.markExecutionStarted();
		bash.updateResult(output("LIVE_OUTPUT"), true);
		now = 5_200;
		const running = render(group);
		assert.match(running, /[├└] ○ Bash npm test · 4\.2s/);
		assert.doesNotMatch(running, /LIVE_OUTPUT|\$ npm test/);
		bash.updateResult(output("FINAL_GROUP_OUTPUT", { durationMs: 6_800 }));
		assert.match(render(group), /[├└] ✓ Bash npm test · 6\.8s/);
		group.setExpanded(true);
		assert.match(render(group), /FINAL_GROUP_OUTPUT/);
		assert.match(render(group), /Input/);
		group.setExpanded(false);
		assert.doesNotMatch(render(group), /FINAL_GROUP_OUTPUT/);
	} finally {
		Date.now = originalNow;
		grouping.shutdown();
		cleanup();
	}
});
