/**
 * One-line, icon-free personal status bar.
 * No status chip registry, external quota polling, configuration panel or extra rows.
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatTokenCount } from "../../utils/format.ts";
import { inputTextIndent } from "./prompt-editor.ts";
import { createGitStatsRefresher, readGitStats, type GitStats } from "./git-stats.ts";

const GIT_REFRESH_MS = 10_000;

export type FooterParts = {
	model: string;
	thinking?: string;
	contextPercent?: number | null;
	contextWindow?: number;
	cost?: number;
	directory?: string;
	branch?: string;
	git?: GitStats;
};

type FooterTheme = Pick<Theme, "fg">;

function gitChanges(git: GitStats | undefined): string {
	if (!git || (!git.add && !git.del)) return "";
	return ` +${git.add}/-${git.del}`;
}

/** Select the richest representation that fits; never emit a second row. */
export function formatOneLineFooter(parts: FooterParts, width: number, theme: FooterTheme): string {
	const available = Math.max(0, Math.floor(width));
	if (!available) return "";
	const fg = theme.fg.bind(theme);
	const model = fg("accent", parts.model || "no-model");
	const thinking = parts.thinking && parts.thinking !== "off"
		? fg("dim", parts.thinking) : "";
	const percentage = parts.contextPercent == null
		? "ctx ?"
		: `ctx ${Math.floor(parts.contextPercent)}%`;
	const contextShort = fg("dim", percentage);
	const contextFull = fg("dim", percentage + (parts.contextWindow ? `/${formatTokenCount(parts.contextWindow)}` : ""));
	const cost = parts.cost && parts.cost > 0 ? fg("dim", `$${parts.cost.toFixed(2)}`) : "";
	const cwd = parts.directory ? fg("dim", parts.directory) : "";
	const branch = parts.branch ? fg("dim", parts.branch) : "";
	const branchFull = parts.branch
		? branch + fg("dim", gitChanges(parts.git))
		: "";
	const separator = fg("muted", " · ");
	const join = (...values: string[]) => values.filter(Boolean).join(separator);
	const right = join(thinking, model);
	const metrics = join(contextShort, cost);
	// Shorten project details before dropping context, cost or Thinking Level.
	const projectBudget = available - visibleWidth(metrics) - visibleWidth(right)
		- visibleWidth(separator) - 1;
	const project = projectBudget >= 3
		? truncateToWidth(join(cwd, branch), projectBudget, "…") : "";
	const candidates: [string, string][] = [
		[join(cwd, branchFull, contextFull, cost), right],
		[join(project, metrics), right],
		[contextShort, right],
		["", right],
		[contextShort, model],
		["", model],
	];
	for (const [left, end] of candidates) {
		const gap = available - visibleWidth(left) - visibleWidth(end);
		if (gap >= (left ? 1 : 0)) return left + " ".repeat(gap) + end;
	}
	const shortened = truncateToWidth(model, available, "…");
	return " ".repeat(Math.max(0, available - visibleWidth(shortened))) + shortened;
}

const createFooter =
	(ctx: ExtensionContext) => (tui: any, theme: FooterTheme, footerData: any) => {
		let gitStats: GitStats | undefined;
		let disposed = false;
		const refresher = createGitStatsRefresher({
			query: (signal) => readGitStats(ctx.cwd, signal),
			onChange: (value) => {
				gitStats = value;
				if (!disposed) tui.requestRender();
			},
		});
		refresher.refresh();
		const timer = setInterval(() => refresher.refresh(), GIT_REFRESH_MS);
		timer.unref?.();
		const unsubBranch = footerData.onBranchChange(() => {
			refresher.refresh(true);
			tui.requestRender();
		});

		return {
			render(width: number): string[] {
				const model = ctx.model;
				const usage = ctx.getContextUsage();
				let cost = 0;
				for (const entry of ctx.sessionManager.getEntries()) {
					if (entry.type === "message") {
						const message = entry.message;
						if (message.role === "assistant") cost += message.usage?.cost?.total || 0;
						else if (message.role === "toolResult" && message.usage)
							cost += message.usage.cost?.total || 0;
					} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
						cost += entry.usage.cost?.total || 0;
					}
				}
				const directory = ctx.cwd.split(/[\\/]/).filter(Boolean).pop() || ctx.cwd;
				const indent = Math.min(inputTextIndent(), Math.max(0, width - 1));
				const line = formatOneLineFooter({
					model: model?.id ?? "no-model",
					thinking: model?.reasoning ? ctx.thinkingLevel : undefined,
					contextPercent: usage?.percent,
					contextWindow: usage?.contextWindow ?? model?.contextWindow,
					cost,
					directory,
					branch: footerData.getGitBranch(),
					git: gitStats,
				}, width - indent, theme);
				return [" ".repeat(indent) + line];
			},
			invalidate(): void { tui.requestRender(); },
			dispose(): void {
				disposed = true;
				clearInterval(timer);
				refresher.dispose();
				unsubBranch();
			},
		};
	};

export function applyCustomFooter(ctx: ExtensionContext): void {
	if (!ctx?.hasUI || typeof ctx.ui?.setFooter !== "function") return;
	try {
		ctx.ui.setFooter(createFooter(ctx));
	} catch (error) {
		ctx.ui.notify(`footer error: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}

export default function footerExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => applyCustomFooter(ctx));
}
