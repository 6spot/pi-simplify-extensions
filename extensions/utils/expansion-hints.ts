import { getKeybindings } from "@earendil-works/pi-tui";
import { patchRegistry, TOOL_MOUSE_TUI_SLOT } from "./patch-keys.ts";

let toolTuiFullscreen: boolean | undefined;

export function setToolTuiFullscreen(value: boolean): void {
	toolTuiFullscreen = value;
}
function currentMode(): boolean | undefined {
	// Extensions can have separate module caches; the existing mouse slot follows its owner.
	const mode = patchRegistry.get<{ mode?: string } | null>(TOOL_MOUSE_TUI_SLOT)?.mode;
	return mode === "fullscreen" ? true : mode === "regular" ? false : toolTuiFullscreen;
}

export function isToolTuiFullscreen(): boolean {
	return currentMode() !== false;
}

export function expandShortcutText(): string {
	const keys = getKeybindings().getKeys("app.tools.expand");
	if (!keys.length) return "ctrl+o";
	return keys
		.join("/")
		.split("/")
		.map((part) =>
			part
				.split("+")
				.map((key) =>
					process.platform === "darwin" && key.toLowerCase() === "alt" ? "option" : key,
				)
				.join("+"),
		)
		.join("/");
}
export function showMoreHintText(): string {
	return isToolTuiFullscreen() ? "click to show more" : `${expandShortcutText()} to show more`;
}
export function collapseHintText(): string {
	return isToolTuiFullscreen() ? "↑ Collapse" : `${expandShortcutText()} to collapse`;
}

/** Independently loaded views use native shortcuts until mouse routing is installed. */
export function expansionHintText(expanded: boolean): string {
	const fullscreen =
		patchRegistry.get<{ mode?: string } | null>(TOOL_MOUSE_TUI_SLOT)?.mode === "fullscreen";
	return fullscreen
		? expanded
			? collapseHintText()
			: showMoreHintText()
		: `${expandShortcutText()} to ${expanded ? "collapse" : "show more"}`;
}
