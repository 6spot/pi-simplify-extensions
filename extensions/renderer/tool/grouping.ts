import { AssistantMessageComponent, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Spacer,
	truncateToWidth,
	visibleWidth,
	type Component,
} from "@earendil-works/pi-tui";
import { config } from "../../config/config.ts";
import { ownsPrivateToolShell, toolCardFamily } from "./card-family.ts";
import { aggregateToolCardBgSlot, toolCardStatus } from "./tool-state.ts";
import { planSummary } from "./plan.ts";
import {
	ASK_USER_QUESTION_TOOL_NAME,
	askUserAnswerText,
	askUserAnswers,
	type AskUserAnswer,
} from "./ask-user-question.ts";
import {
	CODEMODE_TOOL_NAME,
	codemodeCalls,
	codemodeOutputLineCount,
	codemodeSummaryParts,
} from "./codemode.ts";
import { isMcpToolDefinition, mcpToolTitle } from "./mcp-title.ts";
import { collapseHintText, isToolTuiFullscreen, showMoreHintText } from "./names.ts";
import { argumentPreview } from "../../utils/argument-preview.ts";
import {
	hasVisibleText,
	imagePlacement,
	stripAnsi,
	stripBackgroundAnsi,
	stripLeadingStatusIcon,
} from "../../utils/ansi-text.ts";
import { walkComponentTree } from "../../utils/component-tree.ts";
import {
	fitToolCallSummary,
	humanizeToolLabel,
	renderToolHeaderToWidth,
	renderToolSummary,
	SHELL_TOOL_NAMES,
	toolCallSummary,
	type ToolCallSummary,
} from "./names.ts";
import { FILE_PANEL_TOOL_NAMES, fileToolSummary } from "./file-tools.ts";
import {
	formatToolDuration,
	textFromResult,
	headTruncateToWidth,
	toolViewportWidth,
	toolElapsedMs,
} from "./result.ts";
import {
	patchRegistry,
	TOOL_GROUPING_GENERATION_KEY as GENERATION_KEY,
	TOOL_GROUPING_PARENT_KEY as PARENT_KEY,
	TOOL_GROUPING_PATCH_KEY as PATCH_KEY,
} from "../../utils/patch-keys.ts";

const NON_GROUPABLE = new Set(["edit", "write", "apply_patch", "subagent", "subagent_task"]);

type Patch = {
	owner: object;
	active: boolean;
	prototype: any;
	original: { addChild: Function; removeChild: Function; clear: Function };
	installed: { addChild: Function; removeChild: Function; clear: Function };
	groups: Set<ToolGroupComponent>;
	enabled: () => boolean;
	generation: number;
	lastEnabled: boolean;
	theme?: any;
};

function toolName(tool: any): string {
	return String(tool?.toolName ?? tool?.toolDefinition?.name ?? "tool");
}

function family(tool: any) {
	return toolCardFamily(toolName(tool), tool?.toolDefinition ?? tool?.builtInToolDefinition);
}

/** Keep source and registered identity consistent with the standalone fallback. */
function toolTitle(tool: any): string {
	const name = toolName(tool);
	const sourceTitle = mcpToolTitle({
		toolName: name,
		definition: tool?.toolDefinition ?? tool?.builtInToolDefinition,
	});
	if (sourceTitle) return sourceTitle.startsWith("MCP") ? sourceTitle : `MCP · ${sourceTitle}`;
	if (family(tool) === "plan") return "Update Plan";
	if (family(tool) === "question") return "Question";
	if (family(tool) === "generic") return `Tool · ${name}`;
	return humanizeToolLabel(name);
}

function isGroupable(value: unknown): boolean {
	return (
		value instanceof ToolExecutionComponent &&
		(!NON_GROUPABLE.has(toolName(value)) ||
			isMcpToolDefinition(
				(value as any).toolDefinition ?? (value as any).builtInToolDefinition,
				toolName(value),
			)) &&
		!ownsPrivateToolShell(
			toolName(value),
			(value as any).toolDefinition ?? (value as any).builtInToolDefinition,
		)
	);
}

function isIgnorable(value: unknown): boolean {
	if (value instanceof Spacer) return true;
	if (!(value instanceof AssistantMessageComponent)) return false;
	const children = (value as any).contentContainer?.children;
	return Array.isArray(children) && children.length === 0;
}

function previousSibling(
	children: any[],
	start: number,
): { child: any; index: number } | undefined {
	let skipped = 0;
	for (let index = start; index >= 0; index--) {
		const child = children[index];
		if (isIgnorable(child) && skipped < 3) {
			skipped++;
			continue;
		}
		return { child, index };
	}
	return undefined;
}

type ToolStatus = "pending" | "success" | "error" | "cancelled" | "unknown";

function status(tool: any): ToolStatus {
	return toolCardStatus(tool);
}

function statusIcon(value: ToolStatus): string {
	if (value === "success") return "✓";
	if (value === "error") return "✗";
	if (value === "cancelled") return "–";
	return "○";
}

function statusColor(value: ToolStatus): string {
	return value === "pending"
		? "accent"
		: value === "success"
			? "success"
			: value === "error"
				? "error"
				: "dim";
}

function visibleLines(lines: string[]): string[] {
	const keep = new Set<number>();
	for (let index = 0; index < lines.length; index++) {
		const placement = imagePlacement(lines[index]);
		if (!placement) {
			if (stripAnsi(lines[index]).trim()) keep.add(index);
			continue;
		}
		// 图片锚点之外的空行也占终端空间，裁掉后会覆盖后续工具。
		const start = placement.grows === "up" ? index - placement.rows + 1 : index;
		const end = placement.grows === "down" ? index + placement.rows - 1 : index;
		for (let row = Math.max(0, start); row <= Math.min(lines.length - 1, end); row++) keep.add(row);
	}
	return lines.filter((_line, index) => keep.has(index));
}

function stripLeadingSpaces(line: string, count: number): string {
	let offset = 0;
	let removed = 0;
	let ansi = "";
	while (offset < line.length) {
		const control = line.slice(offset).match(/^\x1b\[[0-?]*[ -/]*[@-~]/)?.[0];
		if (control) {
			ansi += control;
			offset += control.length;
			continue;
		}
		if (removed < count && line[offset] === " ") {
			removed++;
			offset++;
			continue;
		}
		break;
	}
	return ansi + line.slice(offset);
}

/** 生成一行铺满 width 的 slot 背景行；bgAnsiOverride 可替换背景 ANSI（用于提亮等）。 */
export function paddedBackgroundRow(
	theme: any,
	slot: string,
	content: string,
	width: number,
	bgAnsiOverride?: string,
): string {
	const innerWidth = Math.max(0, width - 2);
	const clipped = truncateToWidth(stripBackgroundAnsi(content), innerWidth, "");
	const row = ` ${clipped}${" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))} `;
	const bgAnsi =
		bgAnsiOverride ||
		(typeof theme?.bg === "function"
			? theme.getBgAnsi?.(slot) || theme.bg(slot, "").match(/^\x1b\[[0-?]*[ -/]*[@-~]/)?.[0] || ""
			: "");
	const stable = bgAnsi ? row.replace(/\x1b\[(?:0)?m/g, (reset) => reset + bgAnsi) : row;
	if (!bgAnsi) return typeof theme?.bg === "function" ? theme.bg(slot, stable) : row;
	return `${bgAnsi}${stable}\x1b[49m`;
}

function toolSummary(tool: any): ToolCallSummary {
	if (family(tool) === "generic" && toolCardFamily(toolName(tool)) !== "generic")
		return { main: toolTitle(tool), detail: "", payload: argumentPreview(tool.args) };
	if (family(tool) === "query")
		return fileToolSummary(
			toolName(tool),
			tool?.args ?? {},
			tool?.result,
			status(tool) === "success",
			tool?.cwd,
		);
	return toolCallSummary(toolName(tool), tool?.args ?? {}, {
		title: toolTitle(tool),
		variant: "grouping",
		cwd: tool?.cwd,
	});
}

/**
 * codemode 的折叠行：有结果就报该次调用的统计（与单卡汇总行同一套口径），
 * 免得一张卡里几行长代码预览互相看不出区别。还没结果时退回代码预览。
 */
/**
 * ask_user_question 的折叠行：有结果就报「问题 -> 回答」，
 * 多题压成一行并标注剩余条数。还没结果时退回问题预览。
 */
function askUserResultSummary(tool: any): ToolCallSummary | undefined {
	if (family(tool) !== "question" || !tool?.result) return undefined;
	const answers = askUserAnswers(tool.result)
		.map((answer: AskUserAnswer, index: number) => ({ answer, index }))
		.sort((left, right) => {
			const leftIndex = Number(left.answer.questionIndex);
			const rightIndex = Number(right.answer.questionIndex);
			const leftMissing = !Number.isFinite(leftIndex);
			const rightMissing = !Number.isFinite(rightIndex);
			if (leftMissing || rightMissing) {
				if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
				return left.index - right.index;
			}
			return leftIndex - rightIndex;
		})
		.map((entry) => entry.answer);
	if (answers.length === 0) {
		const label =
			tool.result?.details?.cancelled === true
				? "Declined"
				: tool.result?.isError
					? `Failed · ${
							textFromResult(tool.result)
								.split("\n")
								.find((line) => line.trim()) ?? "No error text"
						}`
					: tool.isPartial
						? "Waiting for response"
						: "No answer returned";
		return { main: toolTitle(tool), detail: "", payload: label };
	}
	const first = answers[0]!;
	const question = String(first.question ?? "").trim() || "Question";
	const more = answers.length > 1 ? ` (+${answers.length - 1})` : "";
	return {
		main: toolTitle(tool),
		detail: "",
		payload: `${question} -> ${askUserAnswerText(first)}${more}`,
	};
}

function planResultSummary(tool: any): ToolCallSummary | undefined {
	if (family(tool) !== "plan") return;
	return {
		main: toolTitle(tool),
		detail: "",
		payload:
			planSummary(tool.args, tool.result) ?? (tool.result ? "Result available" : "Updating plan"),
	};
}

function codemodeResultSummary(tool: any): ToolCallSummary | undefined {
	if (family(tool) !== "codemode" || !tool?.result) return undefined;
	const parts = codemodeSummaryParts(
		codemodeCalls(tool.result),
		codemodeOutputLineCount(tool.result),
		tool?.isPartial === true,
	);
	return { main: toolTitle(tool), detail: "", payload: parts.join(" · ") };
}

/**
 * 组内 shell 行的尾巴：只报耗时（`· 12.4s`）。输出和错误正文都在展开后看；
 * 失败靠行首的 ✗，组头另有 failed 计数。
 * 耗时取 pi 记在结果上的 durationMs（单卡渲染上下文里的同一个值），运行中还拿不到就不报。
 */
function shellResultTail(
	tool: any,
	fg: (color: string, text: string) => string,
	toolStatus: ToolStatus,
): string {
	if (family(tool) !== "shell") return "";
	const bash = toolName(tool) === "bash";
	if (!bash && (toolStatus === "pending" || !tool?.result)) return "";
	const durationMs = bash
		? toolElapsedMs(
				tool.getRenderContext?.() ?? { result: tool.result, durationMs: tool.result?.durationMs },
				toolStatus === "pending",
			)
		: tool.result?.durationMs;
	const duration =
		typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0
			? formatToolDuration(durationMs)
			: "";
	return duration ? ` ${fg("dim", `· ${duration}`)}` : "";
}

/** 分组折叠态的一行子工具：`├/└` + 状态图标 + 与组内同一套摘要。 */
function collapsedGroupToolLine(
	tool: any,
	last: boolean,
	fg: (color: string, text: string) => string,
	width: number,
): string {
	const toolStatus = status(tool);
	const color = statusColor(toolStatus);
	const summary =
		planResultSummary(tool) ??
		askUserResultSummary(tool) ??
		codemodeResultSummary(tool) ??
		toolSummary(tool);
	const prefix = ` ${fg("dim", last ? "└" : "├")} ${fg(color, statusIcon(toolStatus))} `;
	const detail = fg("dim", summary.detail);
	const result = shellResultTail(tool, fg, toolStatus);
	const rowWidth = toolViewportWidth(width);
	const mainWidth = Math.max(
		0,
		rowWidth - visibleWidth(prefix) - visibleWidth(detail) - visibleWidth(result),
	);
	return truncateToWidth(
		`${prefix}${renderToolSummary(summary, mainWidth, fg)}${detail}${result}`,
		rowWidth,
		"",
	);
}

type GroupHeaderCounts = {
	pending: number;
	success: number;
	error: number;
	cancelled: number;
	unknown: number;
};

/** 组头计数：`2 done · 1 failed`。没有计数时返回空串。 */
function groupCountText(
	counts: GroupHeaderCounts,
	fg: (color: string, text: string) => string,
): string {
	return (["success", "pending", "error", "cancelled", "unknown"] as const)
		.filter((key) => counts[key])
		.map((key) => {
			const label =
				key === "pending"
					? "running"
					: key === "success"
						? "done"
						: key === "error"
							? "failed"
							: key;
			const color = statusColor(key);
			return `${fg(color, String(counts[key]))} ${label}`;
		})
		.join(` ${fg("dim", "·")} `);
}

/** 组头圆点色：有失败取 error，否则有运行中取 accent，否则 success。 */
function groupOverallStatus(counts: GroupHeaderCounts): ToolStatus {
	return counts.pending
		? "pending"
		: counts.error
			? "error"
			: counts.unknown
				? "unknown"
				: counts.cancelled
					? "cancelled"
					: "success";
}

let nextGroupId = 1;

type SettledGroupCache = {
	width: number;
	hover: boolean;
	theme: unknown;
	fullscreen: boolean;
	children: readonly unknown[];
	args: unknown[];
	results: unknown[];
	lines: string[];
};

type ExpandedGroupCache = {
	width: number;
	hover: boolean;
	theme: unknown;
	fullscreen: boolean;
	bgSlot: string;
	/** 进行中和成功共用中性底色，状态仍须独立参与缓存判断。 */
	statuses: ToolStatus[];
	paints: readonly unknown[];
	lines: string[];
};

export class ToolGroupComponent extends Container {
	readonly toolCallId = `ccstyle-tool-group-${nextGroupId++}`;
	readonly toolName = "Tool group";
	private _expanded = false;
	/** 分组是否展开（只读；测试与外部读状态用）。 */
	get expanded(): boolean {
		return this._expanded;
	}
	private hintHovered = false;
	private titleControlLine: string | undefined;
	isTitleControlLine(line: string): boolean {
		return this.titleControlLine !== undefined && stripAnsi(line).trim() === this.titleControlLine;
	}
	private readonly patch: Patch;
	/** 仅缓存已完成且折叠的分组；pending 每帧现算。 */
	private settledCache: SettledGroupCache | undefined;
	/** 展开分组：子工具 paint 引用未变则复用整卡行。 */
	private expandedPaintCache: ExpandedGroupCache | undefined;

	constructor(patch: Patch) {
		super();
		this.patch = patch;
		patch.groups.add(this);
	}

	private clearPaintCache(): void {
		this.settledCache = undefined;
		this.expandedPaintCache = undefined;
	}

	addTool(tool: any): void {
		this.clearPaintCache();
		this.children.push(tool);
		tool[PARENT_KEY] = this;
	}

	releaseTools(): any[] {
		this.clearPaintCache();
		const tools = [...this.children];
		this.children.length = 0;
		this.patch.groups.delete(this);
		return tools;
	}

	removeTool(tool: any): void {
		this.clearPaintCache();
		const index = this.children.indexOf(tool);
		if (index >= 0) this.children.splice(index, 1);
		if (tool?.[PARENT_KEY] === this) delete tool[PARENT_KEY];
	}

	setExpanded(expanded: boolean): void {
		if (this._expanded !== expanded) this.clearPaintCache();
		this._expanded = expanded;
		for (const tool of this.children)
			(tool as Component & { setExpanded?: (expanded: boolean) => void }).setExpanded?.(expanded);
	}

	setHintHovered(hovered: boolean): void {
		if (this.hintHovered !== hovered) this.clearPaintCache();
		this.hintHovered = hovered;
	}

	/**
	 * 展开时按局部行定位内部组件（null = 行属于 group 自身：空行/头行/尾行）。
	 * 行数计算与 render 保持一致：宽度 width-2 + 空行过滤。
	 */
	childAtRow(localRow: number, width: number): { component: any; row: number } | null {
		if (!this._expanded || localRow < 2) return null;
		let offset = 2;
		for (const tool of this.children) {
			let lines: string[] = [];
			try {
				const rendered = tool.render?.(Math.max(1, width - 2));
				if (Array.isArray(rendered)) lines = visibleLines(rendered.map((line) => String(line)));
			} catch {
				lines = [];
			}
			const lineCount = Math.max(1, lines.length);
			if (localRow < offset + lineCount) {
				return { component: tool, row: localRow - offset };
			}
			offset += lineCount;
		}
		return null;
	}

	invalidate(): void {
		this.clearPaintCache();
		for (const tool of this.children) tool.invalidate?.();
	}

	private settledCacheHit(width: number): string[] | undefined {
		const cache = this.settledCache;
		if (!cache || this._expanded) return;
		if (
			cache.width !== width ||
			cache.hover !== this.hintHovered ||
			cache.theme !== this.patch.theme ||
			cache.fullscreen !== isToolTuiFullscreen()
		) {
			return;
		}
		const tools = this.children as any[];
		if (cache.children.length !== tools.length) return;
		for (let i = 0; i < tools.length; i++) {
			const tool = tools[i];
			if (
				cache.children[i] !== tool ||
				cache.args[i] !== tool?.args ||
				cache.results[i] !== tool?.result ||
				status(tool) === "pending"
			) {
				return;
			}
		}
		return cache.lines;
	}

	private storeSettledCache(width: number, lines: string[]): void {
		this.settledCache = {
			width,
			hover: this.hintHovered,
			theme: this.patch.theme,
			fullscreen: isToolTuiFullscreen(),
			children: [...this.children],
			args: (this.children as any[]).map((tool) => tool?.args),
			results: (this.children as any[]).map((tool) => tool?.result),
			lines,
		};
	}

	render(width: number): string[] {
		const cached = this.settledCacheHit(width);
		if (cached) return cached;
		const theme = this.patch.theme;
		const fg = (color: string, text: string) => theme?.fg?.(color, text) ?? text;
		const counts = { pending: 0, success: 0, error: 0, cancelled: 0, unknown: 0 };
		const statuses = this.children.map(status);
		for (const value of statuses) counts[value]++;
		const countText = groupCountText(counts, fg);
		const overall = groupOverallStatus(counts);
		const overallColor = statusColor(overall);
		const hintText = this._expanded ? collapseHintText() : showMoreHintText();
		const hint = ` ${fg("dim", "·")} ${fg(this.hintHovered ? "text" : "dim", hintText)}`;
		const rowWidth = toolViewportWidth(width);
		const head = ` ${fg(overallColor, overall === "success" ? "●" : statusIcon(overall))} Multiple Tools · ${countText}`;
		const lines = ["", renderToolHeaderToWidth(head, hint, rowWidth)];
		this.titleControlLine = stripAnsi(lines[1]!).includes(hintText)
			? stripAnsi(lines[1]!).trim()
			: undefined;
		const total = this.children.length;
		const childPaints = this._expanded
			? (this.children as any[]).map((tool) => tool.render?.(Math.max(1, width - 2)))
			: undefined;
		if (this._expanded && childPaints) {
			const expandedHit = this.expandedPaintCache;
			if (
				expandedHit &&
				expandedHit.width === width &&
				expandedHit.hover === this.hintHovered &&
				expandedHit.theme === this.patch.theme &&
				expandedHit.fullscreen === isToolTuiFullscreen() &&
				expandedHit.bgSlot === aggregateToolCardBgSlot(this.children) &&
				expandedHit.paints.length === childPaints.length &&
				expandedHit.statuses.every((value, index) => value === statuses[index]) &&
				expandedHit.paints.every((paint, index) => paint === childPaints[index])
			) {
				return expandedHit.lines;
			}
		}
		const expandedLines: string[] = [];
		const visibleTotal = this._expanded ? total : Math.min(6, total);
		for (let index = 0; index < visibleTotal; index++) {
			const tool = this.children[index];
			const toolStatus = statuses[index];
			const color = statusColor(toolStatus);
			const branch = index === total - 1 ? "└" : "├";
			const continuation = index === total - 1 ? "  " : "│ ";
			if (!this._expanded) {
				lines.push(collapsedGroupToolLine(tool, index === visibleTotal - 1, fg, width));
				continue;
			}
			const rendered = visibleLines(Array.isArray(childPaints?.[index]) ? childPaints[index] : []);
			// 首行的状态图标由组前缀给；剥完什么都不剩就丢掉这一行，再对新的首行剥一次，
			// 否则会多出一条只有 `├ ✓` 的空行，标题带着图标落到下一行。
			while (rendered.length) {
				rendered[0] = stripLeadingStatusIcon(rendered[0])
					.replace(/^ +/, "")
					.replace(/^((?:\x1b\[[0-?]*[ -/]*[@-~])*) +/, "$1");
				if (hasVisibleText(rendered[0])) break;
				rendered.shift();
			}
			const childLines = rendered.length ? rendered : [toolSummary(tool).main];
			for (let lineIndex = 0; lineIndex < childLines.length; lineIndex++) {
				const content =
					// 续行只剥外层 Box 的 1 格 left pad，保留 Input/Output 相对缩进
					lineIndex === 0 ? childLines[lineIndex] : stripLeadingSpaces(childLines[lineIndex], 1);
				const prefix =
					lineIndex === 0
						? `${fg("dim", branch)} ${fg(color, statusIcon(toolStatus))} `
						: fg("dim", continuation);
				expandedLines.push(prefix + content);
			}
		}
		if (!this._expanded && total > visibleTotal)
			lines.push(truncateToWidth(fg("dim", `  … ${total - visibleTotal} more tools`), rowWidth));
		if (this._expanded) {
			// 有一个失败整卡用失败底色，其余状态保持中性底色。
			const backgroundSlot = aggregateToolCardBgSlot(this.children);
			for (const line of expandedLines) {
				lines.push(paddedBackgroundRow(theme, backgroundSlot, line, width));
			}
			lines.push(paddedBackgroundRow(theme, backgroundSlot, "", width));
			this.expandedPaintCache = {
				width,
				hover: this.hintHovered,
				theme: this.patch.theme,
				fullscreen: isToolTuiFullscreen(),
				bgSlot: backgroundSlot,
				statuses,
				paints: childPaints ?? [],
				lines,
			};
		} else if (counts.pending === 0) {
			this.storeSettledCache(width, lines);
		}
		return lines;
	}
}

function ungroup(patch: Patch): void {
	for (const group of [...patch.groups]) {
		const parent = (group as any)[PARENT_KEY];
		const children = parent?.children;
		if (!Array.isArray(children)) {
			patch.groups.delete(group);
			continue;
		}
		const index = children.indexOf(group);
		if (index < 0) {
			patch.groups.delete(group);
			continue;
		}
		const tools = group.releaseTools();
		for (const tool of tools) tool[PARENT_KEY] = parent;
		children.splice(index, 1, ...tools);
	}
}

function normalizeGroup(patch: Patch, group: ToolGroupComponent): void {
	if (group.children.length > 1) return;
	const parent = (group as any)[PARENT_KEY];
	const index = parent?.children?.indexOf(group) ?? -1;
	const tools = group.releaseTools();
	delete (group as any)[PARENT_KEY];
	if (index < 0) {
		for (const tool of tools) delete tool[PARENT_KEY];
		return;
	}
	if (tools.length === 1) {
		tools[0][PARENT_KEY] = parent;
		parent.children.splice(index, 1, tools[0]);
	} else {
		parent.children.splice(index, 1);
	}
}

function maybeGroup(patch: Patch, parent: any, component: any): void {
	if (
		!patch.active ||
		!patch.enabled() ||
		parent instanceof ToolGroupComponent ||
		!isGroupable(component)
	)
		return;
	component[GENERATION_KEY] = patch.generation;
	const children = parent?.children;
	if (!Array.isArray(children)) return;
	const index = children.indexOf(component);
	const prior = previousSibling(children, index - 1);
	if (!prior) return;
	if (prior.child instanceof ToolGroupComponent && (prior.child as any).patch === patch) {
		children.splice(index, 1);
		prior.child.addTool(component);
		return;
	}
	if (!isGroupable(prior.child) || prior.child[GENERATION_KEY] !== patch.generation) return;
	const group = new ToolGroupComponent(patch);
	group.addTool(prior.child);
	group.addTool(component);
	(group as any)[PARENT_KEY] = parent;
	children[prior.index] = group;
	children.splice(index, 1);
}

/** /reload 不会重新 addChild；扫描当前 mounted roots，把已有工具重新送入同一分组规则。 */
function regroup(patch: Patch, root: any): void {
	if (!patch.active || !patch.enabled() || !root) return;
	walkComponentTree(root, (value: any) => {
		// 分组卡与可分组工具是分组边界：不继续下钻（与原有遍历过滤一致）。
		if (value instanceof ToolGroupComponent || isGroupable(value)) return false;
		const children = value.children;
		if (Array.isArray(children)) {
			for (const child of [...children]) {
				if (child && typeof child === "object") child[PARENT_KEY] = value;
				maybeGroup(patch, value, child);
			}
		}
	});
}

export type ToolGroupingHooks = {
	setTheme(theme: any): void;
	refresh(root?: any): void;
	shutdown(): void;
};

export function installToolGrouping(getEnabled: () => boolean): ToolGroupingHooks {
	const prototype = Container.prototype as any;
	const previous = patchRegistry.get<Patch>(PATCH_KEY);
	if (previous) {
		previous.active = false;
		previous.enabled = () => false;
		ungroup(previous);
	}
	const original = {
		addChild:
			previous && prototype.addChild === previous.installed.addChild
				? previous.original.addChild
				: prototype.addChild,
		removeChild:
			previous && prototype.removeChild === previous.installed.removeChild
				? previous.original.removeChild
				: prototype.removeChild,
		clear:
			previous && prototype.clear === previous.installed.clear
				? previous.original.clear
				: prototype.clear,
	};
	const patch: Patch = {
		owner: {},
		active: true,
		prototype,
		original,
		installed: undefined as any,
		groups: new Set(),
		enabled: getEnabled,
		generation: 0,
		lastEnabled: getEnabled(),
	};
	patch.installed = {
		addChild: function (this: any, component: any) {
			const result = patch.original.addChild.call(this, component);
			if (component && typeof component === "object") component[PARENT_KEY] = this;
			maybeGroup(patch, this, component);
			return result;
		},
		removeChild: function (this: any, component: any) {
			const group = component?.[PARENT_KEY];
			if (group instanceof ToolGroupComponent && (group as any)[PARENT_KEY] === this) {
				group.removeTool(component);
				normalizeGroup(patch, group);
				return;
			}
			const result = patch.original.removeChild.call(this, component);
			if (component?.[PARENT_KEY] === this) delete component[PARENT_KEY];
			if (this instanceof ToolGroupComponent) normalizeGroup(patch, this);
			if (component instanceof ToolGroupComponent) {
				for (const tool of component.releaseTools()) delete tool[PARENT_KEY];
			}
			return result;
		},
		clear: function (this: any) {
			for (const child of [...(this.children ?? [])]) {
				if (child instanceof ToolGroupComponent) {
					for (const tool of child.releaseTools()) delete tool[PARENT_KEY];
				}
				if (child?.[PARENT_KEY] === this) delete child[PARENT_KEY];
			}
			if (this instanceof ToolGroupComponent) patch.groups.delete(this);
			return patch.original.clear.call(this);
		},
	};
	prototype.addChild = patch.installed.addChild;
	prototype.removeChild = patch.installed.removeChild;
	prototype.clear = patch.installed.clear;
	patchRegistry.install(PATCH_KEY, patch);
	return {
		setTheme(theme: any) {
			patch.theme = theme;
		},
		refresh(root?: any) {
			const enabled = patch.enabled();
			if (enabled !== patch.lastEnabled) {
				patch.lastEnabled = enabled;
				if (enabled) patch.generation++;
			}
			if (enabled) regroup(patch, root);
			else ungroup(patch);
		},
		shutdown() {
			if (!patch.active) return;
			patch.active = false;
			patch.enabled = () => false;
			ungroup(patch);
			if (prototype.addChild === patch.installed.addChild)
				prototype.addChild = patch.original.addChild;
			if (prototype.removeChild === patch.installed.removeChild)
				prototype.removeChild = patch.original.removeChild;
			if (prototype.clear === patch.installed.clear) prototype.clear = patch.original.clear;
		},
	};
}
