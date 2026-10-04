import { killRunningWorkers } from "../scan/code/worker/scanner-worker";

/**
 * Run `scan`, and while it runs answer a termination signal by killing the
 * workers and probes it started and then ending by that signal. A worker
 * leads its own process group on POSIX, so a terminal's Ctrl-C does not reach
 * it. The handlers cover only the scan: a handler cannot run while the CLI
 * blocks reading stdin, and its presence would keep the signal from ending
 * the process.
 */
export async function killingWorkersOnSignal<Result>(scan: () => Promise<Result>): Promise<Result> {
  const signals: NodeJS.Signals[] =
    process.platform === "win32" ? ["SIGINT", "SIGTERM"] : ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = new Map<NodeJS.Signals, () => void>();
  const remove = (): void => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
  };
  for (const signal of signals) {
    const handler = (): void => {
      killRunningWorkers();
      remove();
      process.kill(process.pid, signal);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  try {
    return await scan();
  } finally {
    remove();
  }
}
