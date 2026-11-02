/**
 * One-line, icon-free personal status bar with one blank row below it.
 * No status chip registry, external quota polling or configuration panel.
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatTokenCount } from "../../utils/format.ts";
import { GitOperationMonitor } from "./git-operation.ts";

/** Loader rows (Working/retry indicators) render with 1 column of padding on both sides;
 *  the footer aligns with that grid instead of touching the screen edges. */
const FOOTER_MARGIN = 1;

const SESSION_STATS_TTL_MS = 1000;

export type FooterParts = {
	model: string;
	thinking?: string;
	contextPercent?: number | null;
	contextWindow?: number;
	cost?: number;
	directory?: string;
	branch?: string;
	gitOperation?: string;
};

type FooterTheme = Pick<Theme, "fg">;
type FooterLifecycle = Pick<GitOperationMonitor, "refresh" | "dispose">;

/** Select the richest representation that fits; never emit a second row. */
export function formatOneLineFooter(parts: FooterParts, width: number, theme: FooterTheme): string {
	const available = Math.max(0, Math.floor(width));
	if (!available) return "";
	const fg = theme.fg.bind(theme);
	const model = fg("dim", parts.model || "no-model");
	const thinking = parts.thinking && parts.thinking !== "off"
		? fg("dim", parts.thinking) : "";
	const percentage = parts.contextPercent == null
		? "?"
		: `${Math.floor(parts.contextPercent)}%`;
	const contextShort = fg("dim", percentage);
	const contextFull = fg("dim", percentage + (parts.contextWindow ? `/${formatTokenCount(parts.contextWindow)}` : ""));
	const totalCost = Number.isFinite(parts.cost) ? Math.max(0, parts.cost ?? 0) : 0;
	const cost = fg("dim", `$${totalCost.toFixed(2)}`);
	const cwd = parts.directory ? fg("dim", parts.directory) : "";
	const branch = parts.branch ? fg("dim", parts.branch) : "";
	const operation = parts.gitOperation ? fg("dim", `[${parts.gitOperation}]`) : "";
	const branchState = [branch, operation].filter(Boolean).join(" ");
	const separator = fg("muted", " | ");
	const join = (...values: string[]) => values.filter(Boolean).join(separator);
	const right = [thinking, model].filter(Boolean).join(fg("muted", " · "));
	const usage = join(contextShort, cost, right);
	// Shorten project details before dropping context, cost or Thinking Level.
	const projectBudget = available - visibleWidth(usage) - 1;
	let project = projectBudget >= 3
		? truncateToWidth(join(cwd, branch), projectBudget, "…") : "";
	if (operation && projectBudget >= 3) {
		const identityBudget = projectBudget - visibleWidth(operation) - 1;
		project = identityBudget >= 3
			? `${truncateToWidth(join(cwd, branch), identityBudget, "…")} ${operation}`
			: truncateToWidth(operation, projectBudget, "…");
	}
	const candidates: [string, string][] = [
		[join(cwd, branchState), join(contextFull, cost, right)],
		[project, usage],
		["", join(contextShort, right)],
		["", right],
		["", join(contextShort, model)],
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
	(ctx: ExtensionContext, monitors?: Set<FooterLifecycle>) => (tui: any, theme: FooterTheme, footerData: any) => {
		const operations = new GitOperationMonitor(() => ctx.cwd, () => tui.requestRender());
		const unsubBranch = footerData.onBranchChange(() => {
			void operations.refresh();
			tui.requestRender();
		});
		let disposed = false;
		const lifecycle: FooterLifecycle = {
			refresh: () => operations.refresh(),
			dispose: () => {
				if (disposed) return;
				disposed = true;
				operations.dispose();
				monitors?.delete(lifecycle);
				unsubBranch();
			},
		};
		monitors?.add(lifecycle);

		let statsMemo: { usage: ReturnType<typeof ctx.getContextUsage>; cost: number } | undefined;
		let statsMemoKey = "";
		let statsMemoAt = 0;
		let statsManager: typeof ctx.sessionManager | undefined;
		const sessionStats = () => {
			const manager = ctx.sessionManager;
			const model = ctx.model;
			const key = JSON.stringify([
				manager.getSessionId(),
				manager.getSessionFile(),
				manager.getLeafId(),
				model?.provider,
				model?.id,
				model?.contextWindow,
				ctx.thinkingLevel,
			]);
			if (
				statsMemo &&
				statsManager === manager &&
				statsMemoKey === key &&
				performance.now() - statsMemoAt < SESSION_STATS_TTL_MS
			)
				return statsMemo;
			let cost = 0;
			for (const entry of manager.getEntries()) {
				if (entry.type === "message") {
					const message = entry.message;
					if (message.role === "assistant") cost += message.usage?.cost?.total || 0;
					else if (message.role === "toolResult" && message.usage)
						cost += message.usage.cost?.total || 0;
				} else if (
					(entry.type === "usage" || entry.type === "branch_summary" || entry.type === "compaction") &&
					entry.usage
				)
					cost += entry.usage.cost?.total || 0;
			}
			statsMemo = { usage: ctx.getContextUsage(), cost };
			statsMemoKey = key;
			statsMemoAt = performance.now();
			statsManager = manager;
			return statsMemo;
		};

		return {
			render(width: number): string[] {
				const model = ctx.model;
				const { usage, cost } = sessionStats();
				const directory = ctx.cwd.split(/[\\/]/).filter(Boolean).pop() || ctx.cwd;
				const margin = Math.min(FOOTER_MARGIN, Math.max(0, Math.floor((width - 1) / 2)));
				const line = formatOneLineFooter({
					model: model?.id ?? "no-model",
					thinking: model?.reasoning ? ctx.thinkingLevel : undefined,
					contextPercent: usage?.percent,
					contextWindow: usage?.contextWindow ?? model?.contextWindow,
					cost,
					directory,
					branch: footerData.getGitBranch(),
					gitOperation: operations.label,
				}, width - margin * 2, theme);
				return [" ".repeat(margin) + line + " ".repeat(margin), ""];
			},
			invalidate(): void { tui.requestRender(); },
			dispose: lifecycle.dispose,
		};
	};

export function applyCustomFooter(ctx: ExtensionContext, monitors?: Set<FooterLifecycle>): void {
	if (!ctx?.hasUI || typeof ctx.ui?.setFooter !== "function") return;
	try {
		ctx.ui.setFooter(createFooter(ctx, monitors));
	} catch (error) {
		ctx.ui.notify(`footer error: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}

export default function footerExtension(pi: ExtensionAPI): void {
	const monitors = new Set<FooterLifecycle>();
	pi.on("session_start", (_event, ctx) => applyCustomFooter(ctx, monitors));
	const refresh = () => {
		for (const monitor of monitors) void monitor.refresh();
	};
	pi.on("tool_execution_end", refresh);
	pi.on("agent_end", refresh);
	pi.on("session_shutdown", () => {
		for (const monitor of monitors) monitor.dispose();
		monitors.clear();
	});
}
