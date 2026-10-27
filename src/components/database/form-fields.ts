import type { FormConfig, FormField, Property } from "../../types";
import { TITLE_ID, TITLE_PROPERTY } from "./view-config";

export interface ResolvedField extends FormField {
  prop: Property;
}

/** The questions a form asks: the configured ones, else the title (required) and every property — as Rust does. */
export function resolveFields(
  form: FormConfig | undefined,
  properties: Property[],
): ResolvedField[] {
  const byId = new Map([TITLE_PROPERTY, ...properties].map((p) => [p.id, p]));
  const fields: FormField[] = form?.fields ?? [
    { property: TITLE_ID, required: true },
    ...properties.map((p) => ({ property: p.id })),
  ];
  return fields.flatMap((f) => {
    const prop = byId.get(f.property);
    return prop ? [{ ...f, prop }] : [];
  });
}
