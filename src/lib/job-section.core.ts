// Office job page legacy section keys. Pure and dependency-free on purpose (decision 280, speed): the job route's
// `validateSearch` is not code-split, so whatever it imports loads on EVERY page. allocation.core re-exports these.
export const JOB_SECTIONS = ["enquiry", "ready_check", "quote", "piesa", "installation", "ap_veec", "history", "people"] as const;
export type JobSection = (typeof JOB_SECTIONS)[number];
export function parseJobSection(v: unknown): JobSection | undefined {
  return typeof v === "string" && (JOB_SECTIONS as readonly string[]).includes(v) ? (v as JobSection) : undefined;
}
