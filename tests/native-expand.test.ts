import assert from "node:assert/strict";
import test from "node:test";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { installToolMouseInteraction } from "../extensions/renderer/mouse/interaction.ts";
import { collapsedHintHitbox } from "../extensions/renderer/mouse/layout.ts";

initTheme("dark");
const theme = {
	fg: (_slot: string, text: string) => text,
	bg: (_slot: string, text: string) => text,
};
function interaction(tool?: any) {
	let input: any;
	const tui: any = {
		terminal: { columns: 120, rows: 30, write() {} },
		children: tool ? [tool] : [],
		previousLines: [] as string[],
		previousViewportTop: 0,
		requestRender() {},
		handleInput(data: string) {
			return input?.(data);
		},
		doRender() {
			this.previousLines = tool?.render(120) ?? [];
		},
	};
	installToolMouseInteraction({
		mode: "tui",
		hasUI: true,
		ui: {
			setWidget(_key: string, factory: any) {
				if (typeof factory === "function") factory(tui, theme);
			},
			onTerminalInput(handler: any) {
				input = handler;
				return () => {
					input = undefined;
				};
			},
		},
	});
	return tui;
}

test("native expansion hints retain exact Unicode/ANSI hit columns and reject nonterminal prose", () => {
	for (const hint of [
		"(41 more lines, ctrl+o to expand)",
		"(41 more lines, ctrl+o to show more)",
		"(41 more lines, to expand)",
		"(41 more lines / click)",
		"click to show more",
		"↑ Collapse",
	]) {
		const prefix = "... 中文 🧪 ";
		assert.deepEqual(collapsedHintHitbox(`\x1b[36m${prefix}${hint}\x1b[0m`), {
			startCol: visibleWidth(prefix) + 1,
			endCol: visibleWidth(prefix + hint),
		});
	}
	for (const hint of ["Expand", "Collapse"]) {
		const prefix = "✓ 中文 🧪 · ";
		assert.deepEqual(collapsedHintHitbox(`\x1b[36m${prefix}${hint}\x1b[0m`), {
			startCol: visibleWidth(prefix) + 1,
			endCol: visibleWidth(prefix + hint),
		});
	}
	for (const line of [
		"(not an expand hint)",
		"(30 more lines, ctrl+o to expand) trailing text",
		"the words to expand appear in source",
		"function Expand",
		"const Collapse",
		"... 20 lines",
	])
		assert.equal(collapsedHintHitbox(line), null);
});

test("legacy TUI frames expand native ASCII truncation rows and active plan title hints from their actual hint columns", () => {
	for (const row of [
		"... (20 more lines, ctrl+o to expand)",
		"... (20 more lines, ctrl+o to show more)",
		"○ Update Plan 1/3 done · click to show more",
		"✓ Read · lines 82–133 · click to show more",
		"○ Bash · 1.2s · click to show more",
		"✗ Grep · click to show more",
		"✓ Find · 3 paths · click to show more",
		"○ Update Plan 1/3 done · Expand",
		"✓ Read · lines 82–133 · Expand",
		"○ Bash · 1.2s · Expand",
		"✗ Grep · Expand",
		"✓ Find · 3 paths · Expand",
	]) {
		const tool: any = {
			toolName: "native",
			toolCallId: "native-expand",
			expanded: false,
			render() {
				return this.expanded ? ["✓ Native", "Full native content"] : [row];
			},
			setExpanded(value: boolean) {
				this.expanded = value;
			},
			invalidate() {},
		};
		const tui = interaction(tool);
		try {
			tui.doRender();
			tui.handleInput("\x1b[<0;2;1M");
			tui.handleInput("\x1b[<0;2;1m");
			assert.equal(tool.expanded, false, "summary prefix is not an expand button");
			const label = row.endsWith("Expand")
				? "Expand"
				: row.includes("to expand")
					? "to expand"
					: "to show more";
			const column = row.indexOf(label) + 1;
			tui.handleInput(`\x1b[<0;${column};1M`);
			tui.handleInput(`\x1b[<0;${column};1m`);
			assert.equal(tool.expanded, true, row);
		} finally {
			installToolMouseInteraction({});
		}
	}
});

test("native card-wide click guards protect content rows while preserving hint, selection, expanded and no-hint cards", () => {
	const prototype = ToolExecutionComponent.prototype as any;
	const original = prototype.handleMouse;
	const delegated: any[] = [];
	prototype.handleMouse = (event: any) => {
		delegated.push(event);
		return { handled: true };
	};
	interaction();
	try {
		const lines = ["✓ Native", "visible source content", "... (20 more lines, ctrl+o to expand)"];
		const card: any = { expanded: false, render: () => lines };
		const dispatch = (type: string, y: number) =>
			prototype.handleMouse.call(card, { type, button: "left", y, width: 120 });
		assert.equal(dispatch("click", 1)?.handled, true);
		assert.equal(delegated.length, 0);
		dispatch("click", 2);
		assert.equal(delegated.length, 1);
		dispatch("press", 1);
		assert.equal(delegated.length, 2);
		dispatch("wheel", 1);
		assert.equal(delegated.length, 3);
		card.expanded = true;
		dispatch("click", 1);
		assert.equal(delegated.length, 4);
		card.expanded = false;
		card.render = () => ["✓ Dedicated task card without expand hint"];
		dispatch("click", 0);
		assert.equal(delegated.length, 5);
		card.render = () => lines;
		card.resultRendererComponent = {
			isCollapsedHintLine: (_line: string, row: number) => row === 2,
		};
		dispatch("click", 1);
		assert.equal(delegated.length, 5);
		dispatch("click", 2);
		assert.equal(delegated.length, 6);
	} finally {
		installToolMouseInteraction({});
		prototype.handleMouse = original;
	}
});
