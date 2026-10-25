import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type TextPreview = {
	rows: string[];
	omitted: boolean;
	/** Only available when every selected source line occupies one complete visible row. */
	hiddenLines?: number;
};

/**
 * Bound both the source-line sample and the visible preview. Paint only the sample,
 * so native highlighters do not process an entire result for a four-row preview.
 * Wrapping makes a source-line omission count ambiguous; callers must then use a
 * disclosure without a number. Neither the source nor its native notices change.
 */
export function boundedTextPreview(
	text: string,
	options: {
		width: number;
		maxRows: number;
		direction?: "head" | "tail";
		paint?: (text: string) => string;
	},
): TextPreview {
	const width = Math.max(1, Math.floor(options.width));
	const maxRows = Math.max(0, Math.floor(options.maxRows));
	if (!text) return { rows: [], omitted: false };
	if (!maxRows) return { rows: [], omitted: true };
	const source = text.split("\n");
	const tail = options.direction === "tail";
	const selected = tail ? source.slice(-maxRows) : source.slice(0, maxRows);
	let sample = selected.join("\n");
	const charBudget = Math.max(256, width * maxRows * 8);
	const sourceClipped = sample.length > charBudget;
	if (sourceClipped) {
		let start = tail ? sample.length - charBudget : 0;
		let end = tail ? sample.length : charBudget;
		if (start > 0 && /[\uDC00-\uDFFF]/.test(sample[start]!)) start++;
		if (end < sample.length && /[\uD800-\uDBFF]/.test(sample[end - 1]!)) end--;
		sample = sample.slice(start, end);
	}
	const painted = options.paint ? options.paint(sample) : sample;
	const wrapped = wrapTextWithAnsi(painted.replace(/\t/g, "   "), width);
	const rows = tail ? wrapped.slice(-maxRows) : wrapped.slice(0, maxRows);
	const omitted = sourceClipped || source.length > selected.length || wrapped.length > rows.length;
	return {
		rows,
		omitted,
		...(omitted && !sourceClipped && wrapped.length === selected.length
			? { hiddenLines: source.length - selected.length }
			: {}),
	};
}
