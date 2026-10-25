// Decision 383: Jobs › Active and Enquiries open from a saved copy. After the office changes something in this tab
// (any useAction, a Needs me row, a logged call), every read of the opening view asks the server to work it out now
// until one such read has come back, so the job just changed is never shown as it was. Browser-only module state.
let changes = 0;
const freshUpTo = new Map<string, number>();

export function markOfficeChanged() {
  changes++;
}

/** Reads a list; `refresh` is true for the opening view while a change in this tab is newer than its last fresh read. */
export async function readOfficeList<T>(list: "jobs" | "enquiries", openingView: boolean, read: (refresh: boolean) => Promise<T>): Promise<T> {
  const seen = changes;
  const refresh = openingView && seen > (freshUpTo.get(list) ?? 0);
  const out = await read(refresh);
  if (refresh) freshUpTo.set(list, Math.max(freshUpTo.get(list) ?? 0, seen));
  return out;
}
