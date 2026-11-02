import assert from "node:assert/strict";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { createCodeLineHighlighter } from "../extensions/renderer/tool/diff/diff-highlight.ts";
import { parseDiff, type DiffLineEntry } from "../extensions/renderer/tool/diff/diff-parse.ts";
import {
	MAX_HL_CHARS,
	ShikiHighlightCache,
} from "../extensions/renderer/tool/diff/shiki-highlight.ts";
import { shouldHighlightCodeBlock } from "../extensions/renderer/tool/diff/diff-renderer.ts";
import { sanitizeToolResultText } from "../extensions/utils/tool-result-sanitize.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const theme = { fg: (_color: string, text: string) => text };
initTheme("dark");

test("diff omissions reset syntax state in synchronous and asynchronous highlighting", async () => {
	const parsed = parseDiff(
		["  13 /**", "  14  * documentation", "     ...", "  60 const value = 1"].join("\n"),
	);
	const codeEntry = parsed.entries.find(
		(entry): entry is DiffLineEntry => entry.kind === "line" && entry.content === "const value = 1",
	);
	assert.ok(codeEntry);
	const highlight = createCodeLineHighlighter("javascript", theme, parsed.entries);
	const standalone = createCodeLineHighlighter("javascript", theme, [codeEntry]);
	const sync = highlight(codeEntry.content, codeEntry);
	assert.notEqual(sync, codeEntry.content, "the theme must produce real syntax colors");
	assert.equal(sync, standalone(codeEntry.content, codeEntry));
	let upgraded = sync;
	for (let waited = 0; upgraded === sync && waited < 10_000; waited += 10) {
		await new Promise((resolve) => setTimeout(resolve, 10));
		upgraded = highlight(codeEntry.content, codeEntry);
	}
	assert.notEqual(upgraded, sync, "the asynchronous Shiki upgrade must actually complete");
	assert.equal(upgraded, standalone(codeEntry.content, codeEntry));
});

test("diff segments still share the total syntax highlighting budget", () => {
	const segment = `const text = '${"x".repeat(Math.floor(MAX_HL_CHARS / 2))}'`;
	const parsed = parseDiff([`  1 ${segment}`, "     ...", `  99 ${segment}`].join("\n"));
	assert.ok(segment.length < MAX_HL_CHARS);
	assert.ok(segment.length * 2 > MAX_HL_CHARS);
	const highlight = createCodeLineHighlighter("javascript", theme, parsed.entries);
	for (const entry of parsed.entries) {
		if (entry.kind === "line") assert.equal(highlight(entry.content, entry), entry.content);
	}
});

test("Shiki cache deduplicates pending work, caches success, and isolates themes", async () => {
	let loads = 0;
	let highlights = 0;
	const cache = new ShikiHighlightCache(async () => {
		loads++;
		return async (code, _lang, theme) => {
			highlights++;
			return `${theme}:${code}`;
		};
	});
	let invalidations = 0;
	assert.equal(
		cache.get("const x = 1", "ts", "github-dark", ["fallback"], () => invalidations++),
		undefined,
	);
	assert.equal(
		cache.get("const x = 1", "ts", "github-dark", ["fallback"], () => invalidations++),
		undefined,
	);
	await settle();
	assert.equal(loads, 1);
	assert.equal(highlights, 1);
	assert.deepEqual(cache.get("const x = 1", "ts", "github-dark", ["fallback"]), [
		"github-dark:const x = 1",
	]);
	assert.equal(invalidations, 2, "every component awaiting the shared block repaints");
	assert.equal(cache.get("const x = 1", "ts", "github-light", ["fallback"]), undefined);
	await settle();
	assert.equal(highlights, 2);
});

test("terminal controls are removed before source highlighting", () => {
	assert.equal(
		sanitizeToolResultText("safe\x1b]52;c;SGVsbG8=\x07mid\x1bP1;2|payload\x1b\\end\x1b[31m"),
		"safemidend",
	);
	assert.equal(
		sanitizeToolResultText(
			"a\x9d52;c;C1_OSC\x9cb\x90C1_DCS\x9cc\x1b]52;c;ESC_OSC\x9cd\x1bPESC_DCS\x9ce",
		),
		"abcde",
	);
});

test("Shiki failures degrade without caching, retry, and oversized blocks are skipped", async () => {
	let attempts = 0;
	const cache = new ShikiHighlightCache(async () => async (code) => {
		attempts++;
		if (attempts === 1) throw new Error("temporary");
		return `ok:${code}`;
	});
	assert.equal(cache.get("x", "ts", "github-dark", ["x"]), undefined);
	await settle();
	assert.equal(cache.get("x", "ts", "github-dark", ["x"]), undefined, "failed work is retryable");
	await settle();
	assert.deepEqual(cache.get("x", "ts", "github-dark", ["x"]), ["ok:x"]);
	assert.equal(attempts, 2);
	const oversized = "x".repeat(MAX_HL_CHARS + 1);
	assert.equal(cache.get(oversized, "ts", "github-dark", ["fallback"]), undefined);
	assert.equal(shouldHighlightCodeBlock("x".repeat(MAX_HL_CHARS)), true);
	assert.equal(shouldHighlightCodeBlock(oversized), false, "sync highlighting is also skipped");
	await settle();
	assert.equal(attempts, 2);
});
