import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatOneLineFooter, type FooterParts } from "../extensions/feature/shell/footer.ts";

const theme = { fg: (_color: string, text: string) => text } as any;
const sample: FooterParts = {
	model: "gpt-6",
	thinking: "high",
	contextPercent: 42,
	contextWindow: 200_000,
	cost: 0.23,
	directory: "my-project",
	branch: "main",
	git: { add: 3, del: 1, status: "!" },
};

test("wide footer is a single text-only line with model, context, cost, cwd and Git", () => {
	const line = formatOneLineFooter(sample, 120, theme);
	assert.match(line, /gpt-6/);
	assert.match(line, /ctx 42%/);
	assert.match(line, /\$0\.23/);
	assert.match(line, /my-project/);
	assert.match(line, /main/);
	assert.match(line, /\+3\/\-1/);
	assert.doesNotMatch(line, /[█░󰆼]/);
});

test("narrow footer stays one line and gives model and context priority", () => {
	for (const width of [8, 20, 32, 48, 60]) {
		const line = formatOneLineFooter(sample, width, theme);
		assert.ok(visibleWidth(line) <= width, `overflow at ${width}`);
		assert.equal(line.includes("\\n"), false);
	}
	assert.match(formatOneLineFooter(sample, 32, theme), /gpt-6/);
});

test("unknown context, absent Git and zero cost remain clean", () => {
	const text = formatOneLineFooter({ model: "local", contextPercent: null, cost: 0 }, 80, theme);
	assert.equal(text, "local · ctx ?");
});
