/** Personal defaults. Only a few appearance choices are exposed in simplify.json. */
import { readFileSync } from "node:fs";
import type { CompactThinkingConfig } from "../feature/compact-thinking.ts";

export type CompactStyleMode = "on" | "compact" | "off";
export type DiffViewMode = "auto" | "split" | "unified";
export type DiffIndicatorMode = "bars" | "classic" | "none";
export type FooterGitStatsMode = "working" | "branch";
export type FooterTokenRateMode = "average" | "live";
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
	mode: CompactStyleMode;
	excludeRenderers: string[];
	expandedInputMaxLines: number;
	expandedOutputMaxLines: number;
	toolLabelClip: number;
	useSummaryTitlesAsThinkingTitle: boolean;
	previewLines: number;
	animationIntervalMs: number;
	stickyUserMessage: boolean;
	scrollButtonMode: ScrollButtonMode;
	enableCustomFooter: boolean;
	footerTokenRate: boolean;
	footerTokenRateMode: FooterTokenRateMode;
	footerTokenRateTtft: boolean;
	footerCurrency: string;
	footerCurrencyRate: number | null;
	footerNerdIcons: boolean;
	footerGitStatsMode: FooterGitStatsMode;
	footerHiddenKeys: string[];
	footerLine1Keys: string[];
	footerLine2Keys: string[];
	footerLine3Keys: string[];
};

export const DEFAULT_CONFIG: Config = {
	...DEFAULT_TOOL_DISPLAY_CONFIG,
	mode: "on",
	excludeRenderers: [],
	expandedInputMaxLines: 5,
	expandedOutputMaxLines: 10,
	toolLabelClip: 0,
	useSummaryTitlesAsThinkingTitle: true,
	previewLines: 3,
	animationIntervalMs: 90,
	stickyUserMessage: true,
	scrollButtonMode: "dock",
	enableCustomFooter: true,
	footerTokenRate: false,
	footerTokenRateMode: "average",
	footerTokenRateTtft: false,
	footerCurrency: "USD",
	footerCurrencyRate: null,
	footerNerdIcons: false,
	footerGitStatsMode: "working",
	footerHiddenKeys: [],
	footerLine1Keys: ["model", "context", "cost"],
	footerLine2Keys: ["cwd", "git"],
	footerLine3Keys: [],
};

type LocalSettings = {
	diff?: { view?: DiffViewMode; collapsedEditLines?: number };
	thinking?: { previewLines?: number };
	footer?: { line1?: string[]; line2?: string[] };
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
const validKeys = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((entry) => typeof entry === "string");

export const config: Config = {
	...DEFAULT_CONFIG,
	diffViewMode: view && displayModes.includes(view) ? view : DEFAULT_CONFIG.diffViewMode,
	editDiffCollapsedLines: typeof editLines === "number" && Number.isInteger(editLines) && editLines >= 0
		? Math.min(editLines, 200) : DEFAULT_CONFIG.editDiffCollapsedLines,
	previewLines: typeof thinkingLines === "number" && Number.isInteger(thinkingLines) && thinkingLines >= 0
		? Math.min(thinkingLines, 15) : DEFAULT_CONFIG.previewLines,
	footerLine1Keys: validKeys(settings.footer?.line1) ? settings.footer!.line1! : DEFAULT_CONFIG.footerLine1Keys,
	footerLine2Keys: validKeys(settings.footer?.line2) ? settings.footer!.line2! : DEFAULT_CONFIG.footerLine2Keys,
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
