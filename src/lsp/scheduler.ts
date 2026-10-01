import { isAbortError, type Cancelable } from "../shared/cancelable";
import type { ProjectState } from "./project";

/** The timer functions the scheduler debounces with; tests pass manual ones. */
export type Timers = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

type RescanSchedulerOptions = {
  /** Start a background scan of the project. */
  scan: () => Cancelable<ProjectState>;
  /** Receives the state of every scan accepted as current. */
  onState: (state: ProjectState) => void;
  /** Receives a scan failure other than cancellation. */
  onError: (error: unknown) => void;
  debounceMs: number;
  timers: Timers;
};

type ActiveScan = {
  generation: number;
  task: Cancelable<ProjectState>;
};

/**
 * Decides when the Language Server rescans. Every request makes the running
 * scan stale and cancels it. At most one scan runs at a time; requests that
 * arrive meanwhile leave one follow-up, which starts once the running scan has
 * settled and the debounce has elapsed. A scan's state is accepted only when
 * no request arrived after it started and the scheduler has not stopped.
 *
 * @doc docs/specs/lsp.md#rescan-scheduling
 */
export class RescanScheduler {
  /** Counts requests; a scan is current while this still equals its start value. */
  private generation = 0;
  /** Whether a request arrived that no started scan covers yet. */
  private dirty = false;
  private debounce: { handle: unknown } | undefined;
  private active: ActiveScan | undefined;
  private stopped = false;

  constructor(private readonly options: RescanSchedulerOptions) {}

  /**
   * Content or configuration may have changed. Cancel the running scan and
   * rescan, at once (`now`) or after the debounce window (`debounced`), which
   * every further debounced request restarts.
   */
  request(when: "now" | "debounced"): void {
    if (this.stopped) {
      return;
    }
    this.generation += 1;
    this.dirty = true;
    this.active?.task.cancel();
    this.clearDebounce();
    if (when === "debounced") {
      const handle = this.options.timers.setTimeout(() => {
        this.debounce = undefined;
        this.startIfReady();
      }, this.options.debounceMs);
      this.debounce = { handle };
      return;
    }
    this.startIfReady();
  }

  /** Stop for good: cancel the running scan, drop pending work, accept nothing more. */
  stop(): void {
    this.stopped = true;
    this.clearDebounce();
    this.active?.task.cancel();
  }

  private startIfReady(): void {
    if (this.stopped || !this.dirty || this.active !== undefined || this.debounce !== undefined) {
      return;
    }
    this.dirty = false;
    const active: ActiveScan = { generation: this.generation, task: this.options.scan() };
    this.active = active;
    active.task.promise.then(
      (state) => this.settle(active, () => this.accept(active, state)),
      (error: unknown) => this.settle(active, () => this.fail(error)),
    );
  }

  private settle(active: ActiveScan, report: () => void): void {
    if (this.active === active) {
      this.active = undefined;
    }
    report();
    this.startIfReady();
  }

  private accept(active: ActiveScan, state: ProjectState): void {
    if (!this.stopped && active.generation === this.generation) {
      this.options.onState(state);
    }
  }

  private fail(error: unknown): void {
    if (!isAbortError(error)) {
      this.options.onError(error);
    }
  }

  private clearDebounce(): void {
    if (this.debounce !== undefined) {
      this.options.timers.clearTimeout(this.debounce.handle);
      this.debounce = undefined;
    }
  }
}
