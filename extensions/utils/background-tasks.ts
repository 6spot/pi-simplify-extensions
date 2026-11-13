type BackgroundTaskState = { status: "running" | "blocked" };

/**
 * Pi loads each extension entry in its own module graph, so a plain module-level store would not be
 * shared between this display package and the separately installed Subagent package.
 */
const REGISTRY = Symbol.for("pi-simplify.background-tasks");
type Registry = { active: readonly BackgroundTaskState[] };
const registry = ((globalThis as typeof globalThis & { [key: symbol]: Registry | undefined })[REGISTRY] ??= {
	active: [],
});

/** Written by the Subagent extension so the Working row can carry the task counts. */
export function setActiveBackgroundTasks(tasks: readonly BackgroundTaskState[]): void {
	registry.active = tasks;
}

/** `1 background · 1 waiting`, empty when no background task is active. */
export function backgroundTaskSummary(): string {
	const active = registry.active;
	const waiting = active.filter((task) => task.status === "blocked").length;
	const running = active.length - waiting;
	return [running ? `${running} background` : "", waiting ? `${waiting} waiting` : ""]
		.filter(Boolean)
		.join(" · ");
}
