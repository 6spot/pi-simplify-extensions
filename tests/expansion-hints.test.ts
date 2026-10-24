import assert from "node:assert/strict";
import test from "node:test";
import { patchRegistry, TOOL_MOUSE_TUI_SLOT } from "../extensions/utils/patch-keys.ts";

test("separately loaded renderers follow the active TUI mode and retain shortcut fallback", async () => {
	const hints = await import("../extensions/utils/expansion-hints.ts");
	const isolated = await import(
		new URL("../extensions/utils/expansion-hints.ts?isolated-extension", import.meta.url).href
	);
	const previous = patchRegistry.get(TOOL_MOUSE_TUI_SLOT);
	const tui = { mode: "regular" };
	try {
		hints.setToolTuiFullscreen(true);
		patchRegistry.install(TOOL_MOUSE_TUI_SLOT, tui);
		assert.match(isolated.showMoreHintText(), /to show more/);
		assert.doesNotMatch(isolated.showMoreHintText(), /click/);
		tui.mode = "fullscreen";
		assert.equal(isolated.showMoreHintText(), "Expand");
		assert.equal(isolated.collapseHintText(), "Collapse");
		patchRegistry.dispose(TOOL_MOUSE_TUI_SLOT, tui);
		assert.doesNotMatch(isolated.expansionHintText(false), /click/);
		assert.doesNotMatch(hints.expansionHintText(false), /click/);
		assert.match(isolated.expansionHintText(true), /to collapse/);
	} finally {
		if (previous === undefined) patchRegistry.dispose(TOOL_MOUSE_TUI_SLOT, tui);
		else patchRegistry.install(TOOL_MOUSE_TUI_SLOT, previous);
		hints.setToolTuiFullscreen(true);
	}
});
