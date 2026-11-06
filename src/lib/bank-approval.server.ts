// Launch blocker Task 7 (QA 7 Nov 2026): installer bank changes need the office's OK before pay goes there.
// Reads/writes for `business_bank_details`; the rules are pure in `bank-approval.core.ts`. Callers: pilot.functions
// setBankDetails / approveBankDetails, office Mark paid (office.functions markPayoutPaid), the Payouts tab
// (office-money.server moneyPayouts), Partners (office-partners.server) and Needs me (office.server).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { approvedBankAccount, bankApprovePatch, bankChangeWaiting, bankSaveWrite, payoutBankHold, type BankInput, type BankRow } from "./bank-approval.core";

type Db = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const db = admin as unknown as Db;
const last3 = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-3);
/** The pending_* columns arrive with the pending migration; until then a write naming them fails with this. */
const missingPendingColumn = (e: { message?: string } | null | undefined) => !!e && /pending_(account_name|bsb|account_number)/i.test(e.message ?? "");

async function readRow(businessId: string): Promise<BankRow | null> {
  // select("*"): the pending_* columns may not exist yet (pending migration) — never name them in a read.
  const { data, error } = await db.from("business_bank_details").select("*").eq("business_id", businessId).maybeSingle();
  if (error) throw new WorkflowError(`Could not read bank details: ${error.message}`);
  return (data ?? null) as BankRow | null;
}

async function logBankEvent(businessId: string, actorId: string, eventType: "supplied" | "changed" | "reviewed", details: Record<string, unknown>) {
  const { error } = await db.from("business_bank_detail_events").insert({ business_id: businessId, actor_id: actorId, event_type: eventType, details });
  if (error) throw new WorkflowError(`Could not record the bank details history: ${error.message}`);
}

/** An installer (or the office) saves bank details. With an approved account on file the change waits for the office
 *  (pending_*) and the approved account stays the one we pay; otherwise the details are saved and wait for approval. */
export async function saveBankDetails(businessId: string, actorId: string, input: BankInput) {
  const existing = await readRow(businessId);
  const now = new Date().toISOString();
  const plan = bankSaveWrite(existing, input);
  if (plan.mode === "pending") {
    const { error } = await db.from("business_bank_details").update({ ...plan.patch, updated_by: actorId, updated_at: now }).eq("business_id", businessId);
    if (!error) {
      if (!plan.cleared) await logBankEvent(businessId, actorId, "changed", { bsb_last3: last3(input.bsb), account_last3: last3(input.account_number), waiting_for_office: true });
      return { ok: true };
    }
    if (plan.cleared && missingPendingColumn(error)) return { ok: true }; // no column = nothing waiting to clear
    if (!missingPendingColumn(error)) throw new WorkflowError(error.message);
    // Pending migration not applied yet: the older write (live columns, back to 'pending') — still held from pay below.
  }
  const live = { account_name: input.account_name, bsb: input.bsb, account_number: input.account_number, updated_by: actorId, updated_at: now, supplied_by: actorId, supplied_at: now, reviewed_by: null, reviewed_at: null, review_status: "pending" };
  const { error } = existing
    ? await db.from("business_bank_details").update(live).eq("business_id", businessId)
    : await db.from("business_bank_details").insert({ business_id: businessId, ...live });
  if (error) throw new WorkflowError(error.message);
  await logBankEvent(businessId, actorId, existing ? "changed" : "supplied", { bsb_last3: last3(input.bsb), account_last3: last3(input.account_number) });
  return { ok: true };
}

/** The office Approve (admin only — checked by the server function). A waiting change becomes the account we pay. */
export async function approveBank(businessId: string, actorId: string) {
  const row = await readRow(businessId);
  const now = new Date().toISOString();
  const patch = bankApprovePatch(row, actorId, now);
  if (!row || !patch) return { ok: true, approved: false };
  const changed = "account_number" in patch;
  // Approve exactly what was read: a change saved in between is left waiting (no row updated → nothing approved).
  let q = db.from("business_bank_details").update(patch).eq("business_id", businessId).eq("account_number", row.account_number).eq("review_status", row.review_status);
  if (changed) q = q.eq("pending_account_number", row.pending_account_number).eq("pending_bsb", row.pending_bsb).eq("pending_account_name", row.pending_account_name);
  const { data, error } = await q.select("business_id");
  if (error) throw new WorkflowError(`Could not approve the bank details: ${error.message}`);
  if (!(data ?? []).length) return { ok: true, approved: false };
  const acc = changed ? { bsb: row.pending_bsb, account_number: row.pending_account_number } : { bsb: row.bsb, account_number: row.account_number };
  await logBankEvent(businessId, actorId, "reviewed", { bsb_last3: last3(acc.bsb), account_last3: last3(acc.account_number), changed });
  return { ok: true, approved: true };
}

/** The approved account we pay (never a waiting change), or null. */
export async function approvedBankFor(businessId: string) {
  return approvedBankAccount(await readRow(businessId));
}

/** Per business: why a payout can't be paid yet (null = approved account on file). Read errors throw (fails closed). */
export async function payoutBankHolds(businessIds: string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(businessIds.filter(Boolean))];
  const rows = new Map<string, BankRow>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("business_bank_details").select("*").in("business_id", ids.slice(i, i + 200));
    if (error) throw new Error(`Could not read bank details: ${error.message}`);
    for (const r of (data ?? []) as BankRow[]) rows.set(String(r.business_id), r);
  }
  return new Map(ids.map((b) => [b, payoutBankHold(rows.get(b) ?? null)]));
}

/** Every business with a bank change the office still has to check (Needs me, Partners); TEST businesses left out. */
export async function bankChangesWaiting(): Promise<{ businessId: string; name: string }[]> {
  const { data, error } = await db.from("business_bank_details").select("*").limit(5000);
  if (error) throw new Error(`Could not read bank details: ${error.message}`);
  const ids = ((data ?? []) as BankRow[]).filter((r) => bankChangeWaiting(r)).map((r) => String(r.business_id));
  if (!ids.length) return [];
  const { data: bs, error: be } = await db.from("businesses").select("id, name, onboarding_notes").in("id", ids);
  if (be) throw new Error(`Could not read businesses: ${be.message}`);
  const { isTestBusiness } = await import("./test-send.core");
  return ((bs ?? []) as { id: string; name: string | null; onboarding_notes?: string | null }[])
    .filter((b) => !isTestBusiness(b) && !/^\s*TEST\b/i.test(b.name ?? ""))
    .map((b) => ({ businessId: String(b.id), name: String(b.name ?? "") }));
}

/** Who a payout goes to — the same payee the Payouts tab (office-money.server moneyPayouts) shows for that line. */
export async function payoutPayeeBusiness(jobId: string, kind: "assessment" | "rectification" | "installation", bookingId: string | null): Promise<string | null> {
  const role = kind === "installation" ? "installer" : "electrician";
  const { data: asg, error } = await db.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", role).eq("active", true).limit(1);
  if (error) throw new Error(`Could not read the job's trades: ${error.message}`);
  const assigned = ((asg ?? []) as { business_id: string | null }[])[0]?.business_id ?? null;
  if (kind !== "assessment") return assigned;
  const { data: j, error: je } = await db.from("jobs").select("id, channel, originating_installer_business_id").eq("id", jobId).maybeSingle();
  if (je || !j) throw new Error(`Could not read the job: ${je?.message ?? "not found"}`);
  const paidToInstaller = (await (await import("./installer-paid-electricians.server")).safetyCheckPayeesFor([j])).get(jobId);
  if (paidToInstaller) return paidToInstaller.businessId || null;
  if (bookingId) {
    const { data: b, error: be } = await db.from("bookings").select("business_id").eq("id", bookingId).maybeSingle();
    if (be) throw new Error(`Could not read the visit: ${be.message}`);
    if (b?.business_id) return String(b.business_id);
  }
  return assigned;
}
