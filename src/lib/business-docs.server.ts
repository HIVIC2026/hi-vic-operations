// New job flow Part 9 Task 8 (Jo 2 Nov 2026): ONE read of a business's insurance documents for the hard block
// (`businessDocsBlocker`, trade-expiry.core) — used by every booking kind (booking.server validateBooking), Add a job,
// the Ready Check installer pick and the pre-start facts, so a lapsed / unverified / under-$5m / missing document blocks
// everywhere the same way. Fails CLOSED: a read error throws (never "no block").
//
// G6 B1 (final Part 9 review, 4 Nov 2026; live DB check 17:40): the public liability AMOUNT is `businesses.public_liability_cover_amount`
// (applied migration 0123, filled for every live business) when the verified row has none of its own.
// `business_credentials.amount_insured_aud` is OPTIONAL pending SQL (docs/pending-migrations/2026-11-02-credential-amount-insured.sql,
// not needed for go-live): when the column exists and the row carries an amount, the row's amount wins. Neither recorded =
// NOT recorded — which blocks, exactly as a verified row with no amount does. Nothing is assumed insured.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import type { CredentialView } from "./trade-view.core";
import { businessDocsBlocker, withBusinessCoverAmount } from "./trade-expiry.core";
import { melbourneToday } from "./melbourne-time.core";

type CredRow = { business_id: string; kind: string; label: string | null; expires_at: string | null; verification: string | null; amount_insured_aud?: number | string | null };
export type BusinessDocs = { credentials: CredentialView[]; workersCompExempt: boolean; amountColumnLive: boolean };

const viewOf = (c: CredRow, amountLive: boolean): CredentialView => ({
  kind: c.kind, label: c.label ?? c.kind, expires: c.expires_at, verified: c.verification === "verified", pending: c.verification !== "rejected" && c.verification !== "verified",
  amountInsured: !amountLive || c.amount_insured_aud == null || c.amount_insured_aud === "" ? null : Number(c.amount_insured_aud),
});

/** The insurance documents (and workers-comp exemption) of each business. A read error throws. */
export async function businessDocsFor(businessIds: readonly string[]): Promise<Map<string, BusinessDocs>> {
  const ids = [...new Set(businessIds)];
  const out = new Map<string, BusinessDocs>();
  if (!ids.length) return out;
  let amountLive = true;
  let rows: CredRow[] = [];
  const withAmount = (await admin.from("business_credentials").select("business_id, kind, label, expires_at, verification, amount_insured_aud").in("business_id", ids)) as unknown as { data: CredRow[] | null; error: { code?: string | null; message?: string | null } | null };
  if (withAmount.error) {
    // Pending column (42703 undefined column / PostgREST schema cache): read the rest; the amount is then "not recorded".
    const e = withAmount.error;
    const missingColumn = e.code === "42703" || e.code === "PGRST204" || /amount_insured_aud/i.test(e.message ?? "");
    if (!missingColumn) throw new WorkflowError(`Couldn't read insurance records: ${e.message ?? "unknown error"}`);
    amountLive = false;
    const plain = await admin.from("business_credentials").select("business_id, kind, label, expires_at, verification").in("business_id", ids);
    if (plain.error) throw new WorkflowError(`Couldn't read insurance records: ${plain.error.message}`);
    rows = (plain.data ?? []) as unknown as CredRow[];
  } else rows = withAmount.data ?? [];
  // `workcover_exempt_declared_at` is pending SQL too (2026-11-03_installer_added_electricians.sql): without the column
  // nobody is exempt, so workers comp is required — the stricter reading; the business's public liability amount is still
  // read (B1). Any other read error throws (fail closed).
  type BizRow = { id: string; workcover_exempt_declared_at?: string | null; public_liability_cover_amount?: number | string | null };
  type BizRead = { data: BizRow[] | null; error: { code?: string | null; message: string } | null };
  let bizRead = (await admin.from("businesses").select("id, workcover_exempt_declared_at, public_liability_cover_amount").in("id", ids)) as unknown as BizRead;
  if (bizRead.error && (bizRead.error.code === "42703" || bizRead.error.code === "PGRST204" || /workcover_exempt_declared_at/i.test(bizRead.error.message))) {
    bizRead = (await admin.from("businesses").select("id, public_liability_cover_amount").in("id", ids)) as unknown as BizRead;
  }
  if (bizRead.error) throw new WorkflowError(`Couldn't read the business: ${bizRead.error.message}`);
  const biz = new Map((bizRead.data ?? []).map((b) => [b.id, b]));
  for (const id of ids) {
    const b = biz.get(id);
    const credentials = withBusinessCoverAmount(rows.filter((r) => r.business_id === id).map((r) => viewOf(r, amountLive)), b?.public_liability_cover_amount ?? null);
    out.set(id, { credentials, workersCompExempt: !!b?.workcover_exempt_declared_at, amountColumnLive: amountLive });
  }
  return out;
}

/** The insurance blocker for one business (null = fine). A read error throws (fail closed). */
export async function businessDocsBlockerFor(businessId: string, today = melbourneToday()): Promise<string | null> {
  const d = (await businessDocsFor([businessId])).get(businessId);
  if (!d) throw new WorkflowError("Couldn't read insurance records.");
  return businessDocsBlocker(d.credentials, today, { workersCompExempt: d.workersCompExempt });
}

/** Refuses (WorkflowError) new work for a business whose insurance isn't in order. */
export async function requireBusinessDocs(businessId: string, today = melbourneToday()): Promise<void> {
  const why = await businessDocsBlockerFor(businessId, today);
  if (why) throw new WorkflowError(why);
}
