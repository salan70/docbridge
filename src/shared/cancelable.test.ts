import { describe, expect, test } from "bun:test";

import {
  abortError,
  cancelableSequence,
  deferred,
  isAbortError,
  type Cancelable,
} from "./cancelable";

type Task<T> = Cancelable<T> & { resolve(value: T): void; cancelled: () => boolean };

/** A cancellable task the test settles by hand. */
function task<T>(): Task<T> {
  const settle = deferred<T>();
  let cancelled = false;
  return {
    promise: settle.promise,
    resolve: settle.resolve,
    cancel: () => {
      cancelled = true;
      settle.reject(abortError());
    },
    cancelled: () => cancelled,
  };
}

describe(cancelableSequence, () => {
  test("resolves with the body's result when nothing cancels it", async () => {
    const first = task<number>();
    const sequence = cancelableSequence(async (step) => (await step(first)) + 1);

    first.resolve(1);

    expect(await sequence.promise).toBe(2);
  });

  test("cancelling cancels the running step and rejects with an AbortError", async () => {
    const first = task<number>();
    const sequence = cancelableSequence(async (step) => step(first));

    sequence.cancel();

    expect(first.cancelled()).toBe(true);
    const error = await sequence.promise.catch((reason: unknown) => reason);
    expect(isAbortError(error)).toBe(true);
  });

  test("cancelling rejects at once even when the running step ignores it", async () => {
    let cancelRequested = false;
    const stubborn: Cancelable<number> = {
      promise: deferred<number>().promise,
      cancel: () => {
        cancelRequested = true;
      },
    };
    const sequence = cancelableSequence(async (step) => step(stubborn));

    sequence.cancel();

    expect(isAbortError(await sequence.promise.catch((reason: unknown) => reason))).toBe(true);
    expect(cancelRequested).toBe(true);
  });

  test("cancelling between steps cancels the next step", async () => {
    const first = task<number>();
    const second = task<number>();
    const sequence = cancelableSequence(async (step) => {
      await step(first);
      return step(second);
    });

    const settled = sequence.promise.catch((reason: unknown) => reason);
    // Cancel after the first step has finished but before the second starts.
    first.resolve(1);
    await first.promise;
    sequence.cancel();

    expect(isAbortError(await settled)).toBe(true);
    expect(second.cancelled()).toBe(true);
  });

  test("a sequence cancelled after its last step still rejects", async () => {
    const gate = deferred<void>();
    const sequence = cancelableSequence(async () => {
      await gate.promise;
      return "done";
    });

    sequence.cancel();
    gate.resolve();

    expect(isAbortError(await sequence.promise.catch((reason: unknown) => reason))).toBe(true);
  });
});

describe(isAbortError, () => {
  test("recognizes only errors named AbortError", () => {
    const abort = new Error("stop");
    abort.name = "AbortError";

    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });
});
