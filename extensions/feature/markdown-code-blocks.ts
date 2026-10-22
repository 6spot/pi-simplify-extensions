import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { stripAnsi } from "../utils/ansi-text.ts";
import { MARKDOWN_CODE_BLOCK_PATCH, patchRegistry } from "../utils/patch-keys.ts";

type RenderToken = (
	this: Markdown,
	token: { type: string; lang?: string },
	width: number,
	nextTokenType?: string,
	styleContext?: unknown,
) => string[];

type MarkdownPrototype = {
	render: Markdown["render"];
	renderToken: RenderToken;
};

/** Keep native parsing, highlighting and wrapping; remove only generated fence rows. */
export function installMarkdownCodeBlocks(): () => void {
	patchRegistry.get<{ dispose(): void }>(MARKDOWN_CODE_BLOCK_PATCH)?.dispose();
	const prototype = Markdown.prototype as unknown as MarkdownPrototype;
	if (typeof prototype.renderToken !== "function") return () => {};

	const originalRender = prototype.render;
	const originalToken = prototype.renderToken;
	const seen = new WeakSet<Markdown>();
	const instances = new Set<WeakRef<Markdown>>();
	let active = true;

	const render: Markdown["render"] = function (this: Markdown, width) {
		if (active && !seen.has(this)) {
			seen.add(this);
			instances.add(new WeakRef(this));
			// /reload can install after native components have already cached their output.
			this.invalidate();
		}
		return originalRender.call(this, width);
	};
	const renderToken: RenderToken = function (...args) {
		const lines = originalToken.apply(this, args);
		const [token, , nextTokenType] = args;
		if (!active || token.type !== "code") return lines;

		const closing = lines.length - (nextTokenType && nextTokenType !== "space" ? 2 : 1);
		// Fall back unchanged if another extension or a Pi update changes the layout.
		if (
			closing < 1 ||
			stripAnsi(lines[0]) !== `\`\`\`${token.lang || ""}` ||
			stripAnsi(lines[closing]) !== "```"
		) return lines;

		return [...lines.slice(1, closing), ...lines.slice(closing + 1)];
	};
	const patch = {
		dispose() {
			if (!active) return;
			active = false;
			if (prototype.render === render) prototype.render = originalRender;
			if (prototype.renderToken === renderToken) prototype.renderToken = originalToken;
			for (const ref of instances) ref.deref()?.invalidate();
			instances.clear();
			patchRegistry.dispose(MARKDOWN_CODE_BLOCK_PATCH, patch);
		},
	};

	prototype.render = render;
	prototype.renderToken = renderToken;
	patchRegistry.install(MARKDOWN_CODE_BLOCK_PATCH, patch);
	return () => patch.dispose();
}

export default function markdownCodeBlocks(pi: ExtensionAPI): void {
	let dispose: (() => void) | undefined;
	pi.on("session_start", (_event, ctx) => {
		dispose?.();
		dispose = ctx.mode === "tui" ? installMarkdownCodeBlocks() : undefined;
	});
	pi.on("session_shutdown", () => {
		dispose?.();
		dispose = undefined;
	});
}
