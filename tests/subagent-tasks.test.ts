import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { TaskManager } from "../subagent/tasks.ts";
import type { RpcOptions, RpcProcess, RpcRecord } from "../subagent/rpc.ts";

function harness() {
	const children: Array<{ options: RpcOptions; requests: RpcRecord[]; stops: number }> = [];
	const notifications: any[] = [];
	const manager = new TaskManager(
		(task, event) => notifications.push({ task, event }),
		(options) => {
			const child = { options, requests: [] as RpcRecord[], stops: 0 };
			children.push(child);
			return {
				request: async (
					request: RpcRecord,
					_timeout?: number,
					accepted?: (response: RpcRecord) => void,
				) => {
					child.requests.push(request);
					const response = { type: "response", success: true, data: { disposition: "started" } };
					accepted?.(response);
					return response;
				},
				stop: async () => {
					child.stops++;
				},
			} as unknown as RpcProcess;
		},
	);
	let cleanups = 0;
	const start = () =>
		manager.start({
			agent: "worker",
			task: "inspect",
			cwd: process.cwd(),
			launch: async () => ({
				command: "pi",
				args: [],
				cleanup: () => {
					cleanups++;
				},
			}),
		});
	const report = (index: number, id: string, sequence: number, kind: string, message: string) =>
		children[index].options.onRecord({
			type: "entry_appended",
			entry: {
				type: "custom",
				customType: "subagent-progress",
				data: { taskId: id, sequence, kind, message },
			},
		});
	const final = (index: number, text: string, stopReason = "stop") => {
		children[index].options.onRecord({
			type: "message_end",
			message: { role: "assistant", stopReason, content: [{ type: "text", text }] },
		});
		children[index].options.onRecord({ type: "agent_settled" });
	};
	return { manager, children, notifications, start, report, final, cleanups: () => cleanups };
}

test("background dispatch returns before launch; reports are semantic, deduplicated and isolated", async () => {
	const h = harness();
	const a = h.start();
	const b = h.start();
	assert.equal(h.children.length, 0);
	assert.notEqual(a.id, b.id);
	await tick();
	h.children[0].options.onRecord({ type: "tool_execution_start" });
	h.children[0].options.onRecord({ type: "message_update" });
	assert.equal(h.notifications.length, 0);
	h.report(0, b.id, 1, "progress", "wrong task");
	h.report(0, a.id, 1, "progress", "stage complete");
	h.report(0, a.id, 1, "progress", "replayed");
	h.report(0, a.id, 2, "progress", "stage complete");
	assert.equal(h.notifications.length, 1);
	assert.equal(h.manager.get(b.id).latest_progress, undefined);
	h.final(0, "actual final");
	await h.manager.wait(a.id);
	assert.equal(h.manager.get(a.id).result, "actual final");
	assert.equal(h.children[0].stops, 1);
	await h.manager.dispose();
	assert.equal(h.cleanups(), 2);
});

test("decision keeps an idle child alive; both instruction queue modes use prompt streamingBehavior", async () => {
	const h = harness();
	const task = h.start();
	await tick();
	h.report(0, task.id, 1, "decision", "Choose storage");
	h.final(0, "Awaiting parent");
	assert.equal(h.manager.get(task.id).status, "blocked");
	assert.equal(h.children[0].stops, 0);
	await h.manager.send(task.id, "Use A", "followUp");
	await h.manager.send(task.id, "Keep scope small", "steer");
	assert.deepEqual(h.children[0].requests.slice(1), [
		{ type: "prompt", message: "Use A", streamingBehavior: "followUp" },
		{ type: "prompt", message: "Keep scope small", streamingBehavior: "steer" },
	]);
	// A repeated blocker after a parent instruction is a new state transition, not a replay.
	h.report(0, task.id, 2, "decision", "Choose storage");
	h.final(0, "Still awaiting parent");
	assert.equal(h.manager.get(task.id).status, "blocked");
	await h.manager.send(task.id, "Confirmed: A", "followUp");
	h.final(0, "done");
	await h.manager.wait(task.id);
	await assert.rejects(h.manager.send(task.id, "too late"), /completed/);
	await h.manager.dispose();
});

test("wait cancellation only aborts the wait; cancellation and abnormal exits remain truthful", async () => {
	const h = harness();
	const task = h.start();
	await tick();
	const controller = new AbortController();
	const waiting = h.manager.wait(task.id, undefined, 10000, controller.signal);
	controller.abort();
	await assert.rejects(waiting, /wait aborted/);
	assert.equal(h.manager.get(task.id).status, "running");
	await h.manager.cancel(task.id);
	assert.equal(h.manager.get(task.id).status, "cancelled");
	h.children[0].options.onExit(new Error("late error"));
	assert.equal(h.manager.get(task.id).status, "cancelled");
	const other = h.start();
	await tick();
	h.children[1].options.onExit(new Error("exit 23"));
	await h.manager.wait(other.id);
	assert.equal(h.manager.get(other.id).status, "failed");
	assert.match(h.manager.get(other.id).error!, /exit 23/);
	await h.manager.dispose();
});

test("report history and automatic notifications are bounded; concurrency and lifecycle clean up", async () => {
	const h = harness();
	const task = h.start();
	await tick();
	for (let i = 1; i <= 50; i++) h.report(0, task.id, i, "progress", `finding ${i}`);
	assert.equal(h.notifications.length, 20);
	assert.equal(h.manager.get(task.id).events.length, 16);
	assert.equal(h.manager.get(task.id).auto_reports_suppressed, 30);
	assert.equal(h.manager.get(task.id).latest_progress?.message, "finding 50");
	h.start();
	h.start();
	h.start();
	assert.throws(h.start, /At most 4/);
	await h.manager.dispose();
	assert.equal(h.cleanups(), 4);
	assert.equal(
		h.children.every((child) => child.stops === 1),
		true,
	);
	assert.throws(h.start, /closed/);
	assert.equal(h.manager.list().length, 0);
});

test("a settled event racing an instruction cannot complete the task before prompt acceptance", async () => {
	let options!: RpcOptions;
	let acknowledge!: () => void;
	let requests = 0;
	const manager = new TaskManager(
		() => {},
		(value) => {
			options = value;
			return {
				request: (
					_request: RpcRecord,
					_timeout?: number,
					accepted?: (response: RpcRecord) => void,
				) => {
					requests++;
					const response = { type: "response", success: true, data: { disposition: "started" } };
					if (requests === 1) return Promise.resolve(response);
					return new Promise((resolve) => {
						acknowledge = () => {
							accepted?.(response);
							resolve(response);
						};
					});
				},
				stop: async () => {},
			} as unknown as RpcProcess;
		},
	);
	const task = manager.start({
		agent: "worker",
		task: "work",
		cwd: process.cwd(),
		launch: async () => ({ command: "pi", args: [], cleanup: () => {} }),
	});
	await tick();
	const sending = manager.send(task.id, "one more constraint");
	await tick();
	options.onRecord({
		type: "message_end",
		message: {
			role: "assistant",
			stopReason: "stop",
			content: [{ type: "text", text: "old turn" }],
		},
	});
	options.onRecord({ type: "agent_settled" });
	assert.equal(manager.get(task.id).status, "running");
	acknowledge();
	await sending;
	assert.equal(manager.get(task.id).status, "running");
	options.onRecord({
		type: "message_end",
		message: {
			role: "assistant",
			stopReason: "stop",
			content: [{ type: "text", text: "new turn with constraint" }],
		},
	});
	options.onRecord({ type: "agent_settled" });
	await manager.wait(task.id);
	assert.equal(manager.get(task.id).result, "new turn with constraint");
	await manager.dispose();
});

test("cancel before asynchronous prompt preparation does not leak a process or temporary files", async () => {
	const h = harness();
	const task = h.start();
	await h.manager.cancel(task.id);
	assert.equal(h.children.length, 0);
	assert.equal(h.cleanups(), 1);
	await h.manager.dispose();
});
