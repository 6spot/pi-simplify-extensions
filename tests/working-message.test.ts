import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import workingMessageExtension from "../extensions/feature/shell/working-message.ts";
import { setActiveBackgroundTasks } from "../extensions/utils/background-tasks.ts";

// Deterministic terminal width: the Working row fits itself to the terminal.
Object.defineProperty(process.stdout, "columns", { configurable: true, value: 80 });

function install() {
	const events = new Map<string, Function>();
	const messages: (string | undefined)[] = [];
	const ui = {
		setWorkingMessage(message?: string) {
			messages.push(message);
		},
	} as any;
	workingMessageExtension({
		on(name: string, handler: Function) {
			events.set(name, handler);
		},
	} as any);
	const ctx = { hasUI: true, ui };
	return { events, messages, ctx };
}

for (const { toolName, args, activity } of [
	{ toolName: "read", args: { path: "extensions/index.ts" }, activity: "Reading extensions/index.ts" },
	{ toolName: "edit", args: { file_path: "foo/file.ts" }, activity: "Editing foo/file.ts" },
	{ toolName: "write", args: { path: " x01f7\\file.ts " }, activity: "Writing x01f7\\file.ts" },
	{ toolName: "bash", args: { command: "  printf\t'next'\nexit\x00\x1f\x7f  " }, activity: "Running printf 'next' exit" },
	{ toolName: "custom\nnext", args: {}, activity: "Running custom next" },
]) {
	test(`working activity preserves text and cleans controls: ${JSON.stringify(toolName)}`, async () => {
		const { events, messages, ctx } = install();
		await events.get("turn_start")?.({}, ctx);
		try {
			await events.get("tool_execution_start")?.({ toolCallId: "regression", toolName, args }, ctx);
			assert.equal(messages.at(-1), `Working · ${activity}`);
		} finally {
			await events.get("turn_end")?.({}, ctx);
		}
	});
}

test("working message appends token count and elapsed time while streaming", async () => {
	const { events, messages, ctx } = install();

	await events.get("turn_start")?.({}, ctx);
	// No tokens yet and under the timer threshold: keep Pi's default "Working...".
	assert.equal(messages.at(-1), "Working · Processing");

	const delta = "This is a streaming response body long enough to count some tokens.";
	await events.get("message_update")?.(
		{ assistantMessageEvent: { type: "text_start", contentIndex: 0 } },
		ctx,
	);
	await events.get("message_update")?.(
		{ assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta } },
		ctx,
	);
	const working = messages.at(-1);
	assert.match(working ?? "", /^Working · Generating response · ↓ \d+ tokens · \d+s$/);

	await events.get("turn_end")?.({}, ctx);
	assert.equal(messages.at(-1), undefined, "turn end restores default without a completion line");
	assert.equal(
		messages.some((message) => message?.startsWith("✻ Turn took")),
		false,
	);

	// Shutdown remains idempotent (undefined = Pi's default message).
	await events.get("session_shutdown")?.({}, ctx);
	assert.equal(messages.at(-1), undefined);
});

test("token count accumulates across deltas and resets on the next turn", async () => {
	const { events, messages, ctx } = install();
	await events.get("turn_start")?.({}, ctx);

	await events.get("message_update")?.(
		{ assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "abcd" } },
		ctx,
	);
	const first = messages.at(-1) ?? "";
	assert.match(first, /↓ 1 tokens/);

	await events.get("message_update")?.(
		{ assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "abcd" } },
		ctx,
	);
	assert.match(messages.at(-1) ?? "", /↓ 2 tokens/);

	// text_end provides the full block; it must replace, not double-count, deltas.
	await events.get("message_update")?.(
		{
			assistantMessageEvent: {
				type: "text_end",
				contentIndex: 0,
				content: "abcdefgh",
				partial: {},
			},
		},
		ctx,
	);
	assert.match(messages.at(-1) ?? "", /↓ 2 tokens/);

	// A second text block accumulates independently by contentIndex.
	await events.get("message_update")?.(
		{ assistantMessageEvent: { type: "text_start", contentIndex: 1, partial: {} } },
		ctx,
	);
	await events.get("message_update")?.(
		{
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 1,
				delta: "abcdefgh",
				partial: {},
			},
		},
		ctx,
	);
	assert.match(messages.at(-1) ?? "", /↓ 4 tokens/);

	// Provider usage replaces the live estimate when available.
	await events.get("message_update")?.(
		{
			assistantMessageEvent: {
				type: "done",
				message: {
					content: [
						{ type: "text", text: "abcdefgh" },
						{ type: "text", text: "abcdefgh" },
					],
					usage: { output: 37 },
				},
			},
		},
		ctx,
	);
	assert.match(messages.at(-1) ?? "", /↓ 37 tokens/);

	// 同一条用户指令的下一段 turn 不清 token：工具后继续累计。
	await events.get("turn_end")?.({}, ctx);
	await events.get("turn_start")?.({}, ctx);
	assert.match(messages.at(-1) ?? "", /↓ 37 tokens/);
});

test("tool call argument deltas count toward the token total", async () => {
	const { events, messages, ctx } = install();
	await events.get("turn_start")?.({}, ctx);
	await events.get("message_update")?.(
		{ assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: {} } },
		ctx,
	);
	// 写文件这类工具的参数走 toolcall_delta。
	await events.get("message_update")?.(
		{
			assistantMessageEvent: {
				type: "toolcall_delta",
				contentIndex: 0,
				delta: '{"path":"a.txt"}',
				partial: {},
			},
		},
		ctx,
	);
	assert.match(messages.at(-1) ?? "", /↓ 4 tokens/);
	await events.get("turn_end")?.({}, ctx);
});

// Pi 的 ctx 失效后 getter 会抛错；定时器里逃逸的异常会直接终止 Pi 进程 (#41)。
test("refresh timer stops quietly once the captured ctx goes stale", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { events, messages } = install();
	let stale = false;
	let probes = 0;
	const ctx = {
		get hasUI() {
			probes++;
			if (stale)
				throw new Error("This extension ctx is stale after session replacement or reload.");
			return true;
		},
		get ui() {
			if (stale) throw new Error("stale");
			return { setWorkingMessage: (message?: string) => messages.push(message) };
		},
	};

	await events.get("turn_start")?.({}, ctx);
	stale = true;
	assert.doesNotThrow(() => t.mock.timers.tick(1_000));
	const probesAfterStale = probes;
	t.mock.timers.tick(5_000);
	assert.equal(probes, probesAfterStale, "loop must stop after the stale probe");

	// 失效窗口内到达的事件也不应抛错或重新拉起循环。
	await events.get("message_update")?.(
		{ assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "abcd" } },
		ctx,
	);
	await events.get("turn_start")?.({}, ctx);
	await events.get("session_shutdown")?.({}, ctx);
});

test("working row reports active background tasks", async () => {
	const { events, messages, ctx } = install();
	setActiveBackgroundTasks([{ status: "running" }, { status: "running" }, { status: "blocked" }]);
	try {
		await events.get("turn_start")?.({}, ctx);
		assert.match(messages.at(-1) ?? "", / · 2 background · 1 waiting$/);

		setActiveBackgroundTasks([{ status: "blocked" }]);
		await events.get("tool_execution_end")?.({ toolCallId: "none", toolName: "read" }, ctx);
		assert.match(messages.at(-1) ?? "", / · 1 waiting$/);
	} finally {
		setActiveBackgroundTasks([]);
		await events.get("turn_end")?.({}, ctx);
	}
});

test("working row truncates a long command instead of wrapping", async () => {
	const { events, messages, ctx } = install();
	const command =
		"cd /Users/me/IdeaProjects/knit && npm test > /tmp/knit-b9ea-npm-test-no-build.log && echo done";
	try {
		await events.get("turn_start")?.({}, ctx);
		await events.get("tool_execution_start")?.(
			{ toolCallId: "long", toolName: "bash", args: { command } },
			ctx,
		);
		const message = messages.at(-1) ?? "";
		assert.equal(visibleWidth(message), 76, "fills the row without wrapping");
		assert.match(message, /^Working · Running cd \/Users\/me\/IdeaProjects\/knit/);
		assert.ok(message.endsWith("…"), "marker for the hidden command text");
		await events.get("tool_execution_end")?.({ toolCallId: "long", toolName: "bash" }, ctx);
	} finally {
		await events.get("turn_end")?.({}, ctx);
	}
});

test("working row truncates the activity but keeps the token and time suffix", async () => {
	const { events, messages, ctx } = install();
	try {
		await events.get("turn_start")?.({}, ctx);
		await events.get("tool_execution_start")?.(
			{ toolCallId: "long", toolName: "bash", args: { command: "x".repeat(200) } },
			ctx,
		);
		await events.get("message_update")?.(
			{ assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "abcd" } },
			ctx,
		);
		const message = messages.at(-1) ?? "";
		assert.match(message, /… · ↓ \d+ tokens · \d+s$/);
		assert.ok(visibleWidth(message) <= 76, `one line: ${visibleWidth(message)} columns`);
	} finally {
		await events.get("turn_end")?.({}, ctx);
	}
});

test("shows the current tool and removes it after execution", async () => {
	const { events, messages, ctx } = install();
	await events.get("turn_start")?.({}, ctx);
	await events.get("tool_execution_start")?.(
		{ toolCallId: "a", toolName: "read", args: { path: "src/app.ts" } }, ctx,
	);
	assert.match(messages.at(-1) ?? "", /Working · Reading src\/app\.ts/);
	await events.get("tool_execution_end")?.({ toolCallId: "a", toolName: "read" }, ctx);
	assert.doesNotMatch(messages.at(-1) ?? "", /Reading src\/app\.ts/);
	await events.get("turn_end")?.({}, ctx);
});
