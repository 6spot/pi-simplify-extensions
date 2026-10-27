/**
 * ccstyle 工具卡本体：call/result 渲染，不碰原型补丁。
 * default 用它接管 ToolExecutionComponent；compact 展开面板复用同一份 render。
 */
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { config, getToolDisplayConfig } from "../../config/config.ts";
import { bashOutputText, createBashCallComponent, createBashResultComponent } from "./bash.ts";
import {
	FILE_PANEL_TOOL_NAMES,
	createFileToolCallComponent,
	createFileToolResultComponent,
	fileToolText,
} from "./file-tools.ts";
import { isToolCallHovered } from "../mouse/hover.ts";
import {
	ASK_USER_QUESTION_TOOL_NAME,
	askUserExpandedBody,
	askUserQuestionCount,
	createAskUserResultComponent,
} from "./ask-user-question.ts";
import {
	CODEMODE_TOOL_NAME,
	codemodeExpandedBody,
	codemodeCalls,
	codemodeSummaryParts,
	createCodemodeResultComponent,
} from "./codemode.ts";
import { countEditDiffStats, countWriteDiffStats } from "./diff/diff-renderer.ts";
import { boundedTextPreview } from "./preview.ts";
import { toolCardFamily } from "./card-family.ts";
import { titleControlComponent } from "./card-header.ts";
import { argumentPreview } from "../../utils/argument-preview.ts";
import { renderRichToolResult, type WriteExecutionMetadataStore } from "./diff/index.ts";
import { mcpToolTitle } from "./mcp-title.ts";
import {
	humanizeToolLabel,
	renderToolHeaderToWidth,
	renderToolSummary,
	SHELL_TOOL_NAMES,
	toolCallSummary,
} from "./names.ts";
import {
	collapsedResultSummary,
	expandedBodyComponent,
	formatToolDuration,
	insetComponent,
	renderCollapsedToolResultToWidth,
	textFromResult,
	resultTextView,
	toolViewportWidth,
	toolElapsedMs,
} from "./result.ts";
import {
	hasExpandableDetail,
	hasExpandableResult,
	isExpandedToolIoView,
	renderExpandedToolResult,
} from "./tool-io.ts";
import {
	isToolExpanded,
	pendingIcon,
	resolveToolVisualState,
	settledIcon,
	setToolVisualState,
	toolIconColor,
	toolCardStatus,
} from "./tool-state.ts";
import { showMoreHintText, collapseHintText } from "./names.ts";
import {
	createPlanPreviewComponent,
	createPlanResultComponent,
	planFromResult,
	planSummary,
} from "./plan.ts";

/** `(+A -D)`：plain 用于占宽，styled 用于上屏。default 写标题与 compact edit/write 标题共用。 */
export function styleChangeCounts(
	fg: (color: string, text: string) => string,
	added: number,
	removed: number,
): { text: string; styled: string } {
	return {
		text: ` · +${added} −${removed}`,
		styled: `${fg("dim", " · ")}${fg("success", `+${added}`)} ${fg("error", `−${removed}`)}`,
	};
}

/** Rich Diff is always enabled for successful edit/write calls. */
export function shouldRenderRichDiff(toolName: string, isError: boolean): boolean {
	return !isError && (toolName === "edit" || toolName === "write");
}

type ParsedTask = { id: string; status: string; subject: string };

function parseTaskList(text: string): ParsedTask[] {
	return text
		.split("\n")
		.map((line) => line.match(/^#(\d+) \[([^\]]+)] (.+)$/))
		.filter((match): match is RegExpMatchArray => Boolean(match))
		.map((match) => ({ id: match[1]!, status: match[2]!, subject: match[3]! }));
}

function taskListSummary(tasks: ParsedTask[]): string {
	const counts = { pending: 0, in_progress: 0, completed: 0 };
	for (const task of tasks) {
		if (task.status in counts) counts[task.status as keyof typeof counts]++;
	}
	return [
		`${tasks.length} tasks`,
		counts.in_progress ? `${counts.in_progress} in progress` : "",
		counts.pending ? `${counts.pending} pending` : "",
		counts.completed ? `${counts.completed} completed` : "",
	]
		.filter(Boolean)
		.join(" · ");
}

function renderExpandedTaskResult(
	toolName: string,
	text: string,
	theme: any,
	isError: boolean,
): any | undefined {
	if (isError) return undefined;
	if (toolName === "TaskList") {
		const tasks = parseTaskList(text);
		if (!tasks.length) return undefined;
		const limit = Math.max(1, config.expandedPreviewMaxLines);
		const rows = tasks.slice(0, limit).map((task) => {
			const color =
				task.status === "completed"
					? "success"
					: task.status === "in_progress"
						? "warning"
						: "muted";
			return `${theme.fg("accent", `#${task.id}`)} ${theme.fg(color, task.status)} ${theme.fg("dim", task.subject)}`;
		});
		if (tasks.length > rows.length)
			rows.push(theme.fg("muted", `… ${tasks.length - rows.length} more tasks`));
		// 贴左：外层展开卡片 Box(1,1) 提供 1 格 padding
		return new Text(
			`↳ ${theme.fg("muted", taskListSummary(tasks))}\n${rows.map((r) => `  ${r}`).join("\n")}`,
			0,
			0,
		);
	}
	const line = text.trim();
	if (!line || line.includes("\n")) return undefined;
	let formatted: string | undefined;
	let match: RegExpMatchArray | null;
	if (
		toolName === "TaskCreate" &&
		(match = line.match(/^Task #(\d+) created successfully: (.+)$/))
	) {
		formatted = `${theme.fg("success", "Created task")} ${theme.fg("accent", `#${match[1]}`)} ${theme.fg("muted", match[2])}`;
	} else if (toolName === "TaskUpdate" && (match = line.match(/^Updated task #(\d+) (.+)$/))) {
		formatted = `${theme.fg("success", "Updated task")} ${theme.fg("accent", `#${match[1]}`)} ${theme.fg("muted", match[2])}`;
	} else if (toolName === "TaskExecute") {
		formatted = `${theme.fg("success", "Started")} ${theme.fg("muted", line)}`;
	} else if (toolName === "TaskStop") {
		formatted = `${theme.fg("success", "Stopped")} ${theme.fg("muted", line)}`;
	}
	return formatted ? new Text(`↳ ${formatted}`, 0, 0) : undefined;
}

/**
 * shell 的耗时文本。Pi 原生 shell 渲染器会在结果底部报一行，ccstyle 的通用折叠行把它盖掉了。
 *
 * 两条路都要：新 Pi 在渲染上下文里给 `durationMs`（单调，restore 出来的行也带得到），优先用它；
 * 拿不到（旧 Pi、无耗时的结果）再退回自己的时钟——开始时间在 renderCall 记，结束时间在结果定型时定一次。
 * 运行中的实时计时也只能走时钟。
 */
function shellDurationText(toolName: string, context: any, isPartial: boolean): string {
	if (!SHELL_TOOL_NAMES.has(toolName)) return "";
	const elapsed = toolElapsedMs(context, isPartial);
	return elapsed === undefined ? "" : formatToolDuration(elapsed);
}

/** 用 ccstyle call/result 包装任意工具定义。 */
export function createCcstyleTool(
	originalTool: any,
	writeExecutionMetadata: WriteExecutionMetadataStore,
	toolName: string,
): any {
	const label = originalTool.label || toolName;
	const defaultTitle = label === toolName ? humanizeToolLabel(label) : label;
	// MCP 工具直接用 adapter 暴露的真实工具名，不做人性化
	const mcpTitle = mcpToolTitle({ toolName, definition: originalTool });
	const family = toolCardFamily(toolName, originalTool);
	const generic =
		family === "generic" ||
		(family === "task" &&
			typeof originalTool.renderCall !== "function" &&
			typeof originalTool.renderResult !== "function");
	const title = mcpTitle
		? mcpTitle.startsWith("MCP")
			? mcpTitle
			: `MCP · ${mcpTitle}`
		: generic
			? `Tool · ${toolName}`
			: toolName === ASK_USER_QUESTION_TOOL_NAME
				? "Question"
				: defaultTitle;

	return {
		...originalTool,
		renderShell: "self",
		renderCall(args: any, theme: any, context: any) {
			context = { ...context, lastComponent: undefined };
			if (!context.expanded && !context.result && context.state)
				context.state.ccstyleIoView = undefined;
			const expanded = Boolean(context.expanded);
			const waitingView =
				expanded && !context.result && (generic || toolName !== "update_plan")
					? renderExpandedToolResult(
							context.executionStarted ? "Waiting for output…" : "Receiving arguments…",
							theme,
							false,
							context.state?.ccstyleIoView,
							args,
							context,
							true,
						)
					: undefined;
			const framedCall = (view: any) =>
				titleControlComponent(
					waitingView
						? {
								render(width: number) {
									return [...view.render(width), ...waitingView.render(width)];
								},
								invalidate() {
									view.invalidate?.();
									waitingView.invalidate?.();
								},
							}
						: view,
				);
			// shell 的耗时从执行开始算；restore 出来的行没有 executionStarted，不参与。
			if (
				!generic &&
				SHELL_TOOL_NAMES.has(toolName) &&
				context?.executionStarted &&
				context.state &&
				context.state.ccstyleShellStartedAt === undefined
			) {
				context.state.ccstyleShellStartedAt = Date.now();
			}

			if (!generic && FILE_PANEL_TOOL_NAMES.has(toolName))
				return framedCall(
					createFileToolCallComponent(
						toolName,
						args,
						context,
						theme,
						() => isToolCallHovered(context?.toolCallId),
						!waitingView,
					),
				);

			if (!generic && SHELL_TOOL_NAMES.has(toolName)) {
				return framedCall(
					createBashCallComponent({
						showInput: !waitingView,
						toolName,
						args,
						context,
						theme,
						elapsed: () => shellDurationText(toolName, context, Boolean(context?.isPartial)),
						isHovered: () => isToolCallHovered(context?.toolCallId),
					}),
				);
			}

			if (
				!generic &&
				toolName === "update_plan" &&
				context?.result &&
				context?.isPartial === false
			) {
				setToolVisualState(
					context,
					context.isError || context.result.isError ? "error" : "success",
				);
			}
			const visualState =
				toolName === CODEMODE_TOOL_NAME && !generic
					? toolCardStatus({
							toolName,
							result: context?.result,
							isPartial: context?.isPartial,
							isError: context?.isError,
						})
					: resolveToolVisualState(context);
			const isPending =
				!context?.result ||
				context?.isPartial === true ||
				visualState === "pending" ||
				(!visualState && (context?.isPartial || context?.executionStarted));
			let settledRawIcon = isPending ? "" : settledIcon(toolName, visualState);
			// Codemode 展开为子调用树，成功容器标题与工具分组统一；子项仍用勾。
			const codemodeFailed =
				!generic &&
				toolName === CODEMODE_TOOL_NAME &&
				codemodeCalls(context?.result).some((call) => call?.status === "error");
			if (!generic && toolName === CODEMODE_TOOL_NAME && visualState === "success")
				settledRawIcon = codemodeFailed ? "✗" : "●";
			const incompletePlan =
				!generic &&
				toolName === "update_plan" &&
				!isPending &&
				!context?.isError &&
				planFromResult(context?.result)?.steps.some((step) => step.status !== "completed");
			const settledIconStyled = theme.fg(
				visualState === "unknown" || visualState === "cancelled"
					? "muted"
					: codemodeFailed && !isPending
						? "error"
						: toolIconColor(context),
				settledRawIcon,
			);
			// Working 负责全局活动动画；工具行使用静态标记保留进行中状态。
			const pendingIconStyled = () => theme.fg("accent", pendingIcon(toolName));
			const inputSummary = generic ? argumentPreview(args) : "";
			let summaryArgs = args;
			if (generic) {
				try {
					summaryArgs = JSON.parse(inputSummary);
				} catch {
					summaryArgs = {};
				}
			}
			const summary = toolCallSummary(toolName, summaryArgs, {
				title,
				variant: "default",
				cwd: context?.cwd,
			});
			if (!generic && toolName === "update_plan") {
				const description = planSummary(args, context?.result, false);
				summary.detail = description ? ` · ${description}` : "";
				summary.payload = undefined;
			}
			if (!generic && toolName === CODEMODE_TOOL_NAME) {
				summary.main = title;
				summary.path = undefined;
				summary.payload = undefined;
				summary.detail = ` · ${codemodeSummaryParts(codemodeCalls(context?.result), 0, isPending).join(" · ")}`;
			}
			// ask_user_question：问题原文在折叠结果树里逐条列出，标题只留工具名和问题数，
			// 否则第一个问题会在标题和树里各出现一次。
			if (!generic && toolName === ASK_USER_QUESTION_TOOL_NAME) {
				// Pi 的渲染上下文不带 result，问题数从这里取。
				const questionCount = askUserQuestionCount(context?.result, args);
				summary.main = title;
				summary.detail =
					(questionCount === undefined ? "" : ` · ${questionCount} questions`) +
					(isPending ? ` · ${context?.executionStarted ? "waiting" : "receiving"}` : "");
				summary.payload = undefined;
			}
			const subject = generic
				? mcpTitle && (summary.main !== title || summary.payload)
					? [
							summary.main !== title ? summary.main.replace(/^MCP\s+/, "") : "",
							summary.payload,
							summary.detail,
						]
							.filter(Boolean)
							.map((part) => part!.trim())
							.join(" ")
					: inputSummary
				: toolName === "edit" || toolName === "write"
					? (summary.path?.value ?? "")
					: "";
			if (generic || toolName === "edit" || toolName === "write") {
				summary.main = title;
				summary.path = undefined;
				summary.payload = undefined;
				summary.detail = "";
			}
			let writeStatsText = "";
			let writeStatsStyled = "";
			if (!generic && (toolName === "write" || toolName === "edit") && visualState === "success") {
				const meta = writeExecutionMetadata.get(context?.toolCallId);
				const stats =
					toolName === "edit"
						? countEditDiffStats(context?.result?.details)
						: countWriteDiffStats(
								typeof args?.content === "string" ? args.content : undefined,
								meta?.previousContent,
								meta?.fileExistedBeforeWrite,
							);
				if (stats) {
					const counts = styleChangeCounts(
						(color, text) => theme.fg(color, text),
						stats.added,
						stats.removed,
					);
					writeStatsText = counts.text;
					writeStatsStyled = counts.styled;
				}
			}
			const elapsed = toolElapsedMs(
				context,
				Boolean(context?.isPartial),
				!generic && SHELL_TOOL_NAMES.has(toolName),
			);
			const durationText =
				(elapsed === undefined ? "" : ` · ${formatToolDuration(elapsed)}`) +
				(visualState === "cancelled" ? " · cancelled" : "");
			const extraText = (writeStatsText || summary.detail) + durationText;
			const extraStyled =
				(writeStatsStyled || theme.fg("dim", summary.detail)) + theme.fg("dim", durationText);
			let cachedWidth: number | undefined;
			let cachedLine: string | undefined;
			let cachedIcon: string | undefined;
			const framed = expanded || (!generic && toolName === "update_plan");
			// Pi does not call renderResult before the first result; show streamed steps in the call.
			const preview =
				!generic && toolName === "update_plan" && !context?.result
					? createPlanPreviewComponent({ args, theme, expanded })
					: undefined;
			return titleControlComponent({
				render(width: number) {
					const icon = isPending
						? pendingIconStyled()
						: incompletePlan && !context?.isGrouped?.()
							? theme.fg("accent", "○")
							: settledIconStyled;
					const viewportWidth = toolViewportWidth(width);
					if (cachedLine === undefined || cachedWidth !== width || cachedIcon !== icon) {
						// 展开态贴左（外层 Box 已 pad 1）；折叠 self-shell 保留 1 格前导空格
						const lead = framed ? "" : " ";
						const callWidth = Math.max(
							0,
							viewportWidth - visibleWidth(icon) - 1 - (framed ? 0 : 1),
						);
						const mainWidth = Math.max(0, callWidth - visibleWidth(extraText));
						cachedWidth = width;
						cachedIcon = icon;
						// 路径按最终可用宽度中间截断，避免整行二次截断隐藏文件名。
						cachedLine = `${lead}${icon} ${renderToolSummary(summary, mainWidth, theme.fg.bind(theme))}${extraStyled}`;
					}
					const text = textFromResult(context?.result, false);
					const hasDetails =
						(generic
							? hasExpandableDetail(text, summaryArgs) || inputSummary.endsWith("…")
							: hasExpandableDetail(text, args)) ||
						(generic &&
							Boolean(context?.result) &&
							typeof originalTool.renderResult === "function") ||
						boundedTextPreview(text, { width: Math.max(1, viewportWidth - 3), maxRows: 4 }).omitted;
					const hint =
						!context?.isGrouped?.() && (expanded || hasDetails)
							? theme.fg(
									isToolCallHovered(context?.toolCallId) ? "text" : "dim",
									` · ${expanded ? collapseHintText() : showMoreHintText()}`,
								)
							: "";
					const subjectPreview =
						!expanded && subject
							? boundedTextPreview(subject, { width: Math.max(1, viewportWidth - 3), maxRows: 2 })
							: undefined;
					return [
						renderToolHeaderToWidth(cachedLine, hint, viewportWidth),
						...(subjectPreview?.rows.map((row) => `   ${theme.fg("mdCode", row)}`) ?? []),
						...(subjectPreview?.omitted || (!expanded && generic && inputSummary.endsWith("…"))
							? [theme.fg("dim", "   … More input hidden")]
							: []),
						...(preview?.render(viewportWidth) ?? []),
						...(waitingView?.render(width) ?? []),
					];
				},
				invalidate() {
					cachedLine = undefined;
					cachedIcon = undefined;
				},
			});
		},
		renderResult(result: any, options: any, theme: any, context: any) {
			const expanded = isToolExpanded(options, context);
			const isError = Boolean(options?.isError || context?.isError || result?.isError);
			result = { ...context?.result, ...result, isError };
			const visualState = toolCardStatus({
				toolName,
				toolDefinition: originalTool,
				result,
				isError,
				isPartial: Boolean(options?.isPartial),
			});
			const displayError = isError && visualState !== "cancelled";
			setToolVisualState(context, visualState);
			if (generic && expanded && typeof originalTool.renderResult === "function") {
				try {
					const originalView = originalTool.renderResult(result, options, theme, context);
					if (originalView && typeof originalView.render === "function") return originalView;
				} catch {
					// A presentation failure must not change the tool's actual outcome.
				}
			}
			if (!generic && toolName === "update_plan" && !isError && !result?.isError) {
				const plan = planFromResult(result);
				if (plan) {
					if (context?.state) context.state.ccstyleIoView = undefined;
					return createPlanResultComponent({
						plan,
						args: context?.args,
						theme,
						expanded,
						isGrouped: context?.isGrouped,
					});
				}
				if (options?.isPartial) {
					if (context?.state) context.state.ccstyleIoView = undefined;
					return createPlanPreviewComponent({ args: context?.args, theme, expanded });
				}
			}
			// codemode：折叠态自己画子调用树，展开态给全部子调用与去掉脚本头的输出
			if (!generic && toolName === CODEMODE_TOOL_NAME) {
				if (expanded) {
					return renderExpandedToolResult(
						codemodeExpandedBody(result),
						theme,
						displayError,
						context?.lastComponent,
						context?.args,
						context,
						true,
					);
				}
				// 折叠态不再复用展开视图，免得 hover/鼠标命中指向已隐藏的组件
				if (context?.state) context.state.ccstyleIoView = undefined;
				const toolCallId = context?.toolCallId;
				return createCodemodeResultComponent({
					result,
					theme,
					running: Boolean(options?.isPartial),
					isError: displayError,
					isHovered: () => isToolCallHovered(toolCallId),
					code: context?.args?.code,
				});
			}
			// ask_user_question：折叠态摊成问答树，展开态按问题逐条列出选择。
			if (!generic && toolName === ASK_USER_QUESTION_TOOL_NAME) {
				if (options?.isPartial) {
					return createAskUserResultComponent({
						result,
						theme,
						isError: displayError,
						args: context?.args,
						running: true,
					});
				}
				if (expanded) {
					return renderExpandedToolResult(
						askUserExpandedBody(result),
						theme,
						displayError,
						context?.lastComponent,
						context?.args,
						context,
						true,
					);
				}
				if (context?.state) context.state.ccstyleIoView = undefined;
				const toolCallId = context?.toolCallId;
				return createAskUserResultComponent({
					result,
					theme,
					isError: displayError,
					args: context?.args,
					isHovered: () => isToolCallHovered(toolCallId),
				});
			}
			if (!generic && FILE_PANEL_TOOL_NAMES.has(toolName)) {
				if (expanded)
					return renderExpandedToolResult(
						fileToolText(result, true),
						theme,
						displayError,
						context?.lastComponent,
						context?.args,
						context,
						true,
					);
				if (context?.state) context.state.ccstyleIoView = undefined;
				return createFileToolResultComponent(
					toolName,
					context?.args,
					{ ...result, isError: Boolean(isError) },
					theme,
					Boolean(options?.isPartial),
				);
			}
			if (!generic && SHELL_TOOL_NAMES.has(toolName)) {
				if (!options?.isPartial) {
					if (context?.state && context.state.ccstyleShellEndedAt === undefined)
						context.state.ccstyleShellEndedAt = Date.now();
				}
				if (expanded)
					return renderExpandedToolResult(
						bashOutputText(result),
						theme,
						displayError,
						context?.lastComponent,
						context?.args,
						context,
						true,
					);
				if (context?.state) context.state.ccstyleIoView = undefined;
				return createBashResultComponent({
					toolName,
					args: context?.args,
					result,
					theme,
					isPartial: Boolean(options?.isPartial),
				});
			}
			if (options?.isPartial && !expanded) {
				const text = textFromResult(result, false);
				return {
					render(width: number) {
						const preview = boundedTextPreview(text || "Running…", {
							width: Math.max(1, toolViewportWidth(width) - 3),
							maxRows: 4,
						});
						return [
							...preview.rows.map((row) => `   ${theme.fg("muted", row)}`),
							...(preview.omitted ? [theme.fg("dim", "  … More output hidden")] : []),
						];
					},
					invalidate() {},
				};
			}

			const toolCallId = context?.toolCallId;
			if (!generic && shouldRenderRichDiff(toolName, Boolean(isError))) {
				// getter 保证 Diff indicator / wrap / limits 下次绘制即更新
				const richResult = renderRichToolResult(
					toolName,
					result,
					{
						...options,
						expanded,
						// 全局共享状态避免 /reload 后旧 result renderer 闭包失联
						isHovered: () => isToolCallHovered(toolCallId),
					},
					theme,
					context,
					writeExecutionMetadata,
					getToolDisplayConfig,
				);
				// 展开态由 Box(1,1) 提供内边距，首行再缩 2 格与标题文字列对齐；折叠态 inset 一级缩进
				if (richResult)
					return expanded ? expandedBodyComponent(richResult) : insetComponent(richResult);
			}

			const { text, displayLimited } = resultTextView(result, expanded);
			const args = context?.args;
			if (expanded) {
				const taskResult = renderExpandedTaskResult(toolName, text, theme, displayError);
				if (taskResult) return taskResult;
			}
			if (expanded) {
				const view = renderExpandedToolResult(
					text || "",
					theme,
					displayError,
					context?.lastComponent,
					args,
					context,
					true, // mode=on：贴左，由外层 Box(1,1) 提供 1 格 padding
				);
				return view;
			}
			if (context?.state) context.state.ccstyleIoView = undefined;
			const output =
				text ||
				(result?.content?.some((item: any) => item.type === "image")
					? "Image result"
					: "No output");
			let cachedWidth: number | undefined;
			let cachedRows: string[] | undefined;
			return {
				render(width: number) {
					if (cachedRows === undefined || cachedWidth !== width) {
						cachedWidth = width;
						const preview = boundedTextPreview(output, {
							width: Math.max(1, toolViewportWidth(width) - 3),
							maxRows: 4,
						});
						cachedRows = preview.rows.map(
							(row) => `   ${theme.fg(displayError ? "error" : "muted", row)}`,
						);
						if (preview.omitted)
							cachedRows.push(
								theme.fg(
									"dim",
									preview.hiddenLines !== undefined && !displayLimited
										? `   … ${preview.hiddenLines} more lines in result`
										: "  … More output hidden",
								),
							);
						if (
							displayLimited &&
							!preview.rows.some((row) =>
								/^\[Display limit reached · (?:output|structured result) excerpt\]$/.test(
									row.trim(),
								),
							)
						)
							cachedRows.push(theme.fg("dim", "  [Display limit reached · output excerpt]"));
						cachedRows = cachedRows.map((row) =>
							truncateToWidth(row, toolViewportWidth(width), "…"),
						);
					}
					return cachedRows;
				},
				invalidate() {
					cachedRows = undefined;
				},
			};
		},
	};
}
