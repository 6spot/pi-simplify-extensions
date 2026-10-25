import { stripVTControlCharacters } from "node:util";

/** The call renderer owns the one title control; result disclosures are passive. */
export function titleControlComponent<T extends { render(width: number): string[] }>(view: T): T {
	const render = view.render;
	let title: string | undefined;
	return Object.assign(view, {
		usesTitleControls: true,
		render(width: number): string[] {
			const rows = render.call(view, width);
			const first = stripVTControlCharacters(rows[0] ?? "").trim();
			title =
				/(?: · (?:Expand|Collapse)|(?:to (?:expand|collapse|show more|show less)|click to show more)\)?)\s*$/.test(
					first,
				)
					? first
					: undefined;
			return rows;
		},
		hasTitleControl: () => title !== undefined,
		isTitleControlLine: (line: string) =>
			title !== undefined && stripVTControlCharacters(line).trim() === title,
	});
}
