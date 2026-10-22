import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturePreviousContent, WriteExecutionMetadataStore } from "../extensions/renderer/tool/diff/write-execution.ts";
import { renderRichToolResult } from "../extensions/renderer/tool/diff/index.ts";

test("observes original file content for Rich Diff without replacing the write tool", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-simplify-"));
	try {
		const path = join(dir, "example.ts");
		await writeFile(path, "const a = 1;\n");
		const metadata = await capturePreviousContent(path);
		assert.equal(metadata.previousContent, "const a = 1;\n");
		const store = new WriteExecutionMetadataStore();
		store.set("w1", metadata);
		const theme: any = {
			fg: (_name: string, text: string) => text,
			bg: (_name: string, text: string) => text,
			bold: (text: string) => text,
		};
		const diff = renderRichToolResult("write",
			{ content: [{ type: "text", text: "Written" }] },
			{ expanded: false }, theme,
			{ toolCallId: "w1", args: { path, content: "const a = 2;\n" } }, store);
		assert.ok(diff);
		assert.ok(Array.isArray(diff.render(100)));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
