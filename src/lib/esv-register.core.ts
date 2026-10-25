// Decision 371(c) (Jo, 25 Oct 2026): look up a new electrician's licence and REC number on the Energy Safe Victoria
// public register and record the result FOR THE OFFICE REVIEWER. PURE: the adapter contract, the result shapes and the
// review-line wording. The office still gives the final Approve — a lookup never approves, rejects or blocks anything.
//
// Reachability (25 Oct 2026): from the build sandbox every esv.vic.gov.au host is refused by the outbound proxy (403 on
// CONNECT), and ESV publishes no documented public API for the licence / REC search. So no live adapter is configured:
// every lookup records "not checked" until a reachable, permitted endpoint is confirmed and an adapter is written behind
// the switch (env ESV_REGISTER_LOOKUP_ENABLED=true; default off).
import { normaliseLicenceNumber, normaliseRecNumber } from "./trade-numbers.core";

export const ESV_REGISTER_EVENT = "esv_register_lookup";
export const ESV_REGISTER_SWITCH_ENV = "ESV_REGISTER_LOOKUP_ENABLED";
export const ESV_REGISTER_SEARCH_URL = "https://www.esv.vic.gov.au";

export type RegisterKind = "licence" | "rec";
export type RegisterLookupQuery = { kind: RegisterKind; number: string; name?: string | null };
export type RegisterLookupStatus = "found_current" | "found_not_current" | "not_found" | "not_checked" | "error";
export type RegisterLookupResult = {
  kind: RegisterKind; number: string; status: RegisterLookupStatus; checkedAt: string;
  /** Adapter name, or "none" when nothing was looked up. */
  source: string; detail: string; holderName?: string | null; expiresOn?: string | null;
};

/** What a live adapter must implement (one call per number; it must never throw for "not found"). */
export interface EsvRegisterAdapter {
  readonly name: string;
  lookup(q: RegisterLookupQuery): Promise<Omit<RegisterLookupResult, "checkedAt" | "source">>;
}

export const switchOn = (env: Record<string, string | undefined>) => env[ESV_REGISTER_SWITCH_ENV] === "true";
export const normaliseRegisterNumber = (q: RegisterLookupQuery) => (q.kind === "rec" ? normaliseRecNumber(q.number) : normaliseLicenceNumber(q.number));

export function notChecked(q: RegisterLookupQuery, reason: string, nowIso: string): RegisterLookupResult {
  return { kind: q.kind, number: q.number.trim(), status: "not_checked", checkedAt: nowIso, source: "none", detail: reason };
}

/** The numbers to look up from a signed REC application (the applicant's licence and their REC / host REC number). */
export function registerQueries(d: { licence_number?: string | null; rec_registration_number?: string | null; host_rec_number?: string | null; primary_contact_name?: string | null; legal_entity_name?: string | null; works_under_rec?: boolean | null }): RegisterLookupQuery[] {
  const out: RegisterLookupQuery[] = [];
  if (d.licence_number?.trim()) out.push({ kind: "licence", number: d.licence_number.trim(), name: d.primary_contact_name ?? null });
  const rec = d.works_under_rec ? d.host_rec_number : d.rec_registration_number;
  if (rec?.trim()) out.push({ kind: "rec", number: rec.trim(), name: d.legal_entity_name ?? null });
  return out;
}

/** True when a new result should be recorded: first time, or the status / detail changed for this number. */
export function shouldRecordLookup(previous: Pick<RegisterLookupResult, "status" | "detail"> | null, next: RegisterLookupResult): boolean {
  return !previous || previous.status !== next.status || previous.detail !== next.detail;
}

export type RegisterCheckLine = { mark: "ok" | "warn" | "missing"; text: string };
const what = (k: RegisterKind) => (k === "rec" ? "REC" : "Licence");

/** The office review line for one lookup. "Not checked" is a warning to check by hand, never a pass. */
export function registerCheckLine(r: RegisterLookupResult): RegisterCheckLine {
  const n = `${what(r.kind)} ${r.number}`;
  switch (r.status) {
    case "found_current": return { mark: "ok", text: `ESV register · ${n} found and current${r.holderName ? ` · ${r.holderName}` : ""}${r.expiresOn ? ` · to ${r.expiresOn}` : ""}` };
    case "found_not_current": return { mark: "missing", text: `ESV register · ${n} found but NOT current${r.detail ? ` · ${r.detail}` : ""}` };
    case "not_found": return { mark: "missing", text: `ESV register · ${n} not found${r.detail ? ` · ${r.detail}` : ""}` };
    case "error": return { mark: "warn", text: `ESV register · ${n} lookup failed (${r.detail}) — check it by hand before approving` };
    default: return { mark: "warn", text: `ESV register · ${n} not checked automatically (${r.detail}) — check it on the ESV website before approving` };
  }
}
