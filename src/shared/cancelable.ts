/**
 * An operation whose result arrives later and that can be stopped. After
 * `cancel()`, `promise` rejects with an error that {@link isAbortError}
 * recognizes, unless it has already settled.
 */
export type Cancelable<T> = {
  promise: Promise<T>;
  cancel(): void;
};

/** A promise together with the functions that settle it. */
type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

/** Create a {@link Deferred}, for settling a promise from callbacks. */
export function deferred<T>(): Deferred<T> {
  let settle: Pick<Deferred<T>, "resolve" | "reject"> | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject };
  });
  return {
    promise,
    resolve: (value) => settle?.resolve(value),
    reject: (error) => settle?.reject(error),
  };
}

/** An operation that has already finished with `value`; cancelling it does nothing. */
export function settledCancelable<T>(value: T): Cancelable<T> {
  return { promise: Promise.resolve(value), cancel: () => undefined };
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

/** Starts one cancellable step of a sequence and waits for its result. */
type Step = <U>(task: Cancelable<U>) => Promise<U>;

/**
 * Run `body` as one cancellable operation. The body starts each cancellable
 * step through `step`. Cancelling cancels the running step, cancels any step
 * started later at once, and rejects even when the body has finished its last
 * step but not yet returned.
 */
export function cancelableSequence<T>(body: (step: Step) => Promise<T>): Cancelable<T> {
  let cancelled = false;
  let running: Cancelable<unknown> | undefined;

  const step: Step = async (task) => {
    if (cancelled) {
      // Nothing awaits this task's rejection; observe it so it is not reported.
      task.promise.catch(() => undefined);
      task.cancel();
      throw abortError();
    }
    running = task;
    try {
      return await task.promise;
    } finally {
      if (running === task) {
        running = undefined;
      }
    }
  };

  const promise = (async () => {
    const result = await body(step);
    if (cancelled) {
      throw abortError();
    }
    return result;
  })();

  return {
    promise,
    cancel() {
      if (cancelled) {
        return;
      }
      cancelled = true;
      running?.cancel();
    },
  };
}
