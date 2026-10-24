// O3 Jobs (Active) and O4 Enquiries list reads (office only, read-only). One pile per job: Enquiries holds every
// job before a spot is saved (office_enquiry_index bucket "enquiry") split by the pure enquiryPile rule; Jobs Active
// holds the "active" bucket split by the pure jobsStage rule. Filters, sorting, priority and paging are pure
// (office-filters.core); every job-id lookup is batched (AGENTS: one all-ids URL stalled Office reads).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { loadOffice } from "./office.server";
import { enquiryPile, jobsStage, surnameOf, waitingOnLine, type EnquiryPile, type JobsStage } from "./office-jobs.core";
import { tidyEnquiryDetails, type DetailsProblem } from "./name-address-tidy.core";
import {
  insulationChip, lastHeardChip, matchesChips, pageOf, rankByPriority, regionChip, sizeChip, sortRows, sourceChip,
  type ChipFilters, type InsulationChip, type LastHeardChip, type RegionChip, type SizeChip, type SortDir, type SourceChip,
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
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  const out: Row[] = [];
  // At most four chunks in flight: bounded parallel reads.
  for (let i = 0; i < chunks.length; i += 4) out.push(...(await Promise.all(chunks.slice(i, i + 4).map((c) => all(what, (f, t) => q(c, f, t))))).flat());
  return out;
}

/** "Last heard from us" per job (decision 216): newest email / text / recorded outbound contact that did not fail. */
async function lastHeardMap(ids: string[]) {
  const [emails, texts, comms] = await Promise.all([
    byIds("emails sent", ids, (c, f, t) => admin.from("customer_email_sends").select("job_id, sent_at, created_at, purpose, status").in("job_id", c).in("status", ["sent", "delivered"]).range(f, t)),
    byIds("texts sent", ids, (c, f, t) => admin.from("sms_messages").select("job_id, created_at, message_type, status").in("job_id", c).is("business_id", null).in("status", ["sent", "delivered", "accepted", "queued"]).range(f, t)),
    byIds("recorded contact", ids, (c, f, t) => admin.from("job_communications").select("job_id, sent_at, channel, delivery_status").in("job_id", c).in("direction", ["outbound", "internal"]).not("sent_at", "is", null).not("delivery_status", "in", "(failed,bounced,undelivered)").range(f, t)),
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
async function coveredFn() {
  const [{ data: businesses, error: be }, { data: credentials, error: ce }] = await Promise.all([
    admin.from("businesses").select("id,name,trading_name,business_type,capabilities,onboarding_status,is_active,service_postcodes,service_regions,coverage_verified_at,declared_service_origin,declared_travel_radius_km,declared_excluded_areas"),
    admin.from("business_credentials").select("business_id,kind,label,expires_at,critical,verification"),
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

export type EnquiryListParams = { pile: EnquiryPile; search: string; sort: string; dir: SortDir; page: number; filters: ChipFilters; includeTest?: boolean };
export type EnquiryListRow = {
  id: string; jobNumber: string; priority: number; ownerName: string; street: string; suburb: string; postcode: string; phone: string | null; email: string | null;
  told: string; websiteSaid: string; problems: DetailsProblem[]; lastHeardAt: string | null; lastHeardChannel: string | null; waitingOn: string;
  insulation: InsulationChip; size: SizeChip; region: RegionChip | null; source: SourceChip; heard: LastHeardChip; createdAt: string; areaM2: number | null;
};

export async function loadEnquiriesList(p: EnquiryListParams) {
  const now = Date.now();
  const index = await all("enquiries", (a, b) => admin.from("office_enquiry_index").select("id, job_number, created_at, source, channel, enquiry_status, needs_first_response, latest_attempt_status, owner_name, owner_email, owner_phone")
    .eq("office_bucket", "enquiry").in("source", ["base44", "portal", "email"]).eq("channel", "hivic_sourced").order("created_at", { ascending: false }).order("id").range(a, b));
  const ids = index.map((r) => String(r["id"]));
  const [jobs, heard, answered, covered] = await Promise.all([
    byIds("enquiry details", ids, (c, f, t) => admin.from("jobs").select("id, estimated_area_m2, properties(address_line, suburb, postcode, answers:enrichment->base44->raw->answers)").in("id", c).range(f, t)),
    lastHeardMap(ids),
    byIds("3 questions answers", ids, (c, f, t) => admin.from("workflow_events").select("job_id").in("job_id", c).eq("event_type", "owner_insulation_details_answered").range(f, t)),
    coveredFn(),
  ]);
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
    return {
      id, jobNumber: String(r["job_number"]), ownerName: tidy.fullName, street: tidy.street, suburb: tidy.suburb, postcode: tidy.postcode, phone: s(r["owner_phone"]), email: s(r["owner_email"]),
      told: [areaM2 ? `~${Math.round(areaM2)} m²` : "No size", ins === "no" ? "no insulation" : ins === "some" ? "some insulation" : "not sure"].join(" · "),
      websiteSaid: [s(r["owner_name"]), [prop?.address_line, prop?.suburb, prop?.postcode].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
      problems: tidy.problems, lastHeardAt: last?.at ?? null, lastHeardChannel: last?.channel ?? null,
      waitingOn: waitingOnLine({ enquiryStatus: s(r["enquiry_status"]), needsFirstResponse: r["needs_first_response"] === true, latestSend: sends.at(-1) ?? null, reminders: sends.filter((x) => REMINDER.test(x.purpose)).length, answeredQuestions: answeredSet.has(id), latestFailed: r["latest_attempt_status"] === "failed" && r["needs_first_response"] === true }),
      insulation: ins, size: sizeChip(areaM2), region: regionChip(tidy.postcode || prop?.postcode), source: sourceChip({ source: s(r["source"]), channel: s(r["channel"]) }), heard: lastHeardChip(last?.at ?? null, now),
      createdAt: String(r["created_at"]), areaM2, covered: covered(tidy.postcode || prop?.postcode || null, tidy.suburb || null),
      pile: enquiryPile({ fullName: s(r["owner_name"]), addressLine: prop?.address_line ?? null, suburb: prop?.suburb ?? null, postcode: prop?.postcode ?? null }),
    };
  });
  const counts = { fix_details: rows.filter((r) => r.pile === "fix_details").length, waiting_owner: rows.filter((r) => r.pile === "waiting_owner").length };
  const ranked = rankByPriority(rows.map((r) => ({ ...r, insulation: r.insulation, lastHeardAt: r.lastHeardAt })), now);
  const q = p.search.trim().toLowerCase();
  const filtered = ranked.filter((r) => r.pile === p.pile && matchesChips(r, p.filters) && (!q || [r.jobNumber, r.ownerName, r.street, r.suburb, r.postcode, r.email ?? "", r.phone ?? "", r.websiteSaid].join(" ").toLowerCase().includes(q)));
  const SORTS: Record<string, keyof (typeof filtered)[number]> = { priority: "priority", job: "jobNumber", owner: "ownerName", street: "street", suburb: "suburb", postcode: "postcode", heard: "lastHeardAt", waiting: "waitingOn", told: "areaM2", created: "createdAt" };
  const key = SORTS[p.sort] ?? "priority";
  const sorted = sortRows(filtered, key, key === "priority" && !p.sort ? "asc" : p.dir);
  const page = pageOf(sorted, p.page);
  return { ...page, counts, rows: page.rows.map(({ score: _s, pile: _p, covered: _c, ...r }) => r as EnquiryListRow) };
}

export type JobsListParams = { search: string; sort: string; dir: SortDir; page: number; filters: ChipFilters; includeTest?: boolean };
export type JobsListRow = {
  id: string; jobNumber: string; owner: string; surname: string; suburb: string | null; stage: JobsStage; status: string; lastHeardAt: string | null; lastHeardChannel: string | null;
  installer: string | null; ownJob: boolean; onHold: boolean; lifeSupport: boolean; isTest: boolean; insulation: InsulationChip; region: RegionChip | null; source: SourceChip; heard: LastHeardChip;
  createdAt: string; lastActivityAt: string | null;
};

export async function loadActiveJobsList(p: JobsListParams) {
  const now = Date.now();
  const base = await all("active jobs", (a, b) => {
    // office_job_list is the shared office bucket view (not in the generated client types).
    const view = (admin as unknown as { from: (t: string) => any }).from("office_job_list"); // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = view.select("id, job_number, stage, source, channel, owner_name, owner_email, owner_phone, property_address, installer_name, originating_business_name, life_support, last_activity_at, created_at").eq("office_bucket", "active");
    q = p.includeTest ? q : q.or("source.is.null,source.neq.qa_test");
    return q.order("created_at", { ascending: false }).order("id").range(a, b);
  });
  const ids = base.map((r) => String(r["id"]));
  const [extra, heard] = await Promise.all([
    byIds("job facts", ids, (c, f, t) => admin.from("jobs").select("id, prior_stage, deleted_at, qa_archived_at, properties(suburb, postcode, answers:enrichment->base44->raw->answers)").in("id", c).range(f, t)),
    lastHeardMap(ids),
  ]);
  const ex = new Map(extra.map((r) => [String(r["id"]), r]));
  const live = base.filter((r) => { const e = ex.get(String(r["id"])); return e && !e["deleted_at"] && !e["qa_archived_at"]; });
  // Status line: the office rulebook (office-status.core via loadOffice), batched by job id.
  const statusOf = new Map<string, string>();
  const liveIds = live.map((r) => String(r["id"]));
  for (let i = 0; i < liveIds.length; i += 150) {
    const o = await loadOffice(admin, { includeTest: true, onlyIds: liveIds.slice(i, i + 150) });
    for (const j of o.jobs) if (j.status) statusOf.set(j.id, `${j.status.label}${j.status.detail ? ` · ${j.status.detail}` : ""}`);
  }
  const { declaredExtras } = await import("./enquiry.core");
  const { normaliseInsulation } = await import("./eligibility.core");
  const rows: (JobsListRow & { id: string })[] = [];
  for (const r of live) {
    const id = String(r["id"]);
    const e = ex.get(id)!;
    const prop = e["properties"] as { suburb: string | null; postcode: string | null; answers: Record<string, unknown> | null } | null;
    const ownJob = r["channel"] === "installer_sourced";
    const installer = s(r["installer_name"]) ?? (ownJob ? s(r["originating_business_name"]) : null);
    const stage = jobsStage({ stage: s(r["stage"]), priorStage: s(e["prior_stage"]), hasInstaller: !!installer });
    if (!stage) continue;
    const last = heard.last.get(id) ?? null;
    rows.push({
      id, jobNumber: String(r["job_number"]), owner: s(r["owner_name"]) ?? "", surname: surnameOf(s(r["owner_name"])), suburb: prop?.suburb ?? null, stage,
      status: r["stage"] === "on_hold" ? `On hold${statusOf.get(id) ? ` · ${statusOf.get(id)}` : ""}` : statusOf.get(id) ?? "Check this job's status",
      lastHeardAt: last?.at ?? null, lastHeardChannel: last?.channel ?? null, installer, ownJob, onHold: r["stage"] === "on_hold", lifeSupport: r["life_support"] === true, isTest: r["source"] === "qa_test",
      insulation: insulationChip(normaliseInsulation(declaredExtras(prop?.answers ?? null).existing_insulation)), region: regionChip(prop?.postcode), source: sourceChip({ source: s(r["source"]), channel: s(r["channel"]) }),
      heard: lastHeardChip(last?.at ?? null, now), createdAt: String(r["created_at"]), lastActivityAt: s(r["last_activity_at"]),
    });
  }
  const stageCounts = Object.fromEntries((["choose_installer", "ready_check", "quote", "piesa", "install", "final_check"] as JobsStage[]).map((k) => [k, rows.filter((r) => r.stage === k).length])) as Record<JobsStage, number>;
  const ownCount = rows.filter((r) => r.ownJob).length;
  const installers = [...new Set(rows.map((r) => r.installer).filter((x): x is string => !!x))].sort();
  const q = p.search.trim().toLowerCase();
  const filtered = rows.filter((r) => matchesChips({ ...r, size: "none" }, p.filters) && (!q || [r.jobNumber, r.owner, r.suburb ?? "", r.installer ?? "", r.status].join(" ").toLowerCase().includes(q)));
  const SORTS: Record<string, keyof JobsListRow> = { heard: "lastHeardAt", job: "jobNumber", owner: "surname", suburb: "suburb", stage: "stage", status: "status", installer: "installer", created: "createdAt", activity: "lastActivityAt" };
  const key = SORTS[p.sort] ?? "lastHeardAt";
  const STAGE_ORDER: Record<JobsStage, number> = { choose_installer: 1, ready_check: 2, quote: 3, piesa: 4, install: 5, final_check: 6 };
  const sorted = key === "stage" ? [...filtered].sort((a, b) => (STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]) * (p.dir === "asc" ? 1 : -1) || a.id.localeCompare(b.id)) : sortRows(filtered, key, p.sort ? p.dir : "desc");
  const page = pageOf(sorted, p.page);
  return { ...page, total: page.total, all: rows.length, stageCounts, ownCount, installers };
}
