/*
 * Bounded preview adapted from pi-zentui v0.32.0 tool-display/tool-presentation.ts:
 * https://github.com/lmilojevicc/pi-zentui/tree/9e8e798/extensions/zentui/tool-display
 *
 * MIT License
 * Copyright (c) 2025-2026 Luka
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

function prefix(text: string, limit: number): string {
	let end = Math.min(text.length, Math.max(0, limit));
	if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end -= 1;
	return text.slice(0, end);
}

/** Display only: bound work before JSON.stringify; never change execution arguments. */
export function argumentPreview(value: unknown): string {
	const maxChars = 4096;
	let remaining = maxChars;
	let entries = 256;
	let truncated = false;
	const ancestors = new Set<object>();

	function text(value: string): string {
		const result = prefix(value, remaining);
		remaining -= result.length;
		if (result.length !== value.length) truncated = true;
		return result;
	}

	function visit(value: unknown, depth: number): unknown {
		if (typeof value === "string") return text(value);
		if (typeof value === "function" || typeof value === "symbol") return undefined;
		if (!value || typeof value !== "object") return value;
		if (depth >= 16 || ancestors.has(value)) {
			truncated = true;
			return null;
		}
		ancestors.add(value);
		try {
			if (Array.isArray(value)) {
				const result: unknown[] = [];
				for (let index = 0; index < value.length; index++) {
					if (entries-- <= 0 || remaining <= 0) {
						truncated = true;
						break;
					}
					const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
					if (descriptor && !("value" in descriptor)) {
						truncated = true;
						break;
					}
					result.push(visit(descriptor?.value, depth + 1));
					if (truncated) break;
				}
				return result;
			}
			const result: Record<string, unknown> = Object.create(null);
			// Do not build an unbounded Object.keys/entries array or invoke getters/toJSON.
			for (const key in value) {
				if (!Object.hasOwn(value, key)) continue;
				if (entries-- <= 0 || remaining <= 0) {
					truncated = true;
					break;
				}
				const descriptor = Object.getOwnPropertyDescriptor(value, key);
				if (!descriptor || !("value" in descriptor)) {
					truncated = true;
					break;
				}
				const previewKey = text(key);
				result[previewKey] = truncated ? null : visit(descriptor.value, depth + 1);
				if (truncated) break;
			}
			return result;
		} finally {
			ancestors.delete(value);
		}
	}

	try {
		const json = JSON.stringify(visit(value, 0));
		if (json === undefined) return "";
		return truncated || json.length > maxChars ? `${prefix(json, maxChars - 1)}…` : json;
	} catch {
		return "";
	}
}
