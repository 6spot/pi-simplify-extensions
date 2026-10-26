/**
 * Subagent model resolution.
 *
 * Agent definitions may name a model without a provider (`model: claude-sonnet-4-5`).
 * Pi's CLI rejects that reference when several providers serve the same id, which used
 * to surface as `Model "…" is ambiguous across providers`. Resolve against the models the
 * current session can actually use, and prefer the parent model when the agent inherits.
 */

export interface ModelLike {
	provider: string;
	id: string;
}

export interface ModelResolution {
	/** Canonical `provider/model` reference to pass to the child CLI. */
	reference?: string;
	/** Human-readable reason when the requested model cannot be addressed unambiguously. */
	error?: string;
	/**
	 * The requested model could not be used and the parent model is used instead.
	 * Present so the card can disclose the substitution rather than hide it.
	 */
	fallbackFrom?: string;
}

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

function canonical(model: ModelLike): string {
	return `${model.provider}/${model.id}`;
}

function uniqueByIdentity(models: readonly ModelLike[]): ModelLike[] {
	const seen = new Map<string, ModelLike>();
	for (const model of models) {
		const key = normalize(canonical(model));
		if (!seen.has(key)) seen.set(key, model);
	}
	return [...seen.values()];
}

/**
 * Resolve the agent's model, falling back to `parentModel` when the requested one is
 * unusable. A bare id is never guessed across providers; the caller can still run the
 * task on the parent model and say so on the card.
 */
export function resolveAgentModelOrParent(
	requested: string | undefined,
	available: readonly ModelLike[],
	parentModel: string | undefined,
): ModelResolution {
	const resolved = resolveAgentModel(requested, available);
	if (!resolved.error || !parentModel?.trim()) return resolved;
	const parent = resolveAgentModel(parentModel, available);
	if (parent.error) return resolved;
	return { reference: parent.reference, fallbackFrom: requested?.trim(), error: resolved.error };
}

/**
 * Resolve an agent model reference to a `provider/model` string.
 *
 * `requested` comes from the agent definition or dispatch defaults. Ambiguous bare ids are
 * rejected with an explicit list instead of being silently guessed, because guessing can
 * route work to a provider the user did not intend.
 */
export function resolveAgentModel(
	requested: string | undefined,
	available: readonly ModelLike[],
): ModelResolution {
	const reference = requested?.trim();
	if (!reference) return {};

	const candidates = uniqueByIdentity(available);
	const canonicalMatches = candidates.filter(
		(model) => normalize(canonical(model)) === normalize(reference),
	);
	if (canonicalMatches.length === 1) return { reference: canonical(canonicalMatches[0]!) };

	const slash = reference.indexOf("/");
	if (slash > 0) {
		const provider = reference.slice(0, slash).trim();
		const id = reference.slice(slash + 1).trim();
		const providerMatches = candidates.filter(
			(model) =>
				normalize(model.provider) === normalize(provider) && normalize(model.id) === normalize(id),
		);
		if (providerMatches.length === 1) return { reference: canonical(providerMatches[0]!) };
		if (providerMatches.length > 1)
			return {
				error: `Model "${reference}" is ambiguous across providers: ${providerMatches
					.map(canonical)
					.join(", ")}.`,
			};
	}

	const idMatches = candidates.filter((model) => normalize(model.id) === normalize(reference));
	if (idMatches.length === 1) return { reference: canonical(idMatches[0]!) };
	if (idMatches.length > 1)
		return {
			error: `Model "${reference}" is ambiguous across providers: ${idMatches
				.map(canonical)
				.join(", ")}. Set the agent's model to provider/model, or remove it to inherit.`,
		};

	return {
		error: `Model "${reference}" is not available in this session. Available models: ${
			candidates.map(canonical).join(", ") || "none"
		}.`,
	};
}
