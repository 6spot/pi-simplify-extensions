import { Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { sanitizeToolResultText } from "../../utils/tool-result-sanitize.ts";
import {
	collapseHintText,
	humanizeToolLabel,
	renderToolHeaderToWidth,
	showMoreHintText,
	TOOL_INPUT_COLOR,
} from "./names.ts";
import { boundedTextPreview } from "./preview.ts";
import { textFromResult } from "./result.ts";
import { toolWasCancelled } from "./tool-state.ts";

/** Preserve the returned output and native truncation/path notes, including on errors. */
export function bashOutputText(result: any): string {
	const text = Array.isArray(result?.content)
		? result.content
				.filter((part: any) => part?.type === "text" && typeof part.text === "string")
				.map((part: any) => part.text)
				.join("\n")
		: "";
	const structured = result?.structuredContent;
	const fallback =
		structured && (structured.exit_code !== undefined || structured.wall_time_seconds !== undefined)
			? typeof structured.error === "string"
				? structured.error
				: result?.details === undefined
					? ""
					: textFromResult({ ...result, structuredContent: undefined }, true)
			: textFromResult(result, true);
	return sanitizeToolResultText(
		text || (typeof structured?.output === "string" ? structured.output : fallback),
	);
}

/** Only report an exit code/reason actually supplied by Pi; output prose is not status. */
export function bashStatusText(result: any, isPartial: boolean): string | undefined {
	if (!result || isPartial) return;
	if (toolWasCancelled("bash", result)) return "Cancelled";
	const code = result.structuredContent?.exit_code;
	if (typeof code === "number" && Number.isSafeInteger(code)) return `exit ${code}`;
	if (!result.isError) return;
	const text = bashOutputText(result);
	const exit = /(?:^|\n)Command exited with code (-?\d+)\s*$/.exec(text);
	if (exit) return `exit ${exit[1]}`;
	if (/(?:^|\n)Command timed out after [^\n]+\s*$/.test(text)) return "Timed out";
}

function commandText(args: any): string {
	return typeof args?.command === "string" && args.command
		? `$ ${sanitizeToolResultText(args.command)}`
		: "Receiving command…";
}

function commandRows(command: string, theme: any, width: number): string[] {
	const preview = boundedTextPreview(command, {
		width: Math.max(1, width - 2),
		maxRows: 2,
		paint: (text) => theme.fg(TOOL_INPUT_COLOR, text),
	});
	return [
		...preview.rows.map((line) => truncateToWidth(`  ${line}`, width)),
		...(preview.omitted ? noticeRows("… More command hidden", theme, width) : []),
	];
}

function noticeRows(notice: string, theme: any, width: number): string[] {
	return new Text(theme.fg("dim", notice), 0, 0)
		.render(Math.max(1, width - 2))
		.map((line) => truncateToWidth(`  ${line}`, width));
}

export function createBashCallComponent(options: {
	toolName?: string;
	args: any;
	context: any;
	theme: any;
	elapsed: () => string | undefined;
	isHovered: () => boolean;
	showInput?: boolean;
}): Component {
	const { theme, context } = options;
	const command = commandText(options.args);
	return {
		invalidate() {},
		render(width) {
			const pending = !context.result || Boolean(context.isPartial);
			const code = context.result?.structuredContent?.exit_code;
			const error = Boolean(
				context.result?.isError ||
					context.isError ||
					(!pending && Number.isSafeInteger(code) && code !== 0),
			);
			const status = bashStatusText(context.result, pending);
			const cancelled = status === "Cancelled";
			const icon = theme.fg(
				cancelled ? "dim" : error ? "error" : pending ? "accent" : "success",
				cancelled ? "–" : error ? "✗" : pending ? "○" : "✓",
			);
			const metadata = [status, options.elapsed()].filter(Boolean).join(" · ");
			const header = `${icon} ${theme.fg("toolTitle", humanizeToolLabel(options.toolName ?? "bash"))}${metadata ? theme.fg("dim", ` · ${metadata}`) : ""}`;
			const commandPreview = boundedTextPreview(command, {
				width: Math.max(1, width - 2),
				maxRows: 2,
			});
			const expandable =
				!context.isGrouped?.() &&
				(Boolean(context.result) || context.expanded || commandPreview.omitted);
			const hint = expandable
				? theme.fg(
						options.isHovered() ? "text" : "dim",
						` · ${context.expanded ? collapseHintText() : showMoreHintText()}`,
					)
				: "";
			const lines = [renderToolHeaderToWidth(header, hint, width)];
			if (!context.result && options.showInput !== false) {
				lines.push(
					...(context.expanded
						? new Text(theme.fg(TOOL_INPUT_COLOR, command), 0, 0)
								.render(Math.max(1, width - 2))
								.map((line) => truncateToWidth(`  ${line}`, width))
						: commandRows(command, theme, width)),
				);
			}
			return lines;
		},
	};
}

export function createBashResultComponent(options: {
	toolName?: string;
	args: any;
	result: any;
	theme: any;
	isPartial: boolean;
}): Component {
	const { theme } = options;
	const command = commandText(options.args);
	const text = bashOutputText(options.result);
	const cancelled = bashStatusText(options.result, options.isPartial) === "Cancelled";
	// Native truncation and full-output paths are source limits, not preview loss.
	// Keep them outside the four-row sample, including on failed commands.
	const nativeNotices: string[] = [];
	const body = text.replace(
		/(?:^|\n\n)(\[Showing (?:lines \d+-\d+ of \d+[^\n]*|last [^\n]+)\. Full output: [^\n]+\])(?=\n\nCommand |$)/g,
		(_match, notice: string) => {
			nativeNotices.push(notice);
			return "";
		},
	);
	const outputText = body || (options.isPartial ? "Waiting for output…" : "No output");
	return {
		invalidate() {},
		render(width) {
			const bodyWidth = Math.max(1, width - 2);
			const output = boundedTextPreview(outputText, {
				width: bodyWidth,
				maxRows: 4,
				direction: "tail",
				paint: (value) =>
					theme.fg(
						cancelled ? "dim" : options.result?.isError ? "error" : text ? "text" : "dim",
						value,
					),
			});
			const disclosure =
				output.hiddenLines !== undefined && !text.startsWith("[large tool result replaced")
					? `… ${output.hiddenLines} earlier ${output.hiddenLines === 1 ? "line" : "lines"} hidden`
					: "… Earlier output hidden";
			return [
				...commandRows(command, theme, width),
				...output.rows.map((line) => `  ${line}`),
				...(output.omitted ? noticeRows(disclosure, theme, width) : []),
				...nativeNotices.flatMap((notice) => noticeRows(notice, theme, width)),
			].map((line) => truncateToWidth(line, width));
		},
	};
}
