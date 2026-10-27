// Decision 378: the "Choose installer" list — every our-lead job waiting for the office to pick an installer.
// Read-only, admin only. Two round trips: (1) the waiting-stage jobs + the partner coverage facts, together;
// (2) per-job facts batched by job id (chunks of 150, at most four in flight). Pure rules: installer-waiting-columns.core.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { savedPriceFromEstimate } from "./launch-campaign.core";
import { insulationChip } from "./office-filters.core";
import { selectAgreedRate } from "./allocation.core";
import { melbourneToday } from "./melbourne-time.core";
import { coverageLookup, installerWaiting, waitingSize, type InstallerWaitingRow, type WaitingInstaller, type WaitingPartner } from "./installer-waiting-columns.core";

type Row = Record<string, unknown>;
type Res = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const loose = admin as unknown as SupabaseClient;

/** Pages of 1000; a failed read throws (an empty list must never hide a failure). */
async function all(what: string, page: (from: number, to: number) => Res): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) return out;
  }
}
/** Job-id lookups are batched (AGENTS: one all-ids URL stalled Office reads). */
async function byIds(what: string, ids: string[], q: (chunk: string[], from: number, to: number) => Res): Promise<Row[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  const out: Row[] = [];
  for (let i = 0; i < chunks.length; i += 4) out.push(...(await Promise.all(chunks.slice(i, i + 4).map((c) => all(what, (f, t) => q(c, f, t))))).flat());
  return out;
}

/** Every installer / REC with the facts the coverage rule needs (one read each, no per-job lookups). */
async function partnerFacts(testBusinessIds?: string[]): Promise<WaitingPartner[]> {
  type ScopedQuery = { in: (column: string, ids: string[]) => ScopedQuery; range: (from: number, to: number) => Res };
  const scope = (query: unknown, column: string): ScopedQuery => {
    const q = query as ScopedQuery;
    return testBusinessIds ? q.in(column, testBusinessIds.length ? testBusinessIds : ["00000000-0000-0000-0000-000000000000"]) : q;
  };
  const [bizs, creds, rates, workers] = await Promise.all([
    all("partners", (a, b) => scope(admin.from("businesses").select("id, name, trading_name, business_type, capabilities, onboarding_status, is_active, service_postcodes, service_regions, coverage_verified_at, accepting_new_jobs, receives_hivic_leads, free_measureups_for_hivic_quote_leads, onboarding_notes, rec_number"), "id").range(a, b)),
    all("partner documents", (a, b) => scope(admin.from("business_credentials").select("business_id, kind, label, expires_at, critical, verification"), "business_id").range(a, b)),
    all("electrician rates", (a, b) => scope(loose.from("electrician_rates").select("id, business_id, service_type, rate_inc_gst, status, effective_from, effective_to").eq("status", "active").eq("service_type", "piesa"), "business_id").range(a, b)),
    all("electricians", (a, b) => scope(admin.from("partner_workers").select("business_id").eq("trade_role", "electrician").eq("approval_status", "approved").is("removed_at", null), "business_id").range(a, b)),
  ]);
  const today = melbourneToday();
  const credsBy = new Map<string, Row[]>();
  for (const c of creds) { const k = String(c["business_id"]); credsBy.set(k, [...(credsBy.get(k) ?? []), c]); }
  const elec = new Map<string, number>();
  for (const w of workers) { const k = String(w["business_id"]); elec.set(k, (elec.get(k) ?? 0) + 1); }
  return bizs.map((b) => {
    const id = String(b["id"]);
    return {
      ...(b as object), id, name: String(b["trading_name"] ?? b["name"] ?? ""),
      credentials: (credsBy.get(id) ?? []) as never,
      piesaRate: !!selectAgreedRate(rates as never, id, "piesa", today),
      approvedElectricians: elec.get(id) ?? 0,
    } as unknown as WaitingPartner;
  });
}

/** Every installer business with the facts the Ready Check offer rule reads — the same loader the pop-up's candidate
 *  list uses (readycheck-booking.server `installerOfferFacts`), so "Installer ✓" matches what the pop-up can release. */
async function installerFacts(testBusinessIds?: string[]): Promise<WaitingInstaller[]> {
  const bizs = await all("installers", (a, b) => {
    const q = admin.from("businesses").select("id, name, is_active, onboarding_status, accepting_new_jobs, receives_hivic_leads, coverage_verified_at, service_postcodes, free_measureups_for_hivic_quote_leads, onboarding_notes").or("business_type.eq.eec_installer,capabilities.cs.{installer}");
    return (testBusinessIds ? q.in("id", testBusinessIds.length ? testBusinessIds : ["00000000-0000-0000-0000-000000000000"]) : q).range(a, b);
  });
  const ids = bizs.map((b) => ({ ...(b as object), id: String(b["id"]) }));
  const facts = await (await import("./readycheck-booking.server")).installerOfferFacts(ids);
  return ids.map((b) => {
    const r = b as unknown as Row & { id: string };
    return {
      id: r.id, name: String(r["name"] ?? ""), is_active: r["is_active"] === true, onboarding_status: String(r["onboarding_status"] ?? ""),
      accepting_new_jobs: (r["accepting_new_jobs"] ?? null) as boolean | null, receives_hivic_leads: (r["receives_hivic_leads"] ?? null) as boolean | null,
      coverage_verified_at: s(r["coverage_verified_at"]), service_postcodes: (r["service_postcodes"] ?? null) as string[] | null,
      free_measureups_for_hivic_quote_leads: (r["free_measureups_for_hivic_quote_leads"] ?? null) as boolean | null, onboarding_notes: s(r["onboarding_notes"]),
      credentialsOk: facts.credentialsOk(r as never), fullCertifiedInstallers: facts.fullCertified(r.id),
    };
  });
}

export type InstallerWaitingList = { now: number; rows: InstallerWaitingRow[] };

export async function loadInstallerWaitingList(opts: { includeTest: boolean }, testJobIds?: string[], testBusinessIds?: string[]): Promise<InstallerWaitingList> {
  const now = Date.now();
  const [jobs, partners, installers] = await Promise.all([
    all("waiting jobs", (a, b) => {
      let q = admin.from("jobs").select("id, job_number, stage, source, channel, created_at, estimated_area_m2, deleted_at, qa_archived_at, owners(full_name), properties(suburb, postcode, answers:enrichment->base44->raw->answers)")
        .eq("stage", "ready_check_ready_to_schedule").eq("channel", "hivic_sourced").is("deleted_at", null).is("qa_archived_at", null);
      if (testJobIds) q = q.eq("source", "qa_test").in("id", testJobIds.length ? testJobIds : ["00000000-0000-0000-0000-000000000000"]);
      else if (!opts.includeTest) q = q.or("source.is.null,source.neq.qa_test");
      return q.order("created_at").order("id").range(a, b);
    }),
    partnerFacts(testBusinessIds),
    installerFacts(testBusinessIds),
  ]);
  const ids = jobs.map((j) => String(j["id"]));
  const [assigned, offers, saved, measured, estimates] = ids.length ? await Promise.all([
    byIds("installers", ids, (c, f, t) => admin.from("job_assignments").select("job_id").in("job_id", c).eq("role", "installer").eq("active", true).range(f, t)),
    byIds("Ready Check offers", ids, (c, f, t) => admin.from("partner_offers").select("job_id, status, offered_at, businesses(name)").in("job_id", c).eq("kind", "ready_check").range(f, t)),
    byIds("saved spots", ids, (c, f, t) => admin.from("lead_campaign_responses").select("job_id, spot_saved_at, opted_out_at, saved_total, saved_area_m2, saved_insulation").in("job_id", c).range(f, t)),
    byIds("measurements", ids, (c, f, t) => admin.from("ceiling_measurements").select("job_id, measured_area_m2").in("job_id", c).eq("is_current", true).not("measured_area_m2", "is", null).range(f, t)),
    byIds("website estimates", ids, (c, f, t) => admin.from("indicative_estimates").select("id, job_id, area_m2, insulation_declared, scenarios, created_at").in("job_id", c).eq("status", "current").order("created_at", { ascending: false }).range(f, t)),
  ]) : [[], [], [], [], []];

  const hasInstaller = new Set(assigned.map((a) => String(a["job_id"])));
  const offersBy = new Map<string, { status: string; offered_at: string; business_name: string | null }[]>();
  for (const o of offers) { const k = String(o["job_id"]); offersBy.set(k, [...(offersBy.get(k) ?? []), { status: String(o["status"]), offered_at: String(o["offered_at"]), business_name: (o["businesses"] as { name?: string } | null)?.name ?? null }]); }
  const savedBy = new Map(saved.map((r) => [String(r["job_id"]), r]));
  const measuredBy = new Map<string, number>();
  for (const m of measured) { const v = n(m["measured_area_m2"]); if (v != null) measuredBy.set(String(m["job_id"]), v); }
  const websiteTotal = new Map<string, number | null>();
  for (const e of estimates) { const k = String(e["job_id"]); if (!websiteTotal.has(k)) websiteTotal.set(k, savedPriceFromEstimate(e as never)?.total ?? null); }
  const covered = coverageLookup(partners, new Date(now), installers);
  // Decision 389: each job's release state (batched by job id).
  const releases = ids.length ? await (await import("./spot-release.server")).spotReleaseStates(ids) : new Map();
  const { releaseStatusLine, releasable } = await import("./spot-release.core");
  const { declaredExtras } = await import("./enquiry.core");
  const { normaliseInsulation } = await import("./eligibility.core");

  const rows: InstallerWaitingRow[] = [];
  for (const j of jobs) {
    const id = String(j["id"]);
    const member = installerWaiting({ channel: s(j["channel"]), stage: String(j["stage"]), deleted: !!j["deleted_at"], archived: !!j["qa_archived_at"], hasInstaller: hasInstaller.has(id), offers: offersBy.get(id) ?? [] });
    if (!member) continue;
    const prop = (j["properties"] ?? null) as { suburb: string | null; postcode: string | null; answers: Record<string, unknown> | null } | null;
    const sv = savedBy.get(id);
    const spotSavedAt = s(sv?.["spot_saved_at"]);
    const isTest = j["source"] === "qa_test";
    const postcode = (prop?.postcode ?? "").trim();
    const declared = s(sv?.["saved_insulation"]) ?? normaliseInsulation(declaredExtras(prop?.answers ?? null).existing_insulation);
    rows.push({
      id, jobNumber: String(j["job_number"]), ownerName: ((j["owners"] as { full_name?: string | null } | null)?.full_name ?? "").trim(),
      suburb: (prop?.suburb ?? "").trim(), postcode,
      ...waitingSize({ measuredM2: measuredBy.get(id) ?? null, savedM2: n(sv?.["saved_area_m2"]), estimatedM2: n(j["estimated_area_m2"]) }),
      insulation: insulationChip(declared),
      estimateDollars: n(sv?.["saved_total"]) ?? websiteTotal.get(id) ?? null,
      spotSavedAt, waitingFrom: spotSavedAt ?? String(j["created_at"]),
      coverage: covered(postcode || null, isTest),
      lastOffer: member.lastOffer, isTest,
      ...(() => { const r = releases.get(id); return r ? { release: { state: r.state, line: releaseStatusLine(r, now), releasable: releasable(r) } } : {}; })(),
    });
  }
  return { now, rows };
}
