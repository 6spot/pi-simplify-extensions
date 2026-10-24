import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { TaskSnapshot } from "./tasks.ts";

export function taskSummary(task: TaskSnapshot, theme: Theme, historical = false): string {
	const icon =
		task.status === "completed"
			? theme.fg("success", "✓")
			: task.status === "failed"
				? theme.fg("error", "✗")
				: task.status === "cancelled"
					? theme.fg("dim", "–")
					: theme.fg("accent", "○");
	const status = task.status === "blocked" ? "waiting for parent" : task.status;
	return `${icon} ${theme.fg("toolTitle", task.agent)} ${theme.fg("dim", `${status}${historical ? " at snapshot" : ""} · ${(task.elapsed_ms / 1000).toFixed(1)}s`)}`;
}

/** Read current session state on repaint; a dispatch result is only the initial snapshot. */
export function createTaskView(
	snapshots: TaskSnapshot[],
	theme: Theme,
	expanded: boolean,
	lookup: (id: string) => TaskSnapshot | undefined = () => undefined,
): Component {
	const lastSeen = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
	return {
		invalidate() {},
		render(width) {
			const selected = expanded ? snapshots : snapshots.slice(-4);
			const lines: string[] = [];
			if (!expanded && snapshots.length > selected.length)
				lines.push(
					theme.fg("dim", `${snapshots.length - selected.length} earlier tasks (expand to view)`),
				);
			for (const snapshot of selected) {
				const current = lookup(snapshot.id);
				const task = current ?? lastSeen.get(snapshot.id)!;
				if (current) lastSeen.set(snapshot.id, current);
				if (lines.length) lines.push("");
				lines.push(
					taskSummary(task, theme, !current && ["running", "blocked"].includes(task.status)),
				);
				const field = (label: string, value: string) => {
					const color = ["Task", "ID", "Directory"].includes(label) ? "mdCode" : "toolOutput";
					const text = theme.fg("muted", `${label}: `) + theme.fg(color, value);
					lines.push(
						expanded
							? text
							: text
									.split("\n")
									.map((line) => truncateToWidth(line, width))
									.join("\n"),
					);
				};
				field(
					"Task",
					expanded ? task.task : (task.task.split("\n").find((line) => line.trim()) ?? ""),
				);
				if (expanded) {
					field("ID", task.id);
					field("Directory", task.cwd);
					field("Last activity", task.last_activity_at);
				}
				const reports = task.events.filter((event) =>
					["progress", "blocked", "decision"].includes(event.kind),
				);
				const latest = reports.at(-1);
				if (expanded && reports.length) {
					lines.push(theme.fg("muted", "Reports:"));
					for (const event of reports)
						lines.push(
							theme.fg("dim", `  ${event.at.slice(11, 19)} ${event.kind}: `) +
								theme.fg("toolOutput", event.message),
						);
				} else if (latest) {
					field(
						task.status === "blocked" ? "Waiting for" : "Progress",
						latest.message.split("\n")[0],
					);
				} else if (task.status === "running") {
					field("Progress", "Waiting for first report");
				}
				if (task.result && (expanded || !task.error))
					field("Result", expanded ? task.result : task.result.split("\n").slice(0, 3).join("\n"));
				if (task.error)
					field("Error", expanded ? task.error : task.error.split("\n").slice(0, 3).join("\n"));
			}
			lines.push(theme.fg("dim", expanded ? "↑ Collapse" : "click to show more"));
			return new Text(lines.join("\n"), 0, 0).render(width);
		},
	};
}
