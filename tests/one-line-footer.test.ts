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
};

test("wide footer separates project and usage with thinking and model grouped at the right edge", () => {
	const line = formatOneLineFooter(sample, 120, theme);
	assert.match(line, /^my-project \| main\s{2,}42%\/200k \| \$0\.23 \| high · gpt-6$/);
	assert.equal(visibleWidth(line), 120);
	assert.match(line, /gpt-6/);
	assert.match(line, /42%/);
	assert.doesNotMatch(line, /ctx|high \|/);
	assert.match(line, /\$0\.23/);
	assert.match(line, /my-project/);
	assert.match(line, /main/);
	assert.doesNotMatch(line, /[█░󰆼]/);
});

test("narrow footer shortens project details before usage and keeps model right-aligned", () => {
	for (const width of [0, 1, 4, 8, 20, 32, 48, 60]) {
		const line = formatOneLineFooter(sample, width, theme);
		assert.equal(visibleWidth(line), width, `width ${width}`);
		assert.equal(line.includes("\n"), false);
		if (width >= 5) assert.ok(line.endsWith("gpt-6"));
	}
	assert.match(formatOneLineFooter(sample, 20, theme), /42% \| high · gpt-6$/);
	assert.match(formatOneLineFooter(sample, 32, theme), /42% \| \$0\.23 \| high · gpt-6$/);
	assert.doesNotMatch(formatOneLineFooter(sample, 32, theme), /my-project/);
});

test("unknown context and absent usage default to a visible two-decimal zero cost", () => {
	for (const cost of [undefined, 0, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
		const text = formatOneLineFooter({ model: "local", contextPercent: null, cost }, 80, theme);
		assert.match(text, /^\s*\? \| \$0\.00 \| local$/);
		assert.equal(visibleWidth(text), 80);
	}
});

test("active Git operations survive identity shortening within the single-row width budget", () => {
	const active = {
		...sample,
		directory: "项目目录😀-very-long-project",
		gitOperation: "rebasing 2/5",
	};
	assert.match(formatOneLineFooter(active, 120, theme), /main \[rebasing 2\/5\]/);
	const narrow = formatOneLineFooter(active, 52, theme);
	assert.match(narrow, /\[rebasing 2\/5\]\s+42% \| \$0\.23 \| high · gpt-6$/);
	for (let width = 0; width <= 120; width++) {
		const text = formatOneLineFooter(active, width, theme);
		assert.equal(visibleWidth(text), width);
		assert.ok(!text.includes("\n"));
	}
});
