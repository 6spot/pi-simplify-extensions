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

test("wide footer keeps project and usage on the left and model at the right edge", () => {
	const line = formatOneLineFooter(sample, 120, theme);
	assert.match(line, /^my-project · main \+3\/-1 · ctx 42%\/200k · \$0\.23\s+high · gpt-6$/);
	assert.equal(visibleWidth(line), 120);
	assert.match(line, /gpt-6/);
	assert.match(line, /ctx 42%/);
	assert.match(line, /\$0\.23/);
	assert.match(line, /my-project/);
	assert.match(line, /main/);
	assert.match(line, /\+3\/\-1/);
	assert.doesNotMatch(line, /[█░󰆼]/);
});

test("narrow footer shortens project details before usage and keeps model right-aligned", () => {
	for (const width of [0, 1, 4, 8, 20, 32, 48, 60]) {
		const line = formatOneLineFooter(sample, width, theme);
		assert.equal(visibleWidth(line), width, `width ${width}`);
		assert.equal(line.includes("\n"), false);
		if (width >= 5) assert.ok(line.endsWith("gpt-6"));
	}
	assert.match(formatOneLineFooter(sample, 20, theme), /ctx 42%\s+high · gpt-6$/);
	assert.match(formatOneLineFooter(sample, 32, theme), /ctx 42% · \$0\.23\s+high · gpt-6$/);
	assert.doesNotMatch(formatOneLineFooter(sample, 32, theme), /my-project/);
});

test("unknown context, absent Git and zero cost remain clean", () => {
	const text = formatOneLineFooter({ model: "local", contextPercent: null, cost: 0 }, 80, theme);
	assert.match(text, /^ctx \?\s+local$/);
	assert.equal(visibleWidth(text), 80);
});
