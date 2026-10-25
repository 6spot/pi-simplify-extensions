import assert from "node:assert/strict";
import test from "node:test";
import { applyCustomFooter } from "../extensions/feature/shell/footer.ts";

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
		assert.match(footer.render(100)[0], /^\s*project \| main\s+/);
		branch = "feature";
		onBranchChange?.();
		assert.equal(renders, 1);
		assert.match(footer.render(100)[0], /^\s*project \| feature\s+/);
	} finally {
		footer.dispose();
	}
	assert.equal(unsubscribes, 1);
});
