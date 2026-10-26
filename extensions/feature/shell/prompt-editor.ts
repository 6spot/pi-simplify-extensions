/**
 * Keep Pi's native editor behavior. Only paint its surface like Codex:
 * padded background without a frame; working status is above.
 */
import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const INPUT_PADDING = 2;

export class PromptEditor extends CustomEditor {
	private paintBackground: (line: string) => string = (line) => line;
	private renderSpacer: (width: number) => string = (width) => " ".repeat(width);

	constructor(...args: ConstructorParameters<typeof CustomEditor>) {
		super(...args);
		this.setPaddingX(this.getPaddingX());
	}

	override setPaddingX(padding: number): void {
		// Keep native padding and mouse/cursor geometry in sync.
		super.setPaddingX(Number.isFinite(padding) ? Math.max(INPUT_PADDING, padding) : INPUT_PADDING);
	}

	setBackgroundPainter(paint: (line: string) => string) {
		this.paintBackground = paint;
	}

	/** Row between the input block and the footer. Terminal rows are atomic, so sub-row
	 *  spacing needs a half-block glyph: upper half in the input background, lower half default. */
	setSpacerRenderer(render: (width: number) => string) {
		this.renderSpacer = render;
	}

	protected override renderTopBorder(width: number): string {
		return " ".repeat(width);
	}

	protected override renderBottomBorder(width: number): string {
		return " ".repeat(width);
	}

	override render(width: number): string[] {
		if (width <= 0) return [];
		const lines = super.render(width);
		// Pi appends autocomplete below the editor. Never paint over the popup.
		const self = this as unknown as { renderedAutocompleteHeight: number };
		const inputEnd = Math.max(0, lines.length - (self.renderedAutocompleteHeight ?? 0));
		for (let i = 0; i < inputEnd; i++) {
			lines[i] = this.paintBackground(lines[i]);
		}
		// The frameless editor has no bottom rule to separate it from the footer;
		// keep half a row of breathing room below the input block.
		lines.push(this.renderSpacer(width));
		return lines;
	}
}

type EditorFactory = Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];
let active = false;
let previousFactory: EditorFactory | undefined;

export function applyPromptEditor(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	try {
		if (!active) previousFactory = ctx.ui.getEditorComponent?.();
		active = true;
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = new PromptEditor(tui, theme, keybindings, { embedWorkingStatus: false });
			editor.setBackgroundPainter((line) => ctx.ui.theme.bg("userMessageBg", line));
			editor.setSpacerRenderer((width) =>
				ctx.ui.theme.style("▀".repeat(Math.max(0, width)), { fg: ctx.ui.theme.colors.userMessageBg }));
			return editor;
		});
	} catch (error) {
		ctx.ui.notify(`editor error: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}

export function clearPromptEditor(ctx: ExtensionContext): void {
	if (!active || !ctx.hasUI) return;
	ctx.ui.setEditorComponent(previousFactory);
	active = false;
	previousFactory = undefined;
}
