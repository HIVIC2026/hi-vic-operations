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
  ELECTRICIAN_LINK_OFFICE_BOOKS, electricianLinkAlreadyBooked, ELECTRICIAN_LINK_NOTHING_TO_BOOK, ELECTRICIAN_LINK_BAD_TIME, electricianLinkBookFailed, upgradesDayNotReady, UPGRADES_BOOKING_STAGES, type ElectricianLinkFacts, type ElectricianStepView, type WhoBooks,
  ELECTRICIAN_CANT_DO_EVENT, ELECTRICIAN_CANT_DO_EMAIL_EVENT, ELECTRICIAN_CANT_DO_EMAIL_APPROVED, ELECTRICIAN_CANT_DO_REASON_NEEDED, electricianCantDoReasonOk, electricianCantDoEmailKey,
} from "./electrician-link.core";
import type { RealSmsInput, RealSmsResult } from "./sms.server";
import type { BusinessContact } from "./owner-wording.core";
import type { SendResult } from "./test-send.server";

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

type AssignedElectrician = { id: string; business_id: string; user_id: string | null; /** The worker named by the latest Team allocation event (electricians never log in, so user_id is usually NULL). */ worker_id: string | null };
async function electricianAssignment(jobId: string, businessId: string): Promise<AssignedElectrician | null> {
  const [{ data, error }, { data: ev, error: ee }] = await Promise.all([
    admin.from("job_assignments").select("id, business_id, user_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).eq("business_id", businessId).maybeSingle(),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "in_house_electrician_allocated").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) throw dbErr("the electrician assignment", error);
  if (ee) throw dbErr("the electrician allocation", ee);
  if (!data) return null;
  const wid = (ev?.details as { worker_id?: unknown } | null)?.worker_id;
  return { ...(data as Omit<AssignedElectrician, "worker_id">), worker_id: typeof wid === "string" && wid ? wid : null };
}
/** The assignment names ONE person: by the allocation event's worker (two electricians of one business may both have no
 *  profile, so a NULL user_id never matches anyone), else by the profile on a legacy assignment. Neither on it: the business is enough. */
const sameElectrician = (a: AssignedElectrician, w: { id: string; profile_id: string | null }) =>
  a.worker_id ? a.worker_id === w.id : a.user_id ? a.user_id === w.profile_id : true;

// ---------- minting ----------
/** `keepOlder` (the upgrades nudge): the link already in their phone stays live until the new one has actually been sent —
 *  the caller then calls retireOlderElectricianLinks, or revokeElectricianLink on the new one when the send did not go. */
export async function mintElectricianLink(jobId: string, workerId: string, actorId: string | null, now = Date.now(), opts: { keepOlder?: boolean } = {}): Promise<{ id: string; token: string; url: string }> {
  const { data: w, error } = await admin.from("partner_workers").select("id, business_id, trade_role, approval_status, removed_at, profile_id").eq("id", workerId).maybeSingle();
  if (error) throw dbErr("the electrician", error);
  if (!w || w.trade_role !== "electrician" || w.removed_at || w.approval_status !== "approved") throw new Error("That electrician can't be given a job link.");
  const asg = await electricianAssignment(jobId, w.business_id);
  if (!asg || !sameElectrician(asg, w)) throw new Error("This job isn't assigned to that electrician.");
  const nowIso = new Date(now).toISOString();
  if (!opts.keepOlder) {
    const { error: re } = await admin.from("worker_job_links").update({ revoked_at: nowIso, revoked_by: actorId }).eq("worker_id", w.id).eq("job_id", jobId).is("revoked_at", null);
    if (re) throw new Error(re.message);
  }
  const token = newToken();
  const { data: row, error: ie } = await admin.from("worker_job_links").insert({ worker_id: w.id, business_id: w.business_id, job_id: jobId, token_hash: await hashToken(token), created_by: actorId, expires_at: electricianLinkExpiry({ allDoneAt: null, now }) }).select("id").single();
  if (ie || !row) throw new Error(ie?.message ?? "The link could not be saved.");
  return { id: String(row.id), token, url: `${SET_PASSWORD_BASE}/e/${token}` };
}
/** After a send with the new link succeeded: every OTHER live link of this person for the job is switched off. */
export async function retireOlderElectricianLinks(jobId: string, workerId: string, keepLinkId: string, now = Date.now()): Promise<void> {
  const { error } = await admin.from("worker_job_links").update({ revoked_at: new Date(now).toISOString(), revoked_by: null }).eq("worker_id", workerId).eq("job_id", jobId).neq("id", keepLinkId).is("revoked_at", null);
  if (error) throw new Error(error.message);
}
/** A new link whose send did not go: switch it off again so the one in their phone stays the only live one. */
export async function revokeElectricianLink(linkId: string, now = Date.now()): Promise<void> {
  const { error } = await admin.from("worker_job_links").update({ revoked_at: new Date(now).toISOString(), revoked_by: null }).eq("id", linkId).is("revoked_at", null);
  if (error) throw new Error(error.message);
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
    admin.from("partner_workers").select("id, business_id, mobile, trade_role, removed_at, full_legal_name").eq("id", workerId).maybeSingle(),
  ]);
  if (je) throw dbErr("the job", je);
  if (we) throw dbErr("the electrician", we);
  if (!job || job.deleted_at || !w || w.removed_at || w.trade_role !== "electrician") return "held";
  if (!(w.mobile ?? "").trim()) return "no_mobile";
  const key = electricianLinkTextKey(jobId, workerId);
  const { data: done } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", ELECTRICIAN_LINK_TEXT_SENT_EVENT).contains("details", { key }).limit(1).maybeSingle();
  if (done) return "held";
  const [installer, { data: eb }] = await Promise.all([installerOf(jobId), admin.from("businesses").select("onboarding_notes").eq("id", w.business_id).maybeSingle()]);
  const body = electricianLinkText({ jobNumber: job.job_number, suburb: (job.properties as { suburb: string | null } | null)?.suburb ?? null, installer: installer.name, url, firstName: (w as { full_legal_name?: string | null }).full_legal_name ?? null });
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
  /** Task 9 (Jo 2 Nov, answer 7): who lets the trades in when it isn't the owner — same contact_releases rule as the owner. */
  access: { name: string; role: "tenant" | "property manager"; phone: string } | null;
  view: ElectricianStepView; /** The Mitti form the step's button opens, when it has one. */ buttonUrl: string | null; upgradesDay: string | null;
};

// The installer's "who books" setting (Part 5 `whoBooksOf(businesses.piesa_booked_by)`), read fresh on every open — the one reader.
const whoBooksFor = (installerBusinessId: string | null) => import("./who-books.server").then((m) => m.whoBooksFor(installerBusinessId));

type AccessShown = { name: string; role: "tenant" | "property manager"; phone: string } | null;
/** Owner contact + address, and the person who lets the trades in (Part 3 Task 19 rental answers), only while this business
 *  has a current visit (existing contact_releases rule). A failed rental read shows no access person, never hides the job. */
async function ownerContactFor(jobId: string, businessId: string, stage: string): Promise<{ owner: { name: string; phone: string | null } | null; address: string | null; access: AccessShown }> {
  const none = { owner: null, address: null, access: null };
  const [{ data: rels, error: re }, { data: asgs, error: ae }] = await Promise.all([
    admin.from("contact_releases").select("assignment_id, visit_kind").eq("job_id", jobId).is("revoked_at", null),
    admin.from("job_assignments").select("id, active").eq("job_id", jobId).eq("business_id", businessId),
  ]);
  if (re) throw dbErr("contact releases", re);
  if (ae) throw dbErr("the assignments", ae);
  const mine = new Set((asgs ?? []).filter((a) => a.active).map((a) => a.id));
  const { visitIsCurrent } = await import("./allocation.core");
  if (!(rels ?? []).some((r) => mine.has(r.assignment_id as string) && visitIsCurrent(String(r.visit_kind), stage))) return none;
  // The owner and property rows themselves (not the `job_overview` view): the same name, phone and formatted address.
  const [{ data: o, error }, ap] = await Promise.all([
    admin.from("jobs").select("owners(full_name, phone), properties(address_line, suburb, state, postcode)").eq("id", jobId).maybeSingle(),
    (async () => { try { return await (await import("./rental-answers.server")).accessPersonFor(jobId); } catch (e) { console.error("Electrician link: access person not read", (e as Error).message); return null; } })(),
  ]);
  if (error) throw dbErr("the owner", error);
  const access: AccessShown = ap ? { name: ap.name, role: ap.who === "property_manager" ? "property manager" : "tenant", phone: ap.mobile } : null;
  const owner = (o?.owners ?? null) as { full_name: string | null; phone: string | null } | null;
  const prop = (o?.properties ?? null) as { address_line: string; suburb: string | null; state: string | null; postcode: string | null } | null;
  const { formatPropertyAddress } = await import("./address");
  const address = prop ? formatPropertyAddress(prop) : "";
  return { owner: owner?.full_name ? { name: owner.full_name, phone: owner.phone ?? null } : null, address: address || null, access };
}

type Facts = { facts: ElectricianLinkFacts; piesaFormUrl: string | null; upgradesFormUrl: string | null; allDoneAt: string | null; /** The job's Mitti forms the electrician can see: the A3, and the A4 while it is open. */ auditIds: string[] };
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
    auditIds: [...(a?.external_mitti_id ? [a.external_mitti_id] : []), ...(fixes.auditId && fixes.outcome !== "done" ? [fixes.auditId] : [])],
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
    admin.from("partner_workers").select("id, full_legal_name, trade_role, approval_status, certification_status, removed_at, profile_id").eq("id", l.worker_id).maybeSingle(),
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
    owner: contact.owner, address: contact.address, access: contact.access, view,
    buttonUrl: view.step === "piesa_day" ? f.piesaFormUrl : view.step === "upgrades_day" ? f.upgradesFormUrl : null,
    upgradesDay: f.facts.upgrades.start,
  };
}

// ---------- which link is this? (join 4 Nov 2026) ----------
// Two kinds of /e/<token> link exist until Part 2's minting is retired at go-live: Part 6's worker links (this module,
// `worker_job_links`) and main's Part 2 own-job links (`electrician_job_links`, own-job-electrician-link.server.ts). The
// page asks ONE question; the worker link is tried first, then the own-job link. The token is still the only input.
export type AnyElectricianLinkView =
  | { kind: "worker"; data: ElectricianLinkView }
  | { kind: "own_job"; data: import("./own-job-electrician-link.server").ElectricianLinkView };
export async function electricianLinkAnyView(token: string, now = Date.now()): Promise<AnyElectricianLinkView> {
  if (!isTokenShape(token)) throw new Error(ELECTRICIAN_LINK_NOT_VALID);
  const { data: l, error } = await admin.from("worker_job_links").select("id").eq("token_hash", await hashToken(token)).maybeSingle();
  if (error) { console.error("Electrician link read failed", error.message); throw new Error(ELECTRICIAN_LINK_NOT_VALID); }
  if (l) return { kind: "worker", data: await electricianLinkView(token, now) };
  const own = await (await import("./own-job-electrician-link.server")).electricianLinkView(token, new Date(now));
  // Neither table knows the token: Part 6's plain message (the own-job reader's own refusals — moved, expired — stay its own).
  if (!own.ok && own.reason === (await import("./own-job-electrician-link.core")).LINK_INVALID) throw new Error(ELECTRICIAN_LINK_NOT_VALID);
  return { kind: "own_job", data: own };
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
    const existingMs = existing ? Date.parse(existing) : NaN;
    if (existing) {
      // Whose booking is it? Theirs when THEY booked that very time from this link (timestamps compared as instants, never
      // as strings). The same time again is a retry; a new time is the approved "then update it on the job" — re-booked
      // through the same canonical path, which cancels the earlier booking of this kind and logs booking_rescheduled.
      // Anyone else's booking (the office, another electrician) stays theirs: "Already booked…".
      const { data: evs, error: ee } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", ELECTRICIAN_LINK_BOOKED_EVENT).contains("details", { kind, worker_id: w.id });
      if (ee) throw dbErr("the link bookings", ee);
      const mine = (evs ?? []).some((e) => Date.parse(String((e.details as { start?: string } | null)?.start ?? "")) === existingMs);
      if (!mine) return { ok: false as const, message: electricianLinkAlreadyBooked(existing) };
      if (existingMs === startMs) return { ok: true as const, start: existing };
      // A change of time only while the link is still on that visit's day (a done A4 or a passed PIESA never gets a second form).
      if (step !== (kind === "assessment" ? "piesa_day" : "upgrades_day")) return { ok: false as const, message: ELECTRICIAN_LINK_NOTHING_TO_BOOK };
    } else if (step !== (kind === "assessment" ? "book_piesa" : "set_upgrades_day")) return { ok: false as const, message: ELECTRICIAN_LINK_NOTHING_TO_BOOK };
    // Main's Part 3 final fix wave (#137), carried onto this link at the join: the upgrades day is booked only at the
    // upgrades-booking stages. A job still parked at PIESA complete (e.g. completed before that fix) is moved on by the
    // normal guarded auto-advance first; if it still isn't there, the electrician gets a plain reason and nothing is booked.
    if (kind === "rectification" && !(UPGRADES_BOOKING_STAGES as readonly string[]).includes(job.stage ?? "")) {
      const { autoAdvanceJob } = await import("./autoadvance.server");
      const { getStage } = await import("./workflow.server");
      await autoAdvanceJob(jobId, null, "upgrades day from the electrician's link").catch((e) => console.error("upgrades day auto-advance failed", jobId, (e as Error).message));
      const now2 = await getStage(jobId).catch(() => null);
      if (!now2 || !(UPGRADES_BOOKING_STAGES as readonly string[]).includes(now2)) {
        console.warn("upgrades day refused: job not at the upgrades booking", jobId, now2);
        return { ok: false as const, message: upgradesDayNotReady((await import("./office-phone.server")).officePhone()) };
      }
    }
    try {
      const booking = await import("./booking.server");
      // proposedWorkerId = this electrician (the job is already allocated to them). No actor: the electrician has no login.
      await booking.validateBooking(jobId, kind, start, null, w.id);
      await booking.confirmBooking(jobId, kind, start, null, "electrician link");
    } catch (e) {
      const { WorkflowError } = await import("./workflow.server");
      // The upgrades day: a booking-rule refusal (stage moved, a guard) is shown in plain words; the real reason stays in the server log (main #137).
      if (e instanceof WorkflowError && kind === "rectification") { console.warn("upgrades day refused", jobId, e.message); return { ok: false as const, message: upgradesDayNotReady((await import("./office-phone.server")).officePhone()) }; }
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

// ---------- uploading the Certificate of Electrical Safety from the link ----------
export type ElectricianLinkUploadResult = { ok: true } | { ok: false; message: string };

/** Upload the Certificate of Electrical Safety. Everything comes from the token: the job, the electrician and the business are
 *  never sent by the browser. The file goes through the one upload path the installer office uses (coes-upload.server), so the
 *  link, the office's Next step and the install gate all read the same record. Plain messages, never the raw error. */
export async function uploadCoesFromElectricianLink(token: string, file: { name: string; type: string; /** The bytes, or a function that decodes them — called only once the token and link checks passed. */ bytes: Uint8Array | (() => Uint8Array) }, now = Date.now()): Promise<ElectricianLinkUploadResult> {
  if (!isTokenShape(token)) return { ok: false, message: ELECTRICIAN_LINK_NOT_VALID };
  const { data: l, error } = await admin.from("worker_job_links").select("id, job_id, worker_id, business_id, expires_at, revoked_at").eq("token_hash", await hashToken(token)).maybeSingle();
  if (error) { console.error("Electrician link upload could not read the link", error.message); return { ok: false, message: ELECTRICIAN_LINK_NOT_VALID }; }
  if (!l) return { ok: false, message: ELECTRICIAN_LINK_NOT_VALID };
  try {
    const installer = await installerOf(l.job_id);
    const state = linkState(l, now);
    if (state === "revoked") return { ok: false, message: electricianLinkSwitchedOff(installer.name) };
    if (state === "expired") return { ok: false, message: electricianLinkExpired(installer.name) };
    const off = { ok: false as const, message: electricianLinkSwitchedOff(installer.name) };
    const [{ data: w, error: we }, { data: job, error: je }] = await Promise.all([
      admin.from("partner_workers").select("id, trade_role, approval_status, certification_status, removed_at, profile_id").eq("id", l.worker_id).maybeSingle(),
      admin.from("jobs").select("stage, deleted_at").eq("id", l.job_id).maybeSingle(),
    ]);
    if (we) throw dbErr("the electrician", we);
    if (je) throw dbErr("the job", je);
    if (!w || w.trade_role !== "electrician" || w.removed_at || w.approval_status !== "approved" || certificationBlocker(w) || !job || job.deleted_at || job.stage === "cancelled") return off;
    const asg = await electricianAssignment(l.job_id, l.business_id);
    if (!asg || !sameElectrician(asg, w)) return off;
    const { saveUploadedCoes, CoesUploadError } = await import("./coes-upload.server");
    const bytes = typeof file.bytes === "function" ? file.bytes() : file.bytes;
    try { await saveUploadedCoes(l.job_id, { name: file.name, type: file.type, bytes }, { kind: "electrician_link", workerId: w.id }); return { ok: true }; }
    catch (e) { if (e instanceof CoesUploadError) return { ok: false, message: e.message }; throw e; }
  } catch (e) {
    console.error("Electrician link upload failed", (e as Error).message);
    return { ok: false, message: ELECTRICIAN_LINK_NOT_VALID };
  }
}

// ---------- "Can't do this one" ----------
export type ElectricianCantDoResult = { ok: true } | { ok: false; message: string };
export type ElectricianCantDoDeps = {
  emailApproved: boolean;
  /** The existing guarded cancel writer (visit-events.server): cancels that business's confirmed booking of that kind, records
   *  the trade cancellation, releases the trade and reopens the visit. Null = nothing of that kind was booked for them. */
  cancelVisit: (jobId: string, kind: "assessment" | "rectification", businessId: string, reason: string) => Promise<{ id: string; scheduled_start: string } | null>;
  /** Part 4's owner email ("your booked visit can't go ahead"), called once per cancelled booking AFTER it is cancelled; its own per-booking key stops a repeat. */
  ownerNotice: (jobId: string, bookingId: string, by: "electrician") => Promise<string>;
  /** Take this person's Mitti access off one form (the same calls the in-house hand-back cleanup uses); "no_user" = not in Mitti. */
  removeMittiAccess: (auditId: string, email: string) => Promise<"removed" | "no_user">;
  sendOfficeEmail: (p: { actorId: null; recipient: "partner"; to: string; contactName: string | null; subject: string; message: string; html: string; text: string; label: string; record: { businessId: string }; idempotencyKey: string }) => Promise<SendResult>;
  sendTestEmail: (info: { jobId: string; jobSource: string | null; partnerIsTest: boolean; label: string }, to: string, subject: string, html: string, text: string) => Promise<SendResult>;
  record: (jobId: string, eventType: string, summary: string, details: Record<string, unknown>) => Promise<void>;
};
const cantDoDeps = (): ElectricianCantDoDeps => ({
  emailApproved: ELECTRICIAN_CANT_DO_EMAIL_APPROVED,
  cancelVisit: async (jobId, kind, businessId, reason) => (await import("./visit-events.server")).cancelVisitFromElectricianLink(jobId, kind, businessId, reason),
  ownerNotice: async (jobId, bookingId, by) => (await import("./visit-cancelled-owner.server")).queueVisitCancelledOwnerEmail(jobId, bookingId, by),
  removeMittiAccess: async (auditId, email) => {
    const m = await import("./mitti.server");
    const call = await m.mittiCallFor(m.realMittiCall, email); // TEST people → the persistent simulator, as every Mitti flow does
    const user = await m.findMittiUserByEmail(email, call);
    if (!user) return "no_user";
    await (await import("./mitti.core")).mittiApi(call).removeInspectionUserAccess(auditId, user);
    return "removed";
  },
  sendOfficeEmail: async (p) => (await import("./office-email.server")).sendOfficeEmail(p),
  sendTestEmail: async (info, to, subject, html, text) => (await import("./test-send.server")).sendTestEmail({ ...info, actorId: null }, to, subject, html, text),
  record: async (jobId, eventType, summary, details) => (await import("./workflow.server")).logEvent(jobId, null, eventType, summary, details, { internal: true }),
});
export const ELECTRICIAN_CANT_DO_MITTI_FAILED_EVENT = "electrician_cant_do_mitti_failed";
export const ELECTRICIAN_CANT_DO_EMAIL_HELD_EVENT = "electrician_cant_do_email_held";
/** Written once every step after the claim has run; a later press of the same link then does nothing at all. */
export const ELECTRICIAN_CANT_DO_FINISHED_EVENT = "electrician_cant_do_finished";

/** The electrician hands the job back from their link (Jo 2 Nov, answer 4). Everything comes from the token; only a live step
 *  (not All done / closed) can be handed back. ONE `electrician_cant_do` event is the claim, written FIRST; everything after it is
 *  idempotent and re-run on a later press of the same link, so a half-done hand-back finishes itself: their confirmed safety
 *  check / upgrades booking is cancelled through the existing guarded cancel writer, their assignment ends, every link of theirs
 *  for the job is switched off, their Mitti access to the job's forms is removed (best effort), then the owner is emailed straight
 *  away for each cancelled booking (Part 4, keyed per booking) and the installer office is told (DRAFT email, keyed; test-send for
 *  TEST jobs). A second press on the same link is the same { ok: true }. */
export async function electricianCantDo(token: string, reason: string, now = Date.now(), over: Partial<ElectricianCantDoDeps> = {}): Promise<ElectricianCantDoResult> {
  if (!electricianCantDoReasonOk(reason)) return { ok: false, message: ELECTRICIAN_CANT_DO_REASON_NEEDED };
  const why = reason.trim().slice(0, 480);
  if (!isTokenShape(token)) return { ok: false, message: ELECTRICIAN_LINK_NOT_VALID };
  const d = { ...cantDoDeps(), ...over };
  const { data: l, error } = await admin.from("worker_job_links").select("id, job_id, worker_id, business_id, expires_at, revoked_at").eq("token_hash", await hashToken(token)).maybeSingle();
  if (error) throw dbErr("the link", error);
  if (!l) return { ok: false, message: ELECTRICIAN_LINK_NOT_VALID };
  const jobId = l.job_id as string;
  type Claim = { assignment_id: string; cancelled_booking_ids: string[] };
  const claimBefore = async (): Promise<Claim | null> => {
    const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", ELECTRICIAN_CANT_DO_EVENT).contains("details", { link_id: l.id }).limit(1).maybeSingle();
    const det = (data?.details ?? null) as Partial<Claim> | null;
    return det ? { assignment_id: String(det.assignment_id ?? ""), cancelled_booking_ids: Array.isArray(det.cancelled_booking_ids) ? det.cancelled_booking_ids.map(String) : [] } : null;
  };
  const installer = await installerOf(jobId);
  const state = linkState(l, now);
  const off = { ok: false as const, message: electricianLinkSwitchedOff(installer.name) };
  // The first press switched this link off; the same press again finishes anything left and is simply done.
  if (state === "revoked" && !(await claimBefore())) return off;
  if (state === "expired") return { ok: false, message: electricianLinkExpired(installer.name) };
  // approval_status / certificationBlocker are deliberately NOT checked: an unapproved or lapsed electrician can still hand a job back.
  const [{ data: w, error: we }, { data: job, error: je }] = await Promise.all([
    admin.from("partner_workers").select("id, email, full_legal_name, trade_role, removed_at, profile_id").eq("id", l.worker_id).maybeSingle(),
    admin.from("jobs").select("job_number, source, stage, deleted_at").eq("id", jobId).maybeSingle(),
  ]);
  if (we) throw dbErr("the electrician", we);
  if (je) throw dbErr("the job", je);
  if (!w || w.trade_role !== "electrician" || w.removed_at || !job || job.deleted_at) return off;

  return withJobLock(jobId, async () => {
    let claim = await claimBefore();
    let auditIds: string[];
    if (claim) {
      const { data: fin } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", ELECTRICIAN_CANT_DO_FINISHED_EVENT).contains("details", { link_id: l.id }).limit(1).maybeSingle();
      if (fin) return { ok: true as const };
    }
    if (!claim) {
      const asg = await electricianAssignment(jobId, l.business_id);
      if (!asg || !sameElectrician(asg, w)) return off;
      // Only a live step can be handed back: All done and a closed job are switched off, nothing written.
      const f = await factsFor(jobId, await whoBooksFor(installer.id), job.stage === "cancelled", now);
      const step = electricianStep(f.facts).step;
      if (step === "all_done" || step === "closed") return off;
      auditIds = f.auditIds;
      const { data: booked, error: be } = await admin.from("bookings").select("id").eq("job_id", jobId).eq("status", "confirmed").eq("business_id", l.business_id).in("kind", ["assessment", "rectification"]);
      if (be) throw dbErr("the bookings", be);
      claim = { assignment_id: asg.id, cancelled_booking_ids: (booked ?? []).map((b) => b.id as string) };
      // The claim (Part 9 reads it) goes first; every step below is idempotent and re-run on a later press.
      await d.record(jobId, ELECTRICIAN_CANT_DO_EVENT, `Electrician can't do this one (${why})`, { worker_id: l.worker_id, reason: why, booking_cancelled: claim.cancelled_booking_ids.length > 0, link_id: l.id, assignment_id: claim.assignment_id, business_id: l.business_id, cancelled_booking_ids: claim.cancelled_booking_ids });
    } else {
      auditIds = (await factsFor(jobId, "office", job.stage === "cancelled", now)).auditIds;
    }
    // 1. Their booked visits, through the existing guarded cancel writer (it also releases the trade). Nothing confirmed = nothing to do.
    const { data: still, error: se } = await admin.from("bookings").select("kind").eq("job_id", jobId).eq("status", "confirmed").eq("business_id", l.business_id).in("kind", ["assessment", "rectification"]);
    if (se) throw dbErr("the bookings", se);
    for (const kind of ["assessment", "rectification"] as const) if ((still ?? []).some((b) => b.kind === kind)) await d.cancelVisit(jobId, kind, l.business_id, why);
    // 2. Off the job: the assignment ends (if the cancel writer hasn't already ended it) and every link of theirs is switched off.
    const nowIso = new Date(now).toISOString();
    const { error: ae } = await admin.from("job_assignments").update({ active: false, ended_at: nowIso, end_reason: `electrician can't do this one: ${why}`.slice(0, 300) }).eq("id", claim.assignment_id).eq("active", true);
    if (ae) throw new Error(ae.message);
    const { error: re } = await admin.from("worker_job_links").update({ revoked_at: nowIso, revoked_by: null }).eq("worker_id", l.worker_id).eq("job_id", jobId).is("revoked_at", null);
    if (re) throw new Error(re.message);
    // 3. Their Mitti access to the job's forms (A3, open A4). Best effort: a failure is logged on the job, never undoes the hand-back.
    const mittiEmail = job.source === "qa_test" ? (await import("./onsite-ready-check.core")).TEST_MITTI_ASSIGNEE : (w.email ?? "").trim();
    for (const auditId of auditIds) {
      try {
        if (!mittiEmail) throw new Error("no email on the electrician's record");
        await d.removeMittiAccess(auditId, mittiEmail);
      } catch (e) {
        console.error("Can't do this one: Mitti access not removed", auditId, (e as Error).message);
        await d.record(jobId, ELECTRICIAN_CANT_DO_MITTI_FAILED_EVENT, "Electrician's Mitti form access could not be removed", { audit_id: auditId, worker_id: l.worker_id, error: (e as Error).message.slice(0, 300) }).catch(() => undefined);
      }
    }
    // 4. The owner, straight away, once per cancelled booking (Part 4's email; its own key stops a repeat). Never undoes the hand-back.
    for (const id of claim.cancelled_booking_ids) await d.ownerNotice(jobId, id, "electrician").catch((e) => console.error("Visit cancelled owner email skipped", (e as Error).message));
    // 5. The installer office (DRAFT wording; real jobs held until approved; keyed, so a retry never sends twice).
    await tellInstallerOfficeCantDo(d, { jobId, jobNumber: job.job_number, source: job.source ?? null, assignmentId: claim.assignment_id, electrician: w.full_legal_name ?? "", electricianBusinessId: l.business_id, installerBusinessId: installer.id, reason: why })
      .catch((e) => console.error("Can't do this one: installer office email skipped", (e as Error).message));
    await d.record(jobId, ELECTRICIAN_CANT_DO_FINISHED_EVENT, "Hand-back finished", { link_id: l.id, worker_id: l.worker_id }).catch((e) => console.error("Can't do this one: finish mark not written", (e as Error).message));
    return { ok: true as const };
  });
}

type CantDoEmailInput = { jobId: string; jobNumber: string; source: string | null; assignmentId: string; electrician: string; electricianBusinessId: string; installerBusinessId: string | null; reason: string };
/** The installer office email (DRAFT wording, names the PERSON). Recorded once per key before the send. Held = one
 *  `electrician_cant_do_email_held` trace per key carrying what is needed to send it later: the tick's
 *  sweepHeldElectricianCantDoEmails retries "awaiting approval" holds once the flag is on. */
async function tellInstallerOfficeCantDo(d: ElectricianCantDoDeps, i: CantDoEmailInput): Promise<"sent" | "test_sent" | "held"> {
  const key = electricianCantDoEmailKey(i.jobId, i.assignmentId);
  const { data: done } = await admin.from("workflow_events").select("id").eq("job_id", i.jobId).eq("event_type", ELECTRICIAN_CANT_DO_EMAIL_EVENT).contains("details", { key }).limit(1).maybeSingle();
  if (done) return "held";
  const held = async (reason: string) => {
    const { data: prior } = await admin.from("workflow_events").select("id").eq("job_id", i.jobId).eq("event_type", ELECTRICIAN_CANT_DO_EMAIL_HELD_EVENT).contains("details", { key }).limit(1).maybeSingle();
    if (!prior) await d.record(i.jobId, ELECTRICIAN_CANT_DO_EMAIL_HELD_EVENT, `Installer office not told the electrician can't do this one: ${reason}`, { key, reason, job_number: i.jobNumber, source: i.source, assignment_id: i.assignmentId, electrician: i.electrician, electrician_business_id: i.electricianBusinessId, installer_business_id: i.installerBusinessId, text: i.reason });
    return "held" as const;
  };
  if (!i.installerBusinessId) return held("no installer on the job");
  const [{ data: ib, error: ie }, { data: eb, error: ee }] = await Promise.all([
    admin.from("businesses").select("name, trading_name, email, onboarding_notes").eq("id", i.installerBusinessId).maybeSingle(),
    admin.from("businesses").select("name, trading_name, onboarding_notes").eq("id", i.electricianBusinessId).maybeSingle(),
  ]);
  if (ie) throw dbErr("the installer", ie);
  if (ee) throw dbErr("the electrician business", ee);
  const to = (ib?.email ?? "").trim();
  if (!to) return held("no installer office email");
  const { isTestPartner } = await import("./test-send.core");
  const partnerIsTest = isTestPartner(ib) || isTestPartner(eb);
  const test = i.source === "qa_test" || partnerIsTest;
  if (!test && !d.emailApproved) return held("awaiting approval");
  const { electricianCantDoEmail } = await import("./electrician-cant-do-email.core");
  const { TEST_APP_BASE } = await import("./test-send.server");
  const mail = electricianCantDoEmail({ jobNumber: i.jobNumber, electrician: i.electrician.trim() || bizName(eb) || "The electrician", reason: i.reason, business: bizName(ib), jobUrl: `${test ? TEST_APP_BASE : SET_PASSWORD_BASE}/field/${i.jobId}`, test });
  // Recorded BEFORE the send, once per key.
  await d.record(i.jobId, ELECTRICIAN_CANT_DO_EMAIL_EVENT, "Installer office told the electrician can't do this one", { key, assignment_id: i.assignmentId, test });
  if (test) {
    const r = await d.sendTestEmail({ jobId: i.jobId, jobSource: i.source, partnerIsTest, label: `electrician_cant_do:${i.jobId}` }, to, mail.subject, mail.html, mail.text);
    return r.status === "sent" ? "test_sent" : "held";
  }
  const r = await d.sendOfficeEmail({ actorId: null, recipient: "partner", to, contactName: bizName(ib), subject: mail.subject, message: mail.text, html: mail.html, text: mail.text, label: "electrician_cant_do", record: { businessId: i.installerBusinessId }, idempotencyKey: key });
  return r.status === "sent" ? "sent" : "held";
}

/** The tick: can't-do emails held "awaiting approval" go once the flag is on (once per key; the sent event stops further tries). */
export async function sweepHeldElectricianCantDoEmails(now = new Date(), over: Partial<ElectricianCantDoDeps> = {}): Promise<{ sent: number }> {
  const d = { ...cantDoDeps(), ...over };
  const out = { sent: 0 };
  void now;
  if (!d.emailApproved) return out;
  try {
    const held = await pagedRows("held can't-do emails", (a, b) => admin.from("workflow_events").select("job_id, details").eq("event_type", ELECTRICIAN_CANT_DO_EMAIL_HELD_EVENT).contains("details", { reason: "awaiting approval" }).order("created_at", { ascending: true }).range(a, b));
    for (const h of held) {
      const det = h["details"] as Partial<{ key: string; job_number: string; source: string | null; assignment_id: string; electrician: string; electrician_business_id: string; installer_business_id: string | null; text: string }>;
      const jobId = String(h["job_id"]);
      if (!det.key || !det.assignment_id || !det.electrician_business_id || !det.job_number) continue;
      try {
        const r = await tellInstallerOfficeCantDo(d, { jobId, jobNumber: det.job_number, source: det.source ?? null, assignmentId: det.assignment_id, electrician: det.electrician ?? "", electricianBusinessId: det.electrician_business_id, installerBusinessId: det.installer_business_id ?? null, reason: det.text ?? "" });
        if (r === "sent" || r === "test_sent") out.sent++;
      } catch (e) { console.error("held can't-do email: job skipped", jobId, (e as Error).message); }
    }
  } catch (e) { console.error("held can't-do email sweep: read failed, nothing sent", (e as Error).message); }
  return out;
}

// ---------- the tick: every active electrician assignment gets its link text (fix wave I2) ----------
export const ELECTRICIAN_LINK_TEXT_HELD_EVENT = "electrician_link_text_held";
/** The sweep only ever texts assignments made from this instant on (or any with a Team allocation event), so switching the
 *  wording on never texts old jobs. Deploy-date placeholder: Part 11 sets it to the go-live instant. */
export const ELECTRICIAN_LINK_SWEEP_FROM_ISO = "2026-11-04T21:40:00Z"; // go-live publish, 5 Nov 2026 08:40 Melbourne
export type ElectricianLinkSweepDeps = {
  /** The link + text step (linkAfterAllocation): returns how it went. */
  link: (jobId: string, workerId: string) => Promise<Awaited<ReturnType<typeof linkAfterAllocation>>>;
};
const CLOSED_STAGES = new Set(["complete", "cancelled"]);
const MAX_LINKS_PER_TICK = 100;
async function pagedRows(what: string, page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await page(from, from + 199);
    if (error) throw new Error(`Could not read ${what}: ${error.message}`);
    out.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data ?? []).length < 200) return out;
  }
}
const chunk = <T,>(xs: T[], n = 200): T[][] => { const o: T[][] = []; for (let i = 0; i < xs.length; i += n) o.push(xs.slice(i, i + n)); return o; };

/** On the 15-minute tick: an active electrician assignment with no `electrician_link_text_sent` for its person gets the link
 *  step again (an allocation whose text was held while the wording was unapproved, or a path that never texted). The
 *  person is the latest Team allocation's worker, else the assignment's profile. Not sent → ONE `electrician_link_text_held`
 *  per key + reason (a trace, never a claim: the step runs again next tick and stops only when a text is recorded sent).
 *  Reads page 200; a failed read logs and does nothing. Never throws. */
export async function sweepElectricianLinks(now = new Date(), over: Partial<ElectricianLinkSweepDeps> = {}): Promise<{ checked: number; sent: number; held: number }> {
  const d: ElectricianLinkSweepDeps = { link: (jobId, workerId) => linkAfterAllocation(jobId, workerId, null), ...over };
  const out = { checked: 0, sent: 0, held: 0 };
  try {
    const asgs = await pagedRows("electrician assignments", (a, b) => admin.from("job_assignments").select("id, job_id, business_id, user_id, created_at").eq("role", "electrician").eq("active", true).order("id").range(a, b));
    const jobIds = [...new Set(asgs.map((a) => String(a["job_id"])))];
    if (!jobIds.length) return out;
    const jobs = new Map<string, { stage: string; deleted_at: string | null }>();
    const events: Record<string, unknown>[] = [];
    const cutoff = Date.parse(ELECTRICIAN_LINK_SWEEP_FROM_ISO);
    for (const c of chunk(jobIds)) {
      for (const j of await pagedRows("jobs", (a, b) => admin.from("jobs").select("id, stage, deleted_at").in("id", c).range(a, b))) jobs.set(String(j["id"]), { stage: String(j["stage"]), deleted_at: (j["deleted_at"] as string | null) ?? null });
      events.push(...(await pagedRows("link events", (a, b) => admin.from("workflow_events").select("job_id, event_type, details, created_at").in("job_id", c).in("event_type", ["in_house_electrician_allocated", ELECTRICIAN_LINK_TEXT_SENT_EVENT, ELECTRICIAN_LINK_TEXT_HELD_EVENT]).order("created_at", { ascending: false }).range(a, b))));
    }
    const det = (e: Record<string, unknown>) => (e["details"] ?? {}) as { key?: string; reason?: string; worker_id?: string };
    const profileIds = [...new Set(asgs.map((a) => a["user_id"]).filter((x): x is string => typeof x === "string" && !!x))];
    const byProfile = new Map<string, string>();
    for (const c of chunk(profileIds)) for (const w of await pagedRows("electricians", (a, b) => admin.from("partner_workers").select("id, profile_id").in("profile_id", c).eq("trade_role", "electrician").is("removed_at", null).range(a, b))) byProfile.set(String(w["profile_id"]), String(w["id"]));
    let budget = MAX_LINKS_PER_TICK;
    for (const a of asgs) {
      if (budget <= 0) break;
      const jobId = String(a["job_id"]);
      const job = jobs.get(jobId);
      if (!job || job.deleted_at || CLOSED_STAGES.has(job.stage)) continue;
      const mine = events.filter((e) => String(e["job_id"]) === jobId);
      const allocated = mine.find((e) => e["event_type"] === "in_house_electrician_allocated");
      // Scope: a Team allocation (new flow), or an assignment made from the cut-over instant; older ones are never texted.
      if (!allocated && !(Date.parse(String(a["created_at"] ?? "")) >= cutoff)) continue;
      const workerId = (allocated && det(allocated).worker_id) || (a["user_id"] ? byProfile.get(String(a["user_id"])) : null) || null;
      if (!workerId) continue;
      const key = electricianLinkTextKey(jobId, workerId);
      if (mine.some((e) => e["event_type"] === ELECTRICIAN_LINK_TEXT_SENT_EVENT && det(e).key === key)) continue;
      try {
        // Only a live step gets a text: All done / closed jobs are left alone.
        const installerBiz = (await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle()).data?.business_id ?? null;
        const stepNow = electricianStep((await factsFor(jobId, await whoBooksFor(installerBiz), job.stage === "cancelled", now.getTime())).facts).step;
        if (stepNow === "all_done" || stepNow === "closed") continue;
      } catch (e) { console.error("electrician link sweep: step not read, job skipped", jobId, (e as Error).message); continue; }
      budget--; out.checked++;
      try {
        const r = await d.link(jobId, workerId);
        if (r === "sent" || r === "test_sent") { out.sent++; continue; }
        if (mine.some((e) => e["event_type"] === ELECTRICIAN_LINK_TEXT_HELD_EVENT && det(e).key === key && det(e).reason === r)) continue;
        await (await import("./workflow.server")).logEvent(jobId, null, ELECTRICIAN_LINK_TEXT_HELD_EVENT, `Electrician job link text not sent: ${r}`, { key, worker_id: workerId, assignment_id: a["id"], reason: r }, { internal: true });
        out.held++;
      } catch (e) { console.error("electrician link sweep: job skipped", jobId, (e as Error).message); }
    }
  } catch (e) { console.error("electrician link sweep: read failed, nothing done", (e as Error).message); }
  return out;
}
