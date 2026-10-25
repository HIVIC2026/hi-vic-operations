// Speed (decision 280): the installer job page used to fire eight separate server calls on load, one after another
// (job overview, role, page facts, install days, Ready Check times, who's doing this, safety plan, staff links, price,
// owner quote). `getTradeJobBundle` answers them all in ONE call; this pure module names the sections, says which
// per-section Query cache key each one seeds, and marks a section that failed on the server so the page shows
// everything else instead of going blank. No wording, no rules: presentation and domain rules stay where they were.

/** A section whose server read threw. The page leaves that card to its own (existing) fetch and error handling. */
export type SectionError = { error: string };

export const isSectionError = (x: unknown): x is SectionError =>
  !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length === 1 && typeof (x as SectionError).error === "string";

export const sectionError = (e: unknown): SectionError => ({ error: String((e as Error)?.message ?? e ?? "failed") });

/** Section name → the per-section React Query key the existing cards read (and their actions invalidate). */
export const BUNDLE_QUERY_KEYS = {
  overview: (jobId: string) => ["job", jobId],
  role: (jobId: string) => ["myrole", jobId],
  page: (jobId: string) => ["trade-job-page", jobId],
  installDays: (jobId: string) => ["installer-install-days", jobId],
  readyCheckTimes: (jobId: string) => ["installer-rc-times", jobId],
  allocation: (jobId: string) => ["visit-allocation", jobId],
  swms: (jobId: string) => ["trade-swms", jobId],
  workerLinks: (jobId: string) => ["worker-links", jobId],
  price: (jobId: string) => ["installer-price", jobId],
  ownerQuote: (jobId: string) => ["my-owner-quote", jobId],
  mittiInvited: () => ["mitti-invited"],
} as const;

export type BundleSection = keyof typeof BUNDLE_QUERY_KEYS;
export const BUNDLE_SECTIONS = Object.keys(BUNDLE_QUERY_KEYS) as BundleSection[];

/** Which cache entries to seed from a bundle: every section that answered (errored sections are skipped — their card
 *  fetches on its own exactly as before, and its own error handling applies). `undefined` means "not part of this bundle". */
export function seedPlan(bundle: Partial<Record<BundleSection, unknown>>, jobId: string): { section: BundleSection; key: readonly string[]; data: unknown }[] {
  const out: { section: BundleSection; key: readonly string[]; data: unknown }[] = [];
  for (const section of BUNDLE_SECTIONS) {
    if (!(section in bundle)) continue;
    const data = bundle[section];
    if (data === undefined || isSectionError(data)) continue;
    out.push({ section, key: BUNDLE_QUERY_KEYS[section](jobId), data });
  }
  return out;
}

/** The page is usable when its overview answered — the one section the route itself cannot do without. */
export const bundleUsable = (bundle: { overview?: unknown } | null | undefined) => !!bundle && bundle.overview !== undefined && !isSectionError(bundle.overview);
