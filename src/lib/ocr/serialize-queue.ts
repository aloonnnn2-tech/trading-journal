// A generic promise-chain mutex: wraps a task so only one call using the
// same queue is ever actually running at a time, and anything else waits
// its turn. Extracted out of paddle.ts (its one real caller) because the
// queueing logic itself is plain and worth verifying on its own, without
// needing a real child process to prove it -- see the reasoning in
// paddle.ts for *why* OCR recognition needs this.
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();

  return function runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    // Chain continues regardless of outcome -- a rejection here must not
    // permanently wedge every task queued behind it.
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
