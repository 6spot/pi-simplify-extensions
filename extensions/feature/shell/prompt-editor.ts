/**
 * Keep Pi's native editor behavior. Only paint its surface like Codex:
 * rounded frame and padded background; working status is above.
 */
import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stripAnsi } from "../../utils/ansi-text.ts";

const INPUT_PADDING = 2;
const MIN_FRAME_WIDTH = INPUT_PADDING * 2 + 1;
let userPaddingX = INPUT_PADDING;

export function inputTextIndent(): number {
	return userPaddingX;
}

export class PromptEditor extends CustomEditor {
	private paintBackground: (line: string) => string = (line) => line;
	private paintBorder = (line: string) => this.borderColor(line);

	constructor(...args: ConstructorParameters<typeof CustomEditor>) {
		super(...args);
		this.setPaddingX(this.getPaddingX());
	}

	override setPaddingX(padding: number): void {
		// One column for the frame and one for spacing. Keep native mouse/cursor geometry in sync.
		super.setPaddingX(Number.isFinite(padding) ? Math.max(INPUT_PADDING, padding) : INPUT_PADDING);
	}

	setBackgroundPainter(paint: (line: string) => string) {
		this.paintBackground = paint;
	}

	setBorderPainter(paint: (line: string) => string) {
		this.paintBorder = paint;
	}

	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		if (width < MIN_FRAME_WIDTH) return " ".repeat(width);
		return this.paintBorder("╭") +
			this.paintBackground(this.paintBorder(stripAnsi(super.renderTopBorder(width - 2, hiddenLineCount)))) +
			this.paintBorder("╮");
	}

	protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
		if (width < MIN_FRAME_WIDTH) return " ".repeat(width);
		return this.paintBorder("╰") +
			this.paintBackground(this.paintBorder(stripAnsi(super.renderBottomBorder(width - 2, hiddenLineCount)))) +
			this.paintBorder("╯");
	}

	override render(width: number): string[] {
		if (width <= 0) return [];
		userPaddingX = Math.min(this.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)));
		const lines = super.render(width);
		// Pi appends autocomplete below the editor. Never frame or paint over the popup.
		const self = this as unknown as { renderedAutocompleteHeight: number };
		const inputEnd = Math.max(0, lines.length - (self.renderedAutocompleteHeight ?? 0));
		const framed = width >= MIN_FRAME_WIDTH;
		for (let i = 1; i < inputEnd - 1; i++) {
			lines[i] = framed
				? this.paintBorder("│") + this.paintBackground(lines[i].slice(1, -1)) + this.paintBorder("│")
				: this.paintBackground(lines[i]);
		}
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
			editor.setBorderPainter((line) => ctx.ui.theme.fg("border", line));
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
