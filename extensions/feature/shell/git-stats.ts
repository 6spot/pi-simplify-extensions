import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type GitStats = { add: number; del: number; status?: string };

const execFileAsync = promisify(execFile);

export function parseGitStats(stdout: string): GitStats {
	let add = 0;
	let del = 0;
	for (const line of stdout.split("\n")) {
		const match = line.match(/^(\d+)\s+(\d+)/);
		if (match) {
			add += Number(match[1]);
			del += Number(match[2]);
		}
	}
	return { add, del };
}

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/**
 * git status --porcelain --branch 的第一行带分支头（## branch...origin/branch [ahead N, behind M]），
 * 其余行是 XY 文件状态。返回 Starship 风格的状态符号串（= ! ? ⇡⇣），无变化时 undefined。
 */
export function parseGitStatus(stdout: string): string | undefined {
	let conflicted = false;
	let modified = false;
	let untracked = false;
	let ahead: number | undefined;
	let behind: number | undefined;
	for (const line of stdout.split("\n")) {
		if (line.startsWith("## ")) {
			ahead = Number(line.match(/ahead (\d+)/)?.[1]) || undefined;
			behind = Number(line.match(/behind (\d+)/)?.[1]) || undefined;
			continue;
		}
		const code = line.slice(0, 2);
		if (code === "??") untracked = true;
		else if (CONFLICT_CODES.has(code)) {
			// 冲突文件必然也有未提交内容，! 与 = 同时出现
			conflicted = true;
			modified = true;
		} else if (line.trim()) modified = true;
	}
	let status = "";
	if (conflicted) status += "=";
	if (modified) status += "!";
	if (untracked) status += "?";
	if (ahead) status += `⇡${ahead}`;
	if (behind) status += `⇣${behind}`;
	return status || undefined;
}

/** Read only local refs and tracked files; never fetch or change the index. */
export async function readGitStats(
	cwd: string,
	signal?: AbortSignal,
): Promise<GitStats | undefined> {
	const git = async (args: string[]) => {
		const { stdout } = await execFileAsync("git", args, {
			cwd,
			timeout: 2000,
			maxBuffer: 16 * 1024 * 1024,
			signal,
		});
		return stdout.trim();
	};
	try {
		// HEAD-relative comparison includes staged + unstaged net changes.
		// Untracked files are excluded from line counts.
		const [numstat, statusOut] = await Promise.all([
			git(["diff", "--numstat", "HEAD", "--"]),
			git(["status", "--porcelain", "--branch"]).catch(() => ""),
		]);
		if (signal?.aborted) return undefined;
		const stats = parseGitStats(numstat);
		const status = parseGitStatus(statusOut);
		return status ? { ...stats, status } : stats;
	} catch {
		// Non-repository, unborn HEAD, timeout, etc.
		return undefined;
	}
}

/** Coalesce overlapping refreshes and reject stale results after a branch/session change. */
export function createGitStatsRefresher(options: {
	query: (signal: AbortSignal) => Promise<GitStats | undefined>;
	onChange: (stats: GitStats | undefined) => void;
}): { refresh: (reset?: boolean) => void; dispose: () => void } {
	let stats: GitStats | undefined;
	let generation = 0;
	let running = false;
	let pending = false;
	let disposed = false;
	let controller: AbortController | undefined;
	const publish = (next: GitStats | undefined) => {
		if (stats?.add === next?.add && stats?.del === next?.del && stats?.status === next?.status)
			return;
		stats = next;
		options.onChange(next);
	};
	const refresh = (reset = false) => {
		if (disposed) return;
		if (reset) publish(undefined);
		const request = ++generation;
		if (running) {
			pending = true;
			return;
		}
		running = true;
		const queryController = new AbortController();
		controller = queryController;
		void (async () => {
			let next: GitStats | undefined;
			try {
				next = await options.query(queryController.signal);
			} catch {
				// Failed queries clear the old numbers rather than leaving a stale chip.
			} finally {
				if (!disposed && request === generation) publish(next);
				running = false;
				controller = undefined;
				if (pending && !disposed) {
					pending = false;
					refresh();
				}
			}
		})();
	};
	return {
		refresh,
		dispose: () => {
			disposed = true;
			generation++;
			controller?.abort();
		},
	};
}
