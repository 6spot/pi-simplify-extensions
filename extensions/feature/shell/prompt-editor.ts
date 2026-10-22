/**
 * Keep Pi's native editor behavior. Only paint its surface like Codex:
 * padded background instead of horizontal rules; working status is above.
 */
import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const PROMPT = "❯";
const PREFIX_WIDTH = 2;
let userPaddingX = 0;

export function inputTextIndent(): number {
	return userPaddingX + PREFIX_WIDTH;
}

export class PromptEditor extends CustomEditor {
	private paintBackground: (line: string) => string = (line) => line;

	setBackgroundPainter(paint: (line: string) => string) {
		this.paintBackground = paint;
	}

	protected override renderTopBorder(width: number, _hiddenLineCount: number): string {
		return " ".repeat(width);
	}

	protected override renderBottomBorder(width: number, _hiddenLineCount: number): string {
		return " ".repeat(width);
	}

	override render(width: number): string[] {
		const self = this as unknown as { paddingX: number; renderedAutocompleteHeight: number };
		const saved = self.paddingX;
		userPaddingX = saved;
		self.paddingX = saved + PREFIX_WIDTH;
		try {
			const lines = super.render(width);
			if (lines.length > 2 && lines[1].startsWith("  ")) {
				lines[1] = this.borderColor(PROMPT) + " " + lines[1].slice(PREFIX_WIDTH);
			}
			// Pi appends autocomplete below the editor. Never paint over the popup.
			const inputEnd = Math.max(0, lines.length - (self.renderedAutocompleteHeight ?? 0));
			for (let i = 0; i < inputEnd; i++) {
				lines[i] = this.paintBackground(lines[i]);
			}
			return lines;
		} finally {
			self.paddingX = saved;
		}
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
