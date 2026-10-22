import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applyPromptEditor, clearPromptEditor } from "../extensions/feature/shell/prompt-editor.ts";

test("Codex-style editor uses a separate Working row and restores the previous editor", () => {
	let factory: any = () => ({ native: true });
	const original = factory;
	const ctx = {
		hasUI: true,
		ui: {
			getEditorComponent: () => factory,
			setEditorComponent: (next: any) => { factory = next; },
			theme: { bg: (_color: string, text: string) => text },
			notify: () => {},
		},
	} as unknown as ExtensionContext;
	applyPromptEditor(ctx);
	assert.notEqual(factory, original);
	const editor = factory({ requestRender() {} }, { borderColor: (text: string) => text }, {});
	assert.equal(editor.embedWorkingStatus, false);
	clearPromptEditor(ctx);
	assert.equal(factory, original);
});
