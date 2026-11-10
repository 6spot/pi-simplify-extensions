import { Type } from "typebox";

/**
 * `{ type: "string", enum: [...] }`, the shape Google and other providers accept instead of
 * anyOf/const. Pi's `StringEnum` returns pi-schema's `Schema`, which TypeBox cannot read inside
 * `Type.Object`, so registerTool would infer the parameter as `unknown`.
 */
export function StringEnum<T extends readonly string[]>(
	values: T,
	options?: { description?: string; default?: T[number] },
) {
	return Type.Unsafe<T[number]>({
		type: "string",
		enum: values,
		...(options?.description && { description: options.description }),
		...(options?.default !== undefined && { default: options.default }),
	});
}
