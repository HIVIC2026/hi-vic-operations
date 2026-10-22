import { toAuE164 } from "./sms.core";

export const BLAST_TYPE = "save_spot_reminder" as const;
export const BLAST_KEY = "save-spot-reminder-blast:v1:";
export type BlastRow = {
  id: string; job_number: string | null; created_at: string; source: string | null;
  owner_name: string | null; owner_phone: string | null; spot_offered: boolean | null;
  spot_saved: boolean | null; deleted_at: string | null; removed: boolean | null; stage: string | null;
  total: number | null; rebate: number | null; link: string | null; consent: boolean;
  linkProblem?: string | null;
  offeredAt?: string | null;
};
export type BlastRecipient = { jobId: string; jobNumber: string | null; phone: string; firstName: string; body: string; idempotencyKey: string };
export type BlastSkip = { jobId: string; jobNumber: string | null; reason: string };
export const phoneKey = (raw: string | null | undefined) => toAuE164(raw)?.replace(/^\+61/, "0") ?? null;

export function blastMessage(firstName: string, total: number, rebate: number, link: string, existingInsulation = false) {
  const money = (n: number) => Math.round(n).toLocaleString("en-AU");
  const price = existingInsulation ? `$${money(total)} (plus removal if needed)` : `$${money(total)}`;
  return `Home Insulation Victoria: Hi ${firstName}, a warmer winter and cooler summer are close. Your ceiling insulation is just ${price}, with $${money(rebate)} off thanks to the rebate. Spots are filling fast — save yours now: ${link}. Reply STOP to opt out.`;
}

/** Use only an URL literally present in the offer, matched to its still-active token. */
export function offeredLink(body: string | null, token: string | null): string | null {
  if (!body || !token) return null;
  const urls = (body.match(/https:\/\/[^\s<>"']+/g) ?? []).map((u) => u.replace(/[.,;)]+$/, ""));
  const allowedHosts = new Set(["estimate.homeinsulationvictoria.com.au", "quote.homeinsulationvictoria.com.au", "hi-vic-operations.lovable.app"]);
  const valid = urls.filter((u) => {
    try { const p = new URL(u); return allowedHosts.has(p.hostname) && !p.username && !p.password &&
      (p.pathname === `/estimate/${token}/campaign` || p.pathname === `/estimate/${token}`); } catch { return false; }
  });
  return valid.find((u) => new URL(u).pathname.endsWith("/campaign")) ?? valid[0] ?? null;
}

export function currentBlastPrice(scenarios: unknown): { total: number | null; rebate: number | null } {
  const first = Array.isArray(scenarios) ? scenarios[0] : null;
  const standard = first?.by_access?.standard;
  const number = (x: unknown) => x !== null && x !== undefined && x !== "" && Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : null;
  return { total: number(standard?.estimated_customer_total), rebate: number(standard?.applied_discount) };
}

export function reminderTimeBlocker(offeredAt: string | null | undefined, now: number, activatedAt?: string | null) {
  const offer = Date.parse(offeredAt ?? "");
  if (!Number.isFinite(offer)) return "Actual spot-offer send time missing";
  if (activatedAt !== undefined && (!activatedAt || !Number.isFinite(Date.parse(activatedAt)) || offer < Date.parse(activatedAt))) return "Historical offer — catch-up review only";
  return now - offer < 24 * 60 * 60 * 1000 ? "Spot offer is less than 24 hours old" : null;
}
export function selectBlast(rows: BlastRow[], optedOutPhones: string[], handledJobs: string[], handledPhones: string[], timing?: { now: number; activatedAt?: string | null }) {
  const optouts = new Set(optedOutPhones.map(phoneKey).filter(Boolean));
  const sentJobs = new Set(handledJobs), sentPhones = new Set(handledPhones.map(phoneKey).filter(Boolean));
  const recipients: BlastRecipient[] = [], skipped: BlastSkip[] = [], seen = new Set<string>();
  // Dedup BEFORE checking missing data: never fall back to an older enquiry's price/link.
  for (const r of [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id))) {
    const phone = phoneKey(r.owner_phone);
    let why: string | null = null;
    if (r.spot_offered !== true) why = "Spot not offered";
    else if (r.spot_saved === true) why = "Spot already saved";
    else if (r.deleted_at !== null) why = "Deleted enquiry";
    else if (r.removed === true) why = "Removed enquiry";
    else if (r.stage === "cancelled") why = "Cancelled enquiry";
    else if (r.source === "qa_test" || /test|testy|hahaha/i.test(r.owner_name ?? "") || phone === "0411111111") why = "TEST record";
    else if (!phone) why = "Missing or invalid Australian mobile";
    else if (optouts.has(phone)) why = "SMS opt-out recorded";
    else if (sentJobs.has(r.id) || sentPhones.has(phone)) why = "Already claimed by this blast (no retry)";
    else if (seen.has(phone)) why = "Duplicate phone — using most recent enquiry";
    else {
      seen.add(phone);
      if (timing && reminderTimeBlocker(r.offeredAt, timing.now, timing.activatedAt)) why = reminderTimeBlocker(r.offeredAt, timing.now, timing.activatedAt);
      else if (!r.owner_name?.trim()) why = "Missing name";
      else if (r.total === null || !Number.isFinite(r.total) || r.total < 0) why = "Missing current customer total";
      else if (r.rebate === null || !Number.isFinite(r.rebate) || r.rebate < 0) why = "Missing current VEU rebate";
      else if (!r.link) why = r.linkProblem ?? "Missing existing offered link";
      else if (!r.consent) why = "No current owner contact consent";
    }
    if (why) { skipped.push({ jobId: r.id, jobNumber: r.job_number, reason: why }); continue; }
    if (!phone || r.total === null || r.rebate === null || !r.link || !r.owner_name) continue;
    const firstName = r.owner_name.trim().split(/\s+/)[0] ?? "";
    recipients.push({ jobId: r.id, jobNumber: r.job_number, phone, firstName, body: blastMessage(firstName, r.total, r.rebate, r.link), idempotencyKey: BLAST_KEY + r.id });
  }
  return { recipients, skipped };
}

/** One stable primary-key claim per phone as well as the unique per-job idempotency key. */
export async function blastClaimId(phone: string): Promise<string> {
  const normal = phoneKey(phone);
  if (!normal) throw new Error("Invalid blast phone");
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(BLAST_KEY + normal))).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 15) | 80; bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}