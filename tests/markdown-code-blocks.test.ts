import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getMarkdownTheme, initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import markdownCodeBlocks, { installMarkdownCodeBlocks } from "../extensions/feature/markdown-code-blocks.ts";
import { stripAnsi } from "../extensions/utils/ansi-text.ts";
import { MARKDOWN_CODE_BLOCK_PATCH, patchRegistry } from "../extensions/utils/patch-keys.ts";

const source = 'Before\n\n```typescript\nconst title = "中文🙂";\nconst n = 42;\n```\n\nAfter';
const nativeRender = Markdown.prototype.render;
const prototype = Markdown.prototype as unknown as { renderToken?: (...args: unknown[]) => string[] };
const nativeToken = prototype.renderToken;
const plain = (lines: string[]) => lines.map(stripAnsi);
const withoutFences = (lines: string[]) => lines.filter((line) => !/^```(?:typescript|text)?$/.test(stripAnsi(line).trim()));

afterEach(() => {
	patchRegistry.get<{ dispose(): void }>(MARKDOWN_CODE_BLOCK_PATCH)?.dispose();
	Markdown.prototype.render = nativeRender;
	prototype.renderToken = nativeToken;
});

for (const appearance of ["dark", "light"]) {
	test(`native ${appearance} highlighting, wrapping and cache survive fence removal`, () => {
		initTheme(appearance);
		const theme = getMarkdownTheme();
		const highlight = theme.highlightCode!;
		let highlights = 0;
		theme.highlightCode = (code, lang) => {
			highlights++;
			assert.equal(lang, "typescript");
			return highlight(code, lang);
		};
		const transformed: string[] = [];
		const markdown = new Markdown(source, 1, 0, theme, undefined, {
			transform: (text) => { transformed.push(text); return text; },
		});
		const native = markdown.render(28);
		assert.ok(native.some((line) => line.includes("\x1b[")));
		const dispose = installMarkdownCodeBlocks();
		const compact = markdown.render(28);
		assert.deepEqual(compact, withoutFences(native));
		assert.ok(compact.every((line) => visibleWidth(line) <= 28));
		assert.equal(markdown.render(28), compact);
		assert.equal(highlights, 2);
		assert.deepEqual(transformed, [source, source]);
		dispose();
		assert.deepEqual(markdown.render(28), native);
	});
}

test("literal fences inside code survive, including without a syntax highlighter", () => {
	initTheme("dark");
	const markdown = new Markdown("````text\n```\n中文 🙂\n````", 0, 0, {
		...getMarkdownTheme(), highlightCode: undefined,
	});
	const native = markdown.render(50);
	installMarkdownCodeBlocks();
	assert.deepEqual(markdown.render(50), native.slice(1, -1));
	assert.ok(plain(markdown.render(50)).some((line) => line.trim() === "```"));
});

test("native lists, quotes, inline code and non-code Markdown retain their layout", () => {
	initTheme("dark");
	const text = '# Heading\n\n- item\n\n  ```text\n  list code\n  ```\n\n> ```text\n> quote code\n> ```\n\nInline `code` and **bold**.\n\n| A | B |\n| - | - |\n| 1 | 2 |';
	const markdown = new Markdown(text, 0, 0, getMarkdownTheme());
	const native = markdown.render(50);
	installMarkdownCodeBlocks();
	const expected = native.filter((line) => !/^(?:> |│ )?\s*```(?:text)?$/.test(stripAnsi(line).trimEnd()));
	assert.deepEqual(markdown.render(50), expected);
});

test("streaming code, resizing and theme invalidation use the native renderer", () => {
	initTheme("dark");
	const markdown = new Markdown("", 0, 0, getMarkdownTheme());
	const chunks = ["```typescript\nconst title =", source, "```\n\n```", "Plain `code` again."];
	const expected = chunks.map((chunk) => {
		markdown.setText(chunk);
		return [20, 50].map((width) => withoutFences(markdown.render(width)));
	});
	installMarkdownCodeBlocks();
	chunks.forEach((chunk, index) => {
		markdown.setText(chunk);
		[20, 50].forEach((width, widthIndex) => assert.deepEqual(markdown.render(width), expected[index][widthIndex]));
	});
	initTheme("light");
	markdown.setText(source);
	markdown.invalidate();
	const light = markdown.render(50);
	const dispose = patchRegistry.get<{ dispose(): void }>(MARKDOWN_CODE_BLOCK_PATCH)!;
	dispose.dispose();
	assert.deepEqual(light, withoutFences(markdown.render(50)));
});

test("reload ownership and later wrappers survive disposal", () => {
	initTheme("dark");
	const markdown = new Markdown(source, 0, 0, getMarkdownTheme());
	const native = markdown.render(50);
	const disposeOld = installMarkdownCodeBlocks();
	const disposeNew = installMarkdownCodeBlocks();
	disposeOld();
	assert.deepEqual(markdown.render(50), withoutFences(native));
	const render = Markdown.prototype.render;
	const laterRender: Markdown["render"] = function (this: Markdown, width) { return render.call(this, width); };
	Markdown.prototype.render = laterRender;
	const token = prototype.renderToken!;
	const laterToken = function (this: Markdown, ...args: unknown[]) { return token.apply(this, args); };
	prototype.renderToken = laterToken;
	disposeNew();
	disposeNew();
	assert.equal(Markdown.prototype.render, laterRender);
	assert.equal(prototype.renderToken, laterToken);
	assert.deepEqual(markdown.render(50), native);
	assert.equal(patchRegistry.get(MARKDOWN_CODE_BLOCK_PATCH), undefined);
});

test("unsupported or changed native token layout falls back unchanged", () => {
	const dispose = installMarkdownCodeBlocks();
	dispose();
	const customLines = ["custom code title", "  body", "custom end"];
	prototype.renderToken = () => customLines;
	const disposeCustom = installMarkdownCodeBlocks();
	assert.equal(prototype.renderToken!.call({} as Markdown, { type: "code" }, 50), customLines);
	disposeCustom();
	prototype.renderToken = undefined;
	assert.doesNotThrow(() => installMarkdownCodeBlocks()());
	assert.equal(Markdown.prototype.render, nativeRender);
});

test("extension installs only for TUI and releases on shutdown", async () => {
	type Handler = (event: unknown, ctx: { mode: string }) => unknown;
	const handlers = new Map<string, Handler>();
	markdownCodeBlocks({ on: (name: string, handler: Handler) => handlers.set(name, handler) } as unknown as ExtensionAPI);
	for (const mode of ["print", "rpc"]) {
		await handlers.get("session_start")!({}, { mode });
		assert.equal(Markdown.prototype.render, nativeRender);
	}
	await handlers.get("session_start")!({}, { mode: "tui" });
	assert.notEqual(Markdown.prototype.render, nativeRender);
	await handlers.get("session_shutdown")!({}, { mode: "tui" });
	await handlers.get("session_shutdown")!({}, { mode: "tui" });
	assert.equal(Markdown.prototype.render, nativeRender);
	assert.equal(prototype.renderToken, nativeToken);
});
