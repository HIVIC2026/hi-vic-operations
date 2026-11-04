// New job flow Part 9 Task 8 (Jo 2 Nov 2026): ONE read of a business's insurance documents for the hard block
// (`businessDocsBlocker`, trade-expiry.core) — used by every booking kind (booking.server validateBooking), Add a job,
// the Ready Check installer pick and the pre-start facts, so a lapsed / unverified / under-$5m / missing document blocks
// everywhere the same way. Fails CLOSED: a read error throws (never "no block").
//
// `amount_insured_aud` is pending SQL (docs/pending-migrations/2026-11-02-credential-amount-insured.sql). Until it is
// applied the column can't be read: the rows are read without it and the amount counts as NOT recorded — which blocks,
// exactly as a verified row with no amount does. Nothing is assumed insured.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import type { CredentialView } from "./trade-view.core";
import { businessDocsBlocker } from "./trade-expiry.core";
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
  // nobody is exempt, so workers comp is required — the stricter reading. Any other read error throws.
  const { data: biz, error: be } = (await admin.from("businesses").select("id, workcover_exempt_declared_at").in("id", ids)) as unknown as { data: { id: string; workcover_exempt_declared_at?: string | null }[] | null; error: { code?: string | null; message: string } | null };
  if (be && !(be.code === "42703" || be.code === "PGRST204" || /workcover_exempt_declared_at/i.test(be.message))) throw new WorkflowError(`Couldn't read the business: ${be.message}`);
  const exempt = new Map((be ? [] : biz ?? []).map((b) => [b.id, !!b.workcover_exempt_declared_at]));
  for (const id of ids) out.set(id, { credentials: rows.filter((r) => r.business_id === id).map((r) => viewOf(r, amountLive)), workersCompExempt: exempt.get(id) ?? false, amountColumnLive: amountLive });
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
