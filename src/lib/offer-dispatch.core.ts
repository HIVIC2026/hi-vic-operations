// "How job offers go out" (Jo, 7 Oct 2026). Pure rules for the office-picks mode and the Choose trades screen.
// Never assigns, books or moves a job; only decides whether offers wait for the office and what the office sees.

export type DispatchMode = "office_picks" | "automatic";
export const DISPATCH_MODE_LABEL: Record<DispatchMode, string> = { office_picks: "Office picks first", automatic: "Automatic" };

/** Fails closed to office picks when the setting is missing or unknown. */
export function officePicks(mode: string | null | undefined, jobOverride: string | null | undefined): boolean {
  if (jobOverride === "office_picks") return true;
  return mode !== "automatic";
}

export type ChooseWarningFacts = {
  today: string; // Melbourne YYYY-MM-DD
  insuranceExpiresOn: (string | null)[];
  certExpiresOn: (string | null)[];
  rate: number | null; // trade's rate for this job (inc GST, same unit as ownerPrice)
  ownerPrice: number | null;
  soonDays?: number;
};

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function chooseWarnings(f: ChooseWarningFacts): string[] {
  const soon = f.soonDays ?? 30;
  const out: string[] = [];
  const first = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).map((x) => x.slice(0, 10)).sort()[0] ?? null;
  const ins = first(f.insuranceExpiresOn);
  if (ins && daysBetween(f.today, ins) <= soon) out.push(daysBetween(f.today, ins) < 0 ? `Insurance expired ${ins}` : `Insurance expires ${ins}`);
  const cert = first(f.certExpiresOn);
  if (cert && daysBetween(f.today, cert) <= soon) out.push(daysBetween(f.today, cert) < 0 ? `Licence/cert expired ${cert}` : `Licence/cert expires ${cert}`);
  if (f.rate == null) out.push("No agreed rate for this job");
  else if (f.ownerPrice != null && f.rate >= f.ownerPrice) out.push("Rate is at or above the owner price");
  return out;
}

/** Great-circle km; null when either point is unknown. */
export function distanceKm(a: { lat: number | null; lng: number | null }, b: { lat: number | null; lng: number | null }): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}

/** Which ticked trades actually get a new offer: never twice to a trade already holding (or having answered) this round. */
export function newRecipients(ticked: string[], alreadyOffered: Set<string>): string[] {
  return [...new Set(ticked)].filter((id) => !alreadyOffered.has(id));
}

/** A job waiting for the office to choose trades: right stage, nobody assigned, no offer out yet this round. */
export function needsChooseTrades(f: { officePicks: boolean; readyForOffer: boolean; hasTrade: boolean; offersThisRound: number }): boolean {
  return f.officePicks && f.readyForOffer && !f.hasTrade && f.offersThisRound === 0;
}
