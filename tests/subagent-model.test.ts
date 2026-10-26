import assert from "node:assert/strict";
import test from "node:test";

import { resolveAgentModel, resolveAgentModelOrParent } from "../subagent/model.ts";

const models = [
	{ provider: "anthropic", id: "claude-sonnet-4-5" },
	{ provider: "opencode", id: "claude-sonnet-4-5" },
	{ provider: "magpie", id: "group/openai" },
	{ provider: "magpie", id: "group/openai" },
];

test("a bare model id served by several providers reports the real ambiguity", () => {
	const result = resolveAgentModel("claude-sonnet-4-5", models);
	assert.equal(result.reference, undefined);
	assert.match(result.error ?? "", /ambiguous across providers/);
	assert.match(result.error ?? "", /anthropic\/claude-sonnet-4-5/);
	assert.match(result.error ?? "", /opencode\/claude-sonnet-4-5/);
	assert.match(result.error ?? "", /provider\/model/);
});

test("a canonical provider/model resolves without guessing", () => {
	assert.deepEqual(resolveAgentModel("opencode/claude-sonnet-4-5", models), {
		reference: "opencode/claude-sonnet-4-5",
	});
});

test("a bare id served by one provider becomes canonical", () => {
	const single = models.filter((model) => model.provider === "magpie");
	assert.deepEqual(resolveAgentModel("group/openai", single), {
		reference: "magpie/group/openai",
	});
});

test("an inherited model reference is passed through unchanged when unambiguous", () => {
	assert.deepEqual(resolveAgentModel("magpie/group/openai", models), {
		reference: "magpie/group/openai",
	});
});

test("an unavailable model fails with the actual available list", () => {
	const result = resolveAgentModel("missing/model", models);
	assert.equal(result.reference, undefined);
	assert.match(result.error ?? "", /not available in this session/);
	assert.match(result.error ?? "", /magpie\/group\/openai/);
});

test("no requested model stays unspecified so the child inherits its own default", () => {
	assert.deepEqual(resolveAgentModel(undefined, models), {});
	assert.deepEqual(resolveAgentModel("   ", models), {});
});

test("an unusable agent model falls back to the parent model and reports the substitution", () => {
	const result = resolveAgentModelOrParent("claude-sonnet-4-5", models, "magpie/group/openai");
	assert.deepEqual(result, {
		reference: "magpie/group/openai",
		fallbackFrom: "claude-sonnet-4-5",
		error: result.error,
	});
	assert.match(result.error ?? "", /ambiguous across providers/);
});

test("no parent model means the original error stands instead of an unusable child", () => {
	const result = resolveAgentModelOrParent("claude-sonnet-4-5", models, undefined);
	assert.equal(result.reference, undefined);
	assert.equal(result.fallbackFrom, undefined);
	assert.match(result.error ?? "", /ambiguous across providers/);
});
