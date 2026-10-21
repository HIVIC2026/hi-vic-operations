// Missing-only task lists for the installer job page (approved two-route brief): only what is still missing, grouped
// by the action it blocks. Pure presentation over facts that the existing guards already enforce — never a new gate.
export type MissingEvidence = { label: string; status: string; gate: string | null };
export type MissingTasks = { quote: string[]; beforeStart: string[]; afterCompletion: string[]; unknown: string[] };
const DONE = new Set(["verified", "not_required"]);
/** Collection deadlines (Activity Guide sequencing): original condition can never be deferred past removal or covering. */
export const DUE_BEFORE_DISTURBANCE = "due before any removal or covering";
export const DUE_BEFORE_START = "due before Start work";
export const DUE_AFTER_COMPLETION = "due before office Final check";

export function missingTasks(i: { quoteBlockers: string[]; worksBlockers: string[]; siteHoldBlocker: string | null; evidence: MissingEvidence[] }): MissingTasks {
  const open = i.evidence.filter((e) => !DONE.has(e.status));
  const uniq = (a: string[]) => [...new Set(a)];
  return {
    quote: uniq([...(i.siteHoldBlocker ? [i.siteHoldBlocker] : []), ...i.quoteBlockers.filter((b) => b !== i.siteHoldBlocker && !b.startsWith(i.siteHoldBlocker ?? "\u0000"))]),
    beforeStart: uniq([...(i.siteHoldBlocker ? [i.siteHoldBlocker] : []), ...i.worksBlockers.map((b) => `Record the original condition: ${b} — ${DUE_BEFORE_DISTURBANCE}`),
      ...open.filter((e) => e.gate === "assessment" || e.gate === "electrical").map((e) => `${e.label} — ${DUE_BEFORE_START}`)]),
    afterCompletion: uniq(open.filter((e) => e.gate === "installation").map((e) => `${e.label} — ${DUE_AFTER_COMPLETION}`)),
    // An evidence item without a recognised stage is shown, never silently dropped (so "nothing missing" is honest).
    unknown: uniq(open.filter((e) => !["assessment", "electrical", "installation"].includes(e.gate ?? "")).map((e) => e.label)),
  };
}
