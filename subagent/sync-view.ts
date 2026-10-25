import type { Message } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { toolCallSummary } from "../extensions/renderer/tool/names.ts";
import { expansionHintText } from "../extensions/utils/expansion-hints.ts";
import { cardHeading, detailRows, previewRows, type TaskCardView } from "./view.ts";

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

type Row = Pick<SingleResult, "agent" | "task"> & Partial<SingleResult> & { output?: string };
type Options = { partial: boolean; mode?: "single" | "parallel" | "chain" };

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
			if (part.type === "text" && part.text.trim()) return part.text;
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
		if (text.trim()) return text;
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
	return {
		invalidate() {},
		setHintHovered(value) {
			hovered = value;
		},
		isCollapsedHintLine(line) {
			return headings.has(stripVTControlCharacters(line).trim());
		},
		render(width) {
			headings.clear();
			const lines: string[] = [];
			const hint = expansionHintText(expanded);
			const selected = expanded ? rows : rows.slice(-4);
			if (selected.length < rows.length)
				lines.push(`${rows.length - selected.length} earlier tasks (expand to view)`);
			for (const [selectedIndex, row] of selected.entries()) {
				const status = state(
					row,
					rows.length - selected.length + selectedIndex,
					rows.length,
					options,
				);
				if (selectedIndex) lines.push("");
				const heading = cardHeading(
					{ ...row, status },
					width,
					theme,
					selectedIndex === 0 ? hint : "",
					hovered,
				);
				lines.push(heading);
				if (selectedIndex === 0 && stripVTControlCharacters(heading).includes(hint))
					headings.add(stripVTControlCharacters(heading).trim());
				const error =
					status === "failed" || status === "cancelled"
						? row.errorMessage || row.stderr || finalText(row)
						: "";
				if (!expanded) {
					const active = status === "running" || status === "pending";
					const label = active
						? "Progress"
						: status === "cancelled"
							? "Cancelled"
							: status === "failed"
								? "Error"
								: "Result";
					lines.push(
						...previewRows(
							label,
							active ? latestText(row) : error || finalText(row),
							width,
							theme,
							active ? 1 : 3,
						),
					);
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
				lines.push(...detailRows(sections, width, theme));
			}
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
		})),
		theme,
		Boolean(context?.expanded),
		{ partial: true },
	);
}
