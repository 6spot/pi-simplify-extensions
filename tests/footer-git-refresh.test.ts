import assert from "node:assert/strict";
import test from "node:test";
import footerExtension, { applyCustomFooter } from "../extensions/feature/shell/footer.ts";
import { GitOperationMonitor } from "../extensions/feature/shell/git-operation.ts";

test("Footer repaints native Git branch changes and releases its subscription", () => {
	let factory: any;
	let onBranchChange: (() => void) | undefined;
	let branch = "main";
	let renders = 0;
	let unsubscribes = 0;
	const ctx: any = {
		hasUI: true,
		cwd: "/project",
		model: { id: "test" },
		sessionManager: {
			getSessionId: () => "session",
			getSessionFile: () => undefined,
			getLeafId: () => "leaf",
			getEntries: () => [],
		},
		getContextUsage: () => undefined,
		ui: {
			setFooter(value: any) {
				factory = value;
			},
			notify: assert.fail,
		},
	};
	applyCustomFooter(ctx);
	const footer = factory(
		{ requestRender: () => renders++ },
		{ fg: (_slot: string, text: string) => text },
		{
			getGitBranch: () => branch,
			onBranchChange(callback: () => void) {
				onBranchChange = callback;
				return () => unsubscribes++;
			},
		},
	);
	try {
		const line = footer.render(100)[0];
		assert.match(line, /^ {1}project \| main {2,}/, "left margin aligns with loader rows");
		assert.match(line, / {1}$/, "right margin mirrors the left margin");
		assert.equal(line.length, 100);
		branch = "feature";
		onBranchChange?.();
		assert.equal(renders, 1);
		assert.match(footer.render(100)[0], /^\s*project \| feature\s+/);
	} finally {
		footer.dispose();
	}
	assert.equal(unsubscribes, 1);
});

test("tool and Agent completion refresh metadata; shutdown releases the Footer exactly once", (t) => {
	const refresh = t.mock.method(GitOperationMonitor.prototype, "refresh", () => Promise.resolve());
	const handlers = new Map<string, (...args: any[]) => void>();
	let footer: any;
	let unsubscribes = 0;
	const ctx: any = {
		hasUI: true,
		cwd: "/project",
		ui: {
			setFooter(factory: any) {
				footer = factory(
					{ requestRender() {} },
					{},
					{
						onBranchChange: () => () => unsubscribes++,
					},
				);
			},
			notify: assert.fail,
		},
	};
	footerExtension({ on: (name: string, handler: any) => handlers.set(name, handler) } as any);
	handlers.get("session_start")?.({}, ctx);
	assert.equal(refresh.mock.callCount(), 1);
	handlers.get("tool_execution_end")?.({}, ctx);
	handlers.get("agent_end")?.({}, ctx);
	assert.equal(refresh.mock.callCount(), 3);
	handlers.get("session_shutdown")?.({}, ctx);
	assert.equal(unsubscribes, 1);
	footer.dispose();
	handlers.get("tool_execution_end")?.({}, ctx);
	assert.equal(unsubscribes, 1);
	assert.equal(refresh.mock.callCount(), 3);
});
