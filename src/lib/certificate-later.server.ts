// Part 3 Task 3 (Jo 3 Nov 2026): the job's certificate facts, built from records that already exist — the PIESA answers
// (Task 2 ids: q20 upgrades needed, q30 doing them today, Part C recorded), the upgrades booking, the A4 completion / the
// post_rectification PIESA record, and the certificate as coes-check.server reads it (`currentCoes` + `coesState`). Read-only
// except `recordInstallCertificateWarning` (one office event per install start, Part 3 Task 4): nothing here sends or moves a
// stage. Rules in certificate-later.core.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import {
  CERTIFICATE_UNREADABLE, INSTALL_CERTIFICATE_WARNING_EVENT, certificateState, certificateStatusLine, installCertificateWarning, prestartCertificate,
  type CertificateState, type PrestartCertificate,
} from "./certificate-later.core";

export type CertificateFacts = {
  upgradesNeeded: boolean;
  /** A3 q30 "Are you doing the electrical upgrades today?" = Yes (the A4 merge sets it too, but then Part C is recorded). */
  upgradesToday: boolean;
  /** A confirmed (or completed) upgrades visit booking exists. */
  upgradesDaySet: boolean;
  upgradesDoneAt: string | null;
  partCRecorded: boolean;
  certificateFileAt: string | null;
  certificateTicked: boolean;
  /** The office rejected the current certificate: its note ("" when none). Null = not rejected. */
  certificateRejectedWhy: string | null;
  /** The current certificate's key (coes-check), null when no file. */
  certificateKey: string | null;
  /** Why the current file still needs the office (coes-check.core `coesState` why), null when ticked or no file. */
  certificateWhy: string | null;
  electrician: string | null;
  state: CertificateState;
  /** The job-page status line, or null. */
  line: string | null;
};

type Entry = { label: string; value: string | null };
const entriesOf = (raw: unknown): Entry[] => (Array.isArray(raw) ? (raw as Entry[]).filter((e) => e && typeof e.label === "string") : []);

/** The active electrician's own name (their worker row), else their business, else null. */
export async function electricianNameFor(jobId: string): Promise<{ name: string | null; first: string | null; businessId: string | null; userId: string | null; assignmentId: string | null }> {
  const { data: rows } = await admin.from("job_assignments").select("id, user_id, business_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).order("assigned_at", { ascending: false }).limit(1);
  const a = ((rows ?? []) as { id: string; user_id: string; business_id: string | null }[])[0];
  if (!a) return { name: null, first: null, businessId: null, userId: null, assignmentId: null };
  const [{ data: w }, { data: b }] = await Promise.all([
    a.business_id ? admin.from("partner_workers").select("full_legal_name").eq("business_id", a.business_id).eq("profile_id", a.user_id).is("removed_at", null).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    a.business_id ? admin.from("businesses").select("name, trading_name").eq("id", a.business_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { displayName } = await import("./display-name.core");
  const own = displayName((w as { full_legal_name?: string | null } | null)?.full_legal_name) || null;
  const biz = displayName((b as { trading_name?: string | null; name?: string | null } | null)?.trading_name || (b as { name?: string | null } | null)?.name) || null;
  const name = own || biz;
  return { name, first: own ? own.split(/\s+/)[0]! : null, businessId: a.business_id, userId: a.user_id, assignmentId: a.id };
}

/** The upgrades facts from the stored A3 answers (Task 2 ids), else the open/completed items or a post-upgrades pass record.
 *  Shared by `jobCertificateFacts` and the Task 5 chase sweeps' batched first pass, so the two never disagree. */
async function upgradesFromRows(snapshot: unknown, itemCount: number, hasPostRecord: boolean): Promise<{ upgradesNeeded: boolean; upgradesToday: boolean; partCRecorded: boolean }> {
  const entries = entriesOf(snapshot);
  const [{ shortAnswersFromEntries }, { piesaRectificationDone }, { fixesFormNeeded }] = await Promise.all([import("./official-short.core"), import("./piesa-evidence.core"), import("./fixes-day.core")]);
  const short = entries.length ? shortAnswersFromEntries("piesa", entries) : null;
  const doneOnForm = !!short && piesaRectificationDone(short);
  const upgradesNeeded = short && short["rectificationOutcome"] ? fixesFormNeeded(short) || doneOnForm : itemCount > 0 || hasPostRecord;
  const upgradesToday = !!short && /^yes\b/i.test(String(short["rectificationComplete"] ?? ""));
  return { upgradesNeeded, upgradesToday, partCRecorded: doneOnForm || hasPostRecord };
}

/** Every certificate fact for one job. Never guesses: a missing record reads as "not yet". */
export async function jobCertificateFacts(jobId: string): Promise<CertificateFacts> {
  const [{ data: a }, { data: items }, { data: bk }, { data: rec }, { data: doneEv }, who] = await Promise.all([
    admin.from("assessments").select("mitti_raw_snapshot, completed_at").eq("job_id", jobId).maybeSingle(),
    admin.from("rectification_items").select("status").eq("job_id", jobId).in("status", ["required", "completed"]),
    admin.from("bookings").select("id").eq("job_id", jobId).eq("kind", "rectification").in("status", ["confirmed", "completed"]).limit(1),
    admin.from("piesa_records").select("completed_date, created_at").eq("job_id", jobId).eq("kind", "post_rectification").eq("outcome", "pass").order("created_at", { ascending: false }).limit(1),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "fixes_form_completed").order("created_at", { ascending: false }).limit(1),
    electricianNameFor(jobId),
  ]);
  const record = ((rec ?? []) as { completed_date: string | null; created_at: string }[])[0] ?? null;
  const { upgradesNeeded, upgradesToday, partCRecorded } = await upgradesFromRows((a as { mitti_raw_snapshot?: unknown } | null)?.mitti_raw_snapshot, (items ?? []).length, !!record);
  const doneDate = ((doneEv ?? []) as { details: { done_date?: string | null } | null }[])[0]?.details?.done_date ?? null;
  const completedAt = (a as { completed_at?: string | null } | null)?.completed_at ?? null;
  // Dates are Melbourne calendar dates (YYYY-MM-DD); a timestamp-shaped read is cut to its date.
  const ymd = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);
  const upgradesDoneAt = partCRecorded ? ymd(record?.completed_date) ?? ymd(doneDate) ?? ymd(completedAt) : null;
  let certificateFileAt: string | null = null, certificateTicked = false, certificateKey: string | null = null, certificateRejectedWhy: string | null = null, certificateWhy: string | null = null;
  if (partCRecorded) {
    const coes = await import("./coes-check.server");
    const c = await coes.currentCoes(jobId);
    if (c.ref?.files.length) {
      certificateKey = c.ref.key;
      certificateFileAt = c.since ?? record?.created_at ?? new Date(0).toISOString();
      const { coesState } = await import("./coes-check.core");
      const { data: evs } = await admin.from("workflow_events").select("id, event_type, created_at, details").eq("job_id", jobId).in("event_type", ["coes_checked", "coes_rejected"]).order("created_at", { ascending: true });
      const st = coesState((evs ?? []) as never, c.ref.key);
      certificateTicked = st.state === "ticked";
      certificateWhy = certificateTicked ? null : st.why;
      // Rejected by the office: the electrician's link asks for a new one, with the office's note.
      if (st.state === "rejected") {
        const last = ((evs ?? []) as { id?: string; details: Record<string, unknown> | null }[]).find((e) => e.id === st.eventId);
        const note = last?.details?.["note"];
        certificateRejectedWhy = typeof note === "string" ? note : "";
      }
    }
  }
  const upgradesDaySet = ((bk ?? []) as unknown[]).length > 0;
  const state = certificateState({ upgradesNeeded, upgradesDoneAt, partCRecorded, certificateFileAt, certificateTicked, certificateRejectedWhy });
  return { upgradesNeeded, upgradesToday, upgradesDaySet, upgradesDoneAt, partCRecorded, certificateFileAt, certificateTicked, certificateRejectedWhy, certificateKey, certificateWhy, electrician: who.name, state, line: certificateStatusLine({ state, electrician: who.name, upgradesDaySet }) };
}

/** Join (4 Nov 2026, #135 read budget): the job-page status line from rows the installer job page bundle already holds —
 *  no extra reads. The rejected-certificate nuance (a file the office rejected reads as waiting) needs the coes events, which
 *  the bundle does not read; here a file on the job reads as "in", so no line is shown (the office Needs me row carries the
 *  rejection). The office page and the chases use the full `jobCertificateFacts`. Never throws. */
export async function certificateLineFromParts(p: { snapshot: unknown; itemCount: number; hasPostRecord: boolean; upgradesDaySet: boolean; certificateOnFile: boolean; electrician: string | null }): Promise<{ state: CertificateState; line: string | null } | null> {
  try {
    const { upgradesNeeded, partCRecorded } = await upgradesFromRows(p.snapshot, p.itemCount, p.hasPostRecord);
    const state = certificateState({ upgradesNeeded, upgradesDoneAt: partCRecorded ? "recorded" : null, partCRecorded, certificateFileAt: p.certificateOnFile ? "on file" : null, certificateTicked: false });
    return { state, line: certificateStatusLine({ state, electrician: p.electrician, upgradesDaySet: p.upgradesDaySet }) };
  } catch (e) { console.error("certificate line not built", (e as Error).message); return null; }
}

/** The job-page status line only (installer + office pages). Never throws: a failed read shows nothing rather than a wrong line. */
export async function certificateLineFor(jobId: string): Promise<{ state: CertificateState; line: string | null } | null> {
  try { const f = await jobCertificateFacts(jobId); return { state: f.state, line: f.line }; } catch (e) { console.error("certificate facts not read", jobId, (e as Error).message); return null; }
}

// ---------- Part 3 Task 4 (Jo 3 Nov 2026): the install can be booked, not started, without the certificate ----------

/** The pre-start certificate fact (prestart.server `prestartFacts`). `onsiteOnly` = the job clears on the electrician at the
 *  start of the install day (clear after the PIESA). Fails closed: a read failure is "unchecked" (the pre-start fails). */
export async function prestartCertificateFacts(jobId: string, opts: { onsiteOnly: boolean }): Promise<{ certificate: PrestartCertificate; certificateWhy: string | null; state: CertificateState | null }> {
  if (opts.onsiteOnly) return { certificate: "not_needed", certificateWhy: null, state: null };
  try {
    const f = await jobCertificateFacts(jobId);
    // An odd job the new facts call "no upgrades" but the existing certificate check still asks for one: that check stands.
    const legacyWhy = f.state === "none_needed" ? await (await import("./coes-check.server")).coesWhyFor(jobId) : null;
    const r = prestartCertificate({ onsiteOnly: false, state: f.state, rejected: f.certificateRejectedWhy != null, why: f.certificateWhy, legacyWhy });
    return { certificate: r.certificate, certificateWhy: r.why, state: f.state };
  } catch (e) {
    console.error("certificate facts not read for the pre-start check", jobId, (e as Error).message);
    return { certificate: "unchecked", certificateWhy: CERTIFICATE_UNREADABLE, state: null };
  }
}

/** The live certificate fact for one job (on-site-only read from the clearance facts; a failed clearance read counts as
 *  not on-site-only, so the certificate is still read). Fails closed like `prestartCertificateFacts`. Fix 1: used by the
 *  booking warning, the live start lock (`requirePrestartClear`) and the in-house install form hold. */
export async function liveCertificateFact(jobId: string): Promise<{ certificate: PrestartCertificate; certificateWhy: string | null }> {
  const { clearanceFacts } = await import("./electrical-clearance.server");
  const onsiteOnly = (await clearanceFacts(jobId).catch(() => null))?.onsiteStartOnly === true;
  const c = await prestartCertificateFacts(jobId, { onsiteOnly });
  return { certificate: c.certificate, certificateWhy: c.certificateWhy };
}

/** The warning for an install booking: the certificate is outstanding (the pre-start check would fail on it), else null.
 *  No file → "still to come"; a file not ticked → "not checked yet". */
export async function installCertificateWarningFor(jobId: string): Promise<string | null> {
  return installCertificateWarning((await liveCertificateFact(jobId)).certificate);
}

/** After an install booking: record the warning once per install start (office history) and return it for the screen.
 *  Never throws — a booking is never undone by this. */
export async function recordInstallCertificateWarning(jobId: string, actorId: string | null, startIso: string): Promise<string | null> {
  try {
    const warning = await installCertificateWarningFor(jobId);
    if (!warning) return null;
    const start = new Date(startIso).toISOString();
    const { data, error } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", INSTALL_CERTIFICATE_WARNING_EVENT);
    if (error) throw new Error(error.message);
    const seen = ((data ?? []) as { details: { scheduled_start?: string } | null }[]).some((e) => e.details?.scheduled_start && new Date(e.details.scheduled_start).toISOString() === start);
    if (!seen) {
      const { logEvent } = await import("./workflow.server");
      await logEvent(jobId, actorId, INSTALL_CERTIFICATE_WARNING_EVENT, `Install booked: ${warning}`, { scheduled_start: start, warning }, { internal: true });
    }
    return warning;
  } catch (e) {
    console.error("install certificate warning not recorded", jobId, (e as Error).message);
    return null;
  }
}

// ---------- Part 3 Task 5 (Jo 3 Nov 2026): chasing the upgrades day and the certificate (rules: certificate-chase.core) ----------

/** Stages a job can sit at while its upgrades day or certificate is still to come (PIESA complete → install booked). */
export const CHASE_STAGES = ["piesa_complete", "electrical_variation_pending", "rectification_required", "awaiting_owner_rectification_approval", "rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked"] as const;
/** At most this many jobs get a REAL send per sweep per tick. Fix 1 (review 4 Nov 2026): flag-only rounds, held wording and
 *  the other waiting reasons never count — they are cheap (no per-job reads) and always done, so held texts can't starve the
 *  office rows of jobs further down the list. */
const CHASE_MAX_PER_TICK = 25;
/** Candidate jobs are read in pages of this many (keyset on id), up to CHASE_MAX_PAGES pages. */
const CHASE_PAGE = 500;
const CHASE_MAX_PAGES = 40;

type R = Record<string, unknown>;
const loose = () => admin as unknown as import("@supabase/supabase-js").SupabaseClient;
async function chunked(what: string, ids: string[], q: (chunk: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await q(ids.slice(i, i + 200));
    if (error) throw new Error(`${what} could not be read: ${error.message}`);
    out.push(...((data ?? []) as R[]));
  }
  return out;
}
const groupBy = (rows: R[], key = "job_id") => { const m = new Map<string, R[]>(); for (const r of rows) { const k = String(r[key]); m.set(k, [...(m.get(k) ?? []), r]); } return m; };
const ymd = (v: unknown) => (v ? String(v).slice(0, 10) : null);
const newestFirst = (x: R, y: R) => String(y["created_at"]).localeCompare(String(x["created_at"]));

type ChaseEventRow = { event_type: string; created_at: string; details: R | null };
type ChaseRow = {
  id: string; source: string | null; originatingInstaller: string | null;
  upgradesNeeded: boolean; upgradesToday: boolean; partCRecorded: boolean; daySet: boolean; hasFile: boolean;
  /** Newest initial / reassessment PIESA record: when upgrades were found (created_at) and the official date (completed_date). */
  piesa: { id: string; createdAt: string; date: string | null } | null;
  /** Part C date, the same rule as the live `upgradesDoneAt` (post-upgrades record → A4 done date → PIESA completion). */
  doneAt: string | null;
  events: ChaseEventRow[];
};

/** Every live hivic job at a chase stage, paged by id (fix 1: no 500-job ceiling; the sweeps then work oldest first). */
async function chaseCandidates(): Promise<R[]> {
  const out: R[] = [];
  let after: string | null = null;
  for (let page = 0; page < CHASE_MAX_PAGES; page++) {
    // Final fix wave item 4: live Home Insulation Victoria jobs only — never an archived TEST journey or another business
    // unit (the same filter as sweepFixesForms).
    let q = loose().from("jobs").select("id, source, originating_installer_business_id").in("stage", [...CHASE_STAGES]).is("deleted_at", null).is("qa_archived_at", null).eq("business_unit", "hivic");
    if (after) q = q.gt("id", after);
    const { data, error } = await q.order("id").limit(CHASE_PAGE);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as R[];
    out.push(...rows);
    if (rows.length < CHASE_PAGE) return out;
    after = String(rows[rows.length - 1]!["id"]);
  }
  console.warn("chase sweep: more than", CHASE_PAGE * CHASE_MAX_PAGES, "candidate jobs — the rest wait for a later tick");
  return out;
}

/** The candidate read + batched facts for the chase sweeps (no per-job reads until a real send is due). */
async function chaseRows(opts: { files: boolean }): Promise<ChaseRow[]> {
  const jobs = await chaseCandidates();
  const ids = jobs.map((j) => String(j["id"]));
  if (!ids.length) return [];
  const { CERTIFICATE_CHASE_ROUND_EVENT, CERTIFICATE_CHASE_SENT_EVENT, CERTIFICATE_CHASE_WAITING_EVENT } = await import("./certificate-chase.core");
  const { FIXES_COES_DOC_KIND, FIXES_COES_DOC_TITLE } = await import("./fixes-day.core");
  const db = loose();
  const [assess, recs, items, books, evs, docs, reqs] = await Promise.all([
    chunked("PIESA answers", ids, (c) => db.from("assessments").select("job_id, mitti_raw_snapshot, completed_at").in("job_id", c)),
    chunked("PIESA records", ids, (c) => db.from("piesa_records").select("id, job_id, kind, outcome, completed_date, created_at").in("job_id", c).in("kind", ["initial", "reassessment", "post_rectification"])),
    chunked("upgrades items", ids, (c) => db.from("rectification_items").select("job_id").in("job_id", c).in("status", ["required", "completed"])),
    chunked("upgrades bookings", ids, (c) => db.from("bookings").select("job_id").in("job_id", c).eq("kind", "rectification").in("status", ["confirmed", "completed"])),
    // fixes_form_completed: the A4 done date, part of the Part C date rule (fix 1 minor 6).
    chunked("chase rounds", ids, (c) => db.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).in("event_type", [CERTIFICATE_CHASE_ROUND_EVENT, CERTIFICATE_CHASE_SENT_EVENT, CERTIFICATE_CHASE_WAITING_EVENT, "fixes_form_completed"])),
    opts.files ? chunked("certificate documents", ids, (c) => db.from("documents").select("job_id").in("job_id", c).eq("kind", FIXES_COES_DOC_KIND).eq("source_system", "mitti").eq("title", FIXES_COES_DOC_TITLE)) : Promise.resolve([] as R[]),
    opts.files ? chunked("certificate requirements", ids, (c) => db.from("evidence_requirements").select("id, job_id").in("job_id", c).eq("category", "rectification_completion")) : Promise.resolve([] as R[]),
  ]);
  const reqIds = reqs.map((r) => String(r["id"]));
  const files = reqIds.length ? await chunked("certificate files", reqIds, (c) => db.from("evidence_files").select("job_id").in("requirement_id", c)) : [];
  const [byA, byRec, byItem, byBook, byEv] = [groupBy(assess), groupBy(recs), groupBy(items), groupBy(books), groupBy(evs)];
  const withFile = new Set([...docs, ...files].map((r) => String(r["job_id"])));
  const out: ChaseRow[] = [];
  for (const j of jobs) {
    const id = String(j["id"]);
    const a = byA.get(id)?.[0] ?? null;
    const rs = byRec.get(id) ?? [];
    const post = rs.filter((r) => r["kind"] === "post_rectification" && r["outcome"] === "pass").sort(newestFirst)[0] ?? null;
    const initial = rs.filter((r) => r["kind"] !== "post_rectification").sort(newestFirst)[0] ?? null;
    const u = await upgradesFromRows(a?.["mitti_raw_snapshot"], (byItem.get(id) ?? []).length, !!post);
    const all = byEv.get(id) ?? [];
    const fixesDone = all.filter((e) => e["event_type"] === "fixes_form_completed").sort(newestFirst)[0] ?? null;
    const doneDate = (fixesDone?.["details"] as R | null | undefined)?.["done_date"];
    out.push({
      id, source: (j["source"] as string | null) ?? null, originatingInstaller: (j["originating_installer_business_id"] as string | null) ?? null,
      ...u, daySet: (byBook.get(id) ?? []).length > 0, hasFile: withFile.has(id),
      piesa: initial ? { id: String(initial["id"]), createdAt: new Date(String(initial["created_at"])).toISOString(), date: ymd(initial["completed_date"]) } : null,
      doneAt: u.partCRecorded ? ymd(post?.["completed_date"]) ?? ymd(doneDate) ?? ymd(a?.["completed_at"]) : null,
      events: all.filter((e) => e["event_type"] !== "fixes_form_completed").map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: (e["details"] ?? null) as R | null })),
    });
  }
  return out;
}

/** Who a due job's sends go to, read in one batch for the due jobs only (fix 1: no per-job recipient reads). Same rules as
 *  `electricianNameFor` (newest active electrician; their worker name, else the business) and the installer office email
 *  (active installer, else the originating installer). */
type ChaseContact = {
  address: string;
  electrician: { name: string | null; phone: string | null; test: boolean } | null;
  installer: { id: string; email: string; test: boolean } | null;
};
async function chaseContacts(rows: ChaseRow[]): Promise<Map<string, ChaseContact>> {
  const out = new Map<string, ChaseContact>();
  if (!rows.length) return out;
  const ids = rows.map((r) => r.id);
  const db = loose();
  const [assigns, overview] = await Promise.all([
    chunked("job assignments", ids, (c) => db.from("job_assignments").select("job_id, role, business_id, user_id, assigned_at").in("job_id", c).eq("active", true).in("role", ["electrician", "installer"])),
    chunked("job addresses", ids, (c) => db.from("job_overview").select("id, property_address, job_number").in("id", c)),
  ]);
  const byJob = groupBy(assigns);
  const elecOf = new Map<string, R>(), instOf = new Map<string, string>();
  for (const r of rows) {
    const as = byJob.get(r.id) ?? [];
    const e = as.filter((x) => x["role"] === "electrician").sort((x, y) => String(y["assigned_at"]).localeCompare(String(x["assigned_at"])))[0];
    if (e) elecOf.set(r.id, e);
    const inst = (as.find((x) => x["role"] === "installer" && x["business_id"])?.["business_id"] as string | undefined) ?? r.originatingInstaller;
    if (inst) instOf.set(r.id, inst);
  }
  const elecBiz = [...new Set([...elecOf.values()].map((e) => e["business_id"]).filter(Boolean).map(String))];
  const bizIds = [...new Set([...elecBiz, ...instOf.values()])];
  const [biz, workers] = await Promise.all([
    bizIds.length ? chunked("businesses", bizIds, (c) => db.from("businesses").select("id, name, trading_name, phone, email, onboarding_notes").in("id", c)) : Promise.resolve([] as R[]),
    elecBiz.length ? chunked("electrician workers", elecBiz, (c) => db.from("partner_workers").select("business_id, profile_id, full_legal_name, mobile").in("business_id", c).is("removed_at", null)) : Promise.resolve([] as R[]),
  ]);
  const bizById = new Map(biz.map((b) => [String(b["id"]), b]));
  const [{ displayName }, { isTestPartner }] = await Promise.all([import("./display-name.core"), import("./test-send.core")]);
  const ov = new Map(overview.map((o) => [String(o["id"]), o]));
  for (const r of rows) {
    const o = ov.get(r.id);
    const e = elecOf.get(r.id);
    const eb = e?.["business_id"] ? bizById.get(String(e["business_id"])) ?? null : null;
    const w = e?.["business_id"] ? workers.find((x) => x["business_id"] === e["business_id"] && x["profile_id"] === e["user_id"]) ?? null : null;
    const instId = instOf.get(r.id) ?? null;
    const ib = instId ? bizById.get(instId) ?? null : null;
    out.set(r.id, {
      address: String(o?.["property_address"] || o?.["job_number"] || "this job"),
      electrician: e?.["business_id"] ? {
        name: displayName(w?.["full_legal_name"] as string | null) || displayName((eb?.["trading_name"] || eb?.["name"]) as string | null) || null,
        phone: (w?.["mobile"] as string | null) || (eb?.["phone"] as string | null) || null,
        test: isTestPartner(eb as { onboarding_notes?: string | null } | null),
      } : null,
      // A missing business row reads as "no installer" (nothing can be emailed); the send path would say the same.
      installer: instId && ib ? { id: instId, email: String(ib["email"] ?? "").trim(), test: isTestPartner(ib as { onboarding_notes?: string | null }) } : null,
    });
  }
  return out;
}

const hasEvent = (row: ChaseRow, type: string, anchor: string, round: string, reason?: string) => row.events.some((e) => e.event_type === type && e.details?.["anchor"] === anchor && e.details?.["round"] === round && (reason === undefined || e.details?.["reason"] === reason));

/** The stable id of a chase event (the claim: a second sweep gets a duplicate key and logs nothing). */
async function chaseEventId(jobId: string, type: string, anchor: string, round: string, reason?: string): Promise<string> {
  const { stableUuid } = await import("./mitti-create-claim.core");
  const { CERTIFICATE_CHASE_WAITING_EVENT } = await import("./certificate-chase.core");
  const suffix = type === CERTIFICATE_CHASE_WAITING_EVENT ? `:waiting:${reason}` : type.endsWith("_sent") ? ":sent" : "";
  return stableUuid(`certificate-chase:${jobId}:${anchor}:${round}${suffix}`);
}

/** Log one event once (stable-id insert). Used for the sent events, after a real send. */
async function logChaseEvent(jobId: string, type: string, anchor: string, round: string, summary: string, details: R = {}): Promise<void> {
  const id = await chaseEventId(jobId, type, anchor, round);
  const { error } = await admin.from("workflow_events").insert({ id, job_id: jobId, actor_id: null, event_type: type, summary, details: { round, anchor, ...details }, internal: true } as never);
  if (error && (error as { code?: string }).code !== "23505") throw new Error(error.message);
}

/** The cheap half of a sweep: every new round claim and waiting marker, written in batches (an existing id is skipped). */
class ChaseWrites {
  rows: R[] = [];
  async add(row: ChaseRow, type: string, anchor: string, round: string, summary: string, details: R = {}) {
    const reason = details["reason"] as string | undefined;
    if (hasEvent(row, type, anchor, round, reason)) return false;
    this.rows.push({ id: await chaseEventId(row.id, type, anchor, round, reason), job_id: row.id, actor_id: null, event_type: type, summary, details: { round, anchor, ...details }, internal: true });
    return true;
  }
  async flush() {
    for (let i = 0; i < this.rows.length; i += 200) {
      const { error } = await loose().from("workflow_events").upsert(this.rows.slice(i, i + 200), { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(`chase rounds could not be recorded: ${error.message}`);
    }
  }
}

/** The text / email has finished when it went, or can't ever go: anything held, refused or failed is tried again next tick. */
const textDone = (r: string) => !/^(held|blocked|failed|no_electrician|not_|day_set)/.test(r);
const emailDone = (r: string) => ["sent", "test_sent", "not_sent"].includes(r);

/** Why the electrician's text can't go yet, from the batch (null = try the real path). TEST jobs / TEST partners always take
 *  the real path (the test sender). */
async function textWaitReason(row: ChaseRow, c: ChaseContact, type: "electrician_upgrades_day_link" | "electrician_certificate_chase"): Promise<import("./certificate-chase.core").ChaseWaitingReason | null> {
  if (!c.electrician) return "no_electrician";
  if (row.source === "qa_test" || c.electrician.test) return null;
  const { SMS_MESSAGE_TYPES } = await import("./sms.core");
  return !SMS_MESSAGE_TYPES[type].wordingApproved ? "wording_not_approved" : null;
}
/** Why the installer office email can't go yet (same order as emailInstallerOffice: TEST partner → TEST job → wording → email). */
function emailWaitReason(row: ChaseRow, c: ChaseContact, approved: boolean): import("./certificate-chase.core").ChaseWaitingReason | null {
  if (!c.installer) return "no_installer";
  if (c.installer.test) return c.installer.email ? null : "no_email";
  if (row.source === "qa_test") return null; // the sender refuses a real installer for a TEST job (a final "not_sent")
  if (!approved) return "wording_not_approved";
  return c.installer.email ? null : "no_email";
}

/** Email the installer's office (held wording) once per job + PIESA. */
async function emailUpgradesDayOffice(jobId: string, anchor: string, installerId: string, electrician: string | null, address: string): Promise<string> {
  const [{ upgradesDayOfficeEmail, UPGRADES_DAY_OFFICE_EMAIL_APPROVED }, { SET_PASSWORD_BASE }, { emailInstallerOffice }] = await Promise.all([import("./certificate-chase.core"), import("./set-password-link.core"), import("./own-job-piesa-notices.server")]);
  const jobUrl = `${SET_PASSWORD_BASE}/field/${jobId}`;
  const mail = upgradesDayOfficeEmail({ address, electrician, jobUrl });
  // emailInstallerOffice passes { businessId: the installer, jobId } to the trade pause check and sends once per key.
  const r = await emailInstallerOffice({ jobId, businessId: installerId, key: `upgrades-day-chase:v1:${jobId}:${anchor}:office-email`, subject: mail.subject, text: mail.text, jobUrl, approved: UPGRADES_DAY_OFFICE_EMAIL_APPROVED });
  return r.status;
}

/** 15-minute tick: the PIESA says upgrades are needed, not today, and no upgrades day is entered → day 1 text, day 2 office
 *  email, red office flag at 7 days left on the 30-day clock. Each round claimed once per job + PIESA (stable event id).
 *  Fix 1: first, from the batch alone, every due round is claimed and every send that can't go yet (wording held, nobody to
 *  send to) gets one waiting marker — no per-job reads, never capped. Then, oldest PIESA first, at most 25 jobs with a send
 *  that can go read their live facts and send (each sender sends once per key; anything held is tried again next tick). */
export async function sweepUpgradesDayChase(now: Date = new Date()): Promise<{ texted: number; emailed: number; flagged: number; held: number; failed: number }> {
  const out = { texted: 0, emailed: 0, flagged: 0, held: 0, failed: 0 };
  const { CERTIFICATE_CHASE_ROUND_EVENT: ROUND, CERTIFICATE_CHASE_SENT_EVENT: SENT, CERTIFICATE_CHASE_WAITING_EVENT: WAITING, CHASE_WAITING_REASON_TEXT, CHASE_ROUND, UPGRADES_DAY_TEXT_ROUND, UPGRADES_DAY_OFFICE_EMAIL_APPROVED, upgradesDayChaseAction } = await import("./certificate-chase.core");
  const due: { row: ChaseRow; anchor: string; actions: ReturnType<typeof upgradesDayChaseAction> }[] = [];
  for (const row of await chaseRows({ files: false })) {
    if (!row.upgradesNeeded || row.partCRecorded || row.daySet || row.upgradesToday || !row.piesa) continue;
    const anchor = row.piesa.id;
    const sent = { text1: hasEvent(row, SENT, anchor, CHASE_ROUND.upgradesText), email2: hasEvent(row, SENT, anchor, CHASE_ROUND.upgradesEmail), flag7: hasEvent(row, ROUND, anchor, CHASE_ROUND.upgradesRed) };
    const actions = upgradesDayChaseAction({ upgradesNeededAt: row.piesa.createdAt, piesaAt: row.piesa.date ?? row.piesa.createdAt, now, sent, dayEntered: false });
    if (actions.length) due.push({ row, anchor, actions });
  }
  if (!due.length) return out;
  due.sort((a, b) => a.row.piesa!.createdAt.localeCompare(b.row.piesa!.createdAt) || a.row.id.localeCompare(b.row.id));
  const contacts = await chaseContacts(due.map((d) => d.row));
  const writes = new ChaseWrites();
  const toSend: { row: ChaseRow; anchor: string; contact: ChaseContact; text: boolean; email: boolean }[] = [];
  for (const { row, anchor, actions } of due) {
    const c = contacts.get(row.id)!;
    const who = { electrician: c.electrician?.name ?? null, address: c.address, phone: c.electrician?.phone ?? null };
    let text = false, email = false;
    for (const act of actions) {
      if (act === "text_electrician") {
        await writes.add(row, ROUND, anchor, CHASE_ROUND.upgradesText, "Upgrades day not set after 1 business day: electrician reminded", who);
        const why = await textWaitReason(row, c, "electrician_upgrades_day_link");
        if (why) { await writes.add(row, WAITING, anchor, CHASE_ROUND.upgradesText, `Electrician's upgrades day text not sent yet: ${CHASE_WAITING_REASON_TEXT[why]}`, { reason: why }); out.held++; }
        else text = true;
      } else if (act === "email_office") {
        // The office's week row comes from this claim, so it is made whether or not the email can go.
        await writes.add(row, ROUND, anchor, CHASE_ROUND.upgradesEmail, "Upgrades day not set after 2 business days: installer office emailed", who);
        const why = emailWaitReason(row, c, UPGRADES_DAY_OFFICE_EMAIL_APPROVED);
        if (why) { await writes.add(row, WAITING, anchor, CHASE_ROUND.upgradesEmail, `Installer office email not sent yet: ${CHASE_WAITING_REASON_TEXT[why]}`, { reason: why }); out.held++; }
        else email = true;
      } else if (await writes.add(row, ROUND, anchor, CHASE_ROUND.upgradesRed, "Upgrades day not set — 7 days left on the 30-day clock", who)) out.flagged++;
    }
    if (text || email) toSend.push({ row, anchor, contact: c, text, email });
  }
  try { await writes.flush(); } catch (e) { out.failed += due.length; console.error("upgrades day chase:", (e as Error).message); return out; }
  for (const { row, anchor, contact, text, email } of toSend.slice(0, CHASE_MAX_PER_TICK)) {
    try {
      const f = await jobCertificateFacts(row.id);
      if (f.state !== "upgrades_pending" || f.upgradesDaySet || f.upgradesToday) continue;
      if (text) {
        const { textUpgradesDayLink } = await import("./own-job-piesa-notices.server");
        const r = await textUpgradesDayLink(row.id, UPGRADES_DAY_TEXT_ROUND, f);
        if (textDone(r)) { await logChaseEvent(row.id, SENT, anchor, CHASE_ROUND.upgradesText, `Upgrades day reminder text: ${r}`, { status: r }); out.texted++; } else out.held++;
      }
      if (email) {
        const r = await emailUpgradesDayOffice(row.id, anchor, contact.installer!.id, f.electrician, contact.address);
        if (emailDone(r)) { await logChaseEvent(row.id, SENT, anchor, CHASE_ROUND.upgradesEmail, `Upgrades day installer email: ${r}`, { status: r }); out.emailed++; } else out.held++;
      }
    } catch (e) { out.failed++; console.error("upgrades day chase failed", row.id, (e as Error).message); }
  }
  return out;
}

/** 15-minute tick: Part C recorded, no certificate file → day 2 text with the link, day 4 office flag. Each round once per job +
 *  Part C date (stable event id). Same two halves as the upgrades sweep (fix 1): claims and waiting markers from the batch,
 *  then at most 25 real sends, oldest Part C date first. A file on the job stops it. */
export async function sweepCertificateChase(now: Date = new Date()): Promise<{ texted: number; flagged: number; held: number; failed: number }> {
  const out = { texted: 0, flagged: 0, held: 0, failed: 0 };
  const { CERTIFICATE_CHASE_ROUND_EVENT: ROUND, CERTIFICATE_CHASE_SENT_EVENT: SENT, CERTIFICATE_CHASE_WAITING_EVENT: WAITING, CHASE_WAITING_REASON_TEXT, CHASE_ROUND, CERTIFICATE_TEXT_ROUND, certificateChaseAction } = await import("./certificate-chase.core");
  const due: { row: ChaseRow; anchor: string; actions: ReturnType<typeof certificateChaseAction> }[] = [];
  for (const row of await chaseRows({ files: true })) {
    if (!row.partCRecorded || row.hasFile || !row.doneAt) continue;
    const anchor = row.doneAt;
    const actions = certificateChaseAction({ upgradesDoneAt: anchor, fileAt: null, now, sent: { text2: hasEvent(row, SENT, anchor, CHASE_ROUND.certificateText), flag4: hasEvent(row, ROUND, anchor, CHASE_ROUND.certificateFlag) } });
    if (actions.length) due.push({ row, anchor, actions });
  }
  if (!due.length) return out;
  due.sort((a, b) => a.anchor.localeCompare(b.anchor) || a.row.id.localeCompare(b.row.id));
  const contacts = await chaseContacts(due.map((d) => d.row));
  const writes = new ChaseWrites();
  const toSend: { row: ChaseRow; anchor: string }[] = [];
  for (const { row, anchor, actions } of due) {
    const c = contacts.get(row.id)!;
    const who = { electrician: c.electrician?.name ?? null, address: c.address, phone: c.electrician?.phone ?? null };
    for (const act of actions) {
      if (act === "text_electrician") {
        await writes.add(row, ROUND, anchor, CHASE_ROUND.certificateText, "Certificate not in after 2 business days: electrician reminded", who);
        const why = await textWaitReason(row, c, "electrician_certificate_chase");
        if (why) { await writes.add(row, WAITING, anchor, CHASE_ROUND.certificateText, `Electrician's certificate text not sent yet: ${CHASE_WAITING_REASON_TEXT[why]}`, { reason: why }); out.held++; }
        else toSend.push({ row, anchor });
      } else if (await writes.add(row, ROUND, anchor, CHASE_ROUND.certificateFlag, "Certificate not in after 4 business days: office to call the electrician", who)) out.flagged++;
    }
  }
  try { await writes.flush(); } catch (e) { out.failed += due.length; console.error("certificate chase:", (e as Error).message); return out; }
  for (const { row, anchor } of toSend.slice(0, CHASE_MAX_PER_TICK)) {
    try {
      const f = await jobCertificateFacts(row.id);
      // The live Part C date must be the one the round was claimed for (the batch uses the same rule).
      if (f.state !== "waiting_for_certificate" || f.upgradesDoneAt !== anchor) continue;
      const { textCertificateLink } = await import("./own-job-piesa-notices.server");
      const r = await textCertificateLink(row.id, CERTIFICATE_TEXT_ROUND, { text: "chase", facts: f });
      if (textDone(r)) { await logChaseEvent(row.id, SENT, anchor, CHASE_ROUND.certificateText, `Certificate reminder text: ${r}`, { status: r }); out.texted++; } else out.held++;
    } catch (e) { out.failed++; console.error("certificate chase failed", row.id, (e as Error).message); }
  }
  return out;
}

/** Needs me: the open chase flags per job, from the round events and the job's LIVE certificate facts (each clears by itself
 *  when the day is entered / the file is on the job; the upgrades rows only for the current PIESA record). Only jobs with a
 *  flag round are read live (max 200). Throws on a failed read (the caller shows the list as partly unavailable, never an
 *  empty one). */
export async function chaseFlagsForJobs(jobIds: string[]): Promise<Map<string, import("./certificate-chase.core").ChaseFlags>> {
  const out = new Map<string, import("./certificate-chase.core").ChaseFlags>();
  if (!jobIds.length) return out;
  const { CERTIFICATE_CHASE_ROUND_EVENT, CHASE_ROUND, chaseOfficeFlags } = await import("./certificate-chase.core");
  const db = loose();
  const flagRounds = [CHASE_ROUND.upgradesEmail, CHASE_ROUND.upgradesRed, CHASE_ROUND.certificateFlag];
  const evs = (await chunked("chase rounds", [...new Set(jobIds)], (c) => db.from("workflow_events").select("job_id, created_at, details").in("job_id", c).eq("event_type", CERTIFICATE_CHASE_ROUND_EVENT)))
    .filter((e) => flagRounds.includes((e["details"] as R | null)?.["round"] as never));
  const byJob = groupBy(evs);
  const ids = [...byJob.keys()].slice(0, 200);
  if (!ids.length) return out;
  const recs = groupBy(await chunked("PIESA records", ids, (c) => db.from("piesa_records").select("id, job_id, created_at").in("job_id", c).in("kind", ["initial", "reassessment"])));
  const facts = await Promise.all(ids.map(async (id) => [id, await jobCertificateFacts(id)] as const));
  for (const [id, f] of facts) {
    const anchor = (recs.get(id) ?? []).sort(newestFirst)[0]?.["id"];
    const flags = chaseOfficeFlags((byJob.get(id) ?? []).map((e) => ({ created_at: String(e["created_at"]), details: (e["details"] ?? null) as R | null })), { ...f, upgradesAnchor: anchor ? String(anchor) : null });
    if (Object.keys(flags).length) out.set(id, flags);
  }
  return out;
}

// ---------- ONE sweep owns the upgrades chasing (join ruling 2, 4 Nov 2026) ----------
/** The three chases, each for its own condition, in one place: (1) no upgrades day entered (sweepUpgradesDayChase), (2) Part C
 *  recorded with no certificate file (sweepCertificateChase), (3) the booked upgrades day passed with no upgrades form in
 *  (Part 6 Task 7 sweepUpgradesWatch, upgrades-watch.server). The conditions are exclusive by state — a job is never texted by
 *  two of them on one day: (1) stops once a day is entered, (3) runs only after an entered day has passed with no Part C, and
 *  (2) runs only once Part C is recorded. One failure never stops the others. */
export async function sweepUpgradesChasing(now: Date = new Date()): Promise<{ upgradesDay: unknown; certificate: unknown; dayPassed: unknown; failed: string[] }> {
  const failed: string[] = [];
  const run = async <T,>(name: string, f: () => Promise<T>): Promise<T | "failed"> => { try { return await f(); } catch (e) { console.error(`upgrades chasing: ${name} failed`, (e as Error).message); failed.push(name); return "failed"; } };
  const upgradesDay = await run("upgrades day", () => sweepUpgradesDayChase(now));
  const certificate = await run("certificate", () => sweepCertificateChase(now));
  const dayPassed = await run("day passed", async () => (await import("./upgrades-watch.server")).sweepUpgradesWatch(now));
  return { upgradesDay, certificate, dayPassed, failed };
}
