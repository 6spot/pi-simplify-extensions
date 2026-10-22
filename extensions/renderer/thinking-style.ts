import type { Theme } from "@earendil-works/pi-coding-agent";

type CompactThinkingTheme = Pick<Theme, "fg" | "italic" | "bold">;

/** 与 compact-thinking 主渲染器共用的静态文字样式。 */
export function styleCompactThinkingText(
	text: string,
	theme: CompactThinkingTheme | undefined,
	bold = false,
): string {
	if (!theme) return text;
	const colored = typeof theme.fg === "function" ? theme.fg("thinkingText", text) : text;
	const weighted = bold && typeof theme.bold === "function" ? theme.bold(colored) : colored;
	return typeof theme.italic === "function" ? theme.italic(weighted) : weighted;
}

/** 与 compact-thinking 主渲染器共用的活动思考扫光动画。 */
export function animateCompactThinkingText(
	text: string,
	theme: CompactThinkingTheme | undefined,
	animationFrame: number,
	boldBase = false,
): string {
	if (!theme) return text;
	const characters = Array.from(text);
	if (characters.length === 0) return "";
	const highlightWidth = Math.max(1, Math.min(5, Math.ceil(characters.length * 0.28)));
	const start = (animationFrame % (characters.length + highlightWidth)) - highlightWidth;
	const end = start + highlightWidth;
	const before = characters.slice(0, Math.max(0, start)).join("");
	const highlighted = characters
		.slice(Math.max(0, start), Math.min(characters.length, end))
		.join("");
	const after = characters.slice(Math.max(0, end)).join("");
	const highlightedColored =
		highlighted && typeof theme.fg === "function" ? theme.fg("text", highlighted) : highlighted;
	const highlightedWeighted =
		highlightedColored && typeof theme.bold === "function"
			? theme.bold(highlightedColored)
			: highlightedColored;
	const highlightedText =
		highlightedWeighted && typeof theme.italic === "function"
			? theme.italic(highlightedWeighted)
			: highlightedWeighted;

	return (
		styleCompactThinkingText(before, theme, boldBase) +
		highlightedText +
		styleCompactThinkingText(after, theme, boldBase)
	);
}

function formatThoughtDuration(durationMs: number) {
	if (durationMs < 1_000) {
		return `${Math.max(1, Math.round(durationMs))}ms`;
	}

	const totalSeconds = Math.max(1, Math.round(durationMs / 1_000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds}s`;
	return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export { formatThoughtDuration };
