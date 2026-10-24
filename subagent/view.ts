import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
} from "@earendil-works/pi-tui";
import type { TaskSnapshot } from "./tasks.ts";
import { expansionHintText } from "../extensions/utils/expansion-hints.ts";

export interface TaskCardView extends Component {
	setHintHovered(value: boolean): void;
	isCollapsedHintLine(line: string): boolean;
}

/** Display-only sanitation; saved task data is never changed. */
export function displayText(value: string): string {
	return stripVTControlCharacters(value)
		.replace(/\r\n?/g, "\n")
		.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
		.replace(/\t/g, "    ");
}

export function statusIcon(status: string, theme: Theme): string {
	return status === "completed"
		? theme.fg("success", "✓")
		: status === "failed"
			? theme.fg("error", "✗")
			: status === "cancelled"
				? theme.fg("dim", "–")
				: theme.fg("accent", "○");
}

export function taskSummary(task: TaskSnapshot, theme: Theme, historical = false): string {
	const status = task.status === "blocked" ? "waiting for parent" : task.status;
	return `${statusIcon(task.status, theme)} ${theme.fg("toolTitle", displayText(task.agent))} ${theme.fg("dim", `${status}${historical ? " at snapshot" : ""} · ${(task.elapsed_ms / 1000).toFixed(1)}s`)}`;
}

export interface CardHeading {
	agent: string;
	task?: string;
	status: string;
	elapsed_ms?: number;
	historical?: boolean;
}

/** Reserve state before optional time/hint; narrow cards retain a useful task title. */
export function cardHeading(
	value: CardHeading,
	width: number,
	theme: Theme,
	hint = "",
	hovered = false,
): string {
	const name = displayText(value.agent).split("\n")[0];
	const task = displayText(value.task ?? "")
		.split("\n")
		.find((line) => line.trim())
		?.trim();
	const status = `${value.status === "blocked" ? "waiting for parent" : value.status}${value.historical ? " at snapshot" : ""}`;
	const prefix = `${statusIcon(value.status, theme)} ${theme.fg("toolTitle", name)}`;
	let timing =
		typeof value.elapsed_ms === "number" &&
		Number.isFinite(value.elapsed_ms) &&
		value.elapsed_ms >= 0
			? ` · ${(value.elapsed_ms / 1000).toFixed(1)}s`
			: "";
	let tail = hint ? theme.fg(hovered ? "text" : "dim", ` · ${hint}`) : "";
	const minimum = () =>
		visibleWidth(prefix) + visibleWidth(status + timing) + visibleWidth(tail) + (task ? 12 : 3);
	if (minimum() > width) timing = "";
	if (minimum() > width) tail = "";
	const suffix = theme.fg("dim", ` · ${status}${timing}`);
	const room = width - visibleWidth(prefix + suffix + tail) - 3;
	const description =
		task && room > 0 ? theme.fg("mdCode", ` · ${truncateToWidth(task, room, "…")}`) : "";
	return truncateToWidth(prefix + description + suffix + tail, Math.max(1, width), "…");
}

export function previewRows(
	label: string,
	value: string,
	width: number,
	theme: Theme,
	maxLines = 1,
): string[] {
	const all = displayText(value).split("\n");
	const rows = all.slice(0, maxLines);
	return rows.map((line, i) =>
		truncateToWidth(
			(i ? " ".repeat(label.length + 2) : theme.fg("muted", `${label}: `)) +
				theme.fg(
					label === "Error" ? "error" : "toolOutput",
					line + (i === rows.length - 1 && all.length > rows.length ? " …" : ""),
				),
			Math.max(1, width),
			"…",
		),
	);
}

export function detailRows(
	sections: Array<{
		label: string;
		text: string;
		color?: "toolOutput" | "mdCode" | "error" | "dim";
	}>,
	width: number,
	theme: Theme,
): string[] {
	const rows: string[] = [];
	const rail = (text: string) => theme.fg("dim", text);
	for (const [index, section] of sections.entries()) {
		const last = index === sections.length - 1;
		rows.push(
			truncateToWidth(
				rail(last ? "└ " : "├ ") + theme.fg("muted", theme.bold(section.label)),
				Math.max(1, width),
			),
		);
		const prefix = last ? "  " : rail("│ ");
		for (const line of displayText(section.text).split("\n")) {
			for (const wrapped of wrapTextWithAnsi(
				theme.fg(section.color ?? "toolOutput", line),
				Math.max(1, width - 2),
			))
				rows.push(truncateToWidth(prefix + wrapped, Math.max(1, width)));
		}
		if (!last) rows.push(truncateToWidth(rail("│"), Math.max(1, width)));
	}
	return rows;
}

/** Read current state on repaint; a dispatch result is only the initial snapshot. */
export function createTaskView(
	snapshots: TaskSnapshot[],
	theme: Theme,
	expanded: boolean,
	lookup: (id: string) => TaskSnapshot | undefined = () => undefined,
): TaskCardView {
	const lastSeen = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
	const headings = new Set<string>();
	let hovered = false;
	return {
		invalidate() {},
		setHintHovered(value: boolean) {
			hovered = value;
		},
		isCollapsedHintLine(line: string) {
			return headings.has(stripVTControlCharacters(line).trim());
		},
		render(width: number) {
			headings.clear();
			const hint = expansionHintText(expanded);
			const selected = expanded ? snapshots : snapshots.slice(-4);
			const lines: string[] = [];
			if (!expanded && snapshots.length > selected.length)
				lines.push(
					theme.fg("dim", `${snapshots.length - selected.length} earlier tasks (expand to view)`),
				);
			for (const [index, snapshot] of selected.entries()) {
				const current = lookup(snapshot.id);
				const task = current ?? lastSeen.get(snapshot.id)!;
				if (current) lastSeen.set(snapshot.id, current);
				if (index) lines.push("");
				const heading = cardHeading(
					{ ...task, historical: !current && ["running", "blocked"].includes(task.status) },
					width,
					theme,
					index === 0 ? hint : "",
					hovered,
				);
				lines.push(heading);
				if (index === 0 && stripVTControlCharacters(heading).includes(hint))
					headings.add(stripVTControlCharacters(heading).trim());
				const reports = task.events.filter((event) =>
					["progress", "blocked", "decision"].includes(event.kind),
				);
				const latest = reports.at(-1);
				if (expanded) {
					const sections: Parameters<typeof detailRows>[0] = [
						{ label: "Task", text: task.task, color: "mdCode" },
						{
							label: "Details",
							text: `ID: ${task.id}\nDirectory: ${task.cwd}\nLast activity: ${task.last_activity_at}`,
							color: "dim",
						},
					];
					if (reports.length)
						sections.push({
							label: "Reports",
							text: reports
								.map((event) => `${event.at.slice(11, 19)} ${event.kind}: ${event.message}`)
								.join("\n"),
						});
					else if (task.status === "running")
						sections.push({ label: "Progress", text: "Waiting for first report" });
					if (task.result) sections.push({ label: "Result", text: task.result });
					if (task.error)
						sections.push({
							label: task.status === "cancelled" ? "Cancelled" : "Error",
							text: task.error,
							color: task.status === "cancelled" ? "dim" : "error",
						});
					lines.push(...detailRows(sections, width, theme));
				} else {
					if (["running", "blocked"].includes(task.status))
						lines.push(
							...previewRows(
								task.status === "blocked" ? "Waiting for" : "Progress",
								latest?.message.split("\n")[0] ?? "Waiting for first report",
								width,
								theme,
							),
						);
					if (task.result && !task.error)
						lines.push(...previewRows("Result", task.result, width, theme, 3));
					if (task.error)
						lines.push(
							...previewRows(
								task.status === "cancelled" ? "Cancelled" : "Error",
								task.error,
								width,
								theme,
								3,
							),
						);
				}
			}
			return new Text(lines.join("\n"), 0, 0).render(width);
		},
	};
}
