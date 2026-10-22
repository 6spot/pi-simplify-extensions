/** Personal defaults. Only a few appearance choices are exposed in simplify.json. */
import { readFileSync } from "node:fs";
import type { CompactThinkingConfig } from "../feature/compact-thinking.ts";

export type DiffViewMode = "auto" | "split" | "unified";
export type DiffIndicatorMode = "bars" | "classic" | "none";
export type FooterGitStatsMode = "working" | "branch";
export type ScrollButtonMode = "dock" | "native";

export interface ToolDisplayConfig {
	diffViewMode: DiffViewMode;
	diffIndicatorMode: DiffIndicatorMode;
	diffSplitMinWidth: number;
	editDiffCollapsedLines: number;
	writeDiffCollapsedLines: number;
	diffWordWrap: boolean;
	expandedPreviewMaxLines: number;
}

export const DEFAULT_TOOL_DISPLAY_CONFIG: ToolDisplayConfig = {
	diffViewMode: "auto",
	diffIndicatorMode: "bars",
	diffSplitMinWidth: 120,
	editDiffCollapsedLines: 12,
	writeDiffCollapsedLines: 0,
	diffWordWrap: true,
	expandedPreviewMaxLines: 40,
};

export type Config = ToolDisplayConfig & {
	excludeRenderers: string[];
	expandedInputMaxLines: number;
	expandedOutputMaxLines: number;
	toolLabelClip: number;
	useSummaryTitlesAsThinkingTitle: boolean;
	previewLines: number;
	animationIntervalMs: number;
	stickyUserMessage: boolean;
	scrollButtonMode: ScrollButtonMode;
};

export const DEFAULT_CONFIG: Config = {
	...DEFAULT_TOOL_DISPLAY_CONFIG,
	excludeRenderers: [],
	expandedInputMaxLines: 5,
	expandedOutputMaxLines: 10,
	toolLabelClip: 0,
	useSummaryTitlesAsThinkingTitle: true,
	previewLines: 3,
	animationIntervalMs: 90,
	stickyUserMessage: true,
	scrollButtonMode: "dock",
};

type LocalSettings = {
	diff?: { view?: DiffViewMode; collapsedEditLines?: number };
	thinking?: { previewLines?: number };
};

function loadLocalSettings(): LocalSettings {
	try {
		const value = JSON.parse(readFileSync(new URL("../../simplify.json", import.meta.url), "utf8"));
		return value && typeof value === "object" && !Array.isArray(value) ? value as LocalSettings : {};
	} catch {
		return {};
	}
}

const settings = loadLocalSettings();
const displayModes: readonly DiffViewMode[] = ["auto", "split", "unified"];
const view = settings.diff?.view;
const editLines = settings.diff?.collapsedEditLines;
const thinkingLines = settings.thinking?.previewLines;
export const config: Config = {
	...DEFAULT_CONFIG,
	diffViewMode: view && displayModes.includes(view) ? view : DEFAULT_CONFIG.diffViewMode,
	editDiffCollapsedLines: typeof editLines === "number" && Number.isInteger(editLines) && editLines >= 0
		? Math.min(editLines, 200) : DEFAULT_CONFIG.editDiffCollapsedLines,
	previewLines: typeof thinkingLines === "number" && Number.isInteger(thinkingLines) && thinkingLines >= 0
		? Math.min(thinkingLines, 15) : DEFAULT_CONFIG.previewLines,
};

export function getCompactThinkingConfig(source: Config = config): CompactThinkingConfig {
	return {
		useSummaryTitlesAsThinkingTitle: source.useSummaryTitlesAsThinkingTitle,
		previewLines: source.previewLines,
		animationIntervalMs: source.animationIntervalMs,
	};
}

export function getToolDisplayConfig(source: Config = config): ToolDisplayConfig {
	return {
		diffViewMode: source.diffViewMode,
		diffIndicatorMode: source.diffIndicatorMode,
		diffSplitMinWidth: source.diffSplitMinWidth,
		editDiffCollapsedLines: source.editDiffCollapsedLines,
		writeDiffCollapsedLines: source.writeDiffCollapsedLines,
		diffWordWrap: source.diffWordWrap,
		expandedPreviewMaxLines: source.expandedPreviewMaxLines,
	};
}
