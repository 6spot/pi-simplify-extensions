import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import customFooter from "./feature/shell/footer.ts";
import { installFlushDockedBash } from "./feature/shell/flush-docked-bash.ts";
import { applyPromptEditor } from "./feature/shell/prompt-editor.ts";
import workingMessage from "./feature/shell/working-message.ts";
import context from "./feature/context.ts";
import { installCompactThinking } from "./feature/compact-thinking.ts";
import claudeCodeStyle from "./renderer/index.ts";
import { getCompactThinkingConfig } from "./config/config.ts";

/**
 * Personal display extension: one fixed tool-card style and native Pi behavior.
 * Only tool presentation, editor, working row, footer and /context are customized.
 */
export default function (pi: ExtensionAPI): void {
	installFlushDockedBash();
	workingMessage(pi);
	customFooter(pi);
	pi.on("session_start", (_event, ctx) => applyPromptEditor(ctx));
	installCompactThinking(pi, getCompactThinkingConfig());
	claudeCodeStyle(pi);
	context(pi);
}
