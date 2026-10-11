/**
 * An operation whose result arrives later and that can be stopped. After
 * `cancel()`, `promise` rejects with an error that {@link isAbortError}
 * recognizes, unless it has already settled.
 */
export type Cancelable<T> = {
  promise: Promise<T>;
  cancel(): void;
};

/** An operation that has already finished with `value`; cancelling it does nothing. */
export function settledCancelable<T>(value: T): Cancelable<T> {
  return { promise: Promise.resolve(value), cancel: () => undefined };
}

/**
 * `task` with its result passed through `map`. Cancelling cancels `task` and
 * rejects at once with an `AbortError` unless the mapped result has settled,
 * even when `task` itself has already finished; `map` then never runs.
 */
export function mapCancelable<T, U>(task: Cancelable<T>, map: (value: T) => U): Cancelable<U> {
  const mapped = Promise.withResolvers<U>();
  let cancelled = false;
  task.promise
    .then((value) => {
      if (cancelled) {
        throw abortError();
      }
      return map(value);
    })
    .then(mapped.resolve, mapped.reject);
  return {
    promise: mapped.promise,
    cancel() {
      cancelled = true;
      mapped.reject(abortError());
      task.cancel();
    },
  };
}

/** The rejection a cancelled operation settles with. */
export function abortError(): Error {
  const error = new Error("The operation was cancelled");
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Runs one cancellable step of a sequence and waits for its result. The step
 * is a task already started, or a function that starts it; once the sequence
 * is cancelled, such a task is cancelled and such a function is never called.
 */
type Step = <U>(next: Cancelable<U> | (() => Cancelable<U>)) => Promise<U>;

/**
 * Run `body` as one cancellable operation. The body starts at once and runs
 * each cancellable step through `step`. Cancelling rejects the operation at
 * once, without waiting for the running step to wind down; it also cancels
 * the running step and any step the body passes later, which it starts only
 * when the step is a task already started, and the body's own result is then
 * ignored.
 */
export function cancelableSequence<T>(body: (step: Step) => Promise<T>): Cancelable<T> {
  const outcome = Promise.withResolvers<T>();
  let cancelled = false;
  let running: Cancelable<unknown> | undefined;

  const step: Step = async (next) => {
    if (cancelled) {
      if (typeof next !== "function") {
        // Nothing awaits this task's rejection; observe it so it is not reported.
        next.promise.catch(() => undefined);
        next.cancel();
      }
      throw abortError();
    }
    const task = typeof next === "function" ? next() : next;
    running = task;
    try {
      return await task.promise;
    } finally {
      if (running === task) {
        running = undefined;
      }
    }
  };

  // A promise ignores resolve and reject calls after it has settled, so after
  // cancellation the body's result or failure is dropped.
  (async () => body(step))().then(outcome.resolve, outcome.reject);

  return {
    promise: outcome.promise,
    cancel() {
      if (cancelled) {
        return;
      }
      cancelled = true;
      outcome.reject(abortError());
      running?.cancel();
    },
  };
}
