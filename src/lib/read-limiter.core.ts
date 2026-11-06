// Bounded parallel reads (speed, Jo 7 Nov 2026). Office pages used to fire hundreds of chunked reads at once; the
// database then queued every one of them and each read took over a second. A shared gate keeps only `max` reads in
// flight per server process. Same queries, same results, same error behaviour — only the start order is paced.

export type ReadGate = <T>(task: () => PromiseLike<T>) => Promise<T>;

export function createReadGate(max: number): ReadGate {
  if (!Number.isInteger(max) || max < 1) throw new Error("Read gate size must be a positive whole number.");
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    active--;
    const next = waiting.shift();
    if (next) next();
  };
  return async function gate<T>(task: () => PromiseLike<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

/** One gate for the office's batched job-id reads (Needs me, Jobs, Enquiries, Choose installer). */
export const officeReadGate: ReadGate = createReadGate(16);
