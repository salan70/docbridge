/** Render an unknown caught value without losing non-Error rejection details. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
