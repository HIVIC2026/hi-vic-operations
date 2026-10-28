// O3 Jobs (Active) and O4 Enquiries list reads (office only, read-only). One pile per job: Enquiries is ONE list of
// every job before a spot is saved (office_enquiry_index bucket "enquiry"; decision 281 — no Fix details pile, the
// address lookup completes blanks itself); Jobs Active holds the "active" bucket split by the pure jobsStage rule.
// Filters, sorting, priority and paging are pure (office-filters.core); every job-id lookup is batched (AGENTS: one
// all-ids URL stalled Office reads).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { loadOffice } from "./office.server";
import { jobsStage, surnameOf, waitingOnLine, type JobsStage } from "./office-jobs.core";
import { tidyEnquiryDetails, type DetailsProblem } from "./name-address-tidy.core";
import { addressLine, estimateDollars, matchesColumnFilters, type ColumnFilters } from "./enquiry-columns.core";
import { savedPriceFromEstimate } from "./launch-campaign.core";
import { CATEGORY_RANK, categoryCounts, enquiryCategory, inView, ownerWrote, type EnquiryCategory, type EnquiryView } from "./enquiry-categories.core";
import { FIRST_RESPONSE_PURPOSES } from "./automatic-first-response.core";
import { readAutoOfferSwitches } from "./auto-offer.server";
import type { OfficeStatus } from "./office-status.core";
import type { SpotReleaseState } from "./spot-release.core";
import { activeJobInstaller, laneCounts, areaCell, costCell, daysAtStage, insulationYesNo, laneOf, matchesJobsFilters, nextStep, type JobsColumnFilters, type JobsColumnRow, type JobsLane } from "./jobs-columns.core";
import {
  insulationChip, lastHeardChip, pageOf, rankByPriority, regionChip, sizeChip, sortRows, sourceChip,
  type InsulationChip, type LastHeardChip, type RegionChip, type SizeChip, type SortDir, type SourceChip,
} from "./office-filters.core";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));

async function all(what: string, page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) return out;
  }
}
async function byIds(what: string, ids: string[], q: (chunk: string[], from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const chunks: string[][] = [];
  // 150 ids per request (not office.server's 200): an enquiry has several sends, and a chunk over 1,000 rows pages
  // into a second, sequential request.
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  const out: Row[] = [];
  // At most eight chunks in flight: bounded parallel reads.
  for (let i = 0; i < chunks.length; i += 8) out.push(...(await Promise.all(chunks.slice(i, i + 8).map((c) => all(what, (f, t) => q(c, f, t))))).flat());
  return out;
}

/** "Last heard from us" per job (decision 216): newest email / text / recorded outbound contact that did not fail. */
async function lastHeardMap(ids: string[], customerOnly = false) {
  const [emails, texts, comms] = await Promise.all([
    byIds("emails sent", ids, (c, f, t) => admin.from("customer_email_sends").select("job_id, sent_at, created_at, purpose, status").in("job_id", c).in("status", ["sent", "delivered"]).range(f, t)),
    byIds("texts sent", ids, (c, f, t) => admin.from("sms_messages").select("job_id, created_at, message_type, status").in("job_id", c).is("business_id", null).in("status", ["sent", "delivered", "accepted", "queued"]).range(f, t)),
    byIds("recorded contact", ids, (c, f, t) => {
      let q = admin.from("job_communications").select("job_id, sent_at, channel, delivery_status").in("job_id", c).not("sent_at", "is", null);
      q = customerOnly ? q.eq("direction", "outbound").eq("visibility", "customer").in("channel", ["email", "sms", "phone"]).in("delivery_status", ["sent", "delivered", "accepted"]) : q.in("direction", ["outbound", "internal"]).not("delivery_status", "in", "(failed,bounced,undelivered)");
      return q.range(f, t);
    }),
  ]);
  const m = new Map<string, { at: string; channel: string }>();
  const put = (id: unknown, at: unknown, channel: string) => { const k = String(id), a = s(at); if (!a) return; const cur = m.get(k); if (!cur || cur.at < a) m.set(k, { at: a, channel }); };
  for (const e of emails) put(e["job_id"], e["sent_at"] ?? e["created_at"], "email");
  for (const x of texts) put(x["job_id"], x["created_at"], "text");
  for (const c of comms) put(c["job_id"], c["sent_at"], c["channel"] === "phone" ? "call" : c["channel"] === "sms" ? "text" : c["channel"] === "note" ? "note" : "email");
  const sends = new Map<string, { purpose: string; at: string; status: string }[]>();
  for (const e of emails) { const k = String(e["job_id"]); sends.set(k, [...(sends.get(k) ?? []), { purpose: String(e["purpose"]), at: String(e["sent_at"] ?? e["created_at"]), status: String(e["status"]) }]); }
  return { last: m, sends };
}

/** Approved installers' coverage (same partner facts as Partners › Coverage) → is this postcode covered? */
async function coveredFn(testOnly = false) {
  const [{ data: businesses, error: be }, { data: credentials, error: ce }] = await Promise.all([
    (() => { const q = admin.from("businesses").select("id,name,trading_name,business_type,capabilities,onboarding_status,is_active,service_postcodes,service_regions,coverage_verified_at,declared_service_origin,declared_travel_radius_km,declared_excluded_areas"); return testOnly ? q.ilike("email", "%@hivic-test.example").like("onboarding_notes", "%[TEST PARTNER]%") : q; })(),
    testOnly ? Promise.resolve({ data: [], error: null }) : admin.from("business_credentials").select("business_id,kind,label,expires_at,critical,verification"),
  ]);
  if (be || ce) throw new Error(`Coverage could not be loaded: ${(be ?? ce)!.message}`);
  const { tradeCoverage } = await import("./coverage.core");
  type P = import("./coverage.core").CoveragePartner;
  const partners = (businesses ?? []).map((b) => ({ ...b, name: b.trading_name || b.name, credentials: (credentials ?? []).filter((c) => c.business_id === b.id) })) as unknown as P[];
  const cache = new Map<string, boolean>();
  return (postcode: string | null, suburb: string | null) => {
    const k = `${postcode ?? ""}|${suburb ?? ""}`;
    if (!cache.has(k)) cache.set(k, tradeCoverage(partners, "installer", { postcode, suburb }).state === "serviceable");
    return cache.get(k)!;
  };
}

/** Decisions 285/286: one search box (owner name, address, job number) + column headings that sort AND filter; no chip panel. */
/** `view`: one category, "active" (default: all but Gone quiet) or "all" (enquiry-categories.core, Jo 26 Oct 2026).
 *  `wantIds`: also return every id in the view (Gone quiet › Close them). */
export type EnquiryListParams = { search: string; sort: string; dir: SortDir; page: number; filters: ColumnFilters; includeTest?: boolean; view?: EnquiryView | undefined; wantIds?: boolean | undefined };
export type EnquiryListRow = {
  id: string; jobNumber: string; ownerName: string; street: string; suburb: string; postcode: string; address: string; phone: string | null; email: string | null;
  told: string; websiteSaid: string; problems: DetailsProblem[]; lastHeardAt: string | null; lastHeardChannel: string | null; waitingOn: string;
  insulation: InsulationChip; size: SizeChip; region: RegionChip | null; source: SourceChip; heard: LastHeardChip; createdAt: string; areaM2: number | null;
  estimateDollars: number | null; estimateKind: "quote" | "website" | null;
  category: EnquiryCategory;
  /** The owner emailed us and we haven't written since (last 14 days): the "Wrote to us" marker. */
  ownerWroteAt: string | null;
};

/** Estimate column facts (decision 286): the latest issued / accepted installation quote, else the current website estimate. */
async function estimateTotals(ids: string[]) {
  const [estimates, quotes] = await Promise.all([
    byIds("website estimates", ids, (c, f, t) => admin.from("indicative_estimates").select("id, job_id, area_m2, insulation_declared, scenarios, created_at").in("job_id", c).eq("status", "current").order("created_at", { ascending: false }).range(f, t)),
    byIds("quotes", ids, (c, f, t) => admin.from("quotes").select("job_id, customer_total_inc_gst, created_at").in("job_id", c).eq("kind", "installation").in("status", ["issued", "accepted"]).order("created_at", { ascending: false }).range(f, t)),
  ]);
  const website = new Map<string, number | null>();
  for (const e of estimates) { const k = String(e["job_id"]); if (!website.has(k)) website.set(k, savedPriceFromEstimate(e as never)?.total ?? null); }
  const quote = new Map<string, number | null>();
  for (const q of quotes) { const k = String(q["job_id"]); if (!quote.has(k)) quote.set(k, q["customer_total_inc_gst"] == null ? null : Number(q["customer_total_inc_gst"])); }
  return (id: string) => ({ quoteTotal: quote.get(id) ?? null, estimateTotal: website.get(id) ?? null });
}
async function estimateMap(ids: string[]) {
  const totals = await estimateTotals(ids);
  return (id: string) => { const t = totals(id); return estimateDollars({ websiteTotal: t.estimateTotal, quoteTotal: t.quoteTotal }); };
}

export async function loadEnquiriesList(p: EnquiryListParams, testJobIds?: string[]) {
  const now = Date.now();
  const index: Row[] = testJobIds ? await all("TEST enquiries", (a, b) => admin.from("jobs")
    .select("id,job_number,created_at,source,channel,owners(full_name,email,phone)").eq("source", "qa_test").eq("channel", "hivic_sourced")
    .in("id", testJobIds.length ? testJobIds : ["00000000-0000-0000-0000-000000000000"])
    .in("stage", ["new_enquiry", "eligibility_review", "preliminary_estimate_ready"]).order("created_at", { ascending: false }).order("id").range(a, b))
    .then(rows => rows.map(r => { const owner = r["owners"] as { full_name?: string; email?: string; phone?: string } | null; return { ...r, owner_name: owner?.full_name, owner_email: owner?.email, owner_phone: owner?.phone, enquiry_status: null, needs_first_response: false, latest_attempt_status: null }; }))
    : await all("enquiries", (a, b) => {
    let q = admin.from("office_enquiry_index").select("id, job_number, created_at, source, channel, enquiry_status, needs_first_response, latest_attempt_status, owner_name, owner_email, owner_phone").eq("office_bucket", "enquiry").eq("channel", "hivic_sourced");
    q = q.in("source", ["base44", "portal", "email"]);
    return q.order("created_at", { ascending: false }).order("id").range(a, b);
  });
  const ids = index.map((r) => String(r["id"]));
  const [jobs, heard, answered, covered, estimateOf, inbound, campaignOpt, emailOpt] = await Promise.all([
    byIds("enquiry details", ids, (c, f, t) => admin.from("jobs").select("id, estimated_area_m2, properties(address_line, suburb, postcode, answers:enrichment->base44->raw->answers)").in("id", c).range(f, t)),
    lastHeardMap(ids, true),
    byIds("3 questions answers", ids, (c, f, t) => admin.from("workflow_events").select("job_id, created_at").in("job_id", c).eq("event_type", "owner_insulation_details_answered").range(f, t)),
    coveredFn(!!testJobIds),
    estimateMap(ids),
    // Where the lead is up to (enquiry-categories.core): owner emails matched to the job, and opt-outs (the same two
    // sources the estimate follow-up reads). Same wave as the reads above.
    byIds("owner emails", ids, (c, f, t) => admin.from("job_communications").select("job_id, received_at").in("job_id", c).eq("direction", "inbound").not("received_at", "is", null).range(f, t)),
    byIds("opt-outs", ids, (c, f, t) => admin.from("lead_campaign_responses").select("job_id").in("job_id", c).not("opted_out_at", "is", null).range(f, t)),
    byIds("email opt-outs", ids, (c, f, t) => admin.from("customer_email_optouts").select("job_id").in("job_id", c).not("opted_out_at", "is", null).range(f, t)),
  ]);
  const optedOut = new Set([...campaignOpt, ...emailOpt].map((r) => String(r["job_id"])));
  const latest = (rows: Row[], at: string) => { const m = new Map<string, string>(); for (const r of rows) { const k = String(r["job_id"]), a = s(r[at]); if (a && (!m.get(k) || m.get(k)! < a)) m.set(k, a); } return m; };
  const answeredAt = latest(answered, "created_at"), inboundAt = latest(inbound, "received_at");
  const { declaredExtras } = await import("./enquiry.core");
  const { normaliseInsulation } = await import("./eligibility.core");
  const jobById = new Map(jobs.map((j) => [String(j["id"]), j]));
  const answeredSet = new Set(answered.map((a) => String(a["job_id"])));
  const REMINDER = /reminder|followup|follow_up/;
  const rows = index.map((r) => {
    const id = String(r["id"]);
    const j = jobById.get(id);
    const prop = (j?.["properties"] ?? null) as { address_line: string | null; suburb: string | null; postcode: string | null; answers: Record<string, unknown> | null } | null;
    const tidy = tidyEnquiryDetails({ fullName: s(r["owner_name"]), addressLine: prop?.address_line ?? null, suburb: prop?.suburb ?? null, postcode: prop?.postcode ?? null });
    const declared = normaliseInsulation(declaredExtras(prop?.answers ?? null).existing_insulation);
    const areaM2 = j?.["estimated_area_m2"] != null ? Number(j["estimated_area_m2"]) : null;
    const last = heard.last.get(id) ?? null;
    const sends = (heard.sends.get(id) ?? []).sort((a, b) => a.at.localeCompare(b.at));
    const ins = insulationChip(declared);
    const est = estimateOf(id);
    const latestFailed = r["latest_attempt_status"] === "failed" && r["needs_first_response"] === true;
    const ans = answeredAt.get(id) ?? null, inb = inboundAt.get(id) ?? null;
    const ownerAt = [ans, inb].filter((x): x is string => !!x).sort().at(-1) ?? null;
    const noResponseYet = !sends.some(x => (FIRST_RESPONSE_PURPOSES as readonly string[]).includes(x.purpose));
    const category = enquiryCategory({ createdAt: String(r["created_at"]), enquiryStatus: s(r["enquiry_status"]), lastOutboundAt: last?.at ?? null, lastOwnerAt: ownerAt, inboundAt: inb, optedOut: optedOut.has(id), sendFailed: latestFailed, noResponseYet }, now);
    return {
      category, ownerWroteAt: ownerWrote({ inboundAt: inb, lastOutboundAt: last?.at ?? null }, now),
      id, jobNumber: String(r["job_number"]), ownerName: tidy.fullName, street: tidy.street, suburb: tidy.suburb, postcode: tidy.postcode, address: addressLine(tidy), phone: s(r["owner_phone"]), email: s(r["owner_email"]),
      estimateDollars: est.dollars, estimateKind: est.kind,
      told: [areaM2 ? `~${Math.round(areaM2)} m²` : "No size", ins === "no" ? "no insulation" : ins === "some" ? "some insulation" : "not sure"].join(" · "),
      websiteSaid: [s(r["owner_name"]), [prop?.address_line, prop?.suburb, prop?.postcode].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
      problems: tidy.problems, lastHeardAt: last?.at ?? null, lastHeardChannel: last?.channel ?? null,
      waitingOn: waitingOnLine({ enquiryStatus: s(r["enquiry_status"]), needsFirstResponse: r["needs_first_response"] === true, latestSend: sends.at(-1) ?? null, reminders: sends.filter((x) => REMINDER.test(x.purpose)).length, answeredQuestions: answeredSet.has(id), latestFailed }),
      insulation: ins, size: sizeChip(areaM2), region: regionChip(tidy.postcode || prop?.postcode), source: sourceChip({ source: s(r["source"]), channel: s(r["channel"]) }), heard: lastHeardChip(last?.at ?? null, now),
      createdAt: String(r["created_at"]), areaM2, covered: covered(tidy.postcode || prop?.postcode || null, tidy.suburb || null),
    };
  });
  // Decision 281: one list. `open` = every enquiry; `incompleteAddresses` = still waiting on the automatic lookup.
  const counts = { open: rows.length, incompleteAddresses: rows.filter((r) => r.problems.length > 0).length, byCategory: categoryCounts(rows.map((r) => r.category)) };
  const view = p.view ?? "offered";
  const ranked = rankByPriority(rows.map((r) => ({ ...r, insulation: r.insulation, lastHeardAt: r.lastHeardAt })), now);
  const q = p.search.trim().toLowerCase();
  const filtered = ranked.filter((r) => inView(r.category, view) && matchesColumnFilters(r, p.filters ?? {}) && (!q || [r.jobNumber, r.ownerName, r.street, r.suburb, r.postcode, r.email ?? "", r.phone ?? "", r.websiteSaid].join(" ").toLowerCase().includes(q)));
  // Decision 286 columns: Job · Owner · Address · Size · Insulation · Estimate · Last heard (older keys kept for bookmarks).
  const SORTS: Record<string, keyof (typeof filtered)[number]> = { priority: "priority", job: "jobNumber", owner: "ownerName", address: "street", street: "street", suburb: "suburb", postcode: "postcode", size: "areaM2", insulation: "insulation", estimate: "estimateDollars", heard: "lastHeardAt", waiting: "waitingOn", told: "areaM2", created: "createdAt" };
  const key = SORTS[p.sort] ?? "priority";
  // Opening order: by category (replied first), hottest first inside each (decision 283's rank, never shown).
  const sorted = p.sort ? sortRows(filtered, key, p.dir) : [...sortRows(filtered, "priority", "asc")].sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]);
  const page = pageOf(sorted, p.page);
  // Decision 283: the priority rank sorts the list hottest first but is never shown, so it does not leave the server.
  return { ...page, counts, view, ...(p.wantIds ? { ids: sorted.map((r) => r.id) } : {}), rows: page.rows.map(({ score: _s, priority: _n, covered: _c, ...r }) => r as EnquiryListRow) };
}

/** Fresh per-job recheck immediately before a bulk close, never a saved list snapshot. */
export async function enquiryCloseBlocker(jobId: string): Promise<string | null> {
  const { data: index, error } = await admin.from("office_enquiry_index").select("office_bucket, created_at, enquiry_status, needs_first_response").eq("id", jobId).maybeSingle();
  if (error) throw new Error("The enquiry could not be rechecked.");
  if (!index || index.office_bucket !== "enquiry") return null; // ordinary Jobs bulk cancellation is unchanged
  const [heard, inbound] = await Promise.all([
    lastHeardMap([jobId], true),
    admin.from("job_communications").select("received_at").eq("job_id", jobId).eq("direction", "inbound").not("received_at", "is", null).order("received_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (inbound.error) throw new Error("The owner's email could not be rechecked.");
  const { enquiryBulkCloseBlocker } = await import("./enquiry-categories.core");
  return enquiryBulkCloseBlocker({ createdAt: index.created_at ?? "", enquiryStatus: index.enquiry_status, lastOutboundAt: heard.last.get(jobId)?.at ?? null, lastOwnerAt: inbound.data?.received_at ?? null, inboundAt: inbound.data?.received_at ?? null, optedOut: index.enquiry_status === "opted_out", sendFailed: false, noResponseYet: !(heard.sends.get(jobId) ?? []).some(x => (FIRST_RESPONSE_PURPOSES as readonly string[]).includes(x.purpose)) }, Date.now());
}
export type JobsListParams = { lane: JobsLane; search: string; sort: string; dir: SortDir; page: number; filters: JobsColumnFilters; needsUs: boolean; includeTest?: boolean };
export type JobsListRow = JobsColumnRow & {
  id: string; ownJob: boolean; onHold: boolean; lifeSupport: boolean; isTest: boolean; lastHeardAt: string | null; lastHeardChannel: string | null;
};

/** Tab badges: active jobs per lane (real jobs only; `testJobIds` = the TEST office, which counts only its own test jobs). */
export async function loadJobsLaneCounts(testJobIds?: string[]): Promise<{ ours: number; installer: number }> {
  // Same rule as the list's `all` (activeJobLane): deleted / archived and stage-less jobs are not counted. Light reads only.
  const base: Row[] = testJobIds ? await all("TEST lane counts", (a, b) => admin.from("jobs")
    .select("id,stage,channel,businesses!jobs_originating_installer_business_id_fkey(name)")
    .eq("source", "qa_test").is("deleted_at", null).is("qa_archived_at", null)
    .in("id", testJobIds.length ? testJobIds : ["00000000-0000-0000-0000-000000000000"])
    .not("stage", "in", "(new_enquiry,eligibility_review,preliminary_estimate_ready,complete,cancelled)").order("id").range(a, b))
    .then(rows => rows.map(r => ({ ...r, installer_name: null, originating_business_name: (r["businesses"] as { name?: string } | null)?.name })))
    // office_job_list is the shared office bucket view (not in the generated client types).
    : await all("active job lanes", (a, b) => (admin as unknown as { from: (t: string) => any }).from("office_job_list") // eslint-disable-line @typescript-eslint/no-explicit-any
      .select("id, stage, channel, installer_name, originating_business_name").eq("office_bucket", "active").or("source.is.null,source.neq.qa_test").order("id").range(a, b));
  const extra = await byIds("job facts", base.map((r) => String(r["id"])), (c, f, t) => admin.from("jobs").select("id, prior_stage, deleted_at, qa_archived_at").in("id", c).range(f, t));
  const ex = new Map(extra.map((r) => [String(r["id"]), r]));
  return laneCounts(base.flatMap((r) => {
    const e = ex.get(String(r["id"]));
    if (!e) return [];
    return [{ channel: s(r["channel"]), stage: s(r["stage"]), priorStage: s(e["prior_stage"]), installerName: s(r["installer_name"]), originatingName: s(r["originating_business_name"]), deleted: !!(e["deleted_at"] || e["qa_archived_at"]) }];
  }));
}

export async function loadActiveJobsList(p: JobsListParams, testJobIds?: string[]) {
  const now = Date.now();
  const base: Row[] = testJobIds ? await all("TEST active jobs", (a, b) => admin.from("jobs")
    .select("id,job_number,stage,source,channel,life_support,last_activity_at,created_at,owners(full_name,email,phone),properties(address_line),businesses!jobs_originating_installer_business_id_fkey(name)")
    .eq("source", "qa_test").is("deleted_at", null).is("qa_archived_at", null)
    .in("id", testJobIds.length ? testJobIds : ["00000000-0000-0000-0000-000000000000"])
    .not("stage", "in", "(new_enquiry,eligibility_review,preliminary_estimate_ready,complete,cancelled)").order("created_at", { ascending: false }).order("id").range(a,b))
    .then(rows => rows.map(r => { const owner = r["owners"] as { full_name?: string; email?: string; phone?: string } | null; const property = r["properties"] as { address_line?: string } | null; const business = r["businesses"] as { name?: string } | null; return { ...r, owner_name: owner?.full_name, owner_email: owner?.email, owner_phone: owner?.phone, property_address: property?.address_line, originating_business_name: business?.name, installer_name: null }; }))
    : await all("active jobs", (a, b) => {
    // office_job_list is the shared office bucket view (not in the generated client types).
    const view = (admin as unknown as { from: (t: string) => any }).from("office_job_list"); // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = view.select("id, job_number, stage, source, channel, owner_name, owner_email, owner_phone, property_address, installer_name, originating_business_name, life_support, last_activity_at, created_at").eq("office_bucket", "active");
    q = p.includeTest ? q : q.or("source.is.null,source.neq.qa_test");
    return q.order("created_at", { ascending: false }).order("id").range(a, b);
  });
  // Lane first: everything below works on the one lane being shown (channel decides it, jobs-columns.core laneOf).
  const inLane = base.filter((r) => laneOf(s(r["channel"])) === p.lane);
  const ids = inLane.map((r) => String(r["id"]));
  const [extra, heard, measurements, totals, switches] = await Promise.all([
    byIds("job facts", ids, (c, f, t) => admin.from("jobs").select("id, prior_stage, deleted_at, qa_archived_at, created_at, estimated_area_m2, properties(suburb, postcode, answers:enrichment->base44->raw->answers)").in("id", c).range(f, t)),
    lastHeardMap(ids),
    byIds("ceiling measurements", ids, (c, f, t) => admin.from("ceiling_measurements").select("job_id, measured_area_m2, verified_area_m2").in("job_id", c).eq("is_current", true).range(f, t)),
    estimateTotals(ids),
    readAutoOfferSwitches(),
  ]);
  const ex = new Map(extra.map((r) => [String(r["id"]), r]));
  const live = inLane.filter((r) => { const e = ex.get(String(r["id"])); return e && !e["deleted_at"] && !e["qa_archived_at"]; });
  const measured = new Map<string, number>();
  for (const m of measurements) { const v = Number(m["verified_area_m2"] ?? m["measured_area_m2"]); if (Number.isFinite(v) && v > 0 && !measured.has(String(m["job_id"]))) measured.set(String(m["job_id"]), v); }
  // Next step needs the office rulebook (office-status.core via loadOffice, status facts only) for every row in the lane:
  // one call, because the Next step column, its filter and Needs us all read it.
  const statusOf = new Map<string, { status: OfficeStatus | null; enteredStageAt: string | null }>();
  if (live.length) {
    const o = await loadOffice(admin, { includeTest: true, onlyIds: live.map((r) => String(r["id"])), statusOnly: true });
    for (const j of o.jobs) statusOf.set(j.id, { status: j.status ?? null, enteredStageAt: j.facts?.enteredStageAt ?? null });
  }
  // Decision 389 (as Needs me): a saved spot already released waits on the owner's Confirm. One read, spot-saved rows only.
  const spotSavedIds = [...statusOf].filter(([, v]) => v.status && ["enquiry.spot_saved", "enquiry.spot_saved_video"].includes(v.status.key)).map(([id]) => id);
  const releases = spotSavedIds.length && switches.readyCheckBooking ? await (await import("./spot-release.server")).spotReleaseStates(spotSavedIds) : new Map<string, SpotReleaseState>();
  const { declaredExtras } = await import("./enquiry.core");
  const { normaliseInsulation } = await import("./eligibility.core");
  const rows: (JobsListRow & { surname: string; lastHeardSort: string | null })[] = [];
  for (const r of live) {
    const id = String(r["id"]);
    const e = ex.get(id)!;
    const prop = e["properties"] as { suburb: string | null; postcode: string | null; answers: Record<string, unknown> | null } | null;
    const ownJob = r["channel"] === "installer_sourced";
    const installer = activeJobInstaller(s(r["channel"]), s(r["installer_name"]), s(r["originating_business_name"]));
    const stage = jobsStage({ stage: s(r["stage"]), priorStage: s(e["prior_stage"]), hasInstaller: !!installer });
    if (!stage) continue;
    const last = heard.last.get(id) ?? null;
    const onHold = r["stage"] === "on_hold";
    const st = statusOf.get(id);
    const t = totals(id);
    rows.push({
      id, jobNumber: String(r["job_number"]), owner: s(r["owner_name"]) ?? "", surname: surnameOf(s(r["owner_name"])), suburb: prop?.suburb ?? null, stage,
      next: nextStep(st?.status ?? null, { onHold, readyCheckBookingOn: switches.readyCheckBooking, release: releases.get(id)?.state ?? null }),
      days: daysAtStage(st?.enteredStageAt ?? null, String(e["created_at"] ?? r["created_at"]), now),
      areaM2: areaCell(measured.get(id) ?? null, e["estimated_area_m2"] == null ? null : Number(e["estimated_area_m2"])),
      insulation: insulationYesNo(insulationChip(normaliseInsulation(declaredExtras(prop?.answers ?? null).existing_insulation))),
      cost: costCell({ lane: p.lane, quoteTotal: t.quoteTotal, estimateTotal: t.estimateTotal }),
      installer, ownJob, onHold, lifeSupport: r["life_support"] === true, isTest: r["source"] === "qa_test",
      heard: lastHeardChip(last?.at ?? null, now), lastHeardAt: last?.at ?? null, lastHeardChannel: last?.channel ?? null, lastHeardSort: last?.at ?? null,
    });
  }
  const installers = [...new Set(rows.map((r) => r.installer).filter((x): x is string => !!x))].sort();
  const nextSteps = [...new Set(rows.map((r) => r.next.text))].sort();
  const q = p.search.trim().toLowerCase();
  const filtered = rows.filter((r) => matchesJobsFilters(r, p.filters, p.needsUs)
    && (!q || [r.jobNumber, r.owner, r.suburb ?? "", r.installer ?? "", r.next.text].join(" ").toLowerCase().includes(q)));
  const STAGE_ORDER: Record<JobsStage, number> = { choose_installer: 1, ready_check: 2, quote: 3, piesa: 4, install: 5, final_check: 6 };
  type Sortable = (typeof rows)[number] & { costSort: number | null; nextSort: string; insSort: string };
  const SORTS: Record<string, keyof Sortable> = { job: "jobNumber", next: "nextSort", owner: "surname", suburb: "suburb", days: "days", area: "areaM2", insulation: "insSort", cost: "costSort", installer: "installer", heard: "lastHeardSort" };
  const key = SORTS[p.sort] ?? "lastHeardSort"; // empty sort = Last heard, newest first
  const withKeys: Sortable[] = filtered.map((r) => ({ ...r, costSort: r.cost.dollars, nextSort: r.next.text, insSort: r.insulation }));
  const dir = p.sort ? p.dir : "desc";
  const sorted = p.sort === "stage" ? [...withKeys].sort((a, b) => (STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]) * (dir === "asc" ? 1 : -1) || a.id.localeCompare(b.id)) : sortRows(withKeys, key, dir);
  const page = pageOf(sorted, p.page);
  return {
    ...page, total: page.total, all: rows.length, nextSteps, installers,
    rows: page.rows.map(({ surname: _s, lastHeardSort: _h, costSort: _c, nextSort: _n, insSort: _i, ...r }) => r as JobsListRow),
  };
}
