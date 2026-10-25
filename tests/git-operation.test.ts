import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import {
	GitOperationMonitor,
	readGitOperation,
} from "../extensions/feature/shell/git-operation.ts";

const exec = promisify(execFile);
const git = (cwd: string, ...args: string[]) =>
	exec("git", ["-c", "user.name=Footer Test", "-c", "user.email=footer@example.invalid", ...args], {
		cwd,
	});

async function temporary(t: TestContext) {
	const root = await mkdtemp(path.join(tmpdir(), "pi-git-operation-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

test("operation metadata preserves actual states and validates both rebase progress formats", async (t) => {
	const root = await temporary(t);
	assert.equal((await readGitOperation(root)).label, "");
	for (const [marker, expected] of [
		["BISECT_LOG", "bisecting"],
		["REVERT_HEAD", "reverting"],
		["CHERRY_PICK_HEAD", "cherry-picking"],
		["MERGE_HEAD", "merging"],
	]) {
		await writeFile(path.join(root, marker), "actual-metadata");
		assert.equal((await readGitOperation(root)).label, expected);
	}
	for (const [name, current, total] of [
		["rebase-merge", "msgnum", "end"],
		["rebase-apply", "next", "last"],
	]) {
		const dir = path.join(root, name);
		await mkdir(dir);
		assert.equal((await readGitOperation(root)).label, "rebasing");
		await writeFile(path.join(dir, current), "2\n");
		await writeFile(path.join(dir, total), "5\n");
		assert.equal((await readGitOperation(root)).label, "rebasing 2/5");
		if (name === "rebase-apply") {
			await writeFile(path.join(dir, "applying"), "");
			assert.equal((await readGitOperation(root)).label, "applying 2/5");
			await rm(path.join(dir, "applying"));
		}
		for (const invalid of ["0", "6", "2bad", "1.5", "9007199254740992"]) {
			await writeFile(path.join(dir, current), invalid);
			assert.equal((await readGitOperation(root)).label, "rebasing");
		}
		await rm(dir, { recursive: true });
	}
});

test("metadata watchers update nested progress, clear finished state, and stop after disposal", async (t) => {
	const root = await temporary(t);
	await git(root, "init", "-b", "main");
	let onChange = () => {};
	let paints = 0;
	const monitor = new GitOperationMonitor(
		() => root,
		() => {
			paints++;
			onChange();
		},
	);
	const expectLabel = (label: string) =>
		new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error(`Expected ${label}, got ${monitor.label}`)),
				3000,
			);
			onChange = () => {
				if (monitor.label !== label) return;
				clearTimeout(timeout);
				resolve();
			};
		});
	try {
		await monitor.refresh();
		const dir = path.join(root, ".git", "rebase-merge");
		let changed = expectLabel("rebasing 1/3");
		await mkdir(dir);
		await writeFile(path.join(dir, "msgnum"), "1");
		await writeFile(path.join(dir, "end"), "3");
		await changed;
		changed = expectLabel("rebasing 2/3");
		await writeFile(path.join(dir, "msgnum"), "2");
		await changed;
		changed = expectLabel("");
		await rm(dir, { recursive: true });
		await changed;
		monitor.dispose();
		const previous = paints;
		await writeFile(path.join(root, ".git", "MERGE_HEAD"), "unobserved");
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(paints, previous);
		assert.equal(monitor.label, "");
	} finally {
		monitor.dispose();
	}
});

test("real worktree conflicts remain local and changing cwd cannot reuse the old operation", async (t) => {
	const root = await temporary(t);
	const repo = path.join(root, "repo");
	const worktree = path.join(root, "worktree");
	await mkdir(repo);
	await git(repo, "init", "-b", "main");
	await writeFile(path.join(repo, "file.txt"), "base\n");
	await git(repo, "add", ".");
	await git(repo, "commit", "-m", "base");
	await git(repo, "checkout", "-b", "topic");
	await writeFile(path.join(repo, "file.txt"), "topic\n");
	await git(repo, "commit", "-am", "topic");
	await git(repo, "checkout", "main");
	await writeFile(path.join(repo, "file.txt"), "main\n");
	await git(repo, "commit", "-am", "main");
	await git(repo, "worktree", "add", "-b", "review", worktree);
	assert.match(await readFile(path.join(worktree, ".git"), "utf8"), /^gitdir:/);
	let cwd = worktree;
	const monitor = new GitOperationMonitor(
		() => cwd,
		() => {},
	);
	try {
		await assert.rejects(git(worktree, "cherry-pick", "topic"));
		await monitor.refresh();
		assert.equal(monitor.label, "cherry-picking");
		assert.equal((await readGitOperation(path.join(repo, ".git"))).label, "");
		await git(worktree, "cherry-pick", "--abort");
		await monitor.refresh();
		assert.equal(monitor.label, "");
		await assert.rejects(git(repo, "merge", "topic"));
		cwd = repo;
		await monitor.refresh();
		assert.equal(monitor.label, "merging");
		cwd = worktree;
		await monitor.refresh();
		assert.equal(monitor.label, "");
	} finally {
		monitor.dispose();
	}
});

test("non-repositories and disposal during discovery cannot publish late state", async (t) => {
	const root = await temporary(t);
	const monitor = new GitOperationMonitor(() => root, assert.fail);
	await monitor.refresh();
	assert.equal(monitor.label, "");
	monitor.dispose();
	for (const cwd of [root, path.join(root, "missing-directory")]) {
		const cancelled = new GitOperationMonitor(() => cwd, assert.fail);
		const pending = cancelled.refresh();
		cancelled.dispose();
		await pending;
		assert.equal(cancelled.label, "");
	}
});
