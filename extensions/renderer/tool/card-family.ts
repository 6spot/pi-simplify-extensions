import { isMcpToolDefinition } from "./mcp-title.ts";
import { SHELL_TOOL_NAMES } from "./names.ts";

export type ToolCardFamily =
	| "query"
	| "shell"
	| "diff"
	| "plan"
	| "task"
	| "question"
	| "codemode"
	| "generic";

/** Explicit adapters only: MCP provenance wins over a coincidentally matching native name. */
export function toolCardFamily(name: string, definition?: any): ToolCardFamily {
	if (isMcpToolDefinition(definition, name)) return "generic";
	if (["read", "grep", "find"].includes(name)) return "query";
	if (SHELL_TOOL_NAMES.has(name)) return "shell";
	if (["edit", "write"].includes(name)) return "diff";
	if (name === "update_plan") return "plan";
	if (["subagent", "subagent_task"].includes(name)) return "task";
	if (name === "ask_user_question") return "question";
	if (name === "codemode") return "codemode";
	return "generic";
}

/** A foreign self renderer owns its interactive shell; ordinary tools get the common fallback. */
export function ownsPrivateToolShell(name: string, definition?: any): boolean {
	return (
		toolCardFamily(name, definition) === "generic" &&
		definition?.renderShell === "self" &&
		(typeof definition.renderCall === "function" || typeof definition.renderResult === "function")
	);
}
