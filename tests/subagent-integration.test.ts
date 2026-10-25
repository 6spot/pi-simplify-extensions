import assert from "node:assert/strict";
import { createServer } from "node:http";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { RpcProcess, type RpcRecord } from "../subagent/rpc.ts";

// Real Pi CLI, RPC, extension discovery, model serialization and child processes.
// The HTTP model is deterministic and local; this is not a live-provider/model-quality test.
const cli =
	process.env.PI_SUBAGENT_TEST_CLI ??
	fileURLToPath(new URL("./cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
const runtimeVersion = JSON.parse(
	await fs.readFile(path.resolve(path.dirname(cli), "../package.json"), "utf8"),
).version as string;
const [major, minor] = runtimeVersion.split(".").map(Number);
const skip =
	major === 1 && minor < 4
		? "Requires Pi >=1.4; set PI_SUBAGENT_TEST_CLI to its dist/cli.js"
		: false;
const extension = fileURLToPath(new URL("../subagent", import.meta.url));
const textOf = (message: any): string =>
	typeof message?.content === "string"
		? message.content
		: (message?.content ?? []).map((part: any) => part.text ?? "").join("\n");
const toolResult = (messages: any[], name: string) => {
	for (const message of messages) {
		if (message.role !== "tool") continue;
		const call = messages
			.flatMap((item: any) => item.tool_calls ?? [])
			.find((item: any) => item.id === message.tool_call_id);
		if (call?.function.name !== name) continue;
		try {
			return JSON.parse(textOf(message));
		} catch {
			/* not a JSON result */
		}
	}
};
const tool = (name: string, args: unknown) => ({ name, args });
type Reply = string | ReturnType<typeof tool>[];

async function fixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-subagent-integration-"));
	const agentDir = path.join(root, "agent");
	const cwd = path.join(root, "project");
	const requests: any[] = [];
	const errors: Error[] = [];
	const choose = async (body: any): Promise<Reply> => {
		requests.push(body);
		const messages = body.messages;
		const all = JSON.stringify(messages);
		const fixtureMessage = messages.findLast(
			(message: any) => message.role === "user" && textOf(message).startsWith("FIXTURE_REQUEST:"),
		);
		if (fixtureMessage) {
			const data = JSON.parse(
				Buffer.from(textOf(fixtureMessage).slice("FIXTURE_REQUEST:".length), "base64").toString(),
			);
			const called = messages
				.flatMap((message: any) => message.tool_calls ?? [])
				.some(
					(call: any) =>
						call.function.name === "subagent_fixture" &&
						JSON.parse(call.function.arguments).tag === data.tag,
				);
			return called ? "FIXTURE_DONE" : [tool("subagent_fixture", data)];
		}
		if (all.includes("PARENT_SLEEP_TEST")) {
			const started = toolResult(messages, "subagent");
			if (!started)
				return [
					tool("subagent", {
						agent: "project-worker",
						task: "CHILD_SLEEP_TEST",
						background: true,
						agentScope: "project",
						confirmProjectAgents: false,
					}),
				];
			if (all.includes("SLEEP_FINAL_RESULT")) return "PARENT_SLEEP_FINAL_SUMMARY";
			if (all.includes("RESUME_SLEEP_TEST")) {
				const sent = messages
					.flatMap((message: any) => message.tool_calls ?? [])
					.some(
						(call: any) =>
							call.function.name === "subagent_task" &&
							JSON.parse(call.function.arguments).action === "send",
					);
				return sent
					? "PARENT_SLEEP_RESUMED"
					: [
							tool("subagent_task", {
								action: "send",
								id: started.id,
								message: "SLEEP_ANSWER_TOKEN",
								mode: "followUp",
							}),
						];
			}
			if (all.includes("SLEEP_DECISION")) return "PARENT_SLEEP_WAITING_FOR_USER";
			return [tool("subagent_task", { action: "sleep" })];
		}
		if (all.includes("PARENT_ASYNC_TEST")) {
			const started = toolResult(messages, "subagent");
			if (!started)
				return [
					tool("subagent", {
						agent: "project-worker",
						task: "CHILD_ASYNC_TEST",
						background: true,
						agentScope: "project",
						confirmProjectAgents: false,
					}),
				];
			const id = started.id;
			const calls = messages
				.flatMap((message: any) => message.tool_calls ?? [])
				.map((call: any) => ({
					name: call.function.name,
					args: JSON.parse(call.function.arguments),
				}));
			const hasCall = (action: string, text?: string) =>
				calls.some(
					(call: any) =>
						call.name === "subagent_task" &&
						call.args.action === action &&
						(!text || call.args.message === text),
				);
			if (!hasCall("send", "ADDITIONAL_STEER_TOKEN")) {
				// Parent has independent work; wait in the fixture server for the child tool batch,
				// then send while bash is busy. Passive progress must not be needed to wake it.
				const deadline = Date.now() + 10000;
				while (
					!requests.some(
						(request) =>
							!JSON.stringify(request.messages).includes("PARENT_ASYNC_TEST") &&
							JSON.stringify(request.messages).includes("CHILD_ASYNC_TEST"),
					) &&
					Date.now() < deadline
				)
					await delay(20);
				await delay(250);
				return [
					tool("subagent_task", {
						action: "send",
						id,
						message: "ADDITIONAL_STEER_TOKEN",
						mode: "steer",
					}),
				];
			}
			if (all.includes("CHILD_DECISION_TOKEN") && !hasCall("get")) {
				await delay(200); // Let the child settle blocked, proving idle resume as well as busy steering.
				return [tool("subagent_task", { action: "get", id })];
			}
			if (
				messages.some(
					(message: any) =>
						message.role === "tool" && textOf(message).includes('"status": "blocked"'),
				) &&
				!hasCall("send", "DECISION_A_TOKEN")
			)
				return [
					tool("subagent_task", {
						action: "send",
						id,
						message: "DECISION_A_TOKEN",
						mode: "followUp",
					}),
				];
			if (all.includes("FINAL_RESULT_TOKEN")) return "PARENT_RECEIVED_FINAL_TOKEN";
			return "PARENT_AVAILABLE_TOKEN";
		}
		if (all.includes("CHILD_ASYNC_TEST")) {
			assert.ok(
				all.includes("PROJECT_AGENT_CONTEXT_TOKEN"),
				"project agent system prompt reaches child model",
			);
			assert.ok(
				all.includes("TRELLIS_INJECTION_TOKEN"),
				"tool_call context injection reaches child unchanged",
			);
			const tools = (body.tools ?? []).map((item: any) => item.function?.name);
			assert.ok(tools.includes("subagent_report"));
			assert.ok(!tools.includes("subagent") && !tools.includes("subagent_task"));
			if (all.includes("DECISION_A_TOKEN"))
				return "FINAL_RESULT_TOKEN: stage complete; ADDITIONAL_STEER_TOKEN and DECISION_A_TOKEN applied.";
			if (all.includes("CHILD_DECISION_TOKEN")) return "Waiting for the parent decision.";
			if (all.includes("ADDITIONAL_STEER_TOKEN"))
				return [
					tool("subagent_report", {
						kind: "decision",
						message: "CHILD_DECISION_TOKEN: choose A to finish.",
					}),
				];
			if (!all.includes("CHILD_PHASE_1"))
				return [
					tool("subagent_report", {
						kind: "progress",
						message: "CHILD_PHASE_1: inspected inputs; parent may add constraints.",
					}),
					tool("bash", { command: "sleep 1.2" }),
				];
			return [
				tool("subagent_report", {
					kind: "blocked",
					message: "Waiting for supplementary instruction.",
				}),
			];
		}
		if (all.includes("CHILD_SLEEP_TEST")) {
			if (all.includes("SLEEP_ANSWER_TOKEN"))
				return "SLEEP_FINAL_RESULT: the parent answer was applied.";
			if (all.includes("SLEEP_DECISION"))
				throw new Error("blocked child made a model request before explicit resume");
			if (all.includes("SLEEP_PROGRESS"))
				return [
					tool("subagent_report", {
						kind: "decision",
						message: "SLEEP_DECISION: an explicit answer is required.",
					}),
				];
			return [
				tool("subagent_report", { kind: "progress", message: "SLEEP_PROGRESS: inputs inspected." }),
				tool("bash", { command: "sleep 2" }),
			];
		}
		if (all.includes("CHILD_WAIT_TEST")) {
			if (!all.includes("WAITING_REPORT_TOKEN"))
				return [
					tool("subagent_report", {
						kind: "blocked",
						message: "WAITING_REPORT_TOKEN: explicit parent decision required.",
					}),
				];
			return "Awaiting parent.";
		}
		if (all.includes("CHILD_CRASH_TEST")) return [tool("bash", { command: "kill -KILL $PPID" })];
		if (all.includes("CHILD_TOOL_CANCEL_TEST"))
			return [
				tool("bash", { command: `echo $$ > '${path.join(root, "descendant.pid")}'; sleep 30` }),
			];
		if (all.includes("SYNC_TWO")) return "SYNC_TWO_RESULT";
		if (all.includes("SYNC_ONE")) return "SYNC_ONE_RESULT";
		return "DEFAULT_RESULT";
	};
	const server = createServer(async (req, res) => {
		try {
			let raw = "";
			for await (const chunk of req) raw += chunk;
			const body = JSON.parse(raw);
			const reply = await choose(body);
			res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
			const delta =
				typeof reply === "string"
					? { role: "assistant", content: reply }
					: {
							role: "assistant",
							tool_calls: reply.map((call, index) => ({
								index,
								id: `call-${requests.length}-${index}`,
								type: "function",
								function: { name: call.name, arguments: JSON.stringify(call.args) },
							})),
						};
			const chunk = (delta: any, finish_reason: string | null) => ({
				id: "test-completion",
				object: "chat.completion.chunk",
				created: 1,
				model: "deterministic",
				choices: [{ index: 0, delta, finish_reason }],
			});
			res.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`);
			res.write(
				`data: ${JSON.stringify(chunk({}, typeof reply === "string" ? "stop" : "tool_calls"))}\n\n`,
			);
			res.end("data: [DONE]\n\n");
		} catch (error) {
			errors.push(error as Error);
			res.writeHead(500);
			res.end(String(error));
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	await fs.mkdir(path.join(agentDir, "extensions"), { recursive: true });
	await fs.mkdir(path.join(agentDir, "agents"), { recursive: true });
	await fs.mkdir(path.join(cwd, ".pi", "agents"), { recursive: true });
	await fs.symlink(extension, path.join(agentDir, "extensions", "subagent"), "dir");
	await fs.writeFile(
		path.join(agentDir, "settings.json"),
		JSON.stringify({
			defaultProvider: "subagent-test",
			defaultModel: "deterministic",
			defaultThinkingLevel: "off",
			defaultTools: ["read", "bash", "subagent", "subagent_fixture"],
			packages: [],
			enableExtensions: true,
		}),
	);
	await fs.writeFile(
		path.join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				"subagent-test": {
					baseUrl: `http://127.0.0.1:${port}/v1`,
					api: "openai-completions",
					apiKey: "local-test-key",
					models: [
						{
							id: "deterministic",
							name: "Deterministic local test",
							reasoning: false,
							input: ["text"],
							contextWindow: 128000,
							maxTokens: 4096,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						},
					],
				},
			},
		}),
	);
	const agent =
		"---\nname: worker\ndescription: Test worker\ntools: bash\n---\nUSER_AGENT_CONTEXT_TOKEN\n";
	await fs.writeFile(path.join(agentDir, "agents", "worker.md"), agent);
	await fs.writeFile(
		path.join(cwd, ".pi", "agents", "project-worker.md"),
		agent
			.replace("name: worker", "name: project-worker")
			.replace("USER_AGENT_CONTEXT_TOKEN", "PROJECT_AGENT_CONTEXT_TOKEN"),
	);
	await fs.writeFile(
		path.join(agentDir, "extensions", "fixture.ts"),
		`import { Type } from ${JSON.stringify(import.meta.resolve("typebox"))}; export default function(pi) {
		pi.on("tool_call", async (event) => { if(event.toolName === "subagent" && event.input.task) event.input.task += "\\nTRELLIS_INJECTION_TOKEN"; });
		pi.registerTool({ name: "subagent_fixture", label: "Fixture", description: "Integration fixture",
			parameters: Type.Object({ tag: Type.Number(), tool: Type.String(), params: Type.Any() }),
			execute: async (_id, data, signal, _update, ctx) => {
				const outcome = await ctx.executeTool(data.tool, data.params);
				const result = { ...outcome.result, isError: outcome.isError };
				pi.appendEntry("subagent-test-result", { tag: data.tag, result });
				return result;
			}
		});
		pi.registerCommand("fixture-reload", { description: "Reload fixture", handler: async (_args, ctx) => { await ctx.reload(); } });
	}`,
	);
	const records: RpcRecord[] = [];
	let exit: Error | undefined;
	const rpc = new RpcProcess({
		command: process.execPath,
		args: [cli, "--mode", "rpc", "--no-session", "--model", "subagent-test/deterministic"],
		cwd,
		env: { PI_CODING_AGENT_DIR: agentDir },
		onRecord: (record) => records.push(record),
		onExit: (error) => {
			exit = error;
		},
	});
	const until = async <T>(get: () => T | undefined | false, timeout = 20000): Promise<T> => {
		const end = Date.now() + timeout;
		while (Date.now() < end) {
			if (errors.length) throw errors[0];
			if (exit) throw exit;
			const result = get();
			if (result) return result;
			await delay(20);
		}
		throw new Error(
			`Timed out. Recent RPC: ${JSON.stringify(records.slice(-6)).slice(-5000)}; model requests: ${requests.length}`,
		);
	};
	let tag = 0;
	const invoke = async (params: unknown, tool = "subagent") => {
		const requestTag = ++tag;
		await rpc.request({
			type: "prompt",
			message: `FIXTURE_REQUEST:${Buffer.from(JSON.stringify({ tag: requestTag, tool, params })).toString("base64")}`,
			streamingBehavior: "followUp",
		});
		return until(
			() =>
				records.find(
					(record) =>
						record.type === "entry_appended" &&
						record.entry?.customType === "subagent-test-result" &&
						record.entry.data.tag === requestTag,
				)?.entry.data.result,
		);
	};
	return {
		rpc,
		records,
		requests,
		root,
		cwd,
		invoke,
		until,
		close: async () => {
			await rpc.stop();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await fs.rm(root, { recursive: true, force: true });
		},
	};
}

test("real Pi: background reports reach the parent model, busy steer and blocked followUp resume, final result arrives", {
	timeout: 45000,
	skip,
}, async () => {
	const f = await fixture();
	try {
		await f.rpc.request({
			type: "prompt",
			message: "PARENT_ASYNC_TEST: dispatch a background project agent and handle its reports.",
		});
		await f.until(
			() =>
				f.records.find(
					(record) =>
						record.type === "message_end" &&
						record.message?.role === "assistant" &&
						textOf(record.message).includes("PARENT_RECEIVED_FINAL_TOKEN"),
				),
			35000,
		);
		const firstSettled = f.records.findIndex((record) => record.type === "agent_settled");
		assert.ok(firstSettled >= 0);
		const widgetUpdates = f.records.filter(
			(record) =>
				record.type === "extension_ui_request" && record.widgetKey === "subagent-background-tasks",
		);
		const widgetAtParentIdle = f.records
			.slice(0, firstSettled + 1)
			.filter((record) => record.widgetKey === "subagent-background-tasks")
			.at(-1);
		assert.match(
			widgetAtParentIdle?.widgetLines?.join("\n") ?? "",
			/running/,
			"background task remains visibly running after the parent's turn ends",
		);
		assert.ok(
			widgetUpdates.some((record) =>
				record.widgetLines?.some((line: string) => line.includes("waiting for parent")),
			),
		);
		assert.equal(
			widgetUpdates.at(-1)?.widgetLines,
			undefined,
			"completion clears the persistent status",
		);
		const parent = f.requests.filter((request) =>
			JSON.stringify(request.messages).includes("PARENT_ASYNC_TEST"),
		);
		assert.ok(
			parent.some((request) => JSON.stringify(request.messages).includes("CHILD_PHASE_1")),
			"progress is in actual parent provider request",
		);
		assert.ok(
			parent.some((request) => JSON.stringify(request.messages).includes("CHILD_DECISION_TOKEN")),
			"decision request is in parent context",
		);
		assert.ok(
			parent.some((request) => JSON.stringify(request.messages).includes("FINAL_RESULT_TOKEN")),
			"final event is in parent context",
		);
		const children = f.requests.filter(
			(request) =>
				JSON.stringify(request.messages).includes("CHILD_ASYNC_TEST") &&
				!JSON.stringify(request.messages).includes("PARENT_ASYNC_TEST"),
		);
		assert.ok(
			children.some((request) =>
				request.messages.some(
					(message: any) =>
						message.role === "user" && textOf(message).includes("ADDITIONAL_STEER_TOKEN"),
				),
			),
		);
		assert.ok(
			children.some((request) =>
				request.messages.some(
					(message: any) => message.role === "user" && textOf(message).includes("DECISION_A_TOKEN"),
				),
			),
		);
		const results = f.records.filter(
			(record) => record.type === "tool_execution_end" && record.toolName === "subagent_task",
		);
		assert.ok(
			results.some((record) => textOf(record.result).includes('"status": "blocked"')),
			"query sees genuinely blocked child",
		);
		const dispatched = f.records.find(
			(record) => record.type === "tool_execution_end" && record.toolName === "subagent",
		);
		const started = JSON.parse(textOf(dispatched?.result));
		assert.equal(started.status, "running");
		assert.equal(started.latest_progress, undefined, "dispatch result precedes child work");
		const end = await f.invoke({ action: "get", id: started.id }, "subagent_task");
		assert.equal(end.details.tasks[0].status, "completed");
		assert.match(end.details.tasks[0].result, /ADDITIONAL_STEER_TOKEN.*DECISION_A_TOKEN/);
	} finally {
		await f.close();
	}
});

test("real Pi: sleep ends the parent run, progress stays passive, blocked child waits without model calls, explicit send resumes", {
	timeout: 45000,
	skip,
}, async () => {
	const f = await fixture();
	try {
		const parentRequests = () =>
			f.requests.filter((request) =>
				JSON.stringify(request.messages).includes("PARENT_SLEEP_TEST"),
			);
		const childRequests = () =>
			f.requests.filter(
				(request) =>
					JSON.stringify(request.messages).includes("CHILD_SLEEP_TEST") &&
					!JSON.stringify(request.messages).includes("PARENT_SLEEP_TEST"),
			);
		await f.rpc.request({
			type: "prompt",
			message: "PARENT_SLEEP_TEST: delegate, sleep, and wait for an actionable event.",
		});
		await f.until(() =>
			f.records.find(
				(record) =>
					record.type === "message_end" &&
					record.message?.customType === "subagent-events" &&
					textOf(record.message).includes("SLEEP_PROGRESS"),
			),
		);
		assert.equal(
			parentRequests().length,
			2,
			"sleep result does not cause an extra parent inference",
		);
		await delay(250);
		assert.equal(parentRequests().length, 2, "ordinary progress does not wake the parent");
		await f.until(() =>
			f.records.find(
				(record) =>
					record.type === "message_end" &&
					textOf(record.message).includes("PARENT_SLEEP_WAITING_FOR_USER"),
			),
		);
		await f.until(() => f.records.filter((record) => record.type === "agent_settled").length >= 2);
		assert.equal(parentRequests().length, 3, "decision wakes the parent exactly once");
		assert.equal(
			childRequests().length,
			2,
			"decision result does not request a child acknowledgement turn",
		);
		await delay(300);
		assert.equal(parentRequests().length, 3);
		assert.equal(childRequests().length, 2, "blocked child has no inference loop");
		await f.rpc.request({
			type: "prompt",
			message: "RESUME_SLEEP_TEST: apply the requested answer.",
		});
		await f.until(() =>
			f.records.find(
				(record) =>
					record.type === "message_end" &&
					textOf(record.message).includes("PARENT_SLEEP_FINAL_SUMMARY"),
			),
		);
		assert.equal(childRequests().length, 3, "explicit instruction resumes the same child once");
		assert.ok(
			parentRequests().some(
				(request) =>
					JSON.stringify(request.messages).includes("SLEEP_PROGRESS") &&
					JSON.stringify(request.messages).includes("SLEEP_DECISION"),
			),
			"passive findings are present when a decision wakes the parent",
		);
	} finally {
		await f.close();
	}
});

test("real Pi: sync single, parallel, chain, agent discovery and noninteractive original authorization behavior", {
	timeout: 45000,
	skip,
}, async () => {
	const f = await fixture();
	try {
		const single = await f.invoke({ agent: "worker", task: "SYNC_ONE" });
		assert.match(textOf(single), /SYNC_ONE_RESULT/);
		const parallel = await f.invoke({
			tasks: [
				{ agent: "worker", task: "SYNC_ONE" },
				{ agent: "worker", task: "SYNC_TWO" },
			],
		});
		assert.equal(parallel.details.results.length, 2);
		assert.match(textOf(parallel), /SYNC_ONE_RESULT/);
		assert.match(textOf(parallel), /SYNC_TWO_RESULT/);
		const chain = await f.invoke({
			chain: [
				{ agent: "worker", task: "SYNC_ONE" },
				{ agent: "worker", task: "SYNC_TWO previous={previous}" },
			],
		});
		assert.equal(chain.details.results.length, 2);
		assert.match(chain.details.results[1].task, /previous=SYNC_ONE_RESULT/);
		for (const value of [single, parallel, chain]) {
			for (const child of value.details.results) {
				assert.equal(child.status, "completed");
				assert.ok(Number.isFinite(child.elapsed_ms) && child.elapsed_ms > 0);
			}
		}
		const project = await f.invoke({
			agent: "project-worker",
			task: "SYNC_TWO",
			agentScope: "project",
			confirmProjectAgents: false,
		});
		assert.equal(project.details.results[0].agentSource, "project");
		const unknown = await f.invoke({ agent: "project-worker", task: "SYNC_TWO" });
		assert.match(textOf(unknown), /Unknown agent/);
		assert.equal(unknown.details.results[0].status, "failed");
		assert.equal(unknown.details.results[0].elapsed_ms, undefined);
		const invalid = await f.invoke({
			background: true,
			tasks: [{ agent: "worker", task: "SYNC_ONE" }],
		});
		assert.equal(invalid.isError, true);
	} finally {
		await f.close();
	}
});

test("real Pi: parallel task isolation, crash, descendant cancellation and reload clean up", {
	timeout: 45000,
	skip,
}, async () => {
	const f = await fixture();
	try {
		const a = JSON.parse(
			textOf(await f.invoke({ agent: "worker", task: "CHILD_WAIT_TEST_A", background: true })),
		);
		const b = JSON.parse(
			textOf(await f.invoke({ agent: "worker", task: "CHILD_WAIT_TEST_B", background: true })),
		);
		assert.notEqual(a.id, b.id);
		await f.until(
			() =>
				f.records.filter(
					(record) =>
						record.type === "message_end" &&
						record.message?.customType === "subagent-events" &&
						textOf(record.message).includes("WAITING_REPORT_TOKEN"),
				).length >= 2,
		);
		for (const id of [a.id, b.id]) {
			const got = await f.invoke({ action: "get", id }, "subagent_task");
			assert.equal(got.details.tasks[0].id, id);
			assert.equal(got.details.tasks[0].status, "blocked");
		}
		await f.invoke({ action: "cancel", id: a.id }, "subagent_task");
		const stillBlocked = await f.invoke({ action: "get", id: b.id }, "subagent_task");
		assert.equal(stillBlocked.details.tasks[0].status, "blocked");
		const crash = JSON.parse(
			textOf(await f.invoke({ agent: "worker", task: "CHILD_CRASH_TEST", background: true })),
		);
		await f.until(() =>
			f.records.find(
				(record) =>
					record.type === "message_end" &&
					record.message?.customType === "subagent-events" &&
					textOf(record.message).includes(`[${crash.id}]`) &&
					textOf(record.message).includes("failed"),
			),
		);
		const failed = await f.invoke({ action: "get", id: crash.id }, "subagent_task");
		assert.equal(failed.details.tasks[0].status, "failed");
		const cancel = JSON.parse(
			textOf(await f.invoke({ agent: "worker", task: "CHILD_TOOL_CANCEL_TEST", background: true })),
		);
		let descendantPid: number | undefined;
		const deadline = Date.now() + 15000;
		while (Date.now() < deadline && !descendantPid) {
			try {
				descendantPid = Number(await fs.readFile(path.join(f.root, "descendant.pid"), "utf8"));
			} catch {
				await delay(20);
			}
		}
		assert.ok(descendantPid, "child tool actually started before cancellation");
		await f.invoke({ action: "cancel", id: cancel.id }, "subagent_task");
		await delay(50);
		assert.throws(() => process.kill(descendantPid!, 0), /ESRCH/, "bash descendant was terminated");
		await f.rpc.request({ type: "prompt", message: "/fixture-reload" });
		const list = await f.invoke({ action: "list" }, "subagent_task");
		assert.equal(list.details.tasks.length, 0);
	} finally {
		await f.close();
	}
});
