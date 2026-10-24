import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

/** Loaded only into a background child; appendEntry is emitted as official entry_appended RPC. */
export default function subagentReports(pi: ExtensionAPI) {
	const taskId = process.env.PI_SUBAGENT_TASK_ID;
	if (!taskId) return;
	let sequence = 0;
	pi.registerTool({
		name: "subagent_report",
		label: "Subagent progress",
		description:
			"Report a meaningful milestone, important finding, blocker or decision request to the parent. Use progress for useful stage completion/findings; blocked or decision when parent input is required. After blocked/decision, finish your current response and await parent instructions. Do not report tool counts, elapsed time, token activity or invented percentages. Final results belong in your final assistant response.",
		parameters: Type.Object({
			kind: StringEnum(["progress", "blocked", "decision"] as const),
			message: Type.String({
				minLength: 1,
				maxLength: 2048,
				description:
					"Concrete finding/completed stage, or the exact blocker/question and its consequences",
			}),
		}),
		async execute(_id, params) {
			pi.appendEntry("subagent-progress", { taskId, sequence: ++sequence, ...params });
			return {
				content: [
					{
						type: "text",
						text:
							params.kind === "progress"
								? "Report recorded for the parent (automatic delivery is bounded; the parent can also query it)."
								: "Request recorded for the parent. End this response and wait for parent instructions; your task remains open.",
					},
				],
				details: { taskId, sequence },
			};
		},
	});
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\nYou are background subagent task ${taskId}. Use subagent_report proactively for meaningful completed stages or important findings, and for blockers/decisions needing the parent. Report semantic progress only, never tool counts/time estimates. If blocked or awaiting a decision, report it and end your current response; the parent may send instructions to resume this same isolated session. When finished, give the actual final result in your final assistant response. Do not invoke subagent or subagent_task, or launch other background subagents.`,
	}));
}
