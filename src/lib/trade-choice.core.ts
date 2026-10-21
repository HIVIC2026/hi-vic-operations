// Office "Choose a trade": pure rules. Default stays "offer to all eligible"; this only narrows ONE offer round
// to a single office-picked trade. Never assigns, books or moves a job.

export type ChoiceKind = "ready_check" | "piesa" | "rectification";
export const CHOICE_KIND_LABEL: Record<ChoiceKind, string> = { ready_check: "Ready Check", piesa: "Pre Insulation Electrical Safety Assessment (PIESA)", rectification: "Electrical fixes" };
export const OFFICE_CHOICE_FLAG = "office_choice";

export type OfferLite = { kind: string; status: string; offered_at: string; business_name?: string | null; summary?: unknown };

export const isOfficeChoice = (summary: unknown) => !!summary && typeof summary === "object" && (summary as Record<string, unknown>)[OFFICE_CHOICE_FLAG] === true;

/** Latest offer of this kind was an office pick that was declined or ran out, and nothing newer is open or accepted. */
export function chosenTradeNoAnswer(offers: OfferLite[], kind: ChoiceKind): { name: string | null; status: "declined" | "expired" } | null {
  const mine = offers.filter((o) => o.kind === kind).sort((a, b) => b.offered_at.localeCompare(a.offered_at));
  const last = mine[0];
  if (!last || !isOfficeChoice(last.summary)) return null;
  if (last.status !== "declined" && last.status !== "expired") return null;
  return { name: last.business_name ?? null, status: last.status };
}

/** First postcode-shaped number in an area: used only as a rough "nearest" proxy until travel distance is connected. */
const pc = (v: string | null | undefined) => { const n = Number(String(v ?? "").match(/\d{4}/)?.[0]); return Number.isFinite(n) && n > 0 ? n : null; };

export type ChoiceCandidate = { business_id: string; name: string; blocker: string | null; exact_postcode: boolean; service_postcodes: string[]; open_jobs: number };

/** Eligible only, nearest first (exact postcode, then closest listed postcode), then lightest load, then name. */
export function rankChoices(cands: ChoiceCandidate[], jobPostcode: string | null) {
  const target = pc(jobPostcode);
  const dist = (c: ChoiceCandidate) => {
    if (c.exact_postcode) return 0;
    const ns = c.service_postcodes.map(pc).filter((n): n is number => n != null);
    return target == null || !ns.length ? 9999 : Math.min(...ns.map((n) => Math.abs(n - target)));
  };
  return cands.filter((c) => !c.blocker)
    .map((c) => ({ ...c, distance: dist(c) }))
    .sort((a, b) => a.distance - b.distance || a.open_jobs - b.open_jobs || a.name.localeCompare(b.name));
}

/** Plain-words area summary for the picker. */
export function areaLabel(postcodes: string[]): string {
  if (!postcodes.length) return "No area recorded";
  const shown = postcodes.slice(0, 4).join(", ");
  return postcodes.length > 4 ? `${shown} +${postcodes.length - 4} more` : shown;
}
