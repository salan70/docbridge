import { killRunningWorkers } from "../scan/code/worker/scanner-worker";

/**
 * Forward CLI termination signals to workers. Workers lead their own process
 * group on POSIX, so the terminal's Ctrl-C no longer reaches them directly.
 */
export function killWorkersOnSignal(): void {
  const signals: NodeJS.Signals[] =
    process.platform === "win32" ? ["SIGINT", "SIGTERM"] : ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of signals) {
    const handler = (): void => {
      killRunningWorkers();
      for (const [registeredSignal, registeredHandler] of handlers) {
        process.off(registeredSignal, registeredHandler);
      }
      process.kill(process.pid, signal);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
}
