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
import { argumentPreview } from "../extensions/utils/argument-preview.ts";
import { resultTextView } from "../extensions/renderer/tool/result.ts";
import { boundedTextPreview } from "../extensions/renderer/tool/preview.ts";
import { expansionHintText } from "../extensions/utils/expansion-hints.ts";

export type TaskCardSnapshot = Pick<TaskSnapshot, "id" | "agent" | "task" | "status"> &
	Partial<Omit<TaskSnapshot, "id" | "agent" | "task" | "status" | "events">> & {
		events: Array<{ kind: string; message: string; at?: string }>;
	};

export function isTaskCardSnapshot(value: unknown): value is TaskCardSnapshot {
	if (!value || typeof value !== "object") return false;
	const task = value as TaskCardSnapshot;
	return (
		[task.id, task.agent, task.task].every((item) => typeof item === "string") &&
		(task.cwd === undefined || typeof task.cwd === "string") &&
		(task.last_activity_at === undefined || typeof task.last_activity_at === "string") &&
		(task.result === undefined || typeof task.result === "string") &&
		(task.error === undefined || typeof task.error === "string") &&
		["running", "blocked", "completed", "failed", "cancelled"].includes(task.status) &&
		Array.isArray(task.events) &&
		task.events.every(
			(event) =>
				event &&
				typeof event.kind === "string" &&
				typeof event.message === "string" &&
				(event.at === undefined || typeof event.at === "string"),
		)
	);
}

export interface TaskCardView extends Component {
	setHintHovered(value: boolean): void;
	isCollapsedHintLine(line: string): boolean;
	simplifyVisualState(): "pending" | "success" | "error" | "cancelled" | "unknown";
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

export function shortGoal(value: string): string {
	let protocol = false;
	for (const raw of displayText(value.slice(0, 4096)).split("\n")) {
		const line = raw.trim();
		if (/^Active task:/i.test(line)) {
			protocol = true;
			continue;
		}
		if (!line || /^#{1,6}(?:\s|$)/.test(line) || /^```|^~~~/.test(line)) continue;
		if (/^(?:path|cwd|directory|context|session|task id):/i.test(line)) continue;
		if (protocol && (/^(?:[/~]|[A-Za-z]:[\\/])/.test(line) || /^<[^>]+>$/.test(line))) continue;
		return line;
	}
	return "";
}

export function elapsedText(milliseconds: number | undefined): string {
	if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds) || milliseconds < 0)
		return "";
	if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
	const seconds = Math.floor(milliseconds / 1000);
	return seconds < 3600
		? `${Math.floor(seconds / 60)}m${seconds % 60}s`
		: `${Math.floor(seconds / 3600)}h${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}

export function taskSummary(task: TaskSnapshot, theme: Theme, historical = false): string {
	const status = task.status === "blocked" ? "waiting for parent" : task.status;
	return `${statusIcon(task.status, theme)} ${theme.fg("toolTitle", displayText(task.agent))} ${theme.fg("dim", `${status}${historical ? " at snapshot" : ""} · ${elapsedText(task.elapsed_ms)}`)}`;
}

export interface CardHeading {
	agent: string;
	task?: string;
	status: string;
	elapsed_ms?: number;
	historical?: boolean;
	identity?: "Subagent" | "Subagent Task" | "Background task" | "";
}

export function cardVisualState(
	statuses: string[],
): "pending" | "success" | "error" | "cancelled" | "unknown" {
	if (statuses.some((status) => ["running", "blocked", "pending"].includes(status)))
		return "pending";
	if (statuses.includes("failed")) return "error";
	if (statuses.includes("cancelled")) return "cancelled";
	return statuses.length && statuses.every((status) => status === "completed")
		? "success"
		: "unknown";
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
	const task = shortGoal(value.task ?? "");
	const status =
		`${value.status === "blocked" ? "waiting for parent" : value.status === "completed" ? "" : value.status}${value.historical ? " at snapshot" : ""}`.trim();
	const identity = value.identity === "" ? "" : `${value.identity ?? "Subagent"} · `;
	const prefix = `${statusIcon(value.status, theme)} ${theme.fg("toolTitle", identity + name)}`;
	let timing = elapsedText(value.elapsed_ms);
	let tail = hint ? theme.fg(hovered ? "text" : "dim", ` · ${hint}`) : "";
	const suffix = () =>
		theme.fg(
			"dim",
			[status, timing]
				.filter(Boolean)
				.map((text) => ` · ${text}`)
				.join(""),
		);
	// Keep the complete hint ahead of optional metadata and the short goal.
	if (visibleWidth(prefix + suffix() + tail) + (task ? 5 : 0) > width) timing = "";
	if (visibleWidth(prefix + tail) > width) {
		const minimum = `${statusIcon(value.status, theme)} ${value.identity ?? "Subagent"}`;
		if (hint && visibleWidth(minimum + tail) <= width) {
			const room = width - visibleWidth(tail);
			return truncateToWidth(prefix, room, "…") + tail;
		}
		tail = "";
	}
	const room = width - visibleWidth(prefix + suffix() + tail) - 3;
	const description =
		task && room > 0 ? theme.fg("mdCode", ` · ${truncateToWidth(task, room, "…")}`) : "";
	const body = truncateToWidth(
		prefix + description + suffix(),
		Math.max(1, width - visibleWidth(tail)),
		"…",
	);
	return body + tail;
}

export function previewText(value: string): string {
	return displayText(value)
		.split("\n")
		.filter((line) => line.trim() && !/^\s*(?:#{1,6}(?:\s|$)|`{3,}|~{3,})/.test(line))
		.join("\n");
}

export function previewRows(
	label: string,
	value: string,
	width: number,
	theme: Theme,
	maxLines = 1,
): string[] {
	let end = Math.min(value.length, Math.max(4096, width * maxLines * 16));
	if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1] ?? "")) end--;
	const excerpt = value.slice(0, end);
	const text = previewText(excerpt) || displayText(excerpt).trim() || "No output";
	const prefix = `  ${label}: `;
	const room = Math.max(1, width - visibleWidth(prefix));
	const preview = boundedTextPreview(text, { width: room, maxRows: maxLines });
	const rows = preview.rows.map((line, index) =>
		truncateToWidth(
			(index ? " ".repeat(visibleWidth(prefix)) : theme.fg("muted", prefix)) +
				theme.fg(label === "Error" ? "error" : "toolOutput", line),
			Math.max(1, width),
			"…",
		),
	);
	if (preview.omitted || end < value.length)
		rows.push(
			truncateToWidth(
				theme.fg(
					"dim",
					`  … More ${label === "Error" ? "error" : label === "Result" ? "result" : "task"} details hidden`,
				),
				Math.max(1, width),
				"…",
			),
		);
	return rows;
}

/** Aggregate actual lifecycle states; a successful sibling never hides a failure. */
export function groupHeading(
	identity: string,
	statuses: string[],
	width: number,
	theme: Theme,
	hint: string,
	hovered = false,
): string {
	const counts = [...new Set(statuses)].map(
		(status) =>
			`${statuses.filter((item) => item === status).length} ${status === "completed" ? "done" : status === "blocked" ? "waiting" : status}`,
	);
	const status = statuses.some((item) => ["running", "blocked", "pending"].includes(item))
		? "running"
		: statuses.includes("failed")
			? "failed"
			: statuses.includes("cancelled")
				? "cancelled"
				: statuses.every((item) => item === "completed")
					? "completed"
					: "unknown";
	const icon = status === "completed" ? theme.fg("success", "●") : statusIcon(status, theme);
	const title = `${icon} ${theme.fg("toolTitle", identity)} · ${theme.fg("dim", counts.join(" · "))}`;
	const tail = theme.fg(hovered ? "text" : "dim", ` · ${hint}`);
	return visibleWidth(`${icon} ${identity}${tail}`) <= width
		? truncateToWidth(title, Math.max(1, width - visibleWidth(tail)), "…") + tail
		: truncateToWidth(title, Math.max(1, width), "…");
}

export function compactTaskRow(
	value: CardHeading,
	label: string,
	text: string,
	width: number,
	theme: Theme,
): { line: string; preview: string; omitted: boolean } {
	const line = cardHeading({ ...value, identity: "" }, width, theme);
	const preview = previewRows(label, text, width, theme, 1);
	return { line, preview: preview[0] ?? "", omitted: preview.length > 1 };
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
	snapshots: TaskCardSnapshot[],
	theme: Theme,
	expanded: boolean,
	lookup: (id: string) => TaskCardSnapshot | undefined = () => undefined,
	options: { identity?: "Subagent" | "Subagent Task"; action?: string } = {},
): TaskCardView {
	const lastSeen = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
	const headings = new Set<string>();
	let hovered = false;
	let visualState = cardVisualState(snapshots.map((task) => task.status));
	return {
		simplifyVisualState: () => visualState,
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
			const group = snapshots.length > 1;
			const resolved = new Map(
				snapshots.map((snapshot) => {
					const current = lookup(snapshot.id);
					if (current) lastSeen.set(snapshot.id, current);
					const task = current ?? lastSeen.get(snapshot.id)!;
					return [
						snapshot.id,
						{ task, historical: !current && ["running", "blocked"].includes(task.status) },
					];
				}),
			);
			visualState =
				options.action === "send" || options.action === "cancel"
					? "success"
					: cardVisualState([...resolved.values()].map(({ task }) => task.status));
			if (group) {
				const heading = groupHeading(
					options.identity ?? "Subagent",
					[...resolved.values()].map(({ task }) => task.status),
					width,
					theme,
					hint,
					hovered,
				);
				lines.push(heading);
				if (displayText(heading).includes(hint)) headings.add(displayText(heading).trim());
			}
			if (!expanded && snapshots.length > selected.length)
				lines.push(
					theme.fg("dim", `${snapshots.length - selected.length} earlier tasks (expand to view)`),
				);
			let omitted = false;
			for (const [index, snapshot] of selected.entries()) {
				const { task, historical } = resolved.get(snapshot.id)!;
				const value = { ...task, historical, identity: group ? ("" as const) : options.identity };
				if (index && expanded) lines.push("");
				const control = options.action === "send" || options.action === "cancel";
				const heading = cardHeading(
					control
						? {
								...value,
								agent: `${options.action} · ${value.agent}`,
								status: "completed",
								elapsed_ms: undefined,
							}
						: value,
					width,
					theme,
					!group && index === 0 ? hint : "",
					hovered,
				);
				if (!group || expanded) lines.push(heading);
				if (!group && index === 0 && stripVTControlCharacters(heading).includes(hint))
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
							text: [
								`ID: ${task.id}`,
								`Status: ${task.status}`,
								typeof task.cwd === "string" ? `Directory: ${task.cwd}` : "",
								typeof task.last_activity_at === "string"
									? `Last activity: ${task.last_activity_at}`
									: "",
							]
								.filter(Boolean)
								.join("\n"),
							color: "dim",
						},
					];
					if (reports.length)
						sections.push({
							label: "Reports",
							text: reports
								.map(
									(event) =>
										`${typeof event.at === "string" ? event.at.slice(11, 19) + " " : ""}${event.kind}: ${event.message}`,
								)
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
					const active = ["running", "blocked"].includes(task.status);
					const label = active
						? task.status === "blocked"
							? "Waiting for"
							: "Progress"
						: task.status === "cancelled"
							? "Cancelled"
							: task.status === "failed"
								? "Error"
								: "Result";
					const body = active
						? (latest?.message ?? "Waiting for first report")
						: task.error || task.result || "(no output)";
					const partialResult = Boolean(
						!active && task.error && task.result && task.error !== task.result,
					);
					if (group) {
						const row = compactTaskRow(value, label, body, width - 2, theme);
						lines.push(theme.fg("dim", index === selected.length - 1 ? "└ " : "├ ") + row.line);
						lines.push(theme.fg("dim", index === selected.length - 1 ? "  " : "│ ") + row.preview);
						omitted ||= row.omitted || partialResult;
					} else if (options.action === "send" || options.action === "cancel") {
						lines.push(
							...previewRows(
								"Acknowledged",
								options.action === "send"
									? `Instruction accepted · task ${task.status}`
									: `Cancellation requested · task ${task.status}`,
								width,
								theme,
							),
						);
					} else {
						lines.push(...previewRows(label, body, width, theme, active ? 1 : 3));
						if (partialResult)
							lines.push(
								truncateToWidth(
									theme.fg("dim", "… Partial result hidden"),
									Math.max(1, width),
									"…",
								),
							);
					}
				}
			}
			if (omitted)
				lines.push(
					truncateToWidth(theme.fg("dim", "… More task details hidden"), Math.max(1, width), "…"),
				);
			return new Text(lines.join("\n"), 0, 0).render(width);
		},
	};
}

/** Unknown/historical task payloads keep a bounded card without inventing task lifecycle. */
export function createTaskFallbackView(
	args: any,
	result: any,
	theme: Theme,
	expanded: boolean,
	options: {
		identity?: "Subagent" | "Subagent Task";
		isPartial?: boolean;
		isError?: boolean;
		cancelled?: boolean;
		receiving?: boolean;
	} = {},
): TaskCardView {
	const identity = options.identity ?? "Subagent";
	const status = options.isPartial
		? options.receiving
			? "pending"
			: "running"
		: options.cancelled
			? "cancelled"
			: options.isError
				? "failed"
				: identity === "Subagent Task"
					? "completed"
					: "unknown";
	const output = resultTextView(result, expanded);
	const input = argumentPreview(args);
	const field = (key: string): string | undefined => {
		try {
			const descriptor =
				args && typeof args === "object" ? Object.getOwnPropertyDescriptor(args, key) : undefined;
			return descriptor && "value" in descriptor && typeof descriptor.value === "string"
				? descriptor.value
				: undefined;
		} catch {
			return undefined;
		}
	};
	const task = field("task");
	const agent = field("agent") ?? field("action") ?? "task";
	const inputInTitle = identity === "Subagent" && task !== undefined;
	const headings = new Set<string>();
	let hovered = false;
	return {
		simplifyVisualState: () => cardVisualState([status]),
		invalidate() {},
		setHintHovered(value) {
			hovered = value;
		},
		isCollapsedHintLine(line) {
			return headings.has(displayText(line).trim());
		},
		render(width) {
			headings.clear();
			const subject = boundedTextPreview(input === "{}" ? "" : input, {
				width: Math.max(1, width - 2),
				maxRows: 2,
			});
			const preview = boundedTextPreview(
				output.text ||
					(options.receiving
						? "Receiving arguments…"
						: options.isPartial
							? "Receiving result…"
							: "No output"),
				{ width: Math.max(1, width - 2), maxRows: 4 },
			);
			const hint =
				expanded || (input && input !== "{}") || preview.omitted ? expansionHintText(expanded) : "";
			const heading = cardHeading({ identity, agent, task, status }, width, theme, hint, hovered);
			if (hint) headings.add(displayText(heading).trim());
			if (expanded)
				return [
					heading,
					...detailRows(
						[
							{
								label: "Input",
								text:
									input + (input.endsWith("…") ? "\n[Display limit reached · input excerpt]" : ""),
								color: "mdCode",
							},
							{
								label: options.cancelled ? "Cancelled" : options.isError ? "Error" : "Output",
								text: output.text || "No output",
								color: options.isError && !options.cancelled ? "error" : "toolOutput",
							},
						],
						width,
						theme,
					),
				];
			return [
				heading,
				...(inputInTitle ? [] : subject.rows.map((row) => theme.fg("mdCode", `  ${row}`))),
				...(!inputInTitle && (subject.omitted || input.endsWith("…"))
					? [theme.fg("dim", "  … More input hidden")]
					: []),
				...preview.rows.map((row) =>
					theme.fg(options.isError && !options.cancelled ? "error" : "toolOutput", `  ${row}`),
				),
				...(preview.omitted ? [theme.fg("dim", "  … More output hidden")] : []),
				...(output.displayLimited
					? [theme.fg("dim", "  [Display limit reached · output excerpt]")]
					: []),
			].map((row) => truncateToWidth(row, Math.max(1, width), "…"));
		},
	};
}
