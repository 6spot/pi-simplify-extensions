import { Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { sanitizeToolResultText } from "../../utils/tool-result-sanitize.ts";

type PlanStatus = "pending" | "in_progress" | "completed";
export type PlanStep = { id: string; goal: string; status: PlanStatus };
type PlanView = { steps: PlanStep[]; advice: string[] };

function planSteps(value: unknown): PlanStep[] | undefined {
	if (!Array.isArray(value) || !value.length || value.length > 128) return;
	const ids = new Set<string>();
	for (const step of value) {
		if (
			!step ||
			typeof step !== "object" ||
			typeof step.id !== "string" ||
			!step.id.trim() ||
			ids.has(step.id) ||
			typeof step.goal !== "string" ||
			!step.goal.trim() ||
			!["pending", "in_progress", "completed"].includes(step.status)
		)
			return;
		ids.add(step.id);
	}
	return value;
}

const strings = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && !!item.trim())
		: [];
const clean = (value: string) => sanitizeToolResultText(value);
const oneLine = (value: string) => clean(value).replace(/\s+/g, " ").trim();

/** Display accepted SoL-Pi state; never turn a failed or unknown result into a successful input checklist. */
export function planFromResult(result: any): PlanView | undefined {
	if (!result || result.isError) return;
	const accepted = planSteps(result.details?.plan);
	const text = Array.isArray(result.content)
		? result.content
				.filter((part: any) => part?.type === "text" && typeof part.text === "string")
				.map((part: any) => part.text)
				.join("\n")
		: "";
	const match = /^<sol-pi-plan\b[^>]*>([\s\S]*)<\/sol-pi-plan>/.exec(text.trimStart());
	const advice = strings(match ? text.trimStart().slice(match[0].length).split("\n") : []);
	if (accepted) return { steps: accepted, advice };
	if (!match) return;
	try {
		const steps = planSteps(JSON.parse(match[1]).steps);
		if (steps) return { steps, advice };
	} catch {
		/* Unknown result stays on the ordinary result path. */
	}
}

/** Incoming arguments are a neutral preview, never an accepted completion count. */
function previewSteps(args: any): PlanStep[] {
	if (!Array.isArray(args?.steps)) return [];
	return args.steps.slice(0, 128).flatMap((step: any, index: number) =>
		typeof step?.goal === "string" && step.goal.trim()
			? [
					{
						id: String(index),
						goal: step.goal,
						status: ["pending", "in_progress", "completed"].includes(step.status)
							? step.status
							: "pending",
					},
				]
			: [],
	);
}

/** One compact sentence for a group row or standalone heading. */
export function planSummary(args: any, result?: any, includeCurrent = true): string | undefined {
	if (result?.isError) return "Update failed";
	if (!result) {
		const preview = previewSteps(args);
		if (!preview.length) return;
		const active = preview.find((step) => step.status === "in_progress");
		return `updating${includeCurrent ? ` · ${oneLine(active?.goal ?? preview[0].goal)}` : ""}`;
	}
	const steps = planFromResult(result)?.steps;
	if (!steps) return;
	const done = steps.filter((step) => step.status === "completed").length;
	const active = steps.find((step) => step.status === "in_progress");
	return `${done}/${steps.length} done${includeCurrent ? (active ? ` · ${oneLine(active.goal)}` : done < steps.length ? " · pending" : "") : ""}`;
}

export function createPlanPreviewComponent(options: {
	args: any;
	theme: any;
	expanded: boolean;
}): Component {
	const steps = previewSteps(options.args);
	if (!steps.length) return new Text(options.theme.fg("dim", "  Receiving plan…"), 0, 0);
	return createPlanResultComponent({
		...options,
		plan: { steps, advice: [] },
		preview: true,
	});
}

export function createPlanResultComponent(options: {
	plan: PlanView;
	args: any;
	theme: any;
	expanded: boolean;
	isGrouped?: () => boolean;
	preview?: boolean;
}): Component {
	return {
		invalidate() {},
		render(width) {
			const { plan, theme, expanded } = options;
			const fg = (color: string, value: string) => theme.fg(color, value);
			const lines: string[] = [];
			let detailsHidden = false;
			const firstPending = plan.steps.findIndex((step) => step.status !== "completed");
			const active = plan.steps.findIndex((step) => step.status === "in_progress");
			const focus = active >= 0 ? active : firstPending >= 0 ? firstPending : plan.steps.length - 1;
			const start = expanded ? 0 : Math.max(0, Math.min(focus - 2, plan.steps.length - 6));
			const selected = expanded ? plan.steps : plan.steps.slice(start, start + 6);
			const note = (text: string) => lines.push(truncateToWidth(fg("dim", `  ${text}`), width));
			const item = (prefix: string, value: string, color: string) => {
				if (!expanded) {
					const row = prefix + fg(color, oneLine(value));
					if (visibleWidth(row) > width) detailsHidden = true;
					lines.push(truncateToWidth(row, width));
					return;
				}
				const body = new Text(fg(color, clean(value)), 0, 0).render(Math.max(1, width - 4));
				for (let i = 0; i < body.length; i++)
					lines.push(truncateToWidth((i ? "    " : prefix) + body[i], width));
			};
			if (start) note(`… ${start} earlier steps`);
			for (const step of selected) {
				const active = !options.preview && step.status === "in_progress";
				const completed = !options.preview && step.status === "completed";
				const icon = active ? fg("accent", "→") : completed ? fg("success", "✓") : fg("dim", "·");
				item(`  ${icon} `, step.goal, active ? "text" : completed ? "dim" : "muted");
			}
			const remaining = plan.steps.length - start - selected.length;
			if (remaining) note(`… ${remaining} more steps`);
			for (const advice of expanded ? plan.advice : plan.advice.slice(0, 3))
				item("  ! ", advice, "muted");
			if (!expanded && plan.advice.length > 3) note(`… ${plan.advice.length - 3} more notes`);
			if (expanded && !options.preview && !options.isGrouped?.()) {
				for (const [key, label, color] of [
					["decisions", "Decisions", "muted"],
					["files_changed", "Changed files", "mdCode"],
					["verification", "Validation", "muted"],
				]) {
					const values = strings(options.args?.progress?.[key]);
					if (!values.length) continue;
					lines.push("", fg("dim", `  ${label}`));
					for (const value of values) item("  · ", value, color);
				}
			}
			if (!expanded && detailsHidden) note("… More step details hidden");
			return lines.map((line) => truncateToWidth(line, width));
		},
	};
}
