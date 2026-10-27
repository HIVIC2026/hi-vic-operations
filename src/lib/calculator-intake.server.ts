// Jo 27 Oct: calculator registration -> the same intake path website enquiries use (upsertEnquiry), so duplicate
// matching, Gate 1, the automatic Save my spot offer and day 2/7/21 reminders are identical. Server-only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import type { NormalisedInterest } from "./interest.core";
import { CALCULATOR_EVENT, CALCULATOR_INTAKE_CHANNEL, calculatorEnquiryInput, calculatorIntakeBlocker, calculatorIntakeSource } from "./calculator-intake.core";

export type CalculatorIntakeResult = { jobId: string | null; jobNumber: string | null; created: boolean; source: string; blocker: string | null; postIntake: string | null };

/** Starts (or matches) the enquiry for one saved registration row and links the row to it. Never sends anything itself. */
export async function startCalculatorEnquiry(interestId: string, v: NormalisedInterest, consentedAt: string): Promise<CalculatorIntakeResult> {
  const source = calculatorIntakeSource(v.email);
  const blocker = calculatorIntakeBlocker(v);
  if (blocker) {
    await admin.from("calculator_interests").update({ intake_error: blocker }).eq("id", interestId);
    return { jobId: null, jobNumber: null, created: false, source, blocker, postIntake: null };
  }
  const { upsertEnquiry } = await import("./enquiry.server");
  const input = calculatorEnquiryInput(interestId, v, consentedAt);
  const r = await upsertEnquiry(input as never, source, null);
  // Office marker: where it came from, kept beside any existing references on a matched job.
  const { data: j } = await admin.from("jobs").select("external_refs").eq("id", r.job_id).maybeSingle();
  const prev = (j?.external_refs as Record<string, Json> | null) ?? {};
  const refs: Record<string, Json> = { ...prev, intake_channel: prev["intake_channel"] ?? CALCULATOR_INTAKE_CHANNEL, calculator_interest_id: interestId };
  await admin.from("jobs").update({ external_refs: refs }).eq("id", r.job_id);
  // TEST jobs skip the website-only consent step inside upsertEnquiry; the consent version and time are kept the same way.
  if (source === "qa_test") {
    const { data: job } = await admin.from("jobs").select("owner_id").eq("id", r.job_id).single();
    if (job?.owner_id) await (await import("./intake.server")).recordContactConsent(r.job_id, job.owner_id, input as never);
  }
  const { logEvent } = await import("./workflow.server");
  await logEvent(r.job_id, null, CALCULATOR_EVENT, r.created ? "Enquiry started from the calculator registration." : `Calculator registration matched existing job ${r.job_number}.`, { calculator_interest_id: interestId, created: r.created, consent_version: v.consentVersion, consented_at: consentedAt });
  await admin.from("calculator_interests").update({ job_id: r.job_id, intake_error: null }).eq("id", interestId);
  return { jobId: r.job_id, jobNumber: r.job_number, created: r.created, source, blocker: null, postIntake: String(r.post_intake) };
}

/** Read-only: what each existing unlinked registration WOULD do. Writes nothing. Counts only. */
export async function dryRunCalculatorBackfill() {
  const { data, error } = await admin.from("calculator_interests").select("id, email, mobile, address_line, suburb, postcode, ceiling_m2").is("job_id", null);
  if (error) throw new Error(error.message);
  const { repeatKey, sameOwner } = await import("./enquiry-repeat.core");
  const { findOpenJobAtAddress } = await import("./duplicate-address.server");
  const out = { total: 0, wouldCreate: 0, matchesSameOwner: 0, matchesAddressOnly: 0, blocked: 0, test: 0 };
  for (const row of data ?? []) {
    out.total++;
    if (calculatorIntakeSource(row.email) === "qa_test") out.test++;
    if (calculatorIntakeBlocker({ ceilingM2: Number(row.ceiling_m2), addressLine: row.address_line ?? "" })) { out.blocked++; continue; }
    const key = repeatKey(row.address_line, row.suburb, row.postcode);
    const { data: jobs } = await admin.from("jobs").select("owners(email, phone), properties!inner(address_line, suburb, postcode)").eq("channel", "hivic_sourced").not("stage", "in", "(cancelled,complete)").is("deleted_at", null).eq("properties.postcode", row.postcode ?? "").limit(200);
    const same = (jobs ?? []).some((j) => { const p = j.properties as { address_line: string | null; suburb: string | null; postcode: string | null }; return repeatKey(p.address_line, p.suburb, p.postcode) === key && sameOwner({ email: row.email, phone: row.mobile }, j.owners as never); });
    if (same) { out.matchesSameOwner++; continue; }
    const open = await findOpenJobAtAddress({ address_line: row.address_line, suburb: row.suburb, postcode: row.postcode, source: "base44" });
    if (open) out.matchesAddressOnly++; else out.wouldCreate++;
  }
  return out;
}
