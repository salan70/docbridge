/**
 * @doc docs/auth.md#session-store
 */
export class SessionStore {
  private entries = new Map<string, string>();

  /**
   * @doc docs/auth.md#session-lookup
   */
  find(userId: string): string | undefined {
    return this.entries.get(userId);
  }

  /**
   * @doc docs/auth.md#session-eviction
   */
  evict(userId: string): void {
    this.entries.delete(userId);
  }
}
