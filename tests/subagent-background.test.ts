import assert from "node:assert/strict";
import test from "node:test";
import { registerTaskManager } from "../subagent/background.ts";
import type { RpcOptions, RpcProcess, RpcRecord } from "../subagent/rpc.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
	const handlers = new Map<string, Function[]>();
	const tools = new Map<string, any>();
	const renderers = new Map<string, any>();
	const messages: Array<{ message: any; options: any }> = [];
	const widgets: Array<string[] | undefined> = [];
	const children: Array<{
		options: RpcOptions;
		requests: RpcRecord[];
		stops: number;
		stopWait?: Promise<void>;
	}> = [];
	let idle = false;
	let session = "one";
	const ctx = {
		cwd: process.cwd(),
		mode: "rpc",
		hasUI: true,
		isIdle: () => idle,
		sessionManager: { getSessionId: () => session },
		ui: {
			theme: { fg: (_color: string, value: string) => value },
			setWidget: (_key: string, content: string[] | undefined) => widgets.push(content),
		},
	};
	const getManager = registerTaskManager(
		{
			on: (name: string, handler: Function) =>
				handlers.set(name, [...(handlers.get(name) ?? []), handler]),
			registerTool: (tool: any) => tools.set(tool.name, tool),
			registerMessageRenderer: (name: string, renderer: any) => renderers.set(name, renderer),
			sendMessage: (message: any, options: any) => messages.push({ message, options }),
			getActiveTools: () => ["subagent"],
			setActiveTools: () => {},
		} as any,
		(options) => {
			const child: (typeof children)[number] = { options, requests: [], stops: 0 };
			children.push(child);
			return {
				request: async (
					request: RpcRecord,
					_timeout: number,
					accepted?: (response: RpcRecord) => void,
				) => {
					child.requests.push(request);
					const response = { type: "response", success: true, data: { disposition: "started" } };
					accepted?.(response);
					return response;
				},
				stop: async () => {
					child.stops++;
					await child.stopWait;
				},
			} as unknown as RpcProcess;
		},
	);
	const manager = getManager(ctx as any);
	const start = () =>
		manager.start({
			agent: "reader",
			task: "read only",
			cwd: process.cwd(),
			launch: async () => ({ command: "pi", args: [], cleanup: () => {} }),
		});
	const report = (id: string, sequence: number, kind: string, message: string) =>
		children[0].options.onRecord({
			type: "entry_appended",
			entry: {
				type: "custom",
				customType: "subagent-progress",
				data: { taskId: id, sequence, kind, message },
			},
		});
	const final = (message: string, child = 0) => {
		children[child].options.onRecord({
			type: "message_end",
			message: {
				role: "assistant",
				stopReason: "stop",
				content: [{ type: "text", text: message }],
			},
		});
		children[child].options.onRecord({ type: "agent_settled" });
	};
	const fire = async (name: string, event: any = {}) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};
	const invoke = (params: any) =>
		tools.get("subagent_task").execute("call", params, undefined, undefined, ctx);
	return {
		manager,
		start,
		report,
		final,
		fire,
		invoke,
		messages,
		widgets,
		children,
		renderers,
		ctx,
		setIdle: (value: boolean) => {
			idle = value;
		},
		setSession: (value: string) => {
			session = value;
		},
	};
}

test("ordinary progress is passive context; sleeping the parent terminates only while work is active", async () => {
	const f = fixture();
	try {
		assert.equal((await f.invoke({ action: "sleep" })).terminate, undefined);
		const task = f.start();
		await tick();
		f.setIdle(true);
		f.report(task.id, 1, "progress", "Useful finding without a question");
		await tick();
		assert.equal(f.messages.length, 1);
		assert.equal(f.messages[0].options.triggerTurn, false);
		assert.match(f.messages[0].message.content, /Useful finding/);
		assert.equal((await f.invoke({ action: "sleep" })).terminate, true);
		f.report(task.id, 2, "decision", "Choose the output language");
		assert.equal((await f.invoke({ action: "sleep" })).terminate, true);
		await tick();
		assert.equal(
			f.messages[1].options.triggerTurn,
			true,
			"sleep does not consume pending actionable events",
		);
		await f.invoke({ action: "send", id: task.id, message: "Use Chinese" });
		f.final("Complete outcome");
		await f.manager.wait(task.id);
		const finished = await f.invoke({ action: "sleep" });
		assert.match(
			finished.content[0].text,
			/Complete outcome/,
			"a completion racing sleep is returned to the parent model",
		);
		assert.equal(
			finished.terminate,
			undefined,
			"no active work must return to the model for a final answer",
		);
	} finally {
		await f.fire("session_shutdown");
	}
});

test("background status survives the parent's settled turn and follows waiting, resume and completion", async () => {
	const f = fixture();
	try {
		const task = f.start();
		await tick();
		assert.match(f.widgets.at(-1)!.join("\n"), /Background reader running/);
		f.setIdle(true);
		await f.fire("agent_settled");
		await tick();
		assert.match(f.widgets.at(-1)!.join("\n"), /running/);
		assert.equal(f.messages.length, 0);
		f.report(task.id, 1, "decision", "Choose a language");
		await tick();
		assert.match(f.widgets.at(-1)!.join("\n"), /waiting for parent/);
		assert.equal(f.messages[0].options.triggerTurn, true);
		f.setIdle(false);
		await f.invoke({ action: "send", id: task.id, mode: "followUp", message: "Use Chinese" });
		assert.match(f.widgets.at(-1)!.join("\n"), /running/);
		f.final("Done\nThe actual two facts");
		await f.manager.wait(task.id);
		await tick();
		assert.equal(f.widgets.at(-1), undefined);
		assert.equal(f.messages.length, 1, "no model follow-up is queued while parent is busy");
		f.setIdle(true);
		await f.fire("agent_settled");
		await tick();
		assert.equal(f.messages[1].message.details.events[0].kind, "completed");
		assert.equal(f.messages[1].options.triggerTurn, true);
		assert.match(f.messages[1].message.content, /actual result/);
	} finally {
		await f.fire("session_shutdown");
	}
});

test("a busy parent receives the final result instead of obsolete progress and decisions; result body is visible collapsed", async () => {
	const f = fixture();
	try {
		const task = f.start();
		await tick();
		f.report(task.id, 1, "progress", "Inputs inspected");
		await tick();
		f.report(task.id, 2, "decision", "An old question");
		await tick();
		// Completion can follow a new progress report in the same child run.
		f.report(task.id, 3, "progress", "Question resolved by new evidence");
		f.final("Final title\nImportant final detail");
		await f.manager.wait(task.id);
		await tick();
		assert.equal(f.messages.length, 0);
		f.setIdle(true);
		await f.fire("agent_settled");
		await tick();
		assert.deepEqual(
			f.messages[0].message.details.events.map((event: any) => event.kind),
			["completed"],
		);
		const delivered = f.messages[0].message.details.events[0];
		assert.equal(delivered.task, task.task);
		assert.equal(delivered.status, "completed");
		assert.equal(delivered.elapsed_ms, f.manager.peek(task.id)!.elapsed_ms);
		assert.equal(delivered.result, "Final title\nImportant final detail");
		assert.doesNotMatch(f.messages[0].message.content, /An old question|Inputs inspected/);
		const renderer = f.renderers.get("subagent-events");
		const rendered = renderer(f.messages[0].message, { expanded: false }, f.ctx.ui.theme)
			.render(100)
			.join("\n");
		assert.match(rendered, /Important final detail/);
	} finally {
		await f.fire("session_shutdown");
	}
});

test("queried reports do not cause late wakeups; a queried terminal result remains visible without an extra model turn", async () => {
	const f = fixture();
	try {
		const task = f.start();
		await tick();
		f.report(task.id, 1, "progress", "Read finished");
		await f.invoke({ action: "get", id: task.id });
		f.report(task.id, 2, "decision", "Choose Chinese");
		await f.invoke({ action: "send", id: task.id, message: "Use Chinese" });
		f.setIdle(true);
		await f.fire("agent_settled");
		await tick();
		assert.equal(f.messages.length, 0);
		f.setIdle(false);
		f.final("Result\nBoth verified facts");
		const result = await f.invoke({ action: "wait", id: task.id });
		assert.equal(result.details.tasks[0].status, "completed");
		f.setIdle(true);
		await f.fire("agent_settled");
		await tick();
		assert.equal(f.messages.length, 1);
		assert.equal(f.messages[0].message.display, true);
		assert.equal(f.messages[0].options.triggerTurn, false);
		await f.fire("agent_settled");
		await tick();
		assert.equal(f.messages.length, 1, "no empty acknowledgement turn or duplicate notification");
	} finally {
		await f.fire("session_shutdown");
	}
});

test("a final result queried during process cleanup is not delivered as a second model wakeup", async () => {
	const f = fixture();
	let release!: () => void;
	try {
		const task = f.start();
		await tick();
		f.children[0].stopWait = new Promise<void>((resolve) => {
			release = resolve;
		});
		f.final("Verified result");
		await tick();
		const result = await f.invoke({ action: "get", id: task.id });
		assert.equal(result.details.tasks[0].status, "completed");
		f.setIdle(true);
		await f.fire("agent_settled");
		await tick();
		assert.equal(f.messages.length, 0, "cleanup is still in progress");
		release();
		await f.manager.wait(task.id);
		await tick();
		assert.equal(f.messages.length, 1);
		assert.equal(f.messages[0].options.triggerTurn, false);
	} finally {
		release?.();
		await f.fire("session_shutdown");
	}
});

test("cleanup failure after a queried success still wakes the parent with the actual failure", async () => {
	const f = fixture();
	let reject!: (error: Error) => void;
	try {
		const task = f.start();
		await tick();
		f.children[0].stopWait = new Promise<void>((_resolve, rejectPromise) => {
			reject = rejectPromise;
		});
		f.final("Provisional result");
		await tick();
		await f.invoke({ action: "get", id: task.id });
		f.setIdle(true);
		reject(new Error("cleanup fixture failure"));
		await f.manager.wait(task.id);
		await tick();
		assert.equal(f.messages[0].options.triggerTurn, true);
		assert.equal(f.messages[0].message.details.events[0].kind, "failed");
		assert.match(f.messages[0].message.content, /cleanup fixture failure/);
	} finally {
		await f.fire("session_shutdown");
	}
});

test("pending notifications stay bounded by retained tasks while a parent is continuously busy", async () => {
	const f = fixture();
	try {
		for (let i = 0; i < 35; i++) {
			const task = f.start();
			await tick();
			f.final(`RETAINED_RESULT_${i}_END`, i);
			await f.manager.wait(task.id);
			await tick();
		}
		assert.equal(f.messages.length, 0);
		f.setIdle(true);
		await f.fire("agent_settled");
		await tick();
		assert.equal(f.messages.length, 1);
		assert.equal(f.messages[0].message.details.events.length, 32);
		assert.doesNotMatch(f.messages[0].message.content, /RETAINED_RESULT_0_END/);
		assert.match(f.messages[0].message.content, /RETAINED_RESULT_34_END/);
	} finally {
		await f.fire("session_shutdown");
	}
});

test("session replacement clears the status and old queued events without restoring an old widget", async () => {
	const f = fixture();
	const task = f.start();
	await tick();
	f.report(task.id, 1, "decision", "Old session question");
	f.setSession("two");
	await f.fire("session_start");
	assert.equal(f.children[0].stops, 1);
	assert.equal(f.widgets.at(-1), undefined);
	f.setIdle(true);
	await f.fire("agent_settled");
	await tick();
	assert.equal(f.messages.length, 0);
	f.final("Late old result");
	await tick();
	assert.equal(f.widgets.at(-1), undefined);
	assert.equal(f.messages.length, 0);
	await f.fire("session_shutdown");
});
