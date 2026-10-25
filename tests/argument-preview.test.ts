import assert from "node:assert/strict";
import test from "node:test";
import { toolCallSummary } from "../extensions/renderer/tool/names.ts";
import { argumentPreview } from "../extensions/utils/argument-preview.ts";

test("small JSON arguments retain their original representation and shared references", () => {
	const shared = Object.freeze({ label: "中文 😀", enabled: true });
	const args = Object.freeze({
		first: shared,
		second: shared,
		values: Object.freeze([null, undefined, false, 0, Number.NaN, Number.POSITIVE_INFINITY]),
		omitted: undefined,
	});
	assert.equal(argumentPreview(args), JSON.stringify(args));
	assert.equal(
		argumentPreview(JSON.parse('{"__proto__":{"safe":true}}')),
		'{"__proto__":{"safe":true}}',
	);
	assert.equal(argumentPreview({}), "{}");
	assert.equal(argumentPreview(undefined), "");
	assert.equal(argumentPreview({ value: 1n }), "");
});

test("large, deep and cyclic arguments yield bounded, marked previews", () => {
	const args = { envelope: { blob: "😀".repeat(1024 * 1024), tail: "ORIGINAL_END" } };
	const before = args.envelope.blob;
	let nested: unknown = { leaf: "end" };
	for (let index = 0; index < 10000; index++) nested = { nested };
	const cycle: { label: string; self?: unknown } = { label: "start" };
	cycle.self = cycle;
	for (const value of [args, nested, cycle, { ["key".repeat(10000)]: true }]) {
		const preview = argumentPreview(value);
		assert.ok(preview.endsWith("…"));
		assert.ok(preview.length <= 4096);
		assert.doesNotMatch(
			preview,
			/[\uD800-\uDFFF]/u,
			"truncation must preserve Unicode surrogate pairs",
		);
	}
	assert.equal(args.envelope.blob, before);
	assert.equal(args.envelope.tail, "ORIGINAL_END");
	assert.equal(cycle.self, cycle);
});

test("entry budget limits array inspection and preview serialization invokes no accessors or toJSON", () => {
	let inspected = 0;
	const large = new Proxy(new Array(1000000).fill(1), {
		getOwnPropertyDescriptor(target, property) {
			inspected++;
			return Reflect.getOwnPropertyDescriptor(target, property);
		},
	});
	assert.ok(argumentPreview(large).endsWith("…"));
	assert.equal(inspected, 256);
	let invoked = 0;
	const accessor = {
		label: "visible",
		get danger() {
			invoked++;
			throw new Error("must not execute a display accessor");
		},
	};
	assert.equal(argumentPreview(accessor), '{"label":"visible"}…');
	assert.equal(
		argumentPreview({
			label: "visible",
			toJSON() {
				invoked++;
				throw new Error("must not execute toJSON");
			},
		}),
		'{"label":"visible"}',
	);
	assert.equal(invoked, 0);
});

test("standalone, grouped and MCP summaries bound large fallback arguments without changing execution inputs", () => {
	const small = { envelope: { limit: 10, enabled: true } };
	const large = { envelope: { blob: "x".repeat(2 * 1024 * 1024) } };
	for (const variant of ["default", "grouping"] as const) {
		assert.equal(
			toolCallSummary("vendor_probe", small, { variant }).payload,
			JSON.stringify(small),
		);
		const summary = toolCallSummary("vendor_probe", large, { variant });
		assert.ok(summary.payload);
		assert.ok(summary.payload.endsWith("…"));
		assert.ok(summary.payload.length <= 4096);
		const gateway = toolCallSummary("mcp", { tool: "vendor_probe", args: large }, { variant });
		assert.ok(gateway.payload);
		assert.ok(gateway.payload.endsWith("…"));
		assert.ok(gateway.payload.length <= 4096 + "call vendor_probe ".length);
		assert.equal(toolCallSummary("vendor_probe", {}, { variant }).payload, undefined);
	}
	assert.equal(large.envelope.blob.length, 2 * 1024 * 1024);
});
