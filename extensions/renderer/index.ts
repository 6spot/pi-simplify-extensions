import { ToolExecutionComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isAbsolute, resolve } from "node:path";
import { config } from "../config/config.ts";
import { installToolGrouping, type ToolGroupingHooks } from "./tool/grouping.ts";
import { installDefaultMode, installToolExpandedBackground, type DefaultModeHooks } from "./default-mode.ts";
import { installMainScreenDoRenderPatch } from "../utils/fullscreen-detect.ts";
import { installToolMouseInteraction, teardownToolMouseInteraction } from "./mouse/interaction.ts";
import { getToolMouseTui, noteNewTranscriptItem } from "./mouse/scroll.ts";
import { installStickyPromptPatches, disposeStickyPromptPatches, setStickyPromptTheme } from "./mouse/sticky-prompt.ts";
import { clearAllAnimations, clearLiveToolCalls, noteStreamingToolCalls, retireLiveToolCall } from "./tool/tool-state.ts";
import { capturePreviousContent, WriteExecutionMetadataStore } from "./tool/diff/write-execution.ts";
import { installMessageDisplayRendering, setMessageDisplayTheme, refreshMessageDisplays } from "./tool/message-display.ts";

/** One display mode: Claude Code-style tool cards, no round-level compact mode. */
export default function claudeCodeStyle(pi: ExtensionAPI): void {
	const writeMetadata = new WriteExecutionMetadataStore();
	const mouseOwner = {};
	let installed: {
		defaultMode: DefaultModeHooks;
		grouping: ToolGroupingHooks;
		disposeMessageDisplay: () => void;
		disposeExpandedBackground: () => void;
	} | undefined;

	function ensureInstalled(ctx: any) {
		if (!ctx?.hasUI || ctx.mode !== "tui") return undefined;
		if (!installed) {
			installMainScreenDoRenderPatch();
			installStickyPromptPatches();
			const defaultMode = installDefaultMode(writeMetadata);
			const grouping = installToolGrouping(() => true);
			const disposeMessageDisplay = installMessageDisplayRendering();
			const disposeExpandedBackground = installToolExpandedBackground();
			installed = { defaultMode, grouping, disposeMessageDisplay, disposeExpandedBackground };
		}
		installed.grouping.setTheme(ctx.ui.theme);
		setMessageDisplayTheme(ctx.ui.theme);
		setStickyPromptTheme(ctx.ui.theme);
		return installed;
	}

	pi.on("session_start", (_event, ctx) => {
		const hooks = ensureInstalled(ctx);
		if (!hooks) return;
		installToolMouseInteraction(ctx, mouseOwner);
		ctx.ui.setStatus("ccstyle", undefined);
		queueMicrotask(() => {
			hooks.grouping.refresh(getToolMouseTui());
			refreshMessageDisplays(getToolMouseTui());
			ctx.ui.requestRender();
		});
	});

	pi.on("session_compact", (_event, ctx) => {
		const hooks = ensureInstalled(ctx);
		if (!hooks) return;
		installToolMouseInteraction(ctx, mouseOwner);
		hooks.grouping.refresh(getToolMouseTui());
		refreshMessageDisplays(getToolMouseTui());
	});
	pi.on("session_tree", (_event, ctx) => {
		if (ctx?.hasUI) installed?.grouping.refresh(getToolMouseTui());
	});
	pi.on("message_update", (event) => {
		if (event.message?.role === "assistant") noteStreamingToolCalls(event.message);
	});
	pi.on("message_start", (event) => {
		const role = event.message?.role;
		if (role === "user" || role === "assistant" || role === "custom") noteNewTranscriptItem();
	});

	// Observe native or SoL-Pi writes instead of replacing the write tool.
	pi.on("tool_execution_start", async (event, ctx) => {
		installed?.grouping.setTheme(ctx.ui.theme);
		noteNewTranscriptItem();
		if (event.toolName !== "write" || event.parentToolCallId) return;
		const args = event.args as { path?: unknown; file_path?: unknown } | undefined;
		const path = args?.path ?? args?.file_path;
		if (typeof path !== "string" || !path.trim()) return;
		const absolute = isAbsolute(path) ? path : resolve(ctx.cwd, path);
		writeMetadata.set(event.toolCallId, await capturePreviousContent(absolute));
	});
	pi.on("tool_execution_end", (event) => {
		retireLiveToolCall(event.toolCallId);
		if (event.toolName === "write" && event.isError) writeMetadata.delete(event.toolCallId);
	});
	pi.on("turn_end", () => clearLiveToolCalls());
	pi.on("agent_end", () => clearLiveToolCalls());
	pi.on("session_shutdown", () => {
		writeMetadata.clear();
		clearLiveToolCalls();
		teardownToolMouseInteraction(mouseOwner);
		const current = installed;
		if (!current || !current.defaultMode.isOwner()) return;
		current.defaultMode.shutdown();
		current.grouping.shutdown();
		current.disposeExpandedBackground();
		current.disposeMessageDisplay();
		disposeStickyPromptPatches();
		clearAllAnimations();
		installed = undefined;
	});
}

export { preservesOriginalRenderer, shouldRenderRichDiff } from "./default-mode.ts";
export { isMcpToolDefinition, mcpToolTitle } from "./tool/mcp-title.ts";
export { ExpandedToolIoView, ExpandedToolResultText, formatToolInputArgs } from "./tool/tool-io.ts";
export { SHOW_MORE_LABEL } from "./tool/result.ts";
export { installToolMouseInteraction } from "./mouse/interaction.ts";
