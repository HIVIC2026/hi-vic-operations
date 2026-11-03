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
/** At most this many jobs are acted on per tick per sweep (a held text is tried again each tick, so this bounds the work). */
const CHASE_MAX_PER_TICK = 25;

type R = Record<string, unknown>;
async function chunked(what: string, ids: string[], q: (chunk: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await q(ids.slice(i, i + 200));
    if (error) throw new Error(`${what} could not be read: ${error.message}`);
    out.push(...((data ?? []) as R[]));
  }
  return out;
}
const groupBy = (rows: R[]) => { const m = new Map<string, R[]>(); for (const r of rows) { const k = String(r["job_id"]); m.set(k, [...(m.get(k) ?? []), r]); } return m; };
const ymd = (v: unknown) => (v ? String(v).slice(0, 10) : null);

type ChaseRow = {
  id: string; upgradesNeeded: boolean; upgradesToday: boolean; partCRecorded: boolean; daySet: boolean; hasFile: boolean;
  /** Newest initial / reassessment PIESA record: when upgrades were found (created_at) and the official date (completed_date). */
  piesa: { id: string; createdAt: string; date: string | null } | null;
  /** Part C date as far as the batch can tell (the live facts decide before anything is sent). */
  doneAt: string | null;
  events: { event_type: string; created_at: string; details: R | null }[];
};

/** ONE candidate read + batched facts for the chase sweeps (no per-job reads until something is due). */
async function chaseRows(opts: { files: boolean }): Promise<ChaseRow[]> {
  const { data: jobs, error } = await admin.from("jobs").select("id").in("stage", [...CHASE_STAGES]).is("deleted_at", null).order("id").limit(500);
  if (error) throw new Error(error.message);
  const ids = ((jobs ?? []) as { id: string }[]).map((j) => j.id);
  if (!ids.length) return [];
  const { CERTIFICATE_CHASE_ROUND_EVENT, CERTIFICATE_CHASE_SENT_EVENT } = await import("./certificate-chase.core");
  const { FIXES_COES_DOC_KIND, FIXES_COES_DOC_TITLE } = await import("./fixes-day.core");
  const loose = admin as unknown as import("@supabase/supabase-js").SupabaseClient;
  const [assess, recs, items, books, evs, docs, reqs] = await Promise.all([
    chunked("PIESA answers", ids, (c) => loose.from("assessments").select("job_id, mitti_raw_snapshot, completed_at").in("job_id", c)),
    chunked("PIESA records", ids, (c) => loose.from("piesa_records").select("id, job_id, kind, outcome, completed_date, created_at").in("job_id", c).in("kind", ["initial", "reassessment", "post_rectification"])),
    chunked("upgrades items", ids, (c) => loose.from("rectification_items").select("job_id").in("job_id", c).in("status", ["required", "completed"])),
    chunked("upgrades bookings", ids, (c) => loose.from("bookings").select("job_id").in("job_id", c).eq("kind", "rectification").in("status", ["confirmed", "completed"])),
    chunked("chase rounds", ids, (c) => loose.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).in("event_type", [CERTIFICATE_CHASE_ROUND_EVENT, CERTIFICATE_CHASE_SENT_EVENT])),
    opts.files ? chunked("certificate documents", ids, (c) => loose.from("documents").select("job_id").in("job_id", c).eq("kind", FIXES_COES_DOC_KIND).eq("source_system", "mitti").eq("title", FIXES_COES_DOC_TITLE)) : Promise.resolve([] as R[]),
    opts.files ? chunked("certificate requirements", ids, (c) => loose.from("evidence_requirements").select("id, job_id").in("job_id", c).eq("category", "rectification_completion")) : Promise.resolve([] as R[]),
  ]);
  const reqIds = reqs.map((r) => String(r["id"]));
  const files = reqIds.length ? await chunked("certificate files", reqIds, (c) => loose.from("evidence_files").select("job_id").in("requirement_id", c)) : [];
  const [byA, byRec, byItem, byBook, byEv] = [groupBy(assess), groupBy(recs), groupBy(items), groupBy(books), groupBy(evs)];
  const withFile = new Set([...docs, ...files].map((r) => String(r["job_id"])));
  const out: ChaseRow[] = [];
  for (const id of ids) {
    const a = byA.get(id)?.[0] ?? null;
    const rs = byRec.get(id) ?? [];
    const post = rs.filter((r) => r["kind"] === "post_rectification" && r["outcome"] === "pass").sort((x, y) => String(y["created_at"]).localeCompare(String(x["created_at"])))[0] ?? null;
    const initial = rs.filter((r) => r["kind"] !== "post_rectification").sort((x, y) => String(y["created_at"]).localeCompare(String(x["created_at"])))[0] ?? null;
    const u = await upgradesFromRows(a?.["mitti_raw_snapshot"], (byItem.get(id) ?? []).length, !!post);
    out.push({
      id, ...u, daySet: (byBook.get(id) ?? []).length > 0, hasFile: withFile.has(id),
      piesa: initial ? { id: String(initial["id"]), createdAt: new Date(String(initial["created_at"])).toISOString(), date: ymd(initial["completed_date"]) } : null,
      doneAt: u.partCRecorded ? ymd(post?.["completed_date"]) ?? ymd(a?.["completed_at"]) : null,
      events: (byEv.get(id) ?? []).map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: (e["details"] ?? null) as R | null })),
    });
  }
  return out;
}

const hasEvent = (row: ChaseRow, type: string, anchor: string, round: string) => row.events.some((e) => e.event_type === type && e.details?.["anchor"] === anchor && e.details?.["round"] === round);

/** Log the round once (the stable id is the claim: a second sweep gets a duplicate key and logs nothing). */
async function logChaseEvent(jobId: string, type: string, anchor: string, round: string, summary: string, details: R = {}): Promise<void> {
  const { stableUuid } = await import("./mitti-create-claim.core");
  const id = await stableUuid(`certificate-chase:${jobId}:${anchor}:${round}${type.endsWith("_sent") ? ":sent" : ""}`);
  const { error } = await admin.from("workflow_events").insert({ id, job_id: jobId, actor_id: null, event_type: type, summary, details: { round, anchor, ...details }, internal: true } as never);
  if (error && (error as { code?: string }).code !== "23505") throw new Error(error.message);
}

/** Logs a round once: skipped when the batch already saw it (a held send being tried again), else one stable-id insert. The
 *  electrician's phone and the address are read only when a round is first logged (they go on the event for Needs me). */
function claimer(row: ChaseRow, anchor: string, electrician: string | null) {
  let contact: Promise<{ address: string; phone: string | null }> | null = null;
  const get = () => (contact ??= chaseContact(row.id));
  const claim = async (round: string, summary: string) => {
    const { CERTIFICATE_CHASE_ROUND_EVENT } = await import("./certificate-chase.core");
    if (hasEvent(row, CERTIFICATE_CHASE_ROUND_EVENT, anchor, round)) return;
    const c = await get();
    await logChaseEvent(row.id, CERTIFICATE_CHASE_ROUND_EVENT, anchor, round, summary, { electrician, address: c.address, phone: c.phone });
  };
  return Object.assign(claim, { contact: get });
}

/** The text / email has finished when it went, or can't ever go: anything held, refused or failed is tried again next tick. */
const textDone = (r: string) => !/^(held|blocked|failed|no_electrician|not_|day_set)/.test(r);
const emailDone = (r: string) => ["sent", "test_sent", "not_sent"].includes(r);

/** The electrician's phone + the job address for the office rows (stored on the round event). */
async function chaseContact(jobId: string): Promise<{ address: string; phone: string | null }> {
  const who = await electricianNameFor(jobId);
  const [{ data: ov }, { data: w }, { data: b }] = await Promise.all([
    admin.from("job_overview").select("property_address, job_number").eq("id", jobId).maybeSingle(),
    who.businessId && who.userId ? admin.from("partner_workers").select("mobile").eq("business_id", who.businessId).eq("profile_id", who.userId).is("removed_at", null).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    who.businessId ? admin.from("businesses").select("phone").eq("id", who.businessId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const o = ov as { property_address?: string | null; job_number?: string | null } | null;
  return { address: o?.property_address || o?.job_number || "this job", phone: (w as { mobile?: string | null } | null)?.mobile || (b as { phone?: string | null } | null)?.phone || null };
}

/** Email the installer's office (held wording) once per job + PIESA: active installer, else the originating installer. */
async function emailUpgradesDayOffice(jobId: string, anchor: string, electrician: string | null, address: string): Promise<string> {
  const { data: inst, error } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  let installerId = (inst as { business_id?: string | null } | null)?.business_id ?? null;
  if (!installerId) {
    const { data: j, error: je } = await admin.from("jobs").select("originating_installer_business_id").eq("id", jobId).maybeSingle();
    if (je) throw new Error(je.message);
    installerId = (j as { originating_installer_business_id?: string | null } | null)?.originating_installer_business_id ?? null;
  }
  if (!installerId) return "no_installer";
  const [{ upgradesDayOfficeEmail, UPGRADES_DAY_OFFICE_EMAIL_APPROVED }, { SET_PASSWORD_BASE }, { emailInstallerOffice }] = await Promise.all([import("./certificate-chase.core"), import("./set-password-link.core"), import("./own-job-piesa-notices.server")]);
  const jobUrl = `${SET_PASSWORD_BASE}/field/${jobId}`;
  const mail = upgradesDayOfficeEmail({ address, electrician, jobUrl });
  // emailInstallerOffice passes { businessId: the installer, jobId } to the trade pause check and sends once per key.
  const r = await emailInstallerOffice({ jobId, businessId: installerId, key: `upgrades-day-chase:v1:${jobId}:${anchor}:office-email`, subject: mail.subject, text: mail.text, jobUrl, approved: UPGRADES_DAY_OFFICE_EMAIL_APPROVED });
  return r.status;
}

/** 15-minute tick: the PIESA says upgrades are needed, not today, and no upgrades day is entered → day 1 text, day 2 office
 *  email, red office flag at 7 days left on the 30-day clock. Each round once per job + PIESA (stable event id); a held send is
 *  tried again on later ticks (each sender sends once per key). Entering a day stops it (the live facts are read before acting). */
export async function sweepUpgradesDayChase(now: Date = new Date()): Promise<{ texted: number; emailed: number; flagged: number; held: number; failed: number }> {
  const out = { texted: 0, emailed: 0, flagged: 0, held: 0, failed: 0 };
  const { CERTIFICATE_CHASE_ROUND_EVENT: ROUND, CERTIFICATE_CHASE_SENT_EVENT: SENT, CHASE_ROUND, UPGRADES_DAY_TEXT_ROUND, upgradesDayChaseAction } = await import("./certificate-chase.core");
  let acted = 0;
  for (const row of await chaseRows({ files: false })) {
    if (acted >= CHASE_MAX_PER_TICK) break;
    if (!row.upgradesNeeded || row.partCRecorded || row.daySet || row.upgradesToday || !row.piesa) continue;
    const anchor = row.piesa.id;
    const sent = { text1: hasEvent(row, SENT, anchor, CHASE_ROUND.upgradesText), email2: hasEvent(row, SENT, anchor, CHASE_ROUND.upgradesEmail), flag7: hasEvent(row, ROUND, anchor, CHASE_ROUND.upgradesRed) };
    const base = { upgradesNeededAt: row.piesa.createdAt, piesaAt: row.piesa.date ?? row.piesa.createdAt, now, sent };
    if (!upgradesDayChaseAction({ ...base, dayEntered: false }).length) continue;
    acted++;
    try {
      const f = await jobCertificateFacts(row.id);
      if (f.state !== "upgrades_pending") continue;
      const actions = upgradesDayChaseAction({ ...base, dayEntered: f.upgradesDaySet || f.upgradesToday });
      if (!actions.length) continue;
      const claim = claimer(row, anchor, f.electrician);
      for (const act of actions) {
        if (act === "text_electrician") {
          await claim(CHASE_ROUND.upgradesText, "Upgrades day not set after 1 business day: electrician reminded");
          const { textUpgradesDayLink } = await import("./own-job-piesa-notices.server");
          const r = await textUpgradesDayLink(row.id, UPGRADES_DAY_TEXT_ROUND, f);
          if (textDone(r)) { await logChaseEvent(row.id, SENT, anchor, CHASE_ROUND.upgradesText, `Upgrades day reminder text: ${r}`, { status: r }); out.texted++; } else out.held++;
        } else if (act === "email_office") {
          await claim(CHASE_ROUND.upgradesEmail, "Upgrades day not set after 2 business days: installer office emailed");
          const r = await emailUpgradesDayOffice(row.id, anchor, f.electrician, (await claim.contact()).address);
          if (emailDone(r)) { await logChaseEvent(row.id, SENT, anchor, CHASE_ROUND.upgradesEmail, `Upgrades day installer email: ${r}`, { status: r }); out.emailed++; } else out.held++;
        } else {
          await claim(CHASE_ROUND.upgradesRed, "Upgrades day not set — 7 days left on the 30-day clock");
          out.flagged++;
        }
      }
    } catch (e) { out.failed++; console.error("upgrades day chase failed", row.id, (e as Error).message); }
  }
  return out;
}

/** 15-minute tick: Part C recorded, no certificate file → day 2 text with the link, day 4 office flag. Each round once per job +
 *  Part C date (stable event id); a held text is tried again on later ticks. A file on the job stops it. */
export async function sweepCertificateChase(now: Date = new Date()): Promise<{ texted: number; flagged: number; held: number; failed: number }> {
  const out = { texted: 0, flagged: 0, held: 0, failed: 0 };
  const { CERTIFICATE_CHASE_ROUND_EVENT: ROUND, CERTIFICATE_CHASE_SENT_EVENT: SENT, CHASE_ROUND, CERTIFICATE_TEXT_ROUND, certificateChaseAction } = await import("./certificate-chase.core");
  const sentFor = (row: ChaseRow, anchor: string) => ({ text2: hasEvent(row, SENT, anchor, CHASE_ROUND.certificateText), flag4: hasEvent(row, ROUND, anchor, CHASE_ROUND.certificateFlag) });
  let acted = 0;
  for (const row of await chaseRows({ files: true })) {
    if (acted >= CHASE_MAX_PER_TICK) break;
    if (!row.partCRecorded || row.hasFile || !row.doneAt) continue;
    if (!certificateChaseAction({ upgradesDoneAt: row.doneAt, fileAt: null, now, sent: sentFor(row, row.doneAt) }).length) continue;
    acted++;
    try {
      const f = await jobCertificateFacts(row.id);
      if (f.state !== "waiting_for_certificate" || !f.upgradesDoneAt) continue;
      const anchor = f.upgradesDoneAt;
      const actions = certificateChaseAction({ upgradesDoneAt: anchor, fileAt: f.certificateFileAt, now, sent: sentFor(row, anchor) });
      if (!actions.length) continue;
      const claim = claimer(row, anchor, f.electrician);
      for (const act of actions) {
        if (act === "text_electrician") {
          await claim(CHASE_ROUND.certificateText, "Certificate not in after 2 business days: electrician reminded");
          const { textCertificateLink } = await import("./own-job-piesa-notices.server");
          const r = await textCertificateLink(row.id, CERTIFICATE_TEXT_ROUND, { text: "chase", facts: f });
          if (textDone(r)) { await logChaseEvent(row.id, SENT, anchor, CHASE_ROUND.certificateText, `Certificate reminder text: ${r}`, { status: r }); out.texted++; } else out.held++;
        } else {
          await claim(CHASE_ROUND.certificateFlag, "Certificate not in after 4 business days: office to call the electrician");
          out.flagged++;
        }
      }
    } catch (e) { out.failed++; console.error("certificate chase failed", row.id, (e as Error).message); }
  }
  return out;
}

/** Needs me: the open chase flags per job, from the round events and the job's LIVE certificate facts (each clears by itself
 *  when the day is entered / the file is on the job). Only jobs with a flag round are read live (max 200). Throws on a failed
 *  read (the caller shows the list as partly unavailable, never an empty one). */
export async function chaseFlagsForJobs(jobIds: string[]): Promise<Map<string, import("./certificate-chase.core").ChaseFlags>> {
  const out = new Map<string, import("./certificate-chase.core").ChaseFlags>();
  if (!jobIds.length) return out;
  const { CERTIFICATE_CHASE_ROUND_EVENT, CHASE_ROUND, chaseOfficeFlags } = await import("./certificate-chase.core");
  const loose = admin as unknown as import("@supabase/supabase-js").SupabaseClient;
  const flagRounds = [CHASE_ROUND.upgradesEmail, CHASE_ROUND.upgradesRed, CHASE_ROUND.certificateFlag];
  const evs = (await chunked("chase rounds", [...new Set(jobIds)], (c) => loose.from("workflow_events").select("job_id, created_at, details").in("job_id", c).eq("event_type", CERTIFICATE_CHASE_ROUND_EVENT)))
    .filter((e) => flagRounds.includes((e["details"] as R | null)?.["round"] as never));
  const byJob = groupBy(evs);
  const ids = [...byJob.keys()].slice(0, 200);
  const facts = await Promise.all(ids.map(async (id) => [id, await jobCertificateFacts(id)] as const));
  for (const [id, f] of facts) {
    const flags = chaseOfficeFlags((byJob.get(id) ?? []).map((e) => ({ created_at: String(e["created_at"]), details: (e["details"] ?? null) as R | null })), f);
    if (Object.keys(flags).length) out.set(id, flags);
  }
  return out;
}
