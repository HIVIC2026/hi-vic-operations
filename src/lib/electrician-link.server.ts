// The electrician's no-login job link (new job flow, Part 6, Task 2). The token is the only credential: 32 random bytes,
// only its SHA-256 hash is stored (`worker_job_links`, existing columns, no SQL). It names ONE job and ONE electrician
// business; everything the page shows is resolved here from the token, never from ids the browser sends.
// - mintElectricianLink: revokes the worker's older links for the job, stores the new hash.
// - textElectricianLink: the job-link text, behind ELECTRICIAN_LINK_TEXT_APPROVED (off). TEST jobs / TEST partners ->
//   test-send; real -> the one guarded sender (`sendRealSms`: customer_comms_enabled, trade_messages_paused, quiet hours,
//   per-type switch, idempotency key). One `electrician_link_text_sent` event per key, recorded after a send.
// - linkAfterAllocation: called after a successful allocation; never throws (a failure is logged on the job).
// - electricianLinkView: the page's read. Owner name, phone and address only while the electrician has a current visit
//   (the existing contact_releases rule); never prices.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { SET_PASSWORD_BASE } from "./set-password-link.core";
import { hashToken, isTokenShape, linkState, newToken, certificationBlocker, firstName } from "./worker-links.core";
import {
  ELECTRICIAN_LINK_SMS_TYPE, ELECTRICIAN_LINK_TEXT_APPROVED, ELECTRICIAN_LINK_NOT_VALID, electricianLinkExpired, electricianLinkExpiry, electricianLinkSwitchedOff,
  electricianLinkText, electricianLinkTextKey, maskElectricianLinkInText, electricianStep, canBookFromLink, dayTime,
  ELECTRICIAN_LINK_OFFICE_BOOKS, electricianLinkAlreadyBooked, ELECTRICIAN_LINK_NOTHING_TO_BOOK, ELECTRICIAN_LINK_BAD_TIME, electricianLinkBookFailed, type ElectricianLinkFacts, type ElectricianStepView, type WhoBooks,
} from "./electrician-link.core";
import type { RealSmsInput, RealSmsResult } from "./sms.server";
import type { BusinessContact } from "./owner-wording.core";

export const ELECTRICIAN_LINK_TEXT_SENT_EVENT = "electrician_link_text_sent";
export const ELECTRICIAN_LINK_TEXT_FAILED_EVENT = "electrician_link_text_failed";

/** A failed database read. Its text is for the logs only; the public page never shows it. */
class ReadError extends Error {}
const dbErr = (what: string, e: { message: string }) => new ReadError(`Could not read ${what}: ${e.message}`);
const bizName = (b: { name: string | null; trading_name: string | null } | null | undefined) => ((b?.trading_name ?? "").trim() || (b?.name ?? "").trim()) || null;

async function installerOf(jobId: string): Promise<{ id: string | null; name: string }> {
  const { data: a } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (!a?.business_id) return { id: null, name: "the installer" };
  const { data: b } = await admin.from("businesses").select("name, trading_name").eq("id", a.business_id).maybeSingle();
  return { id: a.business_id, name: bizName(b) ?? "the installer" };
}

type AssignedElectrician = { business_id: string; user_id: string | null };
async function electricianAssignment(jobId: string, businessId: string): Promise<AssignedElectrician | null> {
  const { data, error } = await admin.from("job_assignments").select("business_id, user_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).eq("business_id", businessId).maybeSingle();
  if (error) throw dbErr("the electrician assignment", error);
  return (data as AssignedElectrician | null) ?? null;
}
/** The assignment names a person (Team allocation): the link's person must be that person. No person on it: the business is enough. */
const sameElectrician = (a: AssignedElectrician, w: { profile_id: string | null }) => !a.user_id || !w.profile_id || a.user_id === w.profile_id;

// ---------- minting ----------
export async function mintElectricianLink(jobId: string, workerId: string, actorId: string | null, now = Date.now()): Promise<{ token: string; url: string }> {
  const { data: w, error } = await admin.from("partner_workers").select("id, business_id, trade_role, approval_status, removed_at, profile_id").eq("id", workerId).maybeSingle();
  if (error) throw dbErr("the electrician", error);
  if (!w || w.trade_role !== "electrician" || w.removed_at || w.approval_status !== "approved") throw new Error("That electrician can't be given a job link.");
  const asg = await electricianAssignment(jobId, w.business_id);
  if (!asg || !sameElectrician(asg, w)) throw new Error("This job isn't assigned to that electrician.");
  const nowIso = new Date(now).toISOString();
  const { error: re } = await admin.from("worker_job_links").update({ revoked_at: nowIso, revoked_by: actorId }).eq("worker_id", w.id).eq("job_id", jobId).is("revoked_at", null);
  if (re) throw new Error(re.message);
  const token = newToken();
  const { error: ie } = await admin.from("worker_job_links").insert({ worker_id: w.id, business_id: w.business_id, job_id: jobId, token_hash: await hashToken(token), created_by: actorId, expires_at: electricianLinkExpiry({ allDoneAt: null, now }) });
  if (ie) throw new Error(ie.message);
  return { token, url: `${SET_PASSWORD_BASE}/e/${token}` };
}

// ---------- the text ----------
export type ElectricianLinkTextDeps = {
  approved: boolean;
  sendSms: (input: RealSmsInput) => Promise<RealSmsResult>;
  sendTestSms: (to: string, body: string, info: { jobId: string; jobSource: string | null; partnerIsTest: boolean }) => Promise<{ status: string; detail: string }>;
  record: (jobId: string, eventType: string, summary: string, details: Record<string, unknown>) => Promise<void>;
};
const defaultDeps = (): ElectricianLinkTextDeps => ({
  approved: ELECTRICIAN_LINK_TEXT_APPROVED,
  sendSms: async (input) => (await import("./sms.server")).sendRealSms(input),
  sendTestSms: async (to, body, info) => (await import("./test-send.server")).sendTestSms({ jobId: info.jobId, jobSource: info.jobSource, partnerIsTest: info.partnerIsTest, label: `${ELECTRICIAN_LINK_SMS_TYPE}:${info.jobId}`, actorId: null }, to, body),
  record: async (jobId, eventType, summary, details) => (await import("./workflow.server")).logEvent(jobId, null, eventType, summary, details, { internal: true }),
});

export async function textElectricianLink(jobId: string, workerId: string, url: string, over: Partial<ElectricianLinkTextDeps> = {}): Promise<"sent" | "held" | "test_sent" | "no_mobile"> {
  const d = { ...defaultDeps(), ...over };
  if (!d.approved) return "held";
  const [{ data: job, error: je }, { data: w, error: we }] = await Promise.all([
    admin.from("jobs").select("id, job_number, source, deleted_at, properties(suburb)").eq("id", jobId).maybeSingle(),
    admin.from("partner_workers").select("id, business_id, mobile, trade_role, removed_at").eq("id", workerId).maybeSingle(),
  ]);
  if (je) throw dbErr("the job", je);
  if (we) throw dbErr("the electrician", we);
  if (!job || job.deleted_at || !w || w.removed_at || w.trade_role !== "electrician") return "held";
  if (!(w.mobile ?? "").trim()) return "no_mobile";
  const key = electricianLinkTextKey(jobId, workerId);
  const { data: done } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", ELECTRICIAN_LINK_TEXT_SENT_EVENT).contains("details", { key }).limit(1).maybeSingle();
  if (done) return "held";
  const [installer, { data: eb }] = await Promise.all([installerOf(jobId), admin.from("businesses").select("onboarding_notes").eq("id", w.business_id).maybeSingle()]);
  const body = electricianLinkText({ jobNumber: job.job_number, suburb: (job.properties as { suburb: string | null } | null)?.suburb ?? null, installer: installer.name, url });
  const { isTestPartner } = await import("./test-send.core");
  const partnerIsTest = isTestPartner(eb ?? null);
  if (job.source === "qa_test" || partnerIsTest) {
    const r = await d.sendTestSms(w.mobile!, body, { jobId, jobSource: job.source ?? null, partnerIsTest });
    if (r.status !== "sent") return "held";
    await d.record(jobId, ELECTRICIAN_LINK_TEXT_SENT_EVENT, "Electrician job link texted (test)", { key, worker_id: workerId, test: true });
    return "test_sent";
  }
  const r = await d.sendSms({ type: ELECTRICIAN_LINK_SMS_TYPE, idempotencyKey: key, to: w.mobile, body, storedBody: maskElectricianLinkInText(body), jobId, businessId: w.business_id });
  if (r.status !== "sent" && r.status !== "sent_unknown") return "held";
  await d.record(jobId, ELECTRICIAN_LINK_TEXT_SENT_EVENT, "Electrician job link texted", { key, worker_id: workerId });
  return "sent";
}

/** A link for an email: made only when this person has no live link for the job, so the one already in their phone keeps working
 *  (the URL can't be rebuilt from the stored hash). Returns the URL, or null when a live link already exists. */
export async function ensureElectricianLink(jobId: string, workerId: string, actorId: string | null = null): Promise<string | null> {
  const { data: live, error } = await admin.from("worker_job_links").select("id, expires_at").eq("job_id", jobId).eq("worker_id", workerId).is("revoked_at", null);
  if (error) throw dbErr("the links", error);
  if ((live ?? []).some((l) => linkState({ revoked_at: null, expires_at: l.expires_at }, Date.now()) === "active")) return null;
  return (await mintElectricianLink(jobId, workerId, actorId)).url;
}

/** After a successful allocation: give the electrician their link and text it. Never throws; a failure is logged on the job.
 *  A person who already has a live link for this job (a retry) keeps it, so the link already in their phone keeps working. */
export async function linkAfterAllocation(jobId: string, workerId: string, actorId: string | null, over: Partial<ElectricianLinkTextDeps> = {}): Promise<"sent" | "held" | "test_sent" | "no_mobile" | "already_has_link" | "link_failed" | "text_failed"> {
  const d = { ...defaultDeps(), ...over };
  const fail = async (what: string, e: unknown) => {
    try { await d.record(jobId, ELECTRICIAN_LINK_TEXT_FAILED_EVENT, `Electrician job link: ${what}`, { worker_id: workerId, error: (e as Error).message.slice(0, 300) }); } catch (le) { console.error("Electrician link failure not logged", (le as Error).message); }
  };
  let url: string;
  try {
    const { data: live, error: le } = await admin.from("worker_job_links").select("id, expires_at").eq("job_id", jobId).eq("worker_id", workerId).is("revoked_at", null);
    if (le) throw dbErr("the links", le);
    if ((live ?? []).some((l) => linkState({ revoked_at: null, expires_at: l.expires_at }, Date.now()) === "active")) {
      // The link is already made. Only the text may be missing (held while the flag was off, or it failed). The URL can't be
      // rebuilt from the stored hash, so a new link is made ONLY when no text was ever sent for this job and person;
      // a link already in someone's phone is never replaced.
      if (!d.approved) return "already_has_link";
      const { data: sentBefore, error: se } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", ELECTRICIAN_LINK_TEXT_SENT_EVENT).contains("details", { key: electricianLinkTextKey(jobId, workerId) }).limit(1).maybeSingle();
      if (se) throw dbErr("the text history", se);
      if (sentBefore) return "already_has_link";
    }
    url = (await mintElectricianLink(jobId, workerId, actorId)).url;
  } catch (e) { await fail("the link could not be made", e); return "link_failed"; }
  try { return await textElectricianLink(jobId, workerId, url, over); } catch (e) { await fail("the text was not sent", e); return "text_failed"; }
}

/** The job's assigned electrician's business as a contact (office phone and business email, never the worker's mobile); null when none. */
export async function electricianBusinessFor(jobId: string): Promise<BusinessContact | null> {
  return (await import("./owner-contact.server")).businessContactForJob(jobId, "electrician");
}

// ---------- the page's read ----------
export type ElectricianLinkView = {
  business: string; firstName: string | null; installer: string; jobNumber: string;
  owner: { name: string; phone: string | null } | null; address: string | null;
  view: ElectricianStepView; /** The Mitti form the step's button opens, when it has one. */ buttonUrl: string | null; upgradesDay: string | null;
};

const WHO_BOOKS: readonly WhoBooks[] = ["office", "electrician", "either"];
/** The installer's "who books" setting, read fresh on every open. TODO(join): Part 5 `whoBooksOf(businesses.piesa_booked_by)`.
 *  A missing column (change not applied yet), a failed read or an unknown value is "office": the link then never books. */
async function whoBooksFor(installerBusinessId: string | null): Promise<WhoBooks> {
  if (!installerBusinessId) return "office";
  const { data, error } = await admin.from("businesses").select("piesa_booked_by").eq("id", installerBusinessId).maybeSingle();
  const v = (data as { piesa_booked_by?: string | null } | null)?.piesa_booked_by ?? null;
  return !error && v && (WHO_BOOKS as readonly string[]).includes(v) ? (v as WhoBooks) : "office";
}

/** Owner contact + address only while this business has a current visit (existing contact_releases rule). */
async function ownerContactFor(jobId: string, businessId: string, stage: string): Promise<{ owner: { name: string; phone: string | null } | null; address: string | null }> {
  const none = { owner: null, address: null };
  const [{ data: rels, error: re }, { data: asgs, error: ae }] = await Promise.all([
    admin.from("contact_releases").select("assignment_id, visit_kind").eq("job_id", jobId).is("revoked_at", null),
    admin.from("job_assignments").select("id, active").eq("job_id", jobId).eq("business_id", businessId),
  ]);
  if (re) throw dbErr("contact releases", re);
  if (ae) throw dbErr("the assignments", ae);
  const mine = new Set((asgs ?? []).filter((a) => a.active).map((a) => a.id));
  const { visitIsCurrent } = await import("./allocation.core");
  if (!(rels ?? []).some((r) => mine.has(r.assignment_id as string) && visitIsCurrent(String(r.visit_kind), stage))) return none;
  const { data: o, error } = await admin.from("job_overview").select("owner_name, owner_phone, property_address").eq("id", jobId).maybeSingle();
  if (error) throw dbErr("the owner", error);
  return { owner: o?.owner_name ? { name: o.owner_name, phone: o.owner_phone ?? null } : null, address: o?.property_address ?? null };
}

type Facts = { facts: ElectricianLinkFacts; piesaFormUrl: string | null; upgradesFormUrl: string | null; allDoneAt: string | null };
async function factsFor(jobId: string, whoBooks: WhoBooks, handedBack: boolean, now: number): Promise<Facts> {
  const [{ data: a, error: ae }, { data: books, error: be }, { data: evs, error: ee }, { data: docs, error: de }] = await Promise.all([
    admin.from("assessments").select("external_mitti_id, completed_at, piesa_outcome, mitti_raw_snapshot").eq("job_id", jobId).maybeSingle(),
    admin.from("bookings").select("kind, scheduled_start").eq("job_id", jobId).eq("status", "confirmed").in("kind", ["assessment", "rectification"]).order("scheduled_start", { ascending: false }),
    admin.from("workflow_events").select("event_type, created_at, summary, details").eq("job_id", jobId).in("event_type", ["fixes_form_created", "fixes_form_completed", "fixes_form_not_done", "fixes_form_held"]).order("created_at", { ascending: false }).limit(50),
    admin.from("documents").select("created_at").eq("job_id", jobId).eq("kind", "piesa_evidence").eq("title", (await import("./fixes-day.core")).FIXES_COES_DOC_TITLE).order("created_at", { ascending: false }),
  ]);
  for (const [what, e] of [["the safety check", ae], ["the bookings", be], ["the upgrades form", ee], ["the certificate", de]] as const) if (e) throw dbErr(what, e);
  const { fixesFormOutcome } = await import("./fixes-day.core");
  const { shortAnswersFromEntries } = await import("./official-short.core");
  const { mittiFormUrl } = await import("./mitti-link.core");
  const outcome = a?.completed_at ? (a.piesa_outcome === "pass" ? "pass" : a.piesa_outcome === "fail" ? "upgrades" : null) : null;
  const snapshot = Array.isArray(a?.mitti_raw_snapshot) ? (a!.mitti_raw_snapshot as { label: string; value: string }[]).filter((e) => e && typeof e.label === "string") : [];
  const sameDay = outcome === "upgrades" && /^\s*yes\b/i.test(String(shortAnswersFromEntries("piesa", snapshot as never)["rectificationComplete"] ?? ""));
  const fixes = fixesFormOutcome((evs ?? []) as never);
  const startOf = (kind: string) => (books ?? []).find((b) => b.kind === kind)?.scheduled_start ?? null;
  const piesaFormUrl = a?.external_mitti_id ? mittiFormUrl(a.external_mitti_id) : null;
  const upgradesFormUrl = fixes.auditId ? mittiFormUrl(fixes.auditId) : null;
  const certAt = (docs ?? [])[0]?.created_at ?? null;
  return {
    facts: {
      whoBooks, handedBack, now: new Date(now), certificateIn: (docs ?? []).length > 0,
      piesa: { start: startOf("assessment"), formUrl: piesaFormUrl, outcome, upgradesSameDay: sameDay },
      upgrades: { start: startOf("rectification"), formUrl: upgradesFormUrl, formDone: fixes.outcome === "done" },
    },
    piesaFormUrl, upgradesFormUrl, allDoneAt: certAt ?? (outcome === "pass" ? a?.completed_at ?? null : null),
  };
}

/** Everything the page shows, resolved from the token alone. Throws the plain message for a link that can't be opened. */
export async function electricianLinkView(token: string, now = Date.now()): Promise<ElectricianLinkView> {
  try { return await readElectricianLinkView(token, now); } catch (e) {
    if (!(e instanceof ReadError)) throw e;
    console.error("Electrician link read failed", e.message);
    throw new Error(ELECTRICIAN_LINK_NOT_VALID);
  }
}
async function readElectricianLinkView(token: string, now: number): Promise<ElectricianLinkView> {
  if (!isTokenShape(token)) throw new Error(ELECTRICIAN_LINK_NOT_VALID);
  const { data: l, error } = await admin.from("worker_job_links").select("id, job_id, worker_id, business_id, expires_at, revoked_at, open_count").eq("token_hash", await hashToken(token)).maybeSingle();
  if (error) throw dbErr("the link", error);
  if (!l) throw new Error(ELECTRICIAN_LINK_NOT_VALID);
  const installer = await installerOf(l.job_id);
  const state = linkState(l, now);
  if (state === "revoked") throw new Error(electricianLinkSwitchedOff(installer.name));
  if (state === "expired") throw new Error(electricianLinkExpired(installer.name));
  const [{ data: w, error: we }, { data: eb, error: ebe }, { data: job, error: je }] = await Promise.all([
    admin.from("partner_workers").select("full_legal_name, trade_role, approval_status, certification_status, removed_at, profile_id").eq("id", l.worker_id).maybeSingle(),
    admin.from("businesses").select("name, trading_name").eq("id", l.business_id).maybeSingle(),
    admin.from("jobs").select("job_number, stage, deleted_at, updated_at").eq("id", l.job_id).maybeSingle(),
  ]);
  if (we) throw dbErr("the electrician", we);
  if (ebe) throw dbErr("the business", ebe);
  if (je) throw dbErr("the job", je);
  const off = new Error(electricianLinkSwitchedOff(installer.name));
  if (!w || w.trade_role !== "electrician" || w.removed_at || w.approval_status !== "approved" || certificationBlocker(w) || !job || job.deleted_at) throw off;
  const asg = await electricianAssignment(l.job_id, l.business_id);
  if (!asg || !sameElectrician(asg, w)) throw off;

  const whoBooks = await whoBooksFor(installer.id);
  const f = await factsFor(l.job_id, whoBooks, job.stage === "cancelled", now);
  const view = electricianStep(f.facts);
  // Open: before All done every open renews the link; after, it ends 14 days after All done and is not pushed again.
  // A closed or cancelled job ends the link 14 days after the close (the job's last change) and is never renewed.
  const closedAt = view.step === "closed" && job.updated_at && !Number.isNaN(new Date(job.updated_at).getTime()) ? job.updated_at : null;
  const expires = view.step === "closed" ? (closedAt ? electricianLinkExpiry({ allDoneAt: closedAt, now }) : l.expires_at) : view.step === "all_done" ? (f.allDoneAt ? electricianLinkExpiry({ allDoneAt: f.allDoneAt, now }) : l.expires_at) : electricianLinkExpiry({ allDoneAt: null, now });
  if (new Date(expires).getTime() <= now) throw new Error(electricianLinkExpired(installer.name));
  const { error: ue } = await admin.from("worker_job_links").update({ last_opened_at: new Date(now).toISOString(), open_count: (l.open_count ?? 0) + 1, expires_at: expires }).eq("id", l.id);
  if (ue) console.error("Electrician link open not recorded", ue.message);

  const contact = await ownerContactFor(l.job_id, l.business_id, job.stage ?? "");
  return {
    business: bizName(eb) ?? "Your business", firstName: firstName(w.full_legal_name), installer: installer.name, jobNumber: job.job_number,
    owner: contact.owner, address: contact.address, view,
    buttonUrl: view.step === "piesa_day" ? f.piesaFormUrl : view.step === "upgrades_day" ? f.upgradesFormUrl : null,
    upgradesDay: f.facts.upgrades.start,
  };
}

// ---------- booking from the link ----------
export const ELECTRICIAN_LINK_BOOKED_EVENT = "electrician_link_booked";
export type ElectricianLinkBookResult = { ok: true; start: string } | { ok: false; message: string };

/** Serialises booking per job inside this process, so two presses at once make one booking. The booking path itself
 *  cancels the earlier booking of the same kind, and the step is re-read inside the lock, so a second process is refused too. */
const jobQueues = new Map<string, Promise<unknown>>();
async function withJobLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const prev = jobQueues.get(jobId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  jobQueues.set(jobId, tail);
  try { return await run; } finally { if (jobQueues.get(jobId) === tail) jobQueues.delete(jobId); }
}

/** Book the safety check ("assessment") or the upgrades day ("rectification") from the electrician's link. Everything is
 *  resolved from the token and re-read fresh: the installer's who-books setting, the step, the electrician. The write is the
 *  existing booking path (validateBooking + confirmBooking, every guard unchanged), then the existing in-house owner notice. */
export async function bookFromElectricianLink(token: string, kind: "assessment" | "rectification", startIso: string, now = Date.now()): Promise<ElectricianLinkBookResult> {
  if (!isTokenShape(token)) return { ok: false, message: ELECTRICIAN_LINK_NOT_VALID };
  if (kind !== "assessment" && kind !== "rectification") return { ok: false, message: ELECTRICIAN_LINK_NOTHING_TO_BOOK };
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs) || startMs <= now) return { ok: false, message: ELECTRICIAN_LINK_BAD_TIME };
  const start = new Date(startMs).toISOString();

  const { data: l, error } = await admin.from("worker_job_links").select("id, job_id, worker_id, business_id, expires_at, revoked_at").eq("token_hash", await hashToken(token)).maybeSingle();
  if (error) throw dbErr("the link", error);
  if (!l) return { ok: false, message: ELECTRICIAN_LINK_NOT_VALID };
  const installer = await installerOf(l.job_id);
  const state = linkState(l, now);
  if (state === "revoked") return { ok: false, message: electricianLinkSwitchedOff(installer.name) };
  if (state === "expired") return { ok: false, message: electricianLinkExpired(installer.name) };
  const off = { ok: false as const, message: electricianLinkSwitchedOff(installer.name) };
  const [{ data: w, error: we }, { data: job, error: je }] = await Promise.all([
    admin.from("partner_workers").select("id, full_legal_name, mobile, trade_role, approval_status, certification_status, removed_at, profile_id").eq("id", l.worker_id).maybeSingle(),
    admin.from("jobs").select("stage, deleted_at").eq("id", l.job_id).maybeSingle(),
  ]);
  if (we) throw dbErr("the electrician", we);
  if (je) throw dbErr("the job", je);
  if (!w || w.trade_role !== "electrician" || w.removed_at || w.approval_status !== "approved" || certificationBlocker(w) || !job || job.deleted_at) return off;
  const asg = await electricianAssignment(l.job_id, l.business_id);
  if (!asg || !sameElectrician(asg, w)) return off;
  const jobId = l.job_id as string;

  return withJobLock(jobId, async () => {
    // Fresh inside the lock: the setting, and what is already booked.
    const whoBooks = await whoBooksFor(installer.id);
    if (!canBookFromLink(whoBooks)) return { ok: false as const, message: ELECTRICIAN_LINK_OFFICE_BOOKS };
    const f = await factsFor(jobId, whoBooks, job.stage === "cancelled", now);
    const step = electricianStep(f.facts).step;
    const existing = kind === "assessment" ? f.facts.piesa.start : f.facts.upgrades.start;
    if (existing) {
      // The same electrician pressing the same time again (a retry) is fine; anyone else's booking is theirs.
      const { data: mine } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", ELECTRICIAN_LINK_BOOKED_EVENT).contains("details", { kind, start: existing, worker_id: w.id }).limit(1).maybeSingle();
      if (mine && new Date(existing).getTime() === startMs) return { ok: true as const, start: existing };
      return { ok: false as const, message: electricianLinkAlreadyBooked(existing) };
    }
    if (step !== (kind === "assessment" ? "book_piesa" : "set_upgrades_day")) return { ok: false as const, message: ELECTRICIAN_LINK_NOTHING_TO_BOOK };
    try {
      const booking = await import("./booking.server");
      // proposedWorkerId = this electrician (the job is already allocated to them). No actor: the electrician has no login.
      await booking.validateBooking(jobId, kind, start, null, w.id);
      await booking.confirmBooking(jobId, kind, start, null, "electrician link");
    } catch (e) {
      const { WorkflowError } = await import("./workflow.server");
      if (e instanceof WorkflowError) return { ok: false as const, message: e.message };
      console.error("Electrician link booking failed", (e as Error).message);
      return { ok: false as const, message: electricianLinkBookFailed(installer.name) };
    }
    const wf = await import("./workflow.server");
    await wf.logEvent(jobId, null, ELECTRICIAN_LINK_BOOKED_EVENT, `${kind === "assessment" ? "Safety check" : "Upgrades day"} booked from the electrician's link`, { kind, start, worker_id: w.id }, { internal: true })
      .catch((e) => console.error("Electrician link booking not logged", (e as Error).message));
    // The owner's "You're booked" (PIESA) notice: the existing in-house path (held unless the job is an in-house one; TEST jobs go to test-send inside it).
    if (kind === "assessment") {
      await (await import("./in-house-booking.server")).notifyOwnerBooked(jobId, "piesa", start, { id: w.id, name: w.full_legal_name ?? "", phone: w.mobile ?? null })
        .catch((e) => console.error("Booking confirmation held", (e as Error).message));
    }
    return { ok: true as const, start };
  });
}
