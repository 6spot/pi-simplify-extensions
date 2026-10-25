import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { test } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { createCcstyleTool } from "../extensions/renderer/tool/ccstyle-tool.ts";
import { WriteExecutionMetadataStore } from "../extensions/renderer/tool/diff/index.ts";
import { setToolTuiFullscreen } from "../extensions/renderer/tool/names.ts";
import { formatToolInputArgs, hasExpandableDetail } from "../extensions/renderer/tool/tool-io.ts";

const previousEligibility = (output: string, args: unknown) =>
	output
		.trim()
		.split("\n")
		.filter((line) => line.trim()).length > 1 || formatToolInputArgs(args).trim().length > 0;

test("expansion eligibility preserves empty, code, primitive and unserializable input boundaries", () => {
	const cycle: any = {};
	cycle.self = cycle;
	const arrayCycle: any[] = [];
	arrayCycle.push(arrayCycle);
	const customArray: any[] = [];
	Object.defineProperty(customArray, "toJSON", { value: () => undefined });
	const args: unknown[] = [
		undefined,
		null,
		"",
		" \t\n",
		"\x1b[31m\x1b[0m",
		" ".repeat(8001),
		0,
		false,
		1n,
		Symbol("input"),
		() => undefined,
		{},
		Object.create(null),
		Object.create({ inherited: "ignored" }),
		new Date(0),
		{ hidden: undefined },
		{ input: "" },
		{ input: null },
		{ input: 1n },
		{ input: cycle },
		{ input: () => undefined },
		{ input: Symbol("value") },
		{ code: "" },
		{ code: "\n" },
		{ code: " \n\t" },
		{ code: "\n", absent: undefined },
		{ code: "\n", input: "" },
		{ code: "\n\x1b[31m\x1b[0m" },
		{ code: "\n".repeat(2700) },
		{ code: "\t".repeat(3000) + "\n" },
		{ code: "\nconst value = 1;" },
		{ "\x1b[31mcode\x1b[0m": "\n" },
		{ constructor: "\n" },
		{ toString: "\n" },
		[],
		[undefined],
		[1n],
		arrayCycle,
		customArray,
		[cycle],
	];
	for (const [index, value] of args.entries()) {
		for (const output of ["", "one line", "\n one line \n\t", "one\n\n two"]) {
			assert.equal(
				hasExpandableDetail(output, value),
				previousEligibility(output, value),
				`case ${index}, output ${JSON.stringify(output)}`,
			);
		}
	}
});

test("object eligibility avoids nested serialization and preserves one top-level getter read", () => {
	let serialized = 0;
	const nested = Object.freeze({
		blob: "x".repeat(2 * 1024 * 1024),
		toJSON() {
			serialized++;
			throw new Error("nested serialization is unnecessary");
		},
	});
	const args = Object.freeze({ envelope: nested });
	assert.equal(hasExpandableDetail("done", args), true);
	assert.equal(serialized, 0);
	assert.equal(args.envelope, nested);
	let reads = 0;
	const code = Object.defineProperty({}, "code", {
		enumerable: true,
		get() {
			reads++;
			return "\n";
		},
	});
	assert.equal(hasExpandableDetail("", code), false);
	assert.equal(reads, 1, "the whitespace-code fallback must use the already read value");
	const throwing = Object.defineProperty({}, "value", {
		enumerable: true,
		get() {
			throw new Error("getter failed");
		},
	});
	assert.throws(() => hasExpandableDetail("", throwing), /getter failed/);
	assert.equal(
		hasExpandableDetail("first\nsecond", throwing),
		true,
		"output alone can make the card expandable without reading args",
	);
});

test("generic collapsed cards keep hints for meaningful Input and retain the expanded Input/Output view", () => {
	initTheme("dark");
	setToolTuiFullscreen(true);
	const theme = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
	const tool = createCcstyleTool(
		{ name: "vendor_probe" },
		new WriteExecutionMetadataStore(),
		"vendor_probe",
	);
	const result = { content: [{ type: "text", text: "done" }] };
	try {
		for (const [args, expected] of [
			[{}, false],
			[{ omitted: undefined }, false],
			[{ code: "\n" }, false],
			[{ input: "" }, true],
			[{ envelope: { value: "kept" } }, true],
		] as const) {
			const context = { args, result, isPartial: false, state: {}, toolCallId: "eligibility" };
			const collapsed = stripVTControlCharacters(
				[
					...tool.renderCall(args, theme, context).render(110),
					...tool
						.renderResult(result, { expanded: false, isPartial: false }, theme, context)
						.render(110),
				].join("\n"),
			);
			assert.equal(collapsed.includes("Expand"), expected);
		}
		const args = Object.freeze({ envelope: Object.freeze({ value: "ORIGINAL_INPUT_VALUE" }) });
		const context = { args, state: {}, toolCallId: "expanded-input" };
		const text = stripVTControlCharacters(
			tool
				.renderResult(result, { expanded: true, isPartial: false }, theme, context)
				.render(110)
				.join("\n"),
		);
		assert.match(text, /Input/);
		assert.match(text, /ORIGINAL_INPUT_VALUE/);
		assert.match(text, /Output/);
		assert.match(text, /done/);
		assert.equal(args.envelope.value, "ORIGINAL_INPUT_VALUE");
	} finally {
		setToolTuiFullscreen(undefined as any);
	}
});
