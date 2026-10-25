import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { sanitizeToolResultText } from "../../utils/tool-result-sanitize.ts";
import {
	collapseHintText,
	displayPath,
	renderToolHeaderToWidth,
	showMoreHintText,
	TOOL_INPUT_COLOR,
	type ToolCallSummary,
} from "./names.ts";
import { toolWasCancelled } from "./tool-state.ts";
import { boundedTextPreview } from "./preview.ts";
import { textFromResult } from "./result.ts";

export const FILE_PANEL_TOOL_NAMES = new Set(["grep", "find", "read"]);
const titles: Record<string, string> = { grep: "Grep", find: "Find", read: "Read" };

export type FileToolView = {
	text: string;
	body: string;
	summary?: string;
	notices: string[];
};

/** Read text blocks without the generic summary's size cap; keep raw results untouched. */
export function fileToolText(result: any, expanded = false): string {
	const text = sanitizeToolResultText(
		Array.isArray(result?.content)
			? result.content
					.filter((part: any) => part?.type === "text" && typeof part.text === "string")
					.map((part: any) => part.text)
					.join("\n")
			: "",
	);
	if (text && !expanded) return text;
	const details = textFromResult({ ...result, content: [] }, true);
	if (!text) return details;
	return expanded && details && details !== text ? `${text}\nDetails:\n${details}` : text;
}

function positiveInteger(value: any): value is number {
	return Number.isSafeInteger(value) && value > 0;
}

export function fileToolView(name: string, args: any, result: any): FileToolView {
	const text = fileToolText(result);
	const view: FileToolView = { text, body: text, notices: [] };
	if (!result || result.isError) return view;
	if (
		name !== "read" &&
		(!Array.isArray(result.content) ||
			result.content.some((part: any) => part?.type !== "text") ||
			!result.content.some((part: any) => typeof part?.text === "string" && part.text.length))
	)
		return view;
	// SoL-Pi may keep an observation placeholder in history. Its excerpts are not all results.
	if (/^\[large tool result replaced after its first \d+ provider requests\]\nid: obs_/.test(text))
		return { ...view, summary: "Stored result" };
	if (name === "read") return readView(args, result, view);
	const footer =
		/\n\n\[((?:\d+ (?:matches|results) limit reached\.|[\d.]+\s*[KMGT]?B limit reached|Some lines truncated to \d+ chars\.)[^\n]*)\]$/i.exec(
			text,
		);
	if (footer) {
		view.body = text.slice(0, footer.index);
		view.notices.push(footer[1]!);
	}
	const details = result.details;
	const limited = Boolean(
		details?.matchLimitReached ||
			details?.resultLimitReached ||
			/\d+ (?:matches|results) limit reached\./.test(footer?.[1] ?? ""),
	);
	const truncated = Boolean(
		details?.truncation?.truncated || /[\d.]+\s*[KMGT]?B limit reached/i.test(footer?.[1] ?? ""),
	);
	const shortLines = Boolean(
		details?.linesTruncated || footer?.[1]?.includes("Some lines truncated"),
	);
	const suffix = `${limited ? " · limit reached" : ""}${truncated ? " · truncated" : shortLines ? " · lines truncated" : ""}`;
	if (!view.notices.length && suffix) view.notices.push(suffix.slice(3));
	if (name === "grep") {
		if (view.body === "No matches found") view.summary = "No matches";
		else {
			const rows = view.body.split("\n").filter(Boolean);
			// Native grep marks matches with colons and context with hyphens. Count matches only.
			const parsed = rows.map((line) => /^(.+?)(?::([1-9]\d*): |-([1-9]\d*)- )/.exec(line));
			if (rows.length && parsed.every(Boolean)) {
				const count = parsed.filter((row) => row?.[2] !== undefined).length;
				view.summary = `${count} ${count === 1 ? "match" : "matches"}${limited || truncated ? " shown" : ""}${suffix}`;
			}
		}
	} else if (name === "find") {
		if (view.body === "No files found matching pattern") view.summary = "No paths found";
		else if (view.body) {
			const count = view.body.split("\n").filter(Boolean).length;
			// find can return directories too, so never call this a file count.
			view.summary = `${count} ${count === 1 ? "path" : "paths"}${limited || truncated ? " shown" : ""}${suffix}`;
		}
	}
	return view;
}

function readView(args: any, result: any, view: FileToolView): FileToolView {
	const parts = Array.isArray(result.content) ? result.content : [];
	const images = parts.filter((part: any) => part?.type === "image");
	if (images.length || /^Read image file \[[^\n]+\]/.test(view.text))
		return {
			...view,
			summary:
				!images.length && /\[Image omitted:/.test(view.text)
					? "Image omitted"
					: images.length > 1
						? `${images.length} images`
						: "Image",
		};
	if (
		!parts.some((part: any) => part?.type === "text" && typeof part.text === "string") ||
		(view.text && !parts.some((part: any) => part?.type === "text" && part.text))
	)
		return view;
	// Pi's overlong-first-line warning is a successful result, but contains no file lines.
	if (/^\[Line \d+ is [^\n]+ exceeds [^\n]+\. Use bash:/.test(view.text))
		return { ...view, summary: "Line exceeds read limit" };
	const offset = args?.offset === undefined ? 1 : args.offset;
	if (!positiveInteger(offset)) return view;
	const range =
		/\n\n\[Showing lines (\d+)-(\d+) of (\d+)(?: \([^\n]+\))?\. Use offset=(\d+) to continue\.\]$/.exec(
			view.text,
		);
	const more = /\n\n\[(\d+) more lines in file\. Use offset=(\d+) to continue\.\]$/.exec(view.text);
	const footer = range ?? more;
	if (!footer && /\n\n\[(?:Showing lines |[^\n]+ more lines in file\.)/.test(view.text))
		return view;
	if (footer) {
		const body = view.text.slice(0, footer.index);
		const count = body ? body.split("\n").length : 0;
		const nextOffset = Number(range ? range[4] : more?.[2]);
		// Never infer an accepted range from a malformed/foreign notice.
		if (
			nextOffset !== offset + count ||
			(range &&
				(Number(range[1]) !== offset ||
					Number(range[2]) !== nextOffset - 1 ||
					Number(range[3]) < nextOffset)) ||
			(more &&
				(!positiveInteger(args?.limit) ||
					count !== args.limit ||
					!positiveInteger(Number(more[1]))))
		)
			return view;
		view.body = body;
		view.notices.push(`More available · offset=${nextOffset}`);
		if (result.details?.truncation?.truncated || range) view.notices.push("Read limit reached");
	}
	if (result.details?.truncation?.truncated && !view.notices.includes("Read limit reached"))
		view.notices.push("Read limit reached");
	const count = view.body ? view.body.split("\n").length : 0;
	view.summary =
		count === 1 ? `line ${offset}` : count ? `lines ${offset}–${offset + count - 1}` : "0 lines";
	return view;
}

function safeInput(value: any): string {
	return typeof value === "string" ? sanitizeToolResultText(value).replace(/\s+/g, " ").trim() : "";
}

export function fileToolSummary(
	name: string,
	args: any,
	result?: any,
	settled = false,
	cwd?: string,
): ToolCallSummary {
	const path =
		typeof args?.path === "string" && args.path
			? displayPath(safeInput(args.path), cwd)
			: name === "read"
				? "Receiving path…"
				: ".";
	const payload =
		name === "read"
			? path
			: `${typeof args?.pattern === "string" ? JSON.stringify(sanitizeToolResultText(args.pattern)) : "Receiving pattern…"} in ${path}${args?.glob ? ` · glob=${safeInput(args.glob)}` : ""}`;
	const detail =
		settled && result && !result.isError
			? fileToolView(name, args, result).summary
			: name === "read"
				? [
						args?.offset !== undefined ? `offset=${safeInput(String(args.offset))}` : "",
						args?.limit !== undefined ? `limit=${safeInput(String(args.limit))}` : "",
					]
						.filter(Boolean)
						.join(" · ") || undefined
				: undefined;
	const main = titles[name] ?? name;
	return {
		main,
		payload,
		detail: detail ? ` · ${detail}` : "",
		...(name === "read" ? { path: { prefix: main, value: path } } : {}),
	};
}

export function createFileToolCallComponent(
	name: string,
	args: any,
	context: any,
	theme: any,
	hovered: () => boolean,
	showInput = true,
): Component {
	const pending = !context?.result || Boolean(context.isPartial);
	const error = Boolean(context?.result?.isError || context?.isError);
	const cancelled = toolWasCancelled(name, context?.result, error);
	const summary = fileToolSummary(name, args, context?.result, !pending, context?.cwd);
	const input = new Text(
		theme.fg(TOOL_INPUT_COLOR, `${summary.payload}${pending ? summary.detail : ""}`),
		0,
		0,
	);
	return {
		invalidate() {},
		render(width) {
			const icon = theme.fg(
				cancelled ? "dim" : error ? "error" : pending ? "accent" : "success",
				cancelled ? "–" : error ? "✗" : pending ? "○" : "✓",
			);
			const bodyWidth = Math.max(1, width - 2);
			const inputPreview = boundedTextPreview(
				`${summary.payload}${pending ? summary.detail : ""}`,
				{ width: bodyWidth, maxRows: 2, paint: (text) => theme.fg(TOOL_INPUT_COLOR, text) },
			);
			const inputLines = !context?.result && context?.expanded ? input.render(bodyWidth) : [];
			const expandable =
				!context?.isGrouped?.() &&
				(Boolean(context?.result) || context?.expanded || inputPreview.omitted);
			const hint = expandable
				? theme.fg(
						hovered() ? "text" : "dim",
						` · ${context?.expanded ? collapseHintText() : showMoreHintText()}`,
					)
				: "";
			const header = `${icon} ${theme.fg("toolTitle", summary.main)}${cancelled ? theme.fg("dim", " · cancelled") : !pending && summary.detail ? theme.fg("dim", summary.detail) : ""}`;
			const lines = [renderToolHeaderToWidth(header, hint, width)];
			if (!context?.result && showInput) {
				lines.push(
					...(context?.expanded ? inputLines : inputPreview.rows).map((line) =>
						truncateToWidth(`  ${line}`, width),
					),
					...(!context?.expanded && inputPreview.omitted
						? noticeRows("… More input hidden", theme, width)
						: []),
					truncateToWidth(
						theme.fg(
							"dim",
							`  ${context?.executionStarted ? (name === "read" ? "Reading…" : name === "find" ? "Finding paths…" : "Searching…") : "Receiving arguments…"}`,
						),
						width,
					),
				);
			}
			return lines;
		},
	};
}

function noticeRows(notice: string, theme: any, width: number): string[] {
	return new Text(theme.fg("dim", notice), 0, 0)
		.render(Math.max(1, width - 2))
		.map((line) => truncateToWidth(`  ${line}`, width));
}

export function createFileToolResultComponent(
	name: string,
	args: any,
	result: any,
	theme: any,
	partial = false,
): Component {
	const view = fileToolView(name, args, result);
	const summary = fileToolSummary(name, args);
	const inputText = `${summary.payload}${partial ? summary.detail : ""}`;
	const outputText =
		view.body ||
		(view.summary?.toLowerCase().includes("image")
			? "Image returned"
			: partial
				? "Receiving output…"
				: "(no output)");
	const paint = (text: string): string => {
		if (name === "read" && !result?.isError && /^lines? /.test(view.summary ?? "") && view.body) {
			try {
				return highlightCode(text, getLanguageFromPath(args?.path ?? "")).join("\n");
			} catch {
				/* Preserve plain text when native highlighting cannot handle this content. */
			}
		}
		return theme.fg(result?.isError && !toolWasCancelled(name, result) ? "error" : "text", text);
	};
	return {
		invalidate() {},
		render(width) {
			const bodyWidth = Math.max(1, width - 2);
			const input = boundedTextPreview(inputText, {
				width: bodyWidth,
				maxRows: 2,
				paint: (text) => theme.fg(TOOL_INPUT_COLOR, text),
			});
			const output = boundedTextPreview(outputText, { width: bodyWidth, maxRows: 4, paint });
			let disclosure = "… More output hidden";
			if (output.hiddenLines !== undefined && !result?.isError && !partial) {
				if (name === "read" && /^lines? /.test(view.summary ?? ""))
					disclosure = `… ${output.hiddenLines} more ${output.hiddenLines === 1 ? "line" : "lines"} in result`;
				else if (name === "find" && /^\d+ paths?\b/.test(view.summary ?? ""))
					disclosure = `… ${output.hiddenLines} more ${output.hiddenLines === 1 ? "path" : "paths"} in result`;
				else if (name === "grep" && /^\d+ match/.test(view.summary ?? "")) {
					const hiddenMatches = view.body
						.split("\n")
						.slice(4)
						.filter((line) => /^.+?:[1-9]\d*: /.test(line)).length;
					if (hiddenMatches)
						disclosure = `… ${hiddenMatches} more ${hiddenMatches === 1 ? "match" : "matches"} in result`;
				}
			}
			return [
				...input.rows.map((line) => `  ${line}`),
				...(input.omitted ? noticeRows("… More input hidden", theme, width) : []),
				...output.rows.map((line) => `  ${line}`),
				...(output.omitted ? noticeRows(disclosure, theme, width) : []),
				...view.notices.flatMap((notice) => noticeRows(notice, theme, width)),
			].map((line) => truncateToWidth(line, width));
		},
	};
}
