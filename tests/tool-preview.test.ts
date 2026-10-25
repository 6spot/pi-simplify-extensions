import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as stripAnsi } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { boundedTextPreview } from "../extensions/renderer/tool/preview.ts";

const plainRows = (rows: string[]) => rows.map(stripAnsi);

test("bounded preview counts only complete visible source lines and paints only the sample", () => {
	const text = Array.from({ length: 177 }, (_, index) => `source ${index + 1}`).join("\n");
	let painted = "";
	const preview = boundedTextPreview(text, {
		width: 80,
		maxRows: 4,
		paint: (sample) => {
			painted = sample;
			return `\u001b[31m${sample}\u001b[0m`;
		},
	});
	assert.equal(painted, "source 1\nsource 2\nsource 3\nsource 4");
	assert.deepEqual(plainRows(preview.rows), painted.split("\n"));
	assert.equal(preview.omitted, true);
	assert.equal(preview.hiddenLines, 173);
});

test("bounded preview discloses both source and wrapped-row clipping without invented counts", () => {
	const preview = boundedTextPreview("中🙂".repeat(40) + "\nsecond\nthird\nfourth\nfifth", {
		width: 11,
		maxRows: 4,
	});
	assert.equal(preview.omitted, true);
	assert.equal(preview.hiddenLines, undefined);
	assert.equal(preview.rows.length, 4);
	assert.ok(preview.rows.every((line) => visibleWidth(line) <= 11));
	const oneLine = boundedTextPreview("x".repeat(200), { width: 10, maxRows: 4 });
	assert.equal(oneLine.omitted, true);
	assert.equal(oneLine.hiddenLines, undefined);
	assert.deepEqual(boundedTextPreview("one\ntwo", { width: 10, maxRows: 4 }), {
		rows: ["one", "two"],
		omitted: false,
	});
});

test("tail preview shows the last four source lines, and the last visible rows of a long line", () => {
	const preview = boundedTextPreview("one\ntwo\nthree\nfour\nfive\nsix", {
		width: 20,
		maxRows: 4,
		direction: "tail",
	});
	assert.deepEqual(preview.rows, ["three", "four", "five", "six"]);
	assert.equal(preview.hiddenLines, 2);
	const wrapped = boundedTextPreview("x".repeat(200) + "TAIL", {
		width: 10,
		maxRows: 4,
		direction: "tail",
	});
	assert.equal(wrapped.omitted, true);
	assert.equal(wrapped.hiddenLines, undefined);
	assert.equal(wrapped.rows.length, 4);
	assert.match(wrapped.rows.at(-1)!, /TAIL/);
});

test("source blank lines remain meaningful and zero budgets disclose nonempty input", () => {
	assert.deepEqual(boundedTextPreview("first\n\nthird\n", { width: 20, maxRows: 4 }), {
		rows: ["first", "", "third", ""],
		omitted: false,
	});
	assert.deepEqual(boundedTextPreview("first", { width: 0, maxRows: 0 }), {
		rows: [],
		omitted: true,
	});
	assert.deepEqual(boundedTextPreview("", { width: 0, maxRows: 4 }), {
		rows: [],
		omitted: false,
	});
});
