import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { cardHeading, detailRows, displayText, previewRows } from "./view.ts";
import { expansionHintText } from "../extensions/utils/expansion-hints.ts";

export interface TaskNotice {
	id?: string;
	agent: string;
	kind: string;
	message: string;
	task?: string;
	status?: string;
	elapsed_ms?: number;
	result?: string;
	error?: string;
}

const terminal = (kind: string) => ["completed", "failed", "cancelled"].includes(kind);
const states = new WeakMap<
	object,
	{ expanded: boolean; nativeExpanded: boolean; hovered: boolean }
>();

/** A small view contract for Simplify's mouse layer; no tool ownership or prototype patch. */
export const NOTICE_VIEW = Symbol.for("simplify.subagent-notice-view");

export const renderTaskNotices: MessageRenderer = (message, options, theme) => {
	const raw = (message.details as { events?: unknown } | undefined)?.events;
	const events = Array.isArray(raw)
		? raw.filter(
				(event): event is TaskNotice =>
					event &&
					typeof event.agent === "string" &&
					typeof event.kind === "string" &&
					typeof event.message === "string",
			)
		: [];
	if (
		!events.length ||
		events.length !== (Array.isArray(raw) ? raw.length : 0) ||
		events.some(
			(event) =>
				!["progress", "blocked", "decision", "completed", "failed", "cancelled"].includes(
					event.kind,
				),
		)
	)
		return new Text(
			displayText(
				typeof message.content === "string" ? message.content : JSON.stringify(message.content),
			),
			0,
			0,
		);
	let state = states.get(message);
	if (!state) {
		state = { expanded: options.expanded, nativeExpanded: options.expanded, hovered: false };
		states.set(message, state);
	} else if (state.nativeExpanded !== options.expanded) {
		state.nativeExpanded = options.expanded;
		state.expanded = options.expanded;
	}
	const viewState = state;
	const headings = new Set<string>();
	const group = events.length > 1 && events.every((event) => terminal(event.kind));
	return {
		[NOTICE_VIEW]: true,
		get expanded() {
			return viewState.expanded;
		},
		setExpanded(value: boolean) {
			viewState.expanded = value;
		},
		setHintHovered(value: boolean) {
			viewState.hovered = value;
		},
		isCollapsedHintLine(line: string) {
			return headings.has(displayText(line).trim());
		},
		invalidate() {},
		render(width: number) {
			headings.clear();
			const rows: string[] = [];
			const hint = expansionHintText(viewState.expanded);
			if (group) {
				const counts = [
					["completed", "done"],
					["failed", "failed"],
					["cancelled", "cancelled"],
				].flatMap(([kind, label]) => {
					const count = events.filter((event) => event.kind === kind).length;
					return count ? [`${count} ${label}`] : [];
				});
				const failed = events.some((event) => event.kind === "failed");
				const cancelled = events.some((event) => event.kind === "cancelled");
				const title = theme.fg(
					failed ? "error" : cancelled ? "dim" : "toolTitle",
					`${failed ? "✗" : cancelled ? "–" : "●"} Subagents: ${counts.join(" · ")}`,
				);
				const tail = theme.fg(viewState.hovered ? "text" : "dim", ` · ${hint}`);
				const heading = truncateToWidth(
					title + (visibleWidth(title + tail) <= width ? tail : ""),
					Math.max(1, width),
					"…",
				);
				rows.push(heading);
				if (displayText(heading).includes(hint)) headings.add(displayText(heading).trim());
			}
			for (const [index, event] of events.entries()) {
				const prefix = group ? (index === events.length - 1 ? "└ " : "├ ") : "";
				const rail = group ? (index === events.length - 1 ? "  " : "│ ") : "";
				const status = terminal(event.kind)
					? event.kind
					: event.status === "blocked"
						? "blocked"
						: event.kind;
				const heading = cardHeading(
					{
						agent: event.agent,
						task: typeof event.task === "string" ? event.task : undefined,
						status,
						elapsed_ms: event.elapsed_ms,
					},
					Math.max(1, width - prefix.length),
					theme,
					!group && index === 0 ? hint : "",
					viewState.hovered,
				);
				if (!group && index) rows.push("");
				rows.push(truncateToWidth(theme.fg("dim", prefix) + heading, Math.max(1, width), "…"));
				if (!group && index === 0 && displayText(heading).includes(hint))
					headings.add(displayText(heading).trim());
				const result = typeof event.result === "string" ? event.result : event.message;
				const error = typeof event.error === "string" ? event.error : event.message;
				const label =
					(
						{
							completed: "Result",
							failed: "Error",
							decision: "Decision",
							blocked: "Waiting for",
							cancelled: "Cancelled",
						} as Record<string, string>
					)[event.kind] ?? "Progress";
				const text =
					event.kind === "failed" ? error : event.kind === "completed" ? result : event.message;
				let body: string[];
				if (viewState.expanded) {
					const sections: Parameters<typeof detailRows>[0] = [];
					if (typeof event.task === "string")
						sections.push({ label: "Task", text: event.task, color: "mdCode" });
					if (typeof event.id === "string")
						sections.push({ label: "ID", text: event.id, color: "dim" });
					sections.push({ label, text, color: event.kind === "failed" ? "error" : "toolOutput" });
					if (
						["failed", "cancelled"].includes(event.kind) &&
						typeof event.result === "string" &&
						event.result
					)
						sections.push({ label: "Partial result", text: result });
					body = detailRows(sections, Math.max(1, width - rail.length), theme);
				} else {
					body = previewRows(
						label,
						text,
						Math.max(1, width - rail.length),
						theme,
						!group && terminal(event.kind) ? 3 : 1,
					);
				}
				rows.push(
					...body.map((row) => truncateToWidth(theme.fg("dim", rail) + row, Math.max(1, width))),
				);
			}
			return rows;
		},
	};
};
