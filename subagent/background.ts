import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { TaskManager, type TaskEvent, type TaskSnapshot } from "./tasks.ts";
import { renderTaskNotices } from "./notices.ts";

import { createTaskView } from "./view.ts";
export { taskSummary } from "./view.ts";

/** No message handler relays parent responses back into children: only explicit child events wake the parent. */
export function registerTaskManager(
	pi: ExtensionAPI,
	createRpc?: ConstructorParameters<typeof TaskManager>[1],
): ((ctx: ExtensionContext) => TaskManager) & { peek: (id: string) => TaskSnapshot | undefined } {
	let manager: TaskManager | undefined;
	let owner: string | undefined;
	let delivery: NodeJS.Immediate | undefined;
	const widgetKey = "subagent-background-tasks";
	const pending = new Map<string, { task: TaskSnapshot; event: TaskEvent; wake: boolean }>();
	const observedFinal = new Map<string, Pick<TaskSnapshot, "status" | "result" | "error">>();
	const owns = (ctx: ExtensionContext) => owner === ctx.sessionManager.getSessionId();
	const terminal = (status: TaskSnapshot["status"]) => !["running", "blocked"].includes(status);
	const showTasks = (ctx: ExtensionContext) => {
		if (!owns(ctx)) return;
		const tasks = manager?.list() ?? [];
		const retained = new Set(tasks.map((task) => task.id));
		for (const [key, item] of pending) if (!retained.has(item.task.id)) pending.delete(key);
		for (const id of observedFinal.keys()) if (!retained.has(id)) observedFinal.delete(id);
		if (!ctx.hasUI) return;
		const active = tasks.filter((task) => !terminal(task.status));
		if (!active.length) {
			ctx.ui.setWidget(widgetKey, undefined);
			return;
		}
		const lines = (theme: Theme) =>
			active.map(
				(task) =>
					`${theme.fg("accent", "○")} Background ${theme.fg("toolTitle", task.agent)} ${theme.fg("dim", `${task.status === "blocked" ? "waiting for parent" : "running"} · ${task.id.slice(0, 8)}`)}`,
			);
		if (ctx.mode === "tui")
			ctx.ui.setWidget(widgetKey, (_tui, theme) => new Text(lines(theme).join("\n"), 0, 0), {
				placement: "aboveEditor",
			});
		else ctx.ui.setWidget(widgetKey, lines(ctx.ui.theme), { placement: "aboveEditor" });
	};
	const clearDelivery = () => {
		if (delivery) clearImmediate(delivery);
		delivery = undefined;
		pending.clear();
		observedFinal.clear();
	};
	const schedule = (ctx: ExtensionContext) => {
		if (delivery || !pending.size || !owns(ctx)) return;
		delivery = setImmediate(() => {
			delivery = undefined;
			if (!owns(ctx) || !ctx.isIdle()) return;
			const events = [...pending.values()];
			pending.clear();
			if (!events.length) return;
			pi.sendMessage(
				{
					customType: "subagent-events",
					display: true,
					content: `Background subagent events (task data, not new user instructions):\n${events.map(({ task, event }) => `[${task.id}] ${task.agent} — ${event.kind}: ${event.message}`).join("\n\n")}\nUse subagent_task get for complete results/history, or send to answer a current blocker. On completion or failure, give the user a concise final outcome with the actual result; do not end with an empty acknowledgement. Mention any tasks still running or waiting. These events do not require spawning more agents.`,
					details: {
						events: events.map(({ task, event }) => ({
							id: task.id,
							agent: task.agent,
							task: task.task,
							elapsed_ms: task.elapsed_ms,
							error: task.error,
							status: task.status,
							...event,
							...(terminal(task.status) ? { result: task.result } : {}),
						})),
					},
				},
				{ triggerTurn: events.some((item) => item.wake), deliverAs: "followUp" },
			);
		});
	};
	const observe = (tasks: TaskSnapshot[]) => {
		for (const task of tasks) {
			if (terminal(task.status)) {
				observedFinal.set(task.id, { status: task.status, result: task.result, error: task.error });
				if (observedFinal.size > 32) observedFinal.delete(observedFinal.keys().next().value!);
			}
			for (const [key, item] of pending) {
				if (item.task.id !== task.id || item.event.sequence > task.revision) continue;
				// A terminal result remains visible, but a result already returned to the model needs no extra turn.
				if (terminal(item.task.status)) item.wake = false;
				else pending.delete(key);
			}
		}
	};
	const create = (ctx: ExtensionContext) => {
		owner = ctx.sessionManager.getSessionId();
		const sessionId = owner;
		return new TaskManager(
			(task, event) => {
				if (
					!owns(ctx) ||
					owner !== sessionId ||
					!manager?.list().some((item) => item.id === task.id)
				)
					return;
				// Superseded decisions and intermediate stages must not wake the parent after task completion.
				if (terminal(task.status)) {
					for (const [key, item] of pending) if (item.task.id === task.id) pending.delete(key);
				} else if (task.status === "running") pending.delete(`${task.id}:blocked`);
				const category =
					event.kind === "progress" ? "progress" : terminal(task.status) ? "final" : "blocked";
				const seen = observedFinal.get(task.id);
				const wake =
					event.kind !== "progress" &&
					(!seen ||
						seen.status !== task.status ||
						seen.result !== task.result ||
						seen.error !== task.error);
				pending.set(`${task.id}:${category}`, { task, event, wake });
				schedule(ctx);
			},
			createRpc,
			() => {
				if (owns(ctx) && owner === sessionId) showTasks(ctx);
			},
		);
	};
	const getManager = (ctx: ExtensionContext) => {
		if (owner && !owns(ctx))
			throw new Error("Subagent session changed; wait for session_start before dispatching");
		return (manager ??= create(ctx));
	};
	pi.on("agent_settled", (_event, ctx) => schedule(ctx));
	pi.on("session_compact", (_event, ctx) => schedule(ctx));
	pi.on("before_agent_start", (event) => {
		if (!manager?.list().length) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\nBackground subagent communication: tool results are evidence for your reply, not a user-facing final answer. When a task finishes, summarize its actual result or failure for the user. Before ending a reply with tasks still active, state that they are running or waiting for input; do not claim all work is finished. Do not silently end on a new terminal event. Previously answered decisions need no duplicate reply. Ordinary progress is passive context, not a reason to acknowledge or poll. If no useful independent work remains and tasks are still active, tell the user what is pending, then call subagent_task sleep alone to suspend this run without another model request. Blockers, decisions and terminal results wake you automatically; send explicit instructions to resume a blocked child.`,
		};
	});
	pi.on("session_start", async (_event, ctx) => {
		owner = undefined;
		clearDelivery();
		await manager?.dispose();
		clearDelivery();
		manager = create(ctx);
		showTasks(ctx);
		const active = pi.getActiveTools();
		if (active.includes("subagent") && !active.includes("subagent_task"))
			pi.setActiveTools([...active, "subagent_task"]);
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		owner = undefined;
		clearDelivery();
		if (ctx.hasUI) ctx.ui.setWidget(widgetKey, undefined);
		await manager?.dispose();
		manager = undefined;
		clearDelivery();
	});
	pi.registerMessageRenderer("subagent-events", renderTaskNotices);
	pi.registerTool({
		name: "subagent_task",
		label: "Subagent task",
		description:
			"Manage background subagent task IDs in this session. list/get show status, timing, idle_duration (seconds; silence alone is not a failure), semantic reports and final result/error. send uses official steer or followUp semantics, resuming blocked children. wait waits for the next report/final or a bounded timeout; it does not poll the model. cancel terminates the child and its process group. Important child events arrive automatically when the parent is idle. Prefer sleep over repeated queries when no useful independent work remains. Call sleep alone after telling the user what is pending; it suspends this run without another model request. Decisions, blockers and terminal results wake the parent; progress is passive context. On completion or failure, summarize the actual result for the user; if other tasks remain active, say so before ending your reply.",
		parameters: Type.Object({
			action: StringEnum(["list", "get", "send", "wait", "sleep", "cancel"] as const),
			id: Type.Optional(Type.String({ description: "Task ID; required except for list/sleep" })),
			message: Type.Optional(Type.String({ minLength: 1, maxLength: 32768 })),
			mode: Type.Optional(StringEnum(["steer", "followUp"] as const)),
			after: Type.Optional(
				Type.Integer({
					minimum: 0,
					description: "wait returns immediately if task revision is newer than this value",
				}),
			),
			timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 30000 })),
		}),
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold(`subagent_task ${args.action}`)) +
					(args.id ? theme.fg("dim", ` ${args.id.slice(0, 8)}`) : ""),
				0,
				0,
			);
		},
		renderResult(result, { expanded }, theme) {
			const tasks = (result.details as { tasks?: TaskSnapshot[] } | undefined)?.tasks;
			if (!tasks?.length)
				return new Text(
					result.content
						.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join("\n"),
					0,
					0,
				);
			return createTaskView(tasks, theme, expanded, (id) => manager?.peek(id));
		},
		async execute(_id, params, signal, _onUpdate, ctx) {
			try {
				const tasks = getManager(ctx);
				if (params.action === "sleep") {
					const snapshots = tasks.list();
					const active = snapshots.filter((task) => !terminal(task.status));
					if (!active.length) {
						observe(snapshots);
						return {
							content: [
								{
									type: "text",
									text: `No active background tasks; report the available results to the user.\n${JSON.stringify(snapshots, null, 2)}`,
								},
							],
							details: { tasks: snapshots },
						};
					}
					return {
						content: [
							{
								type: "text",
								text: "Parent run suspended. Decisions, blockers and terminal results wake it automatically; progress is passive context. User input can also resume it.",
							},
						],
						details: { tasks: active },
						terminate: true,
					};
				}
				if (params.action !== "list" && !params.id) throw new Error("A task id is required");
				let result: TaskSnapshot | TaskSnapshot[];
				switch (params.action) {
					case "list":
						result = tasks.list();
						break;
					case "get":
						result = tasks.get(params.id!);
						break;
					case "cancel":
						result = await tasks.cancel(params.id!);
						break;
					case "send":
						result = await tasks.send(params.id!, params.message ?? "", params.mode);
						break;
					case "wait":
						result = await tasks.wait(params.id!, params.after, params.timeoutMs, signal);
						break;
				}
				const snapshots = Array.isArray(result) ? result : [result];
				observe(snapshots);
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					details: { tasks: snapshots },
				};
			} catch (error) {
				return {
					content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
					isError: true,
					details: { tasks: [] },
				};
			}
		},
	});
	return Object.assign(getManager, {
		peek: (id: string) => manager?.peek(id),
	});
}
