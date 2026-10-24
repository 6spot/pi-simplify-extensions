import { Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { sanitizeToolResultText } from "../../utils/tool-result-sanitize.ts";
import { showMoreHintText, TOOL_INPUT_COLOR } from "./names.ts";
import { textFromResult } from "./result.ts";

/** Preserve the returned output and native truncation/path notes, including on errors. */
export function bashOutputText(result: any): string {
	const text = Array.isArray(result?.content)
		? result.content
				.filter((part: any) => part?.type === "text" && typeof part.text === "string")
				.map((part: any) => part.text)
				.join("\n")
		: "";
	return sanitizeToolResultText(
		text ||
			(typeof result?.structuredContent?.output === "string"
				? result.structuredContent.output
				: textFromResult(result, true)),
	).trimEnd();
}

/** Only report an exit code/reason actually supplied by Pi; output prose is not status. */
export function bashStatusText(result: any, isPartial: boolean): string | undefined {
	if (!result || isPartial) return;
	const code = result.structuredContent?.exit_code;
	if (typeof code === "number" && Number.isSafeInteger(code)) return `exit ${code}`;
	if (!result.isError) return;
	const text = bashOutputText(result);
	const exit = /(?:^|\n)Command exited with code (-?\d+)\s*$/.exec(text);
	if (exit) return `exit ${exit[1]}`;
	if (/(?:^|\n)Command aborted\s*$/.test(text)) return "Cancelled";
	if (/(?:^|\n)Command timed out after [^\n]+\s*$/.test(text)) return "Timed out";
}

function commandView(args: any, theme: any): Text {
	const command =
		typeof args?.command === "string" && args.command
			? sanitizeToolResultText(args.command).replace(/\t/g, "   ")
			: "Receiving command…";
	return new Text(theme.fg(TOOL_INPUT_COLOR, `$ ${command}`), 0, 0);
}

function commandRows(view: Text, width: number): string[] {
	const rows = view.render(Math.max(1, width - 2));
	return rows
		.slice(0, 3)
		.map((line, index) =>
			truncateToWidth(`  ${line}${index === 2 && rows.length > 3 ? " …" : ""}`, width),
		);
}

export function createBashCallComponent(options: {
	args: any;
	context: any;
	theme: any;
	elapsed: () => string | undefined;
}): Component {
	const { theme, context } = options;
	const command = commandView(options.args, theme);
	return {
		invalidate() {},
		render(width) {
			const pending = !context.result || Boolean(context.isPartial);
			const error = Boolean(context.result?.isError || context.isError);
			const icon = theme.fg(
				error ? "error" : pending ? "accent" : "success",
				error ? "✗" : pending ? "○" : "✓",
			);
			const metadata = [bashStatusText(context.result, pending), options.elapsed()]
				.filter(Boolean)
				.join(" · ");
			const header = `${icon} ${theme.fg("toolTitle", "Bash")}${metadata ? theme.fg("dim", ` · ${metadata}`) : ""}`;
			const lines = [truncateToWidth(header, width)];
			if (!context.result) {
				const fullCommand = command.render(Math.max(1, width - 2));
				lines.push(
					...(context.expanded
						? fullCommand.map((line) => truncateToWidth(`  ${line}`, width))
						: commandRows(command, width)),
				);
				if (!context.expanded && fullCommand.length > 3)
					lines.push("", theme.fg("dim", showMoreHintText()));
			}
			return lines;
		},
	};
}

export function createBashResultComponent(options: {
	args: any;
	result: any;
	theme: any;
	isPartial: boolean;
	hint: string;
	isHovered: () => boolean;
}): Component {
	const { theme } = options;
	const command = commandView(options.args, theme);
	const text = bashOutputText(options.result);
	const outputLines = text.split("\n");
	const output = new Text(
		theme.fg(
			options.result?.isError ? "error" : text ? "text" : "dim",
			outputLines.slice(-4).join("\n") ||
				(options.isPartial ? "Waiting for output…" : "(no output)"),
		),
		0,
		0,
	);
	return {
		invalidate() {},
		render(width) {
			const bodyWidth = Math.max(1, width - 2);
			const lines = [
				...commandRows(command, width),
				"",
				...output
					.render(bodyWidth)
					.slice(-4)
					.map((line) => `  ${line}`),
			];
			if (!options.isPartial || outputLines.length > 4 || command.render(bodyWidth).length > 3)
				lines.push("", theme.fg(options.isHovered() ? "text" : "dim", options.hint));
			return lines.map((line) => truncateToWidth(line, width));
		},
	};
}
