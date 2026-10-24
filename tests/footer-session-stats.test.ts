import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test, { type TestContext } from "node:test";
import { applyCustomFooter } from "../extensions/feature/shell/footer.ts";

function fixture(t: TestContext) {
	const state = {
		now: 0,
		session: "session-a",
		file: "session-a.jsonl",
		leaf: "leaf-a",
		percent: 10,
		entries: [
			{ type: "message", message: { role: "assistant", usage: { cost: { total: 1.25 } } } },
			{ type: "message", message: { role: "toolResult", usage: { cost: { total: 0.75 } } } },
			{ type: "compaction", usage: { cost: { total: 2 } } },
			{ type: "branch_summary", usage: { cost: { total: 0.25 } } },
		] as any[],
	};
	t.mock.method(performance, "now", () => state.now);
	const calls = { usage: 0, entries: 0, unsubscribe: 0 };
	let factory: any;
	const ctx: any = {
		hasUI: true,
		cwd: tmpdir(),
		model: { id: "model-a", provider: "provider-a", reasoning: true, contextWindow: 100000 },
		thinkingLevel: "low",
		getContextUsage() {
			calls.usage++;
			return {
				tokens: state.percent * 1000,
				percent: state.percent,
				contextWindow: ctx.model?.contextWindow,
			};
		},
		sessionManager: {
			getSessionId: () => state.session,
			getSessionFile: () => state.file,
			getLeafId: () => state.leaf,
			getEntries: () => {
				calls.entries++;
				return state.entries;
			},
		},
		ui: {
			setFooter(value: any) {
				factory = value;
			},
			notify(message: string) {
				assert.fail(message);
			},
		},
	};
	applyCustomFooter(ctx);
	const create = () =>
		factory(
			{ requestRender() {} },
			{ fg: (_slot: string, text: string) => text },
			{
				getGitBranch: () => "main",
				onBranchChange: () => () => {
					calls.unsubscribe++;
				},
			},
		);
	const footer = create();
	t.after(() => footer.dispose());
	return {
		state,
		ctx,
		calls,
		footer,
		create,
		render: (width = 140) => footer.render(width).join("\n"),
	};
}

test("Footer reuses expensive statistics during repaints and refreshes streaming costs at the one-second boundary", (t) => {
	const f = fixture(t);
	assert.match(f.render(), /ctx 10%\/100k · \$4\.25/);
	for (let i = 0; i < 2000; i++) f.render(i % 2 ? 100 : 140);
	f.footer.invalidate();
	f.render();
	assert.deepEqual({ entries: f.calls.entries, usage: f.calls.usage }, { entries: 1, usage: 1 });
	f.state.percent = 32;
	f.state.entries.push({
		type: "message",
		message: { role: "assistant", usage: { cost: { total: 5 } } },
	});
	f.state.now = 999.999;
	assert.match(f.render(), /ctx 10%\/100k · \$4\.25/);
	f.state.now = 1000;
	assert.match(f.render(), /ctx 32%\/100k · \$9\.25/);
	assert.deepEqual({ entries: f.calls.entries, usage: f.calls.usage }, { entries: 2, usage: 2 });
	f.state.now = 1500;
	f.render();
	assert.equal(f.calls.entries, 2);
});

test("Footer immediately refreshes on session, branch leaf, model and thinking changes without waiting for TTL", (t) => {
	const f = fixture(t);
	f.render();
	const changes = [
		() => {
			f.state.leaf = "leaf-b";
		},
		() => {
			f.ctx.model.id = "model-b";
		},
		() => {
			f.ctx.model.provider = "provider-b";
		},
		() => {
			f.ctx.thinkingLevel = "high";
		},
		() => {
			f.ctx.model.contextWindow = 200000;
		},
		() => {
			f.state.session = "session-b";
		},
		() => {
			f.state.file = "session-b.jsonl";
		},
		() => {
			f.ctx.sessionManager = { ...f.ctx.sessionManager };
		},
		() => {
			f.state.leaf = "leaf-a";
		},
	];
	for (const [index, change] of changes.entries()) {
		change();
		f.state.percent++;
		f.state.entries.push({ type: "compaction", usage: { cost: { total: 1 } } });
		assert.ok(f.render().includes(`ctx ${f.state.percent}%`));
		assert.equal(f.calls.entries, index + 2);
		assert.equal(f.calls.usage, index + 2);
	}
	assert.match(f.render(), /high · model-b$/);
	assert.equal(f.state.now, 0);
});

test("replacement Footer instances start with fresh statistics and keep cleanup independent", (t) => {
	const f = fixture(t);
	f.render();
	f.state.entries = [];
	f.state.percent = 0;
	const replacement = f.create();
	try {
		const output = replacement.render(140).join("\n");
		assert.match(output, /ctx 0%\/100k/);
		assert.doesNotMatch(output, /\$4\.25/);
		assert.equal(f.calls.entries, 2);
		assert.equal(f.calls.usage, 2);
	} finally {
		replacement.dispose();
	}
	assert.equal(f.calls.unsubscribe, 1);
});
