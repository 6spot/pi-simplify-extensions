import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { createWriteTool } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import {
	capturePreviousContent,
	WriteExecutionMetadataStore,
} from "../extensions/renderer/tool/diff/write-execution.ts";
import { renderRichToolResult } from "../extensions/renderer/tool/diff/index.ts";

test("write snapshots resolve home, relative, @ and Unicode-space paths like the native writer", async () => {
	const dir = await mkdtemp(join(homedir(), ".pi-simplify-write-"));
	try {
		const name = "example file.ts";
		const path = join(dir, name);
		const homePath = `~/${dir.slice(homedir().length + 1)}/${name}`;
		const writer = createWriteTool(dir);
		for (const input of [
			path,
			name,
			`@${name}`,
			homePath,
			`@${homePath}`,
			"example\u00a0file.ts",
		]) {
			await writeFile(path, "before\n");
			const metadata = await capturePreviousContent(input, dir);
			assert.equal(metadata.previousContent, "before\n", input);
			const result = await writer.execute("write-path", { path: input, content: "after\n" });
			assert.equal(result.isError, undefined, input);
			assert.equal((await capturePreviousContent(path)).previousContent, "after\n", input);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

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
		const diff = renderRichToolResult(
			"write",
			{ content: [{ type: "text", text: "Written" }] },
			{ expanded: false },
			theme,
			{ toolCallId: "w1", args: { path, content: "const a = 2;\n" } },
			store,
		);
		assert.ok(diff);
		assert.ok(Array.isArray(diff.render(100)));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
