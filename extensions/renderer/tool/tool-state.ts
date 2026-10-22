import type { ThemeBg } from "@earendil-works/pi-coding-agent";
/**
 * 本回合流式消息里出现过的工具调用。Pi 要等整条 assistant 消息结束才派发执行，
 * 这段窗口仍属于活动输出，不能提前按已完成内容缓存。
 * 恢复或翻历史重建的旧行不在这个集合里，继续复用已完成内容缓存。
 */
const liveToolCalls = new Set<string>();

/** 收下当前流式 assistant 消息里的工具调用 id。 */
export function noteStreamingToolCalls(message: any): void {
	const content = Array.isArray(message?.content) ? message.content : [];
	for (const block of content) {
		const id = block?.type === "toolCall" ? block.id : undefined;
		if (typeof id === "string" && id) liveToolCalls.add(id);
	}
}

/** 工具收尾后移出等待窗口。 */
export function retireLiveToolCall(toolCallId: unknown): void {
	if (typeof toolCallId === "string") liveToolCalls.delete(toolCallId);
}

export function clearLiveToolCalls(): void {
	liveToolCalls.clear();
}

/** 工具行是否处于等待窗口（流式声明中或等待派发）。 */
export function isLiveToolCall(toolCallId: unknown): boolean {
	return typeof toolCallId === "string" && liveToolCalls.has(toolCallId);
}

export function pendingIcon(_name: string): string {
	return "●";
}

type ToolVisualState = "pending" | "success" | "error";

/** 卡片表面保持中性，成功由状态标记表达；彩色背景留给 Diff 和失败。 */
export const TOOL_CARD_BG_SLOT: Record<ToolVisualState, ThemeBg> = {
	pending: "toolPendingBg",
	success: "toolPendingBg",
	error: "toolErrorBg",
};

/** 单张工具卡的状态。有失败取失败，没有结果或仍在输出取进行中，其余取成功。 */
export function toolCardStatus(tool: any): ToolVisualState {
	if (tool?.result?.isError === true || tool?.isError === true) return "error";
	if (tool?.isPartial === true || (tool?.executionStarted && !tool?.result) || !tool?.result) {
		return "pending";
	}
	return "success";
}

/**
 * 一张卡里多个工具的汇总状态。
 * 有一个失败取失败；没有失败但还有进行中取进行中；全部成功取成功。
 */
export function aggregateToolCardStatus(tools: readonly any[]): ToolVisualState {
	let pending = false;
	for (const tool of tools) {
		const value = toolCardStatus(tool);
		if (value === "error") return "error";
		if (value === "pending") pending = true;
	}
	return pending ? "pending" : "success";
}

/** 单张工具卡的底色，与分组卡片使用相同的状态映射。 */
export function toolCardBgSlot(tool: any): ThemeBg {
	return TOOL_CARD_BG_SLOT[toolCardStatus(tool)];
}

export function aggregateToolCardBgSlot(tools: readonly any[]): string {
	return TOOL_CARD_BG_SLOT[aggregateToolCardStatus(tools)];
}

export function settledIcon(name: string, state: ToolVisualState | undefined): string {
	if (state === "success") return "✓";
	if (state === "error") return "✗";
	// toolIcon(name) 曾恒返回 "●"，已内联；name 保留以稳定导出签名。
	return "●";
}

export function setToolVisualState(context: any, visualState: ToolVisualState) {
	const state = (context.state ??= {});
	if (state.ccstyleToolVisualState === visualState) return;
	state.ccstyleToolVisualState = visualState;
	// Do not invalidate synchronously from renderResult. Pi is already rendering
	// this tool row; recursively scheduling another render here can retain both
	// the finalized result component and its previous secondary/partial component,
	// which displays the result summary twice. The current render pass also
	// refreshes renderCall, so the settled icon still updates immediately.
}

function getToolVisualState(context: any): ToolVisualState | undefined {
	return context?.state?.ccstyleToolVisualState as ToolVisualState | undefined;
}

export function resolveToolVisualState(context: any): ToolVisualState | undefined {
	const visualState = getToolVisualState(context);
	if (visualState || context?.isPartial !== false) return visualState;
	const settledState: ToolVisualState = context?.isError ? "error" : "success";
	setToolVisualState(context, settledState);
	return settledState;
}

export function toolIconColor(context: any): "dim" | "error" | "success" | "muted" {
	const visualState = getToolVisualState(context);
	if (context?.isError || visualState === "error") return "error";
	if (visualState === "success") return "success";
	if (context?.isPartial || context?.executionStarted || visualState === "pending") return "dim";
	return "muted";
}

export function isToolExpanded(options: any, context: any): boolean {
	const local = context?.state?.ccstyleToolExpanded;
	return typeof local === "boolean" ? local : Boolean(options?.expanded ?? context?.expanded);
}
