import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { declaredExtras } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";
import { savedInsulationTap } from "./insulation-details.core";
import { houseAgeLabel, onsiteInsulationLine } from "./onsite-assessment.core";
import { qualifiesOutcome } from "./enquiry-review-custom.core";

export type OnsiteRow = { id: string; jobNumber: string | null; owner: string | null; suburb: string | null; houseAge: string; said: string; declared: "none" | "present" | "unknown" | null };

/** SELECT-only read of the shared onsite_wait bucket (same predicate that hides these jobs from every other Office list). */
export async function listOnsiteAssessment(): Promise<OnsiteRow[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("office_enquiry_index").select("id").eq("office_bucket", "onsite_wait").order("id").range(from, from + 999);
    if (error) throw new Error("Could not load Needs onsite assessment. Please try again.");
    for (const r of data ?? []) if (r.id) ids.push(r.id);
    if (!data || data.length < 1000) break;
  }
  const rows: OnsiteRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from("jobs").select("id, job_number, created_at, owners(full_name), properties(suburb, enrichment)").in("id", ids.slice(i, i + 200));
    if (error) throw new Error("Could not load Needs onsite assessment. Please try again.");
    for (const j of data ?? []) {
      const p = j.properties as { suburb: string | null; enrichment: Record<string, unknown> | null } | null;
      const tap = savedInsulationTap(p?.enrichment)?.answers ?? null;
      const b44 = (p?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
      const declared = normaliseInsulation(declaredExtras(b44.raw?.answers ?? null).existing_insulation);
      rows.push({ id: j.id, jobNumber: j.job_number, owner: (j.owners as { full_name: string | null } | null)?.full_name ?? null, suburb: p?.suburb ?? null, houseAge: houseAgeLabel(tap), said: onsiteInsulationLine(tap), declared });
    }
  }
  return rows.sort((a, b) => (a.jobNumber ?? "").localeCompare(b.jobNumber ?? ""));
}

export type OnsiteOfferResult = { jobId: string; jobNumber: string | null; outcome: string; detail: string };

/** Explicit Office action per job: record the Office decision, prepare the estimate if needed, then the
 *  normal guarded Save my spot sender (switch, consent, opt-out, one-offer, TEST routing, logging). */
export async function offerOnsiteSaveSpot(jobIds: string[], actorId: string | null): Promise<OnsiteOfferResult[]> {
  const members = new Map((await listOnsiteAssessment()).map((r) => [r.id, r]));
  const { reviewLeadMedia } = await import("./enquiry-groups.server");
  const { reviewedInsulationOffer } = await import("./reviewed-insulation-offer.server");
  const out: OnsiteOfferResult[] = [];
  for (const id of [...new Set(jobIds)]) {
    const row = members.get(id);
    if (!row) { out.push({ jobId: id, jobNumber: null, outcome: "blocked", detail: "No longer in Needs onsite assessment. Nothing sent." }); continue; }
    if (row.declared === "none") { out.push({ jobId: id, jobNumber: row.jobNumber, outcome: "blocked", detail: "Owner said no insulation. Nothing sent." }); continue; }
    try {
      const review = qualifiesOutcome(row.declared);
      await reviewLeadMedia(id, review, actorId, "Office offered Save my spot from Needs onsite assessment");
      let r = await reviewedInsulationOffer(id, actorId, review, "send");
      if (r.needsEstimate) {
        const p = await reviewedInsulationOffer(id, actorId, review, "prepare");
        r = p.outcome === "blocked" || p.outcome === "failed" ? p : await reviewedInsulationOffer(id, actorId, review, "send");
      }
      out.push({ jobId: id, jobNumber: row.jobNumber, outcome: r.outcome, detail: r.detail });
    } catch (e) {
      out.push({ jobId: id, jobNumber: row.jobNumber, outcome: "blocked", detail: e instanceof Error ? e.message : "Could not offer. Nothing sent." });
    }
  }
  return out;
}
