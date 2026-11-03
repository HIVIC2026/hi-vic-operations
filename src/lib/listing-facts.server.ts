// Listing facts for the nightly listing check (saved spots by area, Task 7). Reads the queue; writes only the
// property's `listing_check` fact (the previous current one is superseded).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/integrations/supabase/types";
import { hasFullStreet } from "./area-batch.server";
import { spotBand } from "./saved-spot-rank.core";
import { listingFactValue, orderListingQueue, type ListingResult } from "./listing-facts.core";

type Row = Record<string, unknown>;
const loose = admin as unknown as SupabaseClient;
const chunks = <T>(a: T[], n = 150) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const str = (v: unknown) => (v == null ? "" : String(v));

export type ListingQueueItem = {
  jobId: string;
  jobNumber: string;
  address: string;
  suburb: string;
  postcode: string;
};

/** Saved spots waiting for an installer, with a street address and no current listing check, in the spec's order. */
export async function listingQueue(limit: number, nowMs = Date.now()): Promise<ListingQueueItem[]> {
  const saved: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await loose
      .from("lead_campaign_responses")
      .select("job_id, spot_saved_at")
      .not("spot_saved_at", "is", null)
      .is("opted_out_at", null)
      .order("spot_saved_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(`Could not load saved spots: ${error.message}`);
    saved.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) break;
  }
  const savedAt = new Map(saved.map((r) => [str(r["job_id"]), str(r["spot_saved_at"])]));
  const jobs: Row[] = [];
  for (const c of chunks([...savedAt.keys()])) {
    const { data, error } = await loose
      .from("jobs")
      .select("id, job_number, source, property_id, properties(address_line, suburb, postcode)")
      .in("id", c)
      .eq("stage", "ready_check_ready_to_schedule")
      .eq("channel", "hivic_sourced") // our leads only, as To release shows
      .is("deleted_at", null)
      .is("qa_archived_at", null);
    if (error) throw new Error(`Could not load saved spot homes: ${error.message}`);
    jobs.push(...((data ?? []) as Row[]));
  }
  const eligible = jobs.filter((j) => {
    const p = j["properties"] as { address_line?: string | null } | null;
    return j["source"] !== "qa_test" && !!j["property_id"] && hasFullStreet(p?.address_line);
  });
  const checked = new Set<string>();
  for (const c of chunks(eligible.map((j) => str(j["property_id"])))) {
    const { data, error } = await loose
      .from("property_facts")
      .select("property_id")
      .in("property_id", c)
      .eq("fact_key", "listing_check")
      .eq("is_current", true);
    if (error) throw new Error(`Could not load listing checks: ${error.message}`);
    for (const r of (data ?? []) as Row[]) checked.add(str(r["property_id"]));
  }
  const todo = eligible.filter((j) => !checked.has(str(j["property_id"])));
  if (!todo.length) return [];
  const { readSpotFacts } = await import("./saved-spot-facts.server");
  const facts = await readSpotFacts(
    todo.map((j) => str(j["id"])),
    { now: nowMs },
  );
  const ordered = orderListingQueue(
    todo.flatMap((j) => {
      const f = facts.get(str(j["id"]));
      return f
        ? [{ j, jobId: str(j["id"]), savedAt: savedAt.get(str(j["id"])) ?? "", band: spotBand(f) }]
        : [];
    }),
    nowMs,
  );
  return ordered.slice(0, limit).map(({ j, jobId }) => {
    const p = j["properties"] as {
      address_line?: string | null;
      suburb?: string | null;
      postcode?: string | null;
    };
    return {
      jobId,
      jobNumber: str(j["job_number"]),
      address: str(p.address_line).trim(),
      suburb: str(p.suburb).trim(),
      postcode: str(p.postcode).trim(),
    };
  });
}

/** One current `listing_check` fact per home. Returns how many were written and the job ids that were skipped. */
export async function saveListingResults(
  results: ListingResult[],
): Promise<{ written: number; skipped: string[] }> {
  const skipped: string[] = [];
  let written = 0;
  for (const r of results) {
    const { data: job } = await loose
      .from("jobs")
      .select("id, property_id")
      .eq("id", r.jobId)
      .maybeSingle();
    const propertyId = job ? str((job as Row)["property_id"]) : "";
    if (!propertyId) {
      skipped.push(r.jobId);
      continue;
    }
    const { error: upErr } = await loose
      .from("property_facts")
      .update({ is_current: false, superseded_at: new Date().toISOString() })
      .eq("property_id", propertyId)
      .eq("fact_key", "listing_check")
      .eq("is_current", true);
    if (upErr) throw new Error(`Could not replace the old listing check: ${upErr.message}`);
    const { error } = await loose.from("property_facts").insert({
      job_id: r.jobId,
      property_id: propertyId,
      is_current: true,
      fact_key: "listing_check",
      value: listingFactValue(r) as unknown as Json,
      check_status: "info",
      source_type: "listing",
      source_name: r.source ?? "listing check",
      source_url: r.url,
      confidence: "medium",
      evidence_kind: "inferred",
    });
    if (error) throw new Error(`Could not save the listing check: ${error.message}`);
    written++;
  }
  return { written, skipped };
}
