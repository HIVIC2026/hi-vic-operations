// Decision 371(a) (Jo, 25 Oct 2026): watch the expiry dates already stored for trades and raise ONE Needs me row per
// document from 30 days before it lapses; once lapsed, no new offers / assignments to that business or person.
// PURE: the office read (office.server) gathers the stored dates; this decides the rows and the business blocker.
//
// Where the dates live (nothing new is stored):
//   business_credentials.expires_at — public liability (kind public_liability_insurance, or a "liability" label),
//     installer certificate (installer_certification), electrical licence (electrical_licence, per profile),
//     REC registration (rec_registration), and any other insurance the office recorded.
//   partner_workers.licence_expires_on — each electrician's licence (blocking already in workerOfferBlocker).
//   worker_certification_levels.expires_on — each installer's verified CII (blocking already in crewClearance).
// Not stored: a White Card has no expiry date (Victorian construction induction cards don't expire; the record keeps
// only number/upload/verification) — reported, never invented.
import { latestExpiry, type CredentialView } from "./trade-view.core";

export const TRADE_EXPIRY_WARN_DAYS = 30;

/** Plain names for the watched documents. */
export const TRADE_DOC_LABEL: Record<string, string> = {
  public_liability_insurance: "Public liability insurance",
  installer_certification: "Insulation installer certificate (EEC/CII)",
  electrical_licence: "Electrical licence",
  rec_registration: "REC registration",
  workers_comp_insurance: "Workers compensation insurance",
  worker_licence: "Electrical licence",
  worker_cii: "CII certificate",
};

/** Business documents whose lapse stops new offers / assignments to the business (per-person licences and CII are blocked person by person). */
export const BLOCKING_BUSINESS_DOCS = ["public_liability_insurance", "installer_certification", "rec_registration"] as const;
export type BlockingBusinessDoc = (typeof BLOCKING_BUSINESS_DOCS)[number];

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
const dayMonth = (ymd: string) => new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Why this business can't get new offers / assignments because a business document has lapsed (null = none lapsed).
 * Uses the LATEST date on file per document (a renewal upload supersedes the old one); no date on file = not blocked
 * here (older partners never asked are shown as missing, the existing convention).
 */
export function expiredBusinessDocsBlocker(creds: CredentialView[], today: string, kinds: readonly BlockingBusinessDoc[] = BLOCKING_BUSINESS_DOCS): string | null {
  const lapsed = kinds.map((k) => ({ k, exp: latestExpiry(creds, k) })).filter((x) => x.exp && x.exp < today);
  if (!lapsed.length) return null;
  return `${lapsed.map((x) => `${TRADE_DOC_LABEL[x.k]} expired on ${x.exp}`).join("; ")}. No new jobs until the renewed document is uploaded.`;
}

export type ExpiryBusiness = { id: string; name: string; active: boolean };
export type ExpiryCredential = { businessId: string; profileId: string | null; kind: string; label: string; expiresAt: string | null };
export type ExpiryPerson = { id: string; name: string; businessId: string; removed?: boolean; licenceExpiresOn?: string | null; ciiExpiresOn?: string | null };
export type TradeExpiryRow = { key: string; subject: "business" | "person"; businessId: string; personId: string | null; who: string; document: string; expiresOn: string; expired: boolean; daysLeft: number; line: string };

function rowLine(expiresOn: string, today: string, blocks: boolean): { expired: boolean; daysLeft: number; line: string } {
  const daysLeft = daysBetween(today, expiresOn);
  const expired = daysLeft < 0;
  if (expired) return { expired, daysLeft, line: `Expired ${dayMonth(expiresOn)}${blocks ? " · no new offers until the renewal is uploaded" : " · ask for the renewal"}` };
  return { expired, daysLeft, line: `Expires ${dayMonth(expiresOn)} (${daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}) · ask for the renewal` };
}

/**
 * ONE row per document (business + kind [+ person for per-person credentials], or person + licence/CII) whose LATEST
 * stored expiry is within `warnDays` or already past. Inactive businesses and removed people are skipped. Sorted
 * expired first, then soonest.
 */
export function tradeExpiryRows(i: { businesses: ExpiryBusiness[]; credentials: ExpiryCredential[]; people: ExpiryPerson[]; today: string; warnDays?: number }): TradeExpiryRow[] {
  const warn = i.warnDays ?? TRADE_EXPIRY_WARN_DAYS;
  const biz = new Map(i.businesses.map((b) => [b.id, b]));
  const out: TradeExpiryRow[] = [];
  // Business documents: latest date per (business, document kind, person if the credential is a person's).
  const groups = new Map<string, { businessId: string; profileId: string | null; kind: string; label: string; views: CredentialView[] }>();
  for (const c of i.credentials) {
    const b = biz.get(c.businessId);
    if (!b?.active) continue;
    const kind = c.kind === "public_liability_insurance" || (/liab/i.test(c.label) && !/product/i.test(c.label)) ? "public_liability_insurance" : c.kind;
    const k = `${c.businessId}:${kind}:${c.profileId ?? "-"}`;
    const g = groups.get(k) ?? { businessId: c.businessId, profileId: c.profileId, kind, label: c.label, views: [] };
    g.views.push({ kind, label: c.label, expires: c.expiresAt, verified: true });
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    const exp = latestExpiry(g.views, g.kind);
    if (!exp || daysBetween(i.today, exp) > warn) continue;
    const blocks = (BLOCKING_BUSINESS_DOCS as readonly string[]).includes(g.kind);
    out.push({ key: `expiry:${g.businessId}:${g.kind}:${g.profileId ?? "business"}`, subject: "business", businessId: g.businessId, personId: g.profileId, who: biz.get(g.businessId)!.name, document: TRADE_DOC_LABEL[g.kind] ?? g.label, expiresOn: exp, ...rowLine(exp, i.today, blocks) });
  }
  // Per-person documents (blocking already enforced person by person: workerOfferBlocker / crewClearance).
  for (const p of i.people) {
    const b = biz.get(p.businessId);
    if (p.removed || !b?.active) continue;
    for (const [doc, exp] of [["worker_licence", p.licenceExpiresOn], ["worker_cii", p.ciiExpiresOn]] as const) {
      if (!exp || daysBetween(i.today, exp) > warn) continue;
      out.push({ key: `expiry:person:${p.id}:${doc}`, subject: "person", businessId: p.businessId, personId: p.id, who: `${p.name} (${b.name})`, document: TRADE_DOC_LABEL[doc]!, expiresOn: exp.slice(0, 10), ...rowLine(exp, i.today, true) });
    }
  }
  return out.sort((a, b) => Number(b.expired) - Number(a.expired) || a.expiresOn.localeCompare(b.expiresOn) || a.key.localeCompare(b.key));
}

/** Latest CII expiry per installer: latest certification check for the person (by id or email), then its latest recorded level. */
export function latestCiiExpiryByWorker(
  workers: { id: string; email: string }[],
  certs: { id: string; worker_id: string | null; worker_email: string; recorded_at: string }[],
  levels: { certification_id: string; expires_on: string; recorded_at: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  const byRecent = [...certs].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  const lvRecent = [...levels].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  for (const w of workers) {
    const c = byRecent.find((r) => r.worker_id === w.id || r.worker_email.trim().toLowerCase() === w.email.trim().toLowerCase());
    const l = c ? lvRecent.find((r) => r.certification_id === c.id) : null;
    if (l?.expires_on) out.set(w.id, l.expires_on.slice(0, 10));
  }
  return out;
}
