// Speed (installer screens, Task 6): start a read now and await it later. A database query builder only runs when it is
// awaited, so `early(q)` starts it at once; the result (or the error) is kept for whoever awaits it. A read that is
// started early but never awaited — the loader returned or threw first — never surfaces as an unhandled rejection.
export function early<T>(read: PromiseLike<T>): Promise<T> {
  const p = Promise.resolve(read);
  p.catch(() => undefined);
  return p;
}
