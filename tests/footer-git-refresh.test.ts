import assert from "node:assert/strict";
import test from "node:test";
import { createGitStatsRefresher, type GitStats } from "../extensions/feature/shell/git-stats.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function pendingQuery() {
	let resolve!: (stats: GitStats | undefined) => void;
	const promise = new Promise<GitStats | undefined>((done) => { resolve = done; });
	return { promise, resolve };
}

test("git refresh coalesces overlapping requests and rejects results from before a reset", async (t) => {
	const queries: ReturnType<typeof pendingQuery>[] = [];
	const published: (GitStats | undefined)[] = [];
	const refresher = createGitStatsRefresher({
		query: () => {
			const query = pendingQuery();
			queries.push(query);
			return query.promise;
		},
		onChange: (stats) => published.push(stats),
	});
	t.after(() => refresher.dispose());
	refresher.refresh();
	queries[0].resolve({ add: 1, del: 0 });
	await settle();
	refresher.refresh();
	refresher.refresh(true); // A branch/session change clears the displayed numbers immediately.
	refresher.refresh();
	assert.equal(queries.length, 2, "overlapping refreshes share the in-flight query");
	assert.deepEqual(published, [{ add: 1, del: 0 }, undefined]);
	queries[1].resolve({ add: 99, del: 99 });
	await settle();
	assert.equal(queries.length, 3, "only one follow-up query is queued");
	assert.deepEqual(published, [{ add: 1, del: 0 }, undefined]);
	queries[2].resolve({ add: 2, del: 1 });
	await settle();
	assert.deepEqual(published, [{ add: 1, del: 0 }, undefined, { add: 2, del: 1 }]);
});

test("disposing git refresh aborts the query and discards its result and queued refresh", async () => {
	const query = pendingQuery();
	let signal: AbortSignal | undefined;
	let calls = 0;
	const published: (GitStats | undefined)[] = [];
	const refresher = createGitStatsRefresher({
		query: (currentSignal) => {
			signal = currentSignal;
			calls++;
			return query.promise;
		},
		onChange: (stats) => published.push(stats),
	});
	refresher.refresh();
	refresher.refresh();
	refresher.dispose();
	refresher.dispose();
	assert.equal(signal?.aborted, true);
	query.resolve({ add: 1, del: 0 });
	await settle();
	refresher.refresh();
	assert.equal(calls, 1);
	assert.deepEqual(published, []);
});

test("git refresh suppresses duplicate updates and clears old numbers after a failed query", async (t) => {
	let fail = false;
	const published: (GitStats | undefined)[] = [];
	const refresher = createGitStatsRefresher({
		query: async () => {
			if (fail) throw new Error("git unavailable");
			return { add: 1, del: 0, status: "!" };
		},
		onChange: (stats) => published.push(stats),
	});
	t.after(() => refresher.dispose());
	refresher.refresh();
	await settle();
	refresher.refresh();
	await settle();
	assert.deepEqual(published, [{ add: 1, del: 0, status: "!" }]);
	fail = true;
	refresher.refresh();
	await settle();
	assert.deepEqual(published, [{ add: 1, del: 0, status: "!" }, undefined]);
});
