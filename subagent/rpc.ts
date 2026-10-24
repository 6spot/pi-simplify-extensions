import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface RpcRecord {
	type: string;
	[key: string]: any;
}

export interface RpcOptions {
	command: string;
	args: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv;
	onRecord: (record: RpcRecord) => void;
	onExit: (error: Error) => void;
}

/** Official JSONL RPC protocol; no Agent/runtime reimplementation. */
export class RpcProcess {
	private child: ChildProcessWithoutNullStreams;
	private pending = new Map<
		string,
		{ resolve: (value: RpcRecord) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
	>();
	private sequence = 0;
	private buffer = "";
	private stderr = "";
	private stopping = false;
	private exited = false;
	private failure?: Error;
	private closePromise: Promise<void>;
	private closed!: () => void;
	private killTimer?: NodeJS.Timeout;

	private options: RpcOptions;
	constructor(options: RpcOptions) {
		this.options = options;
		this.closePromise = new Promise((resolve) => {
			this.closed = resolve;
		});
		this.child = spawn(options.command, options.args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			stdio: ["pipe", "pipe", "pipe"],
			// POSIX process group lets cancellation also terminate bash/tool descendants.
			detached: process.platform !== "win32",
		});
		this.child.stdout.setEncoding("utf8");
		this.child.stderr.setEncoding("utf8");
		this.child.stderr.on("data", (chunk: string) => {
			this.stderr = (this.stderr + chunk).slice(-8192);
		});
		this.child.stdout.on("data", (chunk: string) => this.receive(chunk));
		this.child.stdin.on("error", (error) => this.fail(error));
		this.child.on("error", (error) => this.fail(error));
		this.child.on("exit", (code, signal) => {
			if (!this.stopping)
				this.fail(
					new Error(`Pi RPC exited (${signal ?? code})${this.stderr ? `: ${this.stderr}` : ""}`),
				);
		});
		this.child.on("close", (code, signal) => {
			this.exited = true;
			if (this.stopping) this.kill("SIGKILL");
			if (this.killTimer) clearTimeout(this.killTimer);
			const error =
				this.failure ??
				new Error(`Pi RPC exited (${signal ?? code})${this.stderr ? `: ${this.stderr}` : ""}`);
			this.rejectPending(error);
			if (!this.stopping) this.options.onExit(error);
			this.closed();
		});
	}

	get pid(): number | undefined {
		return this.child.pid;
	}

	private receive(chunk: string): void {
		if (this.stopping) return;
		this.buffer += chunk;
		// A pathological child must not retain an unbounded JSON line in the parent.
		if (this.buffer.length > 8 * 1024 * 1024) {
			this.fail(new Error("Pi RPC output exceeded the 8 MiB record buffer"));
			return;
		}
		let newline: number;
		while ((newline = this.buffer.indexOf("\n")) >= 0) {
			const line = this.buffer.slice(0, newline);
			this.buffer = this.buffer.slice(newline + 1);
			if (!line.trim()) continue;
			let record: RpcRecord;
			try {
				record = JSON.parse(line);
			} catch {
				this.fail(new Error(`Invalid Pi RPC JSON: ${line.slice(0, 160)}`));
				return;
			}
			if (!record || typeof record.type !== "string") {
				this.fail(new Error("Invalid Pi RPC record"));
				return;
			}
			if (record.type === "response" && typeof record.id === "string") {
				const request = this.pending.get(record.id);
				if (request) {
					clearTimeout(request.timer);
					this.pending.delete(record.id);
					if (record.success) request.resolve(record);
					else request.reject(new Error(record.error || `RPC ${record.command} failed`));
				}
			}
			this.options.onRecord(record);
		}
	}

	request(
		command: RpcRecord,
		timeoutMs = 15_000,
		accepted?: (response: RpcRecord) => void,
	): Promise<RpcRecord> {
		if (this.stopping || this.exited || this.failure)
			return Promise.reject(this.failure ?? new Error("Pi RPC is closed"));
		if (this.pending.size >= 16)
			return Promise.reject(new Error("Too many pending Pi RPC commands"));
		const id = `subagent-${++this.sequence}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`RPC ${command.type} acknowledgement timed out`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (response) => {
					accepted?.(response);
					resolve(response);
				},
				reject,
				timer,
			});
			this.child.stdin.write(`${JSON.stringify({ ...command, id })}\n`, (error) => {
				if (error) this.fail(error);
			});
		});
	}

	private rejectPending(error: Error): void {
		for (const request of this.pending.values()) {
			clearTimeout(request.timer);
			request.reject(error);
		}
		this.pending.clear();
	}

	private fail(error: Error): void {
		if (this.failure || this.stopping) return;
		this.failure = error;
		this.rejectPending(error);
		this.options.onExit(error);
		void this.stop();
	}

	private kill(signal: NodeJS.Signals): void {
		try {
			if (process.platform !== "win32" && this.child.pid) process.kill(-this.child.pid, signal);
			else this.child.kill(signal);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") this.child.kill(signal);
		}
	}

	async stop(): Promise<void> {
		if (!this.stopping && !this.exited) {
			this.stopping = true;
			this.rejectPending(new Error("Pi RPC stopped"));
			// Abort is best effort; SIGTERM/SIGKILL bound cleanup even during tool/transport failure.
			if (this.child.stdin.writable) this.child.stdin.end(`${JSON.stringify({ type: "abort" })}\n`);
			this.kill("SIGTERM");
			this.killTimer = setTimeout(() => this.kill("SIGKILL"), 1000);
		}
		await this.closePromise;
	}
}
