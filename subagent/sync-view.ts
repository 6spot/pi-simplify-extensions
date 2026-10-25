import type { Message } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { toolCallSummary } from "../extensions/renderer/tool/names.ts";
import { expansionHintText } from "../extensions/utils/expansion-hints.ts";
import {
	cardHeading,
	cardVisualState,
	compactTaskRow,
	detailRows,
	groupHeading,
	previewRows,
	previewText,
	type TaskCardView,
} from "./view.ts";

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	/** Recorded process state; older history may not have these fields. */
	status?: "running" | "completed" | "failed" | "cancelled";
	elapsed_ms?: number;
}

type Row = Pick<SingleResult, "agent" | "task"> &
	Partial<Omit<SingleResult, "status">> & {
		status?: SingleResult["status"] | "pending";
		output?: string;
	};
type Options = { partial: boolean; mode?: "single" | "parallel" | "chain" };

export function isSyncTaskRows(value: unknown): value is Row[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every((row) => {
			if (
				!row ||
				typeof row !== "object" ||
				typeof row.agent !== "string" ||
				typeof row.task !== "string"
			)
				return false;
			if (
				row.status !== undefined &&
				!["pending", "running", "completed", "failed", "cancelled", "unknown"].includes(row.status)
			)
				return false;
			if (row.exitCode !== undefined && !Number.isSafeInteger(row.exitCode)) return false;
			if (
				["stderr", "errorMessage", "output"].some(
					(key) => row[key] !== undefined && typeof row[key] !== "string",
				)
			)
				return false;
			if (typeof row.output === "string" && row.messages === undefined) return true;
			return (
				Array.isArray(row.messages) &&
				row.messages.every(
					(message: any) =>
						message &&
						typeof message.role === "string" &&
						(message.role !== "assistant" ||
							(Array.isArray(message.content) &&
								message.content.every(
									(part: any) =>
										part &&
										typeof part.type === "string" &&
										(part.type !== "text" || typeof part.text === "string") &&
										(part.type !== "toolCall" || typeof part.name === "string"),
								))),
				)
			);
		})
	);
}

function state(row: Row, index: number, count: number, options: Options): string {
	if (row.status) return row.status;
	if (row.stopReason === "aborted") return "cancelled";
	if (row.stopReason === "error") return "failed";
	if (options.partial) {
		if (options.mode === "chain" && index < count - 1)
			return row.exitCode === 0 ? "completed" : "failed";
		return "running";
	}
	return row.exitCode === undefined ? "unknown" : row.exitCode === 0 ? "completed" : "failed";
}

function toolText(name: string, args: unknown): string {
	const summary = toolCallSummary(name, args);
	return [summary.main, summary.path?.value ?? summary.payload, summary.detail]
		.filter(Boolean)
		.join(" ");
}

function messageText(message: Message): string {
	if (message.role !== "assistant") return "";
	return message.content
		.map((part) =>
			part.type === "text"
				? part.text
				: part.type === "toolCall"
					? `→ ${toolText(part.name, part.arguments)}`
					: "",
		)
		.filter(Boolean)
		.join("\n");
}

function latestText(row: Row): string {
	if (row.output !== undefined) return row.output;
	for (let index = (row.messages?.length ?? 0) - 1; index >= 0; index--) {
		const message = row.messages![index];
		if (message.role !== "assistant") continue;
		for (const part of [...message.content].reverse()) {
			if (part.type === "text" && previewText(part.text).trim()) return part.text;
			if (part.type === "toolCall") return `→ ${toolText(part.name, part.arguments)}`;
		}
	}
	return "Waiting for first update";
}

function finalText(row: Row): string {
	if (row.output !== undefined) return row.output;
	for (let index = (row.messages?.length ?? 0) - 1; index >= 0; index--) {
		const message = row.messages![index];
		if (message.role !== "assistant") continue;
		const text = message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		if (previewText(text).trim()) return text;
	}
	return "(no output)";
}

function usageText(row: Row): string {
	const usage = row.usage;
	if (!usage) return "";
	return Object.entries(usage)
		.filter(([, value]) => Number.isFinite(value) && value > 0)
		.map(([key, value]) => `${key}: ${key === "cost" ? `$${value.toFixed(4)}` : value}`)
		.join(" · ");
}

/** Synchronous single/parallel/chain use the same heading, preview and sections as background cards. */
export function createSyncTaskView(
	rows: Row[],
	theme: Theme,
	expanded: boolean,
	options: Options,
): TaskCardView {
	let hovered = false;
	const headings = new Set<string>();
	let visualState = cardVisualState(
		rows.map((row, index) => state(row, index, rows.length, options)),
	);
	return {
		simplifyVisualState: () => visualState,
		invalidate() {},
		setHintHovered(value) {
			hovered = value;
		},
		isCollapsedHintLine(line) {
			return headings.has(stripVTControlCharacters(line).trim());
		},
		render(width) {
			visualState = cardVisualState(
				rows.map((row, index) => state(row, index, rows.length, options)),
			);
			headings.clear();
			const lines: string[] = [];
			const hint = expansionHintText(expanded);
			const selected = expanded ? rows : rows.slice(-4);
			const group = rows.length > 1 || options.mode === "parallel" || options.mode === "chain";
			if (group) {
				const heading = groupHeading(
					`Subagent${options.mode && options.mode !== "single" ? ` · ${options.mode}` : ""}`,
					rows.map((row, index) => state(row, index, rows.length, options)),
					width,
					theme,
					hint,
					hovered,
				);
				lines.push(heading);
				if (stripVTControlCharacters(heading).includes(hint))
					headings.add(stripVTControlCharacters(heading).trim());
			}
			if (selected.length < rows.length)
				lines.push(`${rows.length - selected.length} earlier tasks (expand to view)`);
			let omitted = false;
			for (const [selectedIndex, row] of selected.entries()) {
				const status = state(
					row,
					rows.length - selected.length + selectedIndex,
					rows.length,
					options,
				);
				if (selectedIndex && expanded) lines.push("");
				const heading = cardHeading(
					{ ...row, status, identity: group ? "" : "Subagent" },
					width,
					theme,
					!group && selectedIndex === 0 ? hint : "",
					hovered,
				);
				if (!group || expanded) lines.push(heading);
				if (!group && selectedIndex === 0 && stripVTControlCharacters(heading).includes(hint))
					headings.add(stripVTControlCharacters(heading).trim());
				const error =
					status === "failed" || status === "cancelled"
						? row.errorMessage || row.stderr || finalText(row)
						: "";
				const partialResult = Boolean(
					error && finalText(row) !== "(no output)" && finalText(row) !== error,
				);
				if (!expanded) {
					const active = status === "running" || status === "pending";
					const label = active
						? "Progress"
						: status === "cancelled"
							? "Cancelled"
							: status === "failed"
								? "Error"
								: "Result";
					const text = active ? latestText(row) : error || finalText(row);
					if (group) {
						const compact = compactTaskRow({ ...row, status }, label, text, width - 2, theme);
						lines.push(
							theme.fg("dim", selectedIndex === selected.length - 1 ? "└ " : "├ ") + compact.line,
						);
						lines.push(
							theme.fg("dim", selectedIndex === selected.length - 1 ? "  " : "│ ") +
								compact.preview,
						);
						omitted ||= compact.omitted || partialResult;
					} else {
						lines.push(...previewRows(label, text, width, theme, active ? 1 : 3));
						if (partialResult)
							lines.push(
								truncateToWidth(
									theme.fg("dim", "… Partial result hidden"),
									Math.max(1, width),
									"…",
								),
							);
					}
					continue;
				}
				const sections: Parameters<typeof detailRows>[0] = [
					{ label: "Task", text: row.task, color: "mdCode" },
				];
				const details = [
					row.agentSource ? `Source: ${row.agentSource}` : "",
					row.step ? `Step: ${row.step}` : "",
					row.model ? `Model: ${row.model}` : "",
					row.stopReason ? `Stop reason: ${row.stopReason}` : "",
					usageText(row),
				]
					.filter(Boolean)
					.join("\n");
				if (details) sections.push({ label: "Details", text: details, color: "dim" });
				if (row.stderr && row.stderr !== error)
					sections.push({ label: "Process output", text: row.stderr, color: "dim" });
				const reportItems = (row.messages ?? []).map(messageText).filter(Boolean);
				if (status !== "running" && reportItems.at(-1) === finalText(row)) reportItems.pop();
				const reports = reportItems.join("\n\n");
				if (reports) sections.push({ label: "Reports", text: reports });
				if (status === "running" || status === "pending") {
					if (!reports) sections.push({ label: "Progress", text: latestText(row) });
				} else
					sections.push({
						label: status === "failed" ? "Error" : status === "cancelled" ? "Cancelled" : "Result",
						text: error || finalText(row),
						color: status === "failed" ? "error" : status === "cancelled" ? "dim" : "toolOutput",
					});
				if (partialResult) sections.push({ label: "Result (partial)", text: finalText(row) });
				lines.push(...detailRows(sections, width, theme));
			}
			if (omitted)
				lines.push(
					truncateToWidth(theme.fg("dim", "… More task details hidden"), Math.max(1, width), "…"),
				);
			return new Text(lines.join("\n"), 0, 0).render(width);
		},
	};
}

export function createSubagentCallView(args: any, theme: Theme, context: any) {
	if (context?.result) return { render: () => [], invalidate() {} };
	const tasks = args.chain?.length
		? args.chain
		: args.tasks?.length
			? args.tasks
			: [{ agent: args.agent ?? "subagent", task: args.task ?? "Receiving task…" }];
	return createSyncTaskView(
		tasks.map((task: Row) => ({
			agent: task.agent,
			task: task.task,
			output: "Waiting for first update",
			status: "pending" as const,
		})),
		theme,
		Boolean(context?.expanded),
		{
			partial: true,
			mode: args.chain?.length ? "chain" : args.tasks?.length ? "parallel" : "single",
		},
	);
}
