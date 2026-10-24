import { randomUUID } from "node:crypto";
import { RpcProcess, type RpcOptions, type RpcRecord } from "./rpc.ts";

export type TaskStatus = "running" | "blocked" | "completed" | "failed" | "cancelled";
export type ReportKind = "progress" | "blocked" | "decision";
export interface TaskEvent {
	sequence: number;
	kind: ReportKind | "completed" | "failed" | "cancelled";
	message: string;
	at: string;
}
export interface TaskSnapshot {
	id: string;
	agent: string;
	status: TaskStatus;
	cwd: string;
	task: string;
	started_at: string;
	finished_at?: string;
	elapsed_ms: number;
	last_activity_at: string;
	idle_duration: number;
	revision: number;
	latest_progress?: TaskEvent;
	events: TaskEvent[];
	result?: string;
	error?: string;
	auto_reports_suppressed: number;
	last_instruction?: { mode: "steer" | "followUp"; disposition: string; at: string };
}
export interface StartTask {
	agent: string;
	task: string;
	cwd: string;
	/** Build official CLI flags, including the task-specific report channel. */
	launch: (
		id: string,
	) => Promise<{ command: string; args: string[]; env?: NodeJS.ProcessEnv; cleanup: () => void }>;
}
interface TaskRecord {
	snapshot: TaskSnapshot;
	started: number;
	activity: number;
	finished?: number;
	rpc?: RpcProcess;
	cleanup: () => void;
	lastReportSequence: number;
	lastStopReason?: string;
	lastError?: string;
	lastText: string;
	listeners: Set<() => void>;
	autoReports: number;
	done: Promise<void>;
	resolveDone: () => void;
	launchDone?: Promise<void>;
	ready?: Promise<void>;
	pendingInstructions: number;
	deferredSettle: boolean;
}
const terminal = (status: TaskStatus) =>
	status === "completed" || status === "failed" || status === "cancelled";
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const cap = (text: string, length = 32 * 1024) =>
	text.length > length
		? `${text.slice(0, length)}\n[truncated; ask the child to save a file for full output]`
		: text;

/** Session-local, bounded task registry. Silence is activity metadata, never a failure detector. */
export class TaskManager {
	private tasks = new Map<string, TaskRecord>();
	private disposed = false;
	private notify: (snapshot: TaskSnapshot, event: TaskEvent) => void;
	private stateChanged: () => void;
	private createRpc: (options: RpcOptions) => RpcProcess;
	constructor(
		notify: (snapshot: TaskSnapshot, event: TaskEvent) => void,
		createRpc: (options: RpcOptions) => RpcProcess = (options) => new RpcProcess(options),
		stateChanged: () => void = () => {},
	) {
		this.notify = notify;
		this.createRpc = createRpc;
		this.stateChanged = stateChanged;
	}

	start(input: StartTask): TaskSnapshot {
		if (this.disposed) throw new Error("Subagent session is closed");
		if ([...this.tasks.values()].filter((task) => !terminal(task.snapshot.status)).length >= 4)
			throw new Error(
				"At most 4 background subagents may run at once; query or cancel an existing task",
			);
		if (this.tasks.size >= 32) {
			const oldest = [...this.tasks].find(([, task]) => terminal(task.snapshot.status));
			if (oldest) this.tasks.delete(oldest[0]);
		}
		const id = randomUUID();
		const now = Date.now();
		let resolveDone!: () => void;
		const task: TaskRecord = {
			snapshot: {
				id,
				agent: input.agent,
				status: "running",
				cwd: input.cwd,
				task: cap(input.task, 4096),
				started_at: new Date(now).toISOString(),
				elapsed_ms: 0,
				last_activity_at: new Date(now).toISOString(),
				idle_duration: 0,
				revision: 1,
				events: [],
				auto_reports_suppressed: 0,
			},
			started: now,
			activity: now,
			cleanup: () => {},
			lastReportSequence: 0,
			lastText: "",
			listeners: new Set(),
			pendingInstructions: 0,
			deferredSettle: false,
			autoReports: 0,
			done: new Promise((resolve) => {
				resolveDone = resolve;
			}),
			resolveDone: () => resolveDone(),
		};
		this.tasks.set(id, task);
		this.stateChanged();
		task.launchDone = (async () => {
			try {
				const launch = await input.launch(id);
				task.cleanup = launch.cleanup;
				if (this.disposed || terminal(task.snapshot.status)) return;
				task.rpc = this.createRpc({
					...launch,
					cwd: input.cwd,
					onRecord: (record) => this.receive(task, record),
					onExit: (error) => {
						void this.finish(task, "failed", messageOf(error));
					},
				});
				task.ready = task.rpc
					.request({ type: "prompt", message: input.task })
					.then((response) => {
						// An input hook may consume a prompt without ever starting an Agent run.
						if (response.data?.disposition === "handled")
							void this.finish(
								task,
								"failed",
								"Initial prompt was handled by an input hook; no child run started",
							);
					})
					.catch((error) => {
						void this.finish(task, "failed", messageOf(error));
					});
			} catch (error) {
				void this.finish(task, "failed", messageOf(error));
			}
		})();
		return this.snapshot(task);
	}

	private snapshot(task: TaskRecord): TaskSnapshot {
		const now = Date.now();
		return {
			...task.snapshot,
			events: [...task.snapshot.events],
			elapsed_ms: (task.finished ?? now) - task.started,
			last_activity_at: new Date(task.activity).toISOString(),
			idle_duration: Math.max(0, now - task.activity) / 1000,
		};
	}
	private require(id: string): TaskRecord {
		const task = this.tasks.get(id);
		if (!task) throw new Error(`Unknown subagent task ID: ${id}`);
		return task;
	}
	peek(id: string): TaskSnapshot | undefined {
		const task = this.tasks.get(id);
		return task ? this.snapshot(task) : undefined;
	}
	get(id: string): TaskSnapshot {
		return this.snapshot(this.require(id));
	}
	list(): TaskSnapshot[] {
		return [...this.tasks.values()].map((task) => this.snapshot(task));
	}

	private changed(task: TaskRecord, kind: TaskEvent["kind"], message: string): void {
		const event: TaskEvent = {
			sequence: ++task.snapshot.revision,
			kind,
			message: cap(message, 2048),
			at: new Date().toISOString(),
		};
		task.snapshot.events.push(event);
		if (task.snapshot.events.length > 16) task.snapshot.events.shift();
		if (kind === "progress" || kind === "blocked" || kind === "decision")
			task.snapshot.latest_progress = event;
		this.stateChanged();
		for (const listener of task.listeners) listener();
		// Bound automatic context growth, while keeping subsequent reports queryable.
		if (
			(kind === "progress" && task.autoReports >= 20) ||
			(["blocked", "decision"].includes(kind) && task.autoReports >= 40)
		)
			task.snapshot.auto_reports_suppressed++;
		else if (!this.disposed) {
			task.autoReports++;
			this.notify(this.snapshot(task), event);
		}
	}

	private receive(task: TaskRecord, record: RpcRecord): void {
		if (terminal(task.snapshot.status) || this.disposed) return;
		if (
			[
				"message_start",
				"message_update",
				"message_end",
				"tool_execution_start",
				"tool_execution_update",
				"tool_execution_end",
				"agent_start",
				"agent_settled",
				"entry_appended",
			].includes(record.type)
		)
			task.activity = Date.now();
		if (
			record.type === "entry_appended" &&
			record.entry?.type === "custom" &&
			record.entry.customType === "subagent-progress"
		) {
			const data = record.entry.data;
			if (
				!data ||
				data.taskId !== task.snapshot.id ||
				!Number.isSafeInteger(data.sequence) ||
				data.sequence <= task.lastReportSequence ||
				!["progress", "blocked", "decision"].includes(data.kind) ||
				typeof data.message !== "string" ||
				!data.message.trim()
			)
				return;
			task.lastReportSequence = data.sequence;
			const previous = task.snapshot.latest_progress;
			const nextStatus = data.kind === "progress" ? "running" : "blocked";
			if (
				previous &&
				previous.kind === data.kind &&
				previous.message === data.message &&
				task.snapshot.status === nextStatus
			)
				return;
			task.snapshot.status = nextStatus;
			this.changed(task, data.kind, data.message);
		}
		if (record.type === "message_end" && record.message?.role === "assistant") {
			const message = record.message;
			task.lastStopReason = message.stopReason;
			task.lastError =
				typeof message.errorMessage === "string" ? cap(message.errorMessage) : undefined;
			task.lastText = cap(
				(message.content ?? [])
					.filter((part: any) => part.type === "text")
					.map((part: any) => part.text)
					.join("\n"),
			);
		}
		if (record.type === "agent_settled") {
			if (task.pendingInstructions > 0) task.deferredSettle = true;
			else this.settle(task);
		}
		// Child extensions requiring UI fail closed rather than hanging RPC forever.
		if (
			record.type === "extension_ui_request" &&
			record.method !== "notify" &&
			record.method !== "setStatus" &&
			record.method !== "setWidget" &&
			record.method !== "setTitle" &&
			record.method !== "set_editor_text"
		) {
			void this.finish(
				task,
				"failed",
				`Child requested interactive UI (${record.method}); resolve authorization in the parent or run synchronously`,
			);
		}
	}

	private settle(task: TaskRecord): void {
		task.deferredSettle = false;
		if (task.lastStopReason === "error" || task.lastStopReason === "aborted")
			void this.finish(task, "failed", task.lastError || `Child stopped: ${task.lastStopReason}`);
		else if (task.snapshot.status !== "blocked") {
			if (!task.lastText.trim())
				void this.finish(task, "failed", "Child settled without a final text result");
			else void this.finish(task, "completed");
		}
	}

	private async finish(
		task: TaskRecord,
		status: "completed" | "failed" | "cancelled",
		error?: string,
	): Promise<void> {
		if (terminal(task.snapshot.status)) return task.done;
		task.snapshot.status = status;
		task.finished = Date.now();
		task.snapshot.finished_at = new Date(task.finished).toISOString();
		if (status === "completed") task.snapshot.result = task.lastText;
		else task.snapshot.error = cap(error || status);
		try {
			await task.launchDone;
			await task.rpc?.stop();
		} catch (error) {
			task.snapshot.error = `Process cleanup failed: ${messageOf(error)}`;
			if (status !== "cancelled") status = "failed";
		} finally {
			try {
				task.cleanup();
			} catch (error) {
				task.snapshot.error = `${task.snapshot.error ? `${task.snapshot.error}; ` : ""}Prompt cleanup failed: ${messageOf(error)}`;
				if (status !== "cancelled") status = "failed";
			}
			task.snapshot.status = status;
			this.changed(task, status, status === "completed" ? task.lastText : task.snapshot.error!);
			task.resolveDone();
		}
	}

	async send(
		id: string,
		message: string,
		mode: "steer" | "followUp" = "steer",
	): Promise<TaskSnapshot> {
		const task = this.require(id);
		await task.launchDone;
		await task.ready;
		if (terminal(task.snapshot.status) || !task.rpc)
			throw new Error(`Task ${id} is ${task.snapshot.status}; it cannot receive instructions`);
		if (!message.trim() || message.length > 32 * 1024)
			throw new Error("Message must contain 1–32768 characters");
		// prompt + streamingBehavior uses the official steering/follow-up queues while busy,
		// and starts a new turn while idle (plain steer/follow_up would remain queued there).
		task.pendingInstructions++;
		let acknowledged = false;
		try {
			const response = await task.rpc.request(
				{ type: "prompt", message, streamingBehavior: mode },
				15_000,
				(response) => {
					// Update synchronously on the RPC acknowledgement, before later records in the same chunk.
					acknowledged = true;
					task.pendingInstructions--;
					if (response.data?.disposition !== "handled" && !terminal(task.snapshot.status)) {
						task.snapshot.status = "running";
						task.deferredSettle = false;
						task.snapshot.last_instruction = {
							mode,
							disposition: response.data?.disposition ?? "accepted",
							at: new Date().toISOString(),
						};
						this.stateChanged();
					}
				},
			);
			if (response.data?.disposition === "handled")
				throw new Error("Message was handled by a child input hook; no instruction was queued");
			task.activity = Date.now();
			return this.snapshot(task);
		} catch (error) {
			if (!acknowledged) task.pendingInstructions--;
			if (task.deferredSettle && task.pendingInstructions === 0) this.settle(task);
			throw error;
		}
	}

	async cancel(id: string): Promise<TaskSnapshot> {
		const task = this.require(id);
		await this.finish(task, "cancelled", "Cancelled by parent");
		return this.snapshot(task);
	}

	async wait(
		id: string,
		after?: number,
		timeoutMs = 10_000,
		signal?: AbortSignal,
	): Promise<TaskSnapshot> {
		const task = this.require(id);
		if (terminal(task.snapshot.status)) {
			await task.done;
			return this.snapshot(task);
		}
		if (after !== undefined && task.snapshot.revision > after) return this.snapshot(task);
		if (signal?.aborted) throw new Error("Subagent wait aborted; background task is still running");
		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timer);
				task.listeners.delete(finish);
				signal?.removeEventListener("abort", abort);
			};
			const finish = () => {
				cleanup();
				resolve();
			};
			const abort = () => {
				cleanup();
				reject(new Error("Subagent wait aborted; background task is still running"));
			};
			const timer = setTimeout(finish, Math.min(30_000, Math.max(1, timeoutMs)));
			task.listeners.add(finish);
			signal?.addEventListener("abort", abort, { once: true });
		});
		if (terminal(task.snapshot.status)) await task.done;
		return this.snapshot(task);
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		await Promise.all(
			[...this.tasks.values()].map((task) =>
				terminal(task.snapshot.status)
					? task.done
					: this.finish(task, "cancelled", "Parent session ended or reloaded"),
			),
		);
		this.tasks.clear();
		this.stateChanged();
	}
}
