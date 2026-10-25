import assert from "node:assert/strict";
import test from "node:test";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { installDefaultMode } from "../extensions/renderer/default-mode.ts";
import { installToolGrouping, ToolGroupComponent } from "../extensions/renderer/tool/grouping.ts";
import { WriteExecutionMetadataStore } from "../extensions/renderer/tool/diff/index.ts";
import {
	askUserAnswerText,
	askUserCollapsedLines,
	askUserExpandedBody,
	askUserQuestionCount,
	createAskUserResultComponent,
} from "../extensions/renderer/tool/ask-user-question.ts";

initTheme("dark");
const theme = { fg: (_slot: string, text: string) => text } as any;
const strip = (value: string) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const questions = [
	{ question: "Which library should we use?", header: "Library" },
	{ question: "Which paths should the change cover?", header: "Scope" },
	{ question: "Which checks should run?", header: "Checks" },
];
const answered = {
	content: [{ type: "text", text: "User has answered your questions" }],
	details: {
		cancelled: false,
		answers: [
			{ questionIndex: 0, question: questions[0]!.question, kind: "option", answer: "Read" },
			{
				questionIndex: 1,
				question: questions[1]!.question,
				kind: "custom",
				answer: "src and tests",
				notes: "renderer only",
			},
			{
				questionIndex: 2,
				question: questions[2]!.question,
				kind: "multi",
				answer: null,
				selected: ["typecheck", "unit tests", "lint"],
			},
		],
		globalNote: "keep the diff small",
	},
};
const lines = (result: any, width = 120) =>
	askUserCollapsedLines({ result, theme, isError: false, width }).map(strip);

test("question counts and answer types use actual answers and preserve empty choices", () => {
	assert.equal(askUserQuestionCount(answered), 3);
	assert.equal(askUserQuestionCount(undefined, { questions }), 3);
	assert.equal(askUserQuestionCount({ details: { answers: [] } }), undefined);
	assert.equal(askUserAnswerText({ kind: "option", answer: "Read" }), "Read");
	assert.equal(
		askUserAnswerText({ kind: "multi", selected: ["typecheck", "lint"] }),
		"typecheck, lint",
	);
	for (const answer of [
		{ kind: "multi", selected: [] },
		{ kind: "custom", answer: "" },
		{ kind: "option", answer: null },
	])
		assert.equal(askUserAnswerText(answer), "(no answer)");
});

test("question preview discloses omitted answers and notes; expanded content remains intact", () => {
	const original = structuredClone(answered);
	const preview = lines(answered);
	assert.equal(preview.length, 5);
	assert.match(
		preview.join("\n"),
		/Which library[\s\S]*Selected · Read[\s\S]*More answer details hidden/,
	);
	assert.doesNotMatch(preview.join("\n"), /Expand|Collapse|typecheck, unit tests/);
	const expanded = askUserExpandedBody(answered);
	assert.match(expanded, /Which checks should run\?[\s\S]*typecheck, unit tests, lint/);
	assert.match(expanded, /notes: renderer only[\s\S]*Note: keep the diff small/);
	assert.deepEqual(answered, original);
});

test("answer order follows original question indexes and narrow previews remain bounded", () => {
	const reversed = { details: { answers: [...answered.details.answers].reverse() } };
	assert.equal(lines(reversed)[0], lines(answered)[0]);
	assert.match(lines(reversed)[2]!, /Which paths/);
	for (const width of [12, 40, 60]) {
		const preview = lines(answered, width);
		assert.ok(preview.length <= 5);
		assert.ok(preview.every((line) => visibleWidth(line) <= width));
		assert.ok(preview.at(-1)!.includes("…"));
	}
});

test("cancellation, missing answers and execution errors remain distinct", () => {
	assert.deepEqual(lines({ details: { answers: [], cancelled: true } }), [" Cancelled"]);
	assert.deepEqual(lines({ details: { answers: [] } }), [" No answer"]);
	const failed = askUserCollapsedLines({
		result: { content: [{ type: "text", text: "Invalid question schema" }] },
		theme,
		isError: true,
		width: 80,
	});
	assert.match(failed.join("\n"), /Invalid question schema/);
	assert.doesNotMatch(failed.join("\n"), /Done|Cancelled/);
});

test("question result disclosures are passive and never serve as a second expand control", () => {
	const component = createAskUserResultComponent({ result: answered, theme, isError: false });
	for (const line of component.render(120))
		assert.equal(component.isCollapsedHintLine(line), false);
});

function ui() {
	return { theme, requestRender() {}, setStatus() {} } as any;
}

test("native question card has one title control; waiting, selection and cancellation reflect actual state", () => {
	const hooks = installDefaultMode(new WriteExecutionMetadataStore());
	try {
		const tool = new ToolExecutionComponent(
			"ask_user_question",
			"ask-1",
			{ questions },
			{},
			undefined,
			ui(),
			process.cwd(),
		) as any;
		tool.markExecutionStarted();
		assert.match(tool.render(120).map(strip).join("\n"), /Question.*waiting/);
		tool.updateResult(answered);
		const preview = tool
			.render(120)
			.map(strip)
			.filter((line: string) => line.trim());
		assert.match(preview[0]!, /✓ Question · 3 questions.*(?:Expand|to show more)/);
		assert.match(preview.join("\n"), /Selected · Read/);
		assert.equal(preview.filter((line: string) => /Expand|to show more/.test(line)).length, 1);
		tool.updateResult({ content: [], details: { answers: [], cancelled: true }, isError: false });
		assert.match(tool.render(120).map(strip).join("\n"), /– Question.*cancelled[\s\S]*Cancelled/);
	} finally {
		hooks.shutdown();
	}
});

test("grouped questions keep compact actual selection summaries", () => {
	const hooks = installToolGrouping(() => true);
	try {
		const parent = new Container() as any;
		for (const id of ["ask-a", "ask-b"]) {
			const tool = new ToolExecutionComponent(
				"ask_user_question",
				id,
				{ questions },
				{},
				undefined,
				ui(),
				process.cwd(),
			) as any;
			tool.markExecutionStarted();
			tool.updateResult(answered);
			parent.addChild(tool);
		}
		const group = parent.children[0] as ToolGroupComponent;
		const preview = group.render(160).map(strip).filter(Boolean);
		assert.equal(preview.filter((line: string) => / -> Read \(\+2\)/.test(line)).length, 2);
	} finally {
		hooks.shutdown();
	}
});
