// Decision 281 (Jo 25 Oct 2026): the portal completes enquiry addresses itself — no Fix details pile, no buttons.
// Swept by the 15-minute tick (allocation-tick) and run once at intake for a new website / email enquiry: every job in
// the enquiry stages (office_enquiry_index bucket "enquiry", Home Insulation Victoria-sourced, not TEST) whose property
// is missing a suburb or a Victorian postcode gets ONE lookup through the same address provider Add a job uses
// (address-lookup.server → Base44 → Google Places AU). The pure rules (address-complete.core) fill only the blanks and
// accept only an unambiguous result that agrees with what the owner typed; the save goes through the audited
// saveEnquiryDetails. Every lookup is recorded as a workflow event — `address_completed` or
// `address_lookup_unresolved` with details — and a job is not looked up again for 7 days, so a tick never repeats
// itself. Backlog: 50 jobs per tick, oldest first. Nothing here sends anything or changes a stage.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "./workflow.server";
import {
  ADDRESS_COMPLETE_BATCH, ADDRESS_COMPLETED_EVENT, ADDRESS_UNRESOLVED_EVENT, addressMissing, decideAddressCompletion, lookupDue, lookupQuery, shortlistLabels,
  type AddressCandidate, type AddressCompletion, type StoredAddress,
} from "./address-complete.core";
import type { AddressLookup } from "./address-lookup.server";

const loose = admin as unknown as SupabaseClient;
const ENQUIRY_SOURCES = ["base44", "portal", "email"];

export type CompletionOutcome = { jobId: string; outcome: "completed" | "unresolved" | "nothing_missing" | "skipped" | "failed"; detail?: string };

/** Look the stored address up (autocomplete → details for the shortlisted labels) and decide, purely. */
export async function resolveAddress(stored: StoredAddress, lookup: AddressLookup): Promise<{ decision: AddressCompletion; query: string }> {
  const query = lookupQuery(stored);
  if (!addressMissing(stored)) return { decision: { kind: "nothing_missing" }, query };
  if (query.length < 4) return { decision: { kind: "unresolved", reason: "no_street", candidates: [] }, query };
  const suggestions = await lookup.search(query);
  const wanted = new Set(shortlistLabels(stored, suggestions.map((s) => s.label)));
  const candidates: AddressCandidate[] = [];
  for (const s of suggestions) {
    if (!wanted.has(s.label)) continue;
    const d = await lookup.details(s.id);
    if (d) candidates.push({ label: d.label || s.label, street: d.street ?? null, suburb: d.suburb ?? null, postcode: d.postcode ?? null, state: d.state ?? null });
  }
  // Unshortlisted labels are still reported so the office can see what the lookup offered.
  const decision = decideAddressCompletion(stored, candidates);
  if (decision.kind === "unresolved" && !decision.candidates.length) decision.candidates = suggestions.map((s) => s.label).slice(0, 6);
  return { decision, query };
}

/**
 * Complete one job's address now (intake, or one sweep item). `trigger` is recorded on the event. Skips jobs whose
 * address is complete and installer-entered addresses (kept exactly as typed, decision 216); never throws.
 */
export async function completeJobAddress(jobId: string, opts: { trigger: "intake" | "tick"; lookup?: AddressLookup; actorId?: string | null }): Promise<CompletionOutcome> {
  try {
    const { data: job, error } = await admin.from("jobs").select("id, channel, source, owners(full_name), properties(address_line, suburb, postcode)").eq("id", jobId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) return { jobId, outcome: "skipped", detail: "job not found" };
    if (job.channel === "installer_sourced") return { jobId, outcome: "skipped", detail: "installer-entered address is kept as typed" };
    const prop = job.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
    const stored: StoredAddress = { addressLine: prop?.address_line ?? null, suburb: prop?.suburb ?? null, postcode: prop?.postcode ?? null };
    if (!addressMissing(stored)) return { jobId, outcome: "nothing_missing" };
    const lookup = opts.lookup ?? (await import("./address-lookup.server")).serverAddressLookup(opts.trigger === "intake" ? 4000 : 8000);
    const { decision, query } = await resolveAddress(stored, lookup);
    if (decision.kind === "nothing_missing") return { jobId, outcome: "nothing_missing" };
    if (decision.kind === "unresolved") {
      await logEvent(jobId, opts.actorId ?? null, ADDRESS_UNRESOLVED_EVENT,
        `Address lookup could not complete the suburb / postcode (${decision.reason.replace(/_/g, " ")}) — shown as stored; edit it on the job page if needed.`,
        { reason: decision.reason, query, candidates: decision.candidates, stored, trigger: opts.trigger, provider: "google_places_au", decision: 281 }, { internal: true });
      return { jobId, outcome: "unresolved", detail: decision.reason };
    }
    const { saveEnquiryDetails } = await import("./office-actions.server");
    const fullName = (job.owners as { full_name?: string | null } | null)?.full_name ?? "";
    await saveEnquiryDetails(jobId, opts.actorId ?? null, { fullName, street: decision.street, suburb: decision.suburb, postcode: decision.postcode }, {
      type: ADDRESS_COMPLETED_EVENT,
      summary: `Address completed from the lookup: ${decision.street}, ${decision.suburb} ${decision.postcode} (filled ${decision.filled.join(", ")}).`,
      details: { filled: decision.filled, candidate: decision.candidate, query, trigger: opts.trigger, provider: "google_places_au", decision: 281 },
    });
    return { jobId, outcome: "completed", detail: decision.filled.join(",") };
  } catch (e) {
    console.error("address completion failed", jobId, e instanceof Error ? e.message : e);
    return { jobId, outcome: "failed", detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Enquiry-stage jobs (oldest first) still missing a suburb or Victorian postcode and not looked up in the last 7 days. */
export async function findIncompleteEnquiryAddresses(now = Date.now(), batch = ADDRESS_COMPLETE_BATCH): Promise<string[]> {
  const { data: index, error } = await loose.from("office_enquiry_index").select("id, created_at").eq("office_bucket", "enquiry").eq("channel", "hivic_sourced").in("source", ENQUIRY_SOURCES).is("deleted_at", null).order("created_at", { ascending: true }).order("id").limit(2000);
  if (error) throw new Error(`Could not read enquiries for address completion: ${error.message}`);
  const ids = (index ?? []).map((r) => String((r as { id: unknown }).id));
  const due: string[] = [];
  for (let i = 0; i < ids.length && due.length < batch; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const [{ data: jobs, error: je }, { data: events, error: ee }] = await Promise.all([
      admin.from("jobs").select("id, properties(address_line, suburb, postcode)").in("id", chunk),
      loose.from("workflow_events").select("job_id, created_at").in("job_id", chunk).in("event_type", [ADDRESS_COMPLETED_EVENT, ADDRESS_UNRESOLVED_EVENT]).order("created_at", { ascending: false }),
    ]);
    if (je || ee) throw new Error(`Could not read addresses for completion: ${(je ?? ee)!.message}`);
    const last = new Map<string, string>();
    for (const e of (events ?? []) as { job_id: string; created_at: string }[]) if (!last.has(e.job_id)) last.set(e.job_id, e.created_at);
    const byId = new Map((jobs ?? []).map((j) => [String(j.id), j]));
    for (const id of chunk) {
      const j = byId.get(id);
      const p = (j?.properties ?? null) as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
      if (!j || !p || !(p.address_line ?? "").trim()) continue;
      if (!addressMissing({ addressLine: p.address_line, suburb: p.suburb, postcode: p.postcode })) continue;
      if (!lookupDue(last.get(id), now)) continue;
      due.push(id);
      if (due.length >= batch) break;
    }
  }
  return due;
}

/** The 15-minute tick entry: counts only, never PII. */
export async function completeEnquiryAddresses(opts: { lookup?: AddressLookup; now?: number; batch?: number } = {}) {
  const ids = await findIncompleteEnquiryAddresses(opts.now ?? Date.now(), opts.batch ?? ADDRESS_COMPLETE_BATCH);
  const out = { checked: ids.length, completed: 0, unresolved: 0, failed: 0 };
  for (const id of ids) {
    const r = await completeJobAddress(id, opts.lookup ? { trigger: "tick", lookup: opts.lookup } : { trigger: "tick" });
    if (r.outcome === "completed") out.completed++;
    else if (r.outcome === "unresolved") out.unresolved++;
    else if (r.outcome === "failed") out.failed++;
  }
  return out;
}
