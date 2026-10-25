import { execFile, type ChildProcess } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function exists(file: string): Promise<boolean> {
	try {
		await stat(file);
		return true;
	} catch {
		return false;
	}
}

/** Read only real operation metadata, including worktree-local rebase progress. */
export async function readGitOperation(
	gitDir: string,
): Promise<{ label: string; directory?: string }> {
	for (const [name, currentFile, totalFile] of [
		["rebase-merge", "msgnum", "end"],
		["rebase-apply", "next", "last"],
	]) {
		const directory = path.join(gitDir, name);
		if (!(await exists(directory))) continue;
		let progress = "";
		try {
			const [current, total] = await Promise.all([
				readFile(path.join(directory, currentFile), "utf8"),
				readFile(path.join(directory, totalFile), "utf8"),
			]);
			const step = Number(current.trim());
			const count = Number(total.trim());
			if (
				/^\d+$/.test(current.trim()) &&
				/^\d+$/.test(total.trim()) &&
				Number.isSafeInteger(step) &&
				Number.isSafeInteger(count) &&
				step > 0 &&
				step <= count
			)
				progress = ` ${step}/${count}`;
		} catch {
			// Missing or partially written progress must not hide the operation itself.
		}
		const operation =
			name === "rebase-apply" && (await exists(path.join(directory, "applying")))
				? "applying"
				: "rebasing";
		return { label: `${operation}${progress}`, directory };
	}
	for (const [marker, label] of [
		["MERGE_HEAD", "merging"],
		["CHERRY_PICK_HEAD", "cherry-picking"],
		["REVERT_HEAD", "reverting"],
		["BISECT_LOG", "bisecting"],
	]) {
		if (await exists(path.join(gitDir, marker))) return { label };
	}
	return { label: "" };
}

/** Event-driven metadata reads; no periodic polling or git status/diff queries. */
export class GitOperationMonitor {
	label = "";
	private gitDir: string | undefined;
	private resolvedCwd: string | undefined;
	private rootWatcher: FSWatcher | undefined;
	private operationWatcher: FSWatcher | undefined;
	private operationDirectory: string | undefined;
	private pending: Promise<void> | undefined;
	private queued = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	private query: ChildProcess | undefined;

	private readonly cwd: () => string;
	private readonly onChange: () => void;

	constructor(cwd: () => string, onChange: () => void) {
		this.cwd = cwd;
		this.onChange = onChange;
		void this.refresh();
	}

	refresh(): Promise<void> {
		if (this.disposed) return Promise.resolve();
		if (this.pending) {
			this.queued = true;
			return this.pending;
		}
		this.pending = (async () => {
			do {
				this.queued = false;
				await this.read();
			} while (this.queued && !this.disposed);
		})().finally(() => {
			this.pending = undefined;
			if (this.queued && !this.disposed) void this.refresh();
		});
		return this.pending;
	}

	private schedule(): void {
		if (this.disposed || this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.refresh();
		}, 40);
		this.timer.unref?.();
	}

	private observe(directory: string): FSWatcher | undefined {
		try {
			const watcher = watch(directory, () => this.schedule());
			watcher.on("error", () => {
				watcher.close();
				if (this.rootWatcher === watcher) this.rootWatcher = undefined;
				if (this.operationWatcher === watcher) this.operationWatcher = undefined;
			});
			watcher.unref();
			return watcher;
		} catch {
			// Tool/agent completion still refreshes metadata if watching is unavailable.
			return undefined;
		}
	}

	private closeWatchers(): void {
		this.rootWatcher?.close();
		this.operationWatcher?.close();
		this.rootWatcher = undefined;
		this.operationWatcher = undefined;
		this.operationDirectory = undefined;
	}

	private async read(): Promise<void> {
		let cwd: string;
		try {
			cwd = this.cwd();
		} catch {
			return;
		}
		let next = { label: "", directory: undefined as string | undefined };
		try {
			if (this.resolvedCwd !== cwd || !this.gitDir) {
				this.closeWatchers();
				this.gitDir = undefined;
				this.resolvedCwd = cwd;
				const request = execFileAsync("git", ["rev-parse", "--absolute-git-dir"], {
					cwd,
					encoding: "utf8",
					timeout: 2000,
					maxBuffer: 16384,
				});
				this.query = request.child;
				const { stdout } = await request.finally(() => {
					this.query = undefined;
				});
				if (this.disposed) return;
				const directory = stdout.replace(/\r?\n$/, "");
				if (!path.isAbsolute(directory) || /[\r\n\0]/.test(directory))
					throw new Error("Invalid Git directory");
				this.gitDir = directory;
			}
			if (this.disposed) return;
			this.rootWatcher ??= this.observe(this.gitDir);
			next = { directory: undefined, ...(await readGitOperation(this.gitDir)) };
		} catch {
			// A non-repository, removed directory or cancelled query has no confirmed state.
		}
		if (this.disposed) return;
		try {
			if (this.cwd() !== cwd) {
				this.queued = true;
				return;
			}
		} catch {
			return;
		}
		if (this.operationDirectory !== next.directory) {
			this.operationWatcher?.close();
			this.operationWatcher = undefined;
			this.operationDirectory = next.directory;
		}
		if (next.directory) this.operationWatcher ??= this.observe(next.directory);
		if (this.label !== next.label) {
			this.label = next.label;
			this.onChange();
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		// A failed spawn may have no PID; never signal an unstarted process.
		if (this.query?.pid) this.query.kill();
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		this.closeWatchers();
	}
}
