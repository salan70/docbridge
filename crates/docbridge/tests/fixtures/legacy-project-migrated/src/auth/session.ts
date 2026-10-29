export class SessionStore {
  private sessions = new Map<string, string>();

  find(user: string): string | undefined {
    return this.sessions.get(user);
  }

  evict(user: string): void {
    this.sessions.delete(user);
  }
}
