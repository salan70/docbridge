/** @doc docs/auth.md#session-store */
export class SessionStore {
  private sessions = new Map<string, string>();

  /** @doc docs/auth.md#session-lookup */
  find(user: string): string | undefined {
    return this.sessions.get(user);
  }

  evict(user: string): void {
    this.sessions.delete(user);
  }
}
