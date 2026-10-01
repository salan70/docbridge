/**
 * Canonical JSON for the Phase 0 harness: object keys sorted at every depth,
 * array order kept. Objects are rebuilt without a prototype so that any key,
 * including `__proto__`, survives as an ordinary own property.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
