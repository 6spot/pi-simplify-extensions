import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import extension from "../subagent/index.ts";
import { discoverAgents } from "../subagent/agents.ts";

// Exercise the actual inherited project-authorization branch before any subprocess starts.
test("project agent denial blocks both sync and background dispatch; YAML tools remain compatible", async () => {
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-subagent-permission-"));
	try {
		await fs.mkdir(path.join(cwd, ".pi", "agents"), { recursive: true });
		await fs.writeFile(
			path.join(cwd, ".pi", "agents", "local.md"),
			"---\nname: local\ndescription: project fixture\ntools:\n  - read\n  - bash\n---\nProject instructions\n",
		);
		assert.deepEqual(discoverAgents(cwd, "project").agents[0].tools, ["read", "bash"]);
		const tools = new Map<string, any>();
		extension({
			registerTool: (tool: any) => tools.set(tool.name, tool),
			on: () => {},
			registerMessageRenderer: () => {},
		} as any);
		let confirmations = 0;
		const ctx = {
			cwd,
			hasUI: true,
			isProjectTrusted: () => false,
			ui: {
				confirm: async () => {
					confirmations++;
					return false;
				},
			},
			sessionManager: { getSessionId: () => "permission-test" },
		};
		for (const background of [false, true]) {
			const result = await tools
				.get("subagent")
				.execute(
					"call",
					{ agent: "local", task: "Must not run", agentScope: "project", background },
					undefined,
					undefined,
					ctx,
				);
			assert.match(result.content[0].text, /not approved/);
		}
		assert.equal(confirmations, 2);
		const list = await tools
			.get("subagent_task")
			.execute("list", { action: "list" }, undefined, undefined, ctx);
		assert.deepEqual(list.details.tasks, []);
	} finally {
		await fs.rm(cwd, { recursive: true, force: true });
	}
});
