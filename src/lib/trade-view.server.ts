// Trade view reads + the few trade actions (Jo-approved designs, 6 Oct 2026). Every read is scoped to the signed-in
// person's own business. Trades never see customer prices, margins, the office's electrician list or other partners.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { fullAddress, shortAddress } from "./address";
import { isTestPartner } from "./test-send.core";
import { offerTiming } from "./offer-timing.core";
import { placeWorkJob, type WorkPlace } from "./work-places.core";
import { COULDNT_GET_IN, offerMoney, electricianPayState, payState, type PayState, surname, type AreaSource, type InsulationNow, type TradeKind, type DayKind, SETUP_STEPS, type SetupKey, tradeJobAllowed, contactVisible, type AccessAssignment, type TeamMemberView, type BusinessNext, type CredentialView, type MittiLogin, latestExpiry, businessNext, type BusinessNextFacts, bankLine, installerPayHeldReasons, accountEnding } from "./trade-view.core";
import { crewClearance, CREW_CLEARANCE_REASON, melbourneToday } from "./worker-compliance.core";
import type { UsualElectrician } from "./usual-electrician.core";
import type { InstallerQuote } from "./installer-quote-status.server";
// Speed (installer screens, Task 5): module-scope imports instead of awaited import() calls inside the loaders.
import { statusFactsFor, statusView } from "./job-status.server";
import { installerTab, doneReason } from "./installer-progress.core";
import { installerHomeGroups, comingForInstaller } from "./installer-home.core";
import { installerQuoteLine } from "./installer-quote-status.core";
import { inHouseTradeBookingText } from "./in-house-message.core";
import { withoutRetiredInstallDayPhotos } from "./ready-check-chase.core";
import { early } from "./early-read";
// Speed (installer screens, Task 6): the job page's modules, imported at module scope (namespaces, as above).
import * as allocationServer from "./allocation.server";
import * as mittiJobPresentationServer from "./mitti-job-presentation.server";
import * as aiEmailReplyServer from "./ai-email-reply.server";
import * as piesaOwnerConfirmServer from "./piesa-owner-confirm.server";
import * as paymentsServer from "./payments.server";
import * as installAttendanceServer from "./install-attendance.server";
import * as installAttendanceCore from "./install-attendance.core";
import { electricalClearance } from "./allocation.core";
import { needsFinishingTask, installerAttendanceLine, historicalReadyCheckDay, couldntGetInDay } from "./trade-view.core";
import { needsFinishingList } from "./installer-screens.core";
import { currentAllocation } from "./visit-allocation.core";
import { isStepPaid } from "./payments.core";
import { installerTextAddress } from "./installer-texts.core";
const loadInstallerQuote = (jobId: string) => quoteStatusServer.loadInstallerQuote(jobId);
// Namespace imports: several tests replace these modules with partial mocks; a namespace never fails on a missing export.
import * as quoteStatusServer from "./installer-quote-status.server";
import * as installerPriceServer from "./installer-price.server";
// Speed (installer screens, Task 7): the day screen's pure modules load once at module scope (namespace imports, read at call
// time). The day's server modules (fixes-day, official-forms, swms) stay lazy imports: their own dependencies (node:crypto,
// data files) are not available to the test loader that loads this file, and a cached import() costs no database round.
import * as officialFormsCore from "./official-forms.core";
import * as enquiryCore from "./enquiry.core";
import * as eligibilityCore from "./eligibility.core";
const loadInstallerQuotes = (ids: string[]) => quoteStatusServer.loadInstallerQuotes(ids);
const readInstallerPrices = (ids: string[]) => installerPriceServer.readInstallerPrices(ids);

type Biz = { id: string; name: string; business_type: string | null; capabilities: string[] | null; base_suburb: string | null; coverage_radius_km: number | null; covers_all_victoria: boolean | null; accepting_new_jobs: boolean | null; onboarding_notes: string | null; mitti_account_invited?: boolean | null };

const BIZ_COLS = "id, name, business_type, capabilities, base_suburb, coverage_radius_km, covers_all_victoria, accepting_new_jobs, onboarding_notes, mitti_account_invited";

export async function tradeContext(userId: string) {
  // Speed (installer screens, Task 5): the business comes back embedded in the membership read — one round, not two.
  const [{ data: mem }, { data: roles }, { data: prof }] = await Promise.all([
    admin.from("business_members").select(`business_id, member_role, businesses(${BIZ_COLS})`).eq("user_id", userId).eq("active", true),
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin.from("profiles").select("full_name, phone, email").eq("id", userId).maybeSingle(),
  ]);
  const m = (mem ?? [])[0];
  if (!m) return null;
  const b = (m as unknown as { businesses: Biz | null }).businesses;
  if (!b) return null;
  const r = new Set((roles ?? []).map((x) => x.role as string));
  const kind: TradeKind = r.has("installer") && !r.has("electrician") ? "installer" : b.business_type === "eec_installer" && !r.has("electrician") ? "installer" : "electrician";
  return { biz: b as Biz, kind, boss: m.member_role === "business_admin", firstName: prof?.full_name?.trim().split(/\s+/)[0] ?? null, profile: prof, isTest: isTestPartner(b) };
}

/** Review D: bosses see every active assignment for the business; workers only their own. */
export function assignmentQuery(c: { biz: { id: string }; boss: boolean }, userId: string) {
  const q = admin.from("job_assignments").select("job_id, business_id, role").eq("business_id", c.biz.id).eq("active", true);
  return c.boss ? q : q.eq("user_id", userId);
}

export async function ctxOrThrow(userId: string) {
  const c = await tradeContext(userId);
  if (!c) throw new WorkflowError("Your sign-in isn't linked to an approved business yet.");
  return c;
}

/** Business-owner-only data (rates, bank, agreement, insurance, team). Staff logins are refused here, not just hidden in the page. */
export async function bossOrThrow(userId: string) {
  const c = await ctxOrThrow(userId);
  if (!c.boss) throw new WorkflowError("Only the business owner can see this.");
  return c;
}

const VISIT: Record<string, string> = { assessment: "Pre Insulation Electrical Safety Assessment (PIESA)", rectification: "Fixes", ready_check: "Ready Check", installation: "Install" };

const HOME_JOB_COLS = "id, job_number, stage, source, channel, qa_archived_at, deleted_at, updated_at, next_action, owners(full_name), properties(address_line, suburb, postcode)";
type HomeJob = { id: string; job_number: string; stage: string; source: string; channel: string | null; qa_archived_at: string | null; deleted_at: string | null; updated_at: string | null; next_action: string | null; owners: unknown; properties: unknown };

/** My work: open offers, things that need this trade, booked visits, and this month. */
export async function tradeHome(userId: string) {
  // Speed (installer screens, Task 5): three rounds of reads — (1) sign-in context, (2) everything that needs only the
  // business (offers, assignments with their jobs embedded, ended assignments, owner money rows), (3) everything that
  // needs the job ids. The owner's money rows run their own short chain alongside rounds 2–3. Same reads, same value.
  const c = await ctxOrThrow(userId);
  const now = new Date();
  // Business owner only, own pay only. Started now, awaited after round 3; a failure still fails the page (money path).
  const moneyP = c.boss ? tradeMoneyRows(c.biz.id, c.kind, c.isTest) : Promise.resolve([] as Awaited<ReturnType<typeof tradeMoneyRows>>);
  moneyP.catch(() => undefined); // handled where it is awaited; this only stops an early rejection being reported as unhandled
  const histQ = admin.from("job_assignments").select("job_id").eq("business_id", c.biz.id).eq("active", false);
  // Review D (as assignmentQuery): bosses see every active assignment for the business; workers only their own.
  const asgQ = admin.from("job_assignments").select(`job_id, business_id, role, jobs(${HOME_JOB_COLS})`).eq("business_id", c.biz.id).eq("active", true);
  const [{ data: offers }, { data: asg }, { data: ended }] = await Promise.all([
    admin.from("partner_offers").select("id, job_id, kind, summary, expires_at").eq("business_id", c.biz.id).eq("status", "pending").order("offered_at", { ascending: false }),
    c.boss ? asgQ : asgQ.eq("user_id", userId),
    c.boss ? histQ : histQ.eq("user_id", userId),
  ]);
  const jobIds = [...new Set((asg ?? []).map((a) => a.job_id))];
  const jobRows = new Map<string, HomeJob>();
  for (const a of asg ?? []) { const jr = (a as unknown as { jobs: HomeJob | HomeJob[] | null }).jobs; const one = Array.isArray(jr) ? jr[0] : jr; if (one && !jobRows.has(one.id)) jobRows.set(one.id, one); }
  const jobs = [...jobRows.values()];
  const none = ["00000000-0000-0000-0000-000000000000"];
  const mine = c.kind === "installer" ? ["ready_check", "installation"] : ["assessment", "rectification"];
  const live = (jobs ?? []).filter((j) => !j.qa_archived_at && !j.deleted_at && !["cancelled"].includes(j.stage) && (!c.isTest || j.source === "qa_test"));
  const byId = new Map(live.map((j) => [j.id, j]));
  const liveIds = live.map((j) => j.id);
  const ids = jobIds.length ? jobIds : none;
  // Ended assignments get a read-only summary; cancelled active-assignment jobs too (see Done below).
  const histIds = [...new Set([...(ended ?? []).map((a) => a.job_id), ...jobs.filter((j) => j.stage === "cancelled").map((j) => j.id)])].filter((id) => !byId.has(id));
  // Decisions 278/279: the one status line needs two more facts per installer job — has the Mitti form any installer
  // answers (latest ready_check_basics event) and, on the installer's own jobs, has the boss entered the price.
  const formReads = c.kind === "installer" && live.length > 0;
  // Round 3: every read that needs the job ids, together.
  const [{ data: books }, { data: missing }, { data: deadlines }, sf, rcQuotes, { data: ms }, { data: basics }, prices, { data: histJobs }] = await Promise.all([
    admin.from("bookings").select("job_id, kind, status, scheduled_start, scheduled_end").in("job_id", ids).in("status", ["confirmed", "completed"]).order("scheduled_start"),
    admin.from("evidence_requirements").select("job_id, category, gate, label").in("job_id", ids).eq("required", true).in("status", ["outstanding", "rejected"]),
    admin.from("job_piesa_deadlines").select("job_id, install_deadline").in("job_id", ids),
    statusFactsFor(c, liveIds),
    // Installer quote status — one plain line, no approval step (Jo 24 Oct). A failed read drops the lines, never the page.
    c.kind === "installer" ? loadInstallerQuotes(liveIds).catch(() => new Map<string, InstallerQuote>()) : Promise.resolve(new Map<string, InstallerQuote>()),
    formReads ? admin.from("ceiling_measurements").select("job_id, external_source, external_id").in("job_id", liveIds).eq("is_current", true) : Promise.resolve({ data: [] as { job_id: string; external_source: string | null; external_id: string | null }[] }),
    formReads ? admin.from("workflow_events").select("job_id, details, created_at").in("job_id", liveIds).eq("event_type", "ready_check_basics").order("created_at", { ascending: false }) : Promise.resolve({ data: [] as { job_id: string | null; details: unknown; created_at: string }[] }),
    formReads ? readInstallerPrices(liveIds) : Promise.resolve(new Map<string, unknown>()),
    histIds.length
      ? admin.from("jobs").select("id, job_number, stage, source, channel, qa_archived_at, deleted_at, updated_at, properties(suburb)").in("id", histIds).in("stage", ["complete", "cancelled"])
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const moneyAll = await moneyP;
  // Decision 396: rows the retired install-day photo chase created are not missing photos.
  const miss = new Map<string, number>(); for (const r of withoutRetiredInstallDayPhotos(missing ?? [])) miss.set(r.job_id, (miss.get(r.job_id) ?? 0) + 1);
  const deadline = new Map<string, string>(); for (const d of deadlines ?? []) if (d.job_id && d.install_deadline) deadline.set(d.job_id, String(d.install_deadline));
  const label = (j: (typeof live)[number]) => { const o = j.owners as { full_name: string | null } | null; const p = j.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null; return { owner: o?.full_name ?? null, surname: surname(o?.full_name), suburb: p?.suburb ?? null, address: fullAddress(p?.address_line, p?.suburb, p?.postcode), street: shortAddress(p?.address_line, p?.suburb) }; };
  const upcomingOf = (id: string) => (books ?? []).filter((b) => b.job_id === id && b.status === "confirmed" && mine.includes(b.kind) && new Date(b.scheduled_end ?? b.scheduled_start).getTime() > now.getTime() - 12 * 3_600_000);
  // Installers only get Ready Check offers now (decisions 49–52); electricians PIESA / fixes.
  const myOffer = (kind: string) => (c.kind === "installer" ? kind === "ready_check" : kind === "piesa" || kind === "rectification");
  const offerJobs = new Set((offers ?? []).filter((o) => myOffer(o.kind)).map((o) => o.job_id));
  const yourMove: { jobId: string; title: string; detail: string }[] = [];
  const coming: { jobId: string; kind: string; what: string; start: string; end: string | null; owner: string | null; surname: string | null; suburb: string | null; address: string }[] = [];
  const placeOf = new Map<string, { place: WorkPlace; title: string }>();
  for (const j of live) {
    const l = label(j);
    const up = upcomingOf(j.id);
    const p = placeWorkJob({ jobId: j.id, stage: j.stage, trade: c.kind, installerSourced: (j as { channel?: string }).channel === "installer_sourced", missingPhotos: miss.get(j.id) ?? 0, pendingOffer: offerJobs.has(j.id), upcoming: up });
    placeOf.set(j.id, p);
    if (p.place === "needs_me") yourMove.push({ jobId: j.id, title: p.title, detail: `${l.owner ?? "Owner"}, ${l.suburb ?? ""}` });
    if (p.place === "coming_up") { const b = up[0]!; coming.push({ jobId: b.job_id, kind: b.kind, what: VISIT[b.kind] ?? "Visit", start: b.scheduled_start, end: b.scheduled_end, ...l }); }
  }
  coming.sort((a, b) => a.start.localeCompare(b.start));
  const wk0 = new Date(now); wk0.setDate(now.getDate() - ((now.getDay() + 6) % 7)); wk0.setHours(0, 0, 0, 0);
  const wk1 = new Date(wk0.getTime() + 7 * 86_400_000);
  const week = (books ?? []).filter((b) => mine.includes(b.kind) && byId.has(b.job_id) && new Date(b.scheduled_start) >= wk0 && new Date(b.scheduled_start) < wk1).length;
  for (const j of live) {
    const held = sf.get(j.id)?.inHouseDispatch;
    const wording = held ? inHouseTradeBookingText(j.stage) : null;
    if (!wording) continue;
    const line = held === "in_house" ? wording : "Visit booking details unavailable";
    const old = placeOf.get(j.id);
    if (old) old.title = line;
    const move = yourMove.find(x => x.jobId === j.id);
    if (move) move.title = line;
  }
  // This month (business owner only, own pay only): installs done this month and what was paid to this business this month.
  const money = moneyAll.filter((r) => r.billing === "hivic");
  const m0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const month = money.filter((r) => r.doneAt && new Date(r.doneAt) >= m0);
  const paidThisMonth = money.filter((r) => r.state.kind === "paid" && new Date(r.state.on) >= m0).reduce((t, r) => t + (r.amount ?? 0), 0);
  const offerList = (offers ?? []).filter((o) => myOffer(o.kind))
    .map((o) => { const s = (o.summary ?? {}) as { suburb?: string | null; approx_area_m2?: number | null }; return { id: o.id, kind: o.kind, suburb: s.suburb ?? null, areaM2: s.approx_area_m2 ?? null, expiresAt: o.expires_at }; });
  const STATUS: Record<string, string> = { ready_check_ready_to_schedule: "Arranging the Ready Check time", ready_check_complete: "Office checking your Ready Check", on_hold: "On hold (office review)" };
  const allJobs = live.map((j) => ({ jobId: j.id, jobNumber: j.job_number, channel: j.channel, place: placeOf.get(j.id)!.place, status: (j as { next_action?: string | null }).next_action?.startsWith("Needs finishing") ? (j as { next_action: string }).next_action : STATUS[j.stage] ?? "In progress", line: sf.get(j.id) ? statusView(c, sf.get(j.id)!) : null, ...label(j) }));
  // Done: only actual final stages. Active-assignment jobs keep their link; ended assignments get a read-only summary
  // (job number, suburb, source, terminal reason) — no owner, address, contact or price, and no reopened access.
  const quoteLine = new Map<string, string>();
  for (const [id, ap] of rcQuotes) if (ap.applies) quoteLine.set(id, installerQuoteLine(ap));
  const formFacts = new Map<string, { linked: boolean; completed: boolean; hasAnswers: boolean | null }>();
  const priced = new Set<string>();
  if (formReads) {
    const latest = new Map<string, { completed?: boolean; answered?: boolean }>();
    for (const b of basics ?? []) if (b.job_id && !latest.has(b.job_id)) latest.set(b.job_id, (b.details ?? {}) as { completed?: boolean; answered?: boolean });
    for (const m of ms ?? []) if (m.external_source === "mitti" && m.external_id) { const d = latest.get(m.job_id); formFacts.set(m.job_id, { linked: true, completed: d?.completed === true, hasAnswers: typeof d?.answered === "boolean" ? d.answered : null }); }
    for (const id of prices.keys()) priced.add(id);
  }
  const jobsTabbed0 = allJobs.map((j) => ({ ...j, quoteLine: quoteLine.get(j.jobId) ?? null }));
  const jobsTabbed1 = jobsTabbed0.map((j) => ({ ...j, stage: byId.get(j.jobId)!.stage, tab: installerTab(j.place, byId.get(j.jobId)!.stage, /^Needs finishing/.test(String(byId.get(j.jobId)!.next_action ?? ""))) }));
  const jobsTabbed = jobsTabbed1.map((j) => ({ ...j, tab: j.tab === "done" ? j.tab : j.quoteLine ? j.quoteLine.startsWith("You:") ? "action" as const : "progress" as const : j.tab }));
  const done = [
    ...jobsTabbed.filter((j) => j.tab === "done").map((j) => ({ jobId: j.jobId, jobNumber: j.jobNumber, suburb: j.suburb, channel: j.channel, stage: j.stage, endedAt: byId.get(j.jobId)?.updated_at ?? null, reason: doneReason(j.stage), open: true })),
    ...(histJobs ?? []).filter((j) => !j.qa_archived_at && !j.deleted_at && (!c.isTest || j.source === "qa_test")).map((j) => ({ jobId: j.id, jobNumber: j.job_number, suburb: (j.properties as { suburb: string | null } | null)?.suburb ?? null, channel: j.channel as string | null, stage: j.stage, endedAt: j.updated_at ?? null, reason: doneReason(j.stage), open: false })),
  ];
  // Installer home (mock-up M1): one "Next:" line and one group per job, from the pure rules only.
  const upcomingTile = (id: string) => { const b = upcomingOf(id)[0]; return b ? { what: VISIT[b.kind] ?? "Visit", start: b.scheduled_start } : null; };
  const home = c.kind === "installer" ? installerHomeGroups(jobsTabbed.map((j) => ({
    jobId: j.jobId, jobNumber: j.jobNumber, street: j.street, suburb: j.suburb, channel: j.channel, stage: j.stage, place: j.place, placeTitle: placeOf.get(j.jobId)?.title ?? null,
    inHouseDispatch: sf.get(j.jobId)?.inHouseDispatch ?? null,
    nextAction: (byId.get(j.jobId) as { next_action?: string | null } | undefined)?.next_action ?? null, quoteLine: j.quoteLine, status: j.line ? { text: j.line.text, who: j.line.who } : null,
    upcoming: upcomingTile(j.jobId), installDeadline: deadline.get(j.jobId) ?? null, endedAt: byId.get(j.jobId)?.updated_at ?? null,
    formLinked: formFacts.get(j.jobId)?.linked === true, formCompleted: formFacts.get(j.jobId)?.completed === true, formHasAnswers: formFacts.get(j.jobId)?.hasAnswers ?? null,
    priceEntered: j.channel === "installer_sourced" ? priced.has(j.jobId) : null, boss: c.boss,
  }))) : null;
  return { kind: c.kind, boss: c.boss, business: c.biz.name, firstName: c.firstName, isTest: c.isTest, week, offers: offerList, yourMove, coming: home ? comingForInstaller(coming, home) : coming, jobs: jobsTabbed, done, home, month: c.boss ? { jobs: month.length, earned: month.reduce((t, r) => t + (r.amount ?? 0), 0), paid: paidThisMonth } : null };
}

/** One offer, trade-side. Owner and address only once this business has taken it. */
export async function tradeOffer(offerId: string, userId: string) {
  const c = await ctxOrThrow(userId);
  const { data: o } = await admin.from("partner_offers").select("id, job_id, business_id, kind, status, summary, expires_at, offered_at, superseded_at").eq("id", offerId).maybeSingle();
  if (!o || o.business_id !== c.biz.id) throw new WorkflowError("This offer isn't for your business.");
  // Speed (decision 280): once the offer row is known, the suggest-hours setting, the owner's PIESA windows, this
  // business's live assignment, the owner's own answers and the job number are independent — one round trip, not five.
  const [hours, { data: winRows }, { data: liveAsg }, says, { data: jn }] = await Promise.all([
    offerSuggestHours(),
    // Jo 24 Oct 2026 (decision 52): a Ready Check offer is accepted by offering the owner 3 times — the owner gives none.
    o.kind === "ready_check"
      ? Promise.resolve({ data: [] as { id: string; starts_at: string; ends_at: string | null; status: string }[] })
      : admin.from("appointment_proposals").select("id, starts_at, ends_at, status").eq("job_id", o.job_id).not("piesa_window_round", "is", null).order("starts_at"),
    // Review B: contact details only while this business still holds an ACTIVE assignment on the job (and, for a worker, their own).
    o.status === "accepted" ? assignmentQuery(c, userId).eq("job_id", o.job_id).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    // Decision 201: the two plain lines come from the owner's OWN answers on the job (never an aerial/measured figure).
    o.kind === "ready_check" ? ownerSaysFor(o.job_id) : Promise.resolve({ areaM2: null, insulation: null } as Awaited<ReturnType<typeof ownerSaysFor>>),
    o.kind === "ready_check" ? admin.from("jobs").select("job_number").eq("id", o.job_id).maybeSingle() : Promise.resolve({ data: null as { job_number: string | null } | null }),
  ]);
  const timing = offerTiming(o.offered_at, hours);
  const s = (o.summary ?? {}) as { suburb?: string; postcode?: string; distance_km?: number; electrician_rate_inc_gst?: number | null; approx_area_m2?: number; area_source?: AreaSource; insulation_now?: InsulationNow; installer_rate_per_m2?: number | null };
  const windows = (winRows ?? []).filter((w) => w.status === "open" || w.status === "proposed").map((w) => ({ id: w.id, start: w.starts_at, end: w.ends_at }));
  const rcDays = o.kind === "ready_check" && o.status === "pending" ? (await import("./ready-check-times.core")).allowedReadyCheckDays() : [];
  // Decision 333: every pending PIESA offer, including jobs started the old way, is accepted by offering the owner 3 times.
  const piesaDays = o.kind === "piesa" && o.status === "pending" ? (await import("./piesa-times.core")).allowedPiesaTimeDays() : [];
  let locked: null | { owner: string | null; phone: string | null; address: string; start: string; end: string | null } = null;
  if (o.status === "accepted" && liveAsg) {
    const bk = o.kind === "ready_check" ? "ready_check" : o.kind === "piesa" ? "assessment" : o.kind;
    const [{ data: b }, { data: j }] = await Promise.all([
      admin.from("bookings").select("scheduled_start, scheduled_end").eq("job_id", o.job_id).eq("kind", bk as never).neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("jobs").select("owners(full_name, phone), properties(address_line, suburb, postcode)").eq("id", o.job_id).single(),
    ]);
    const ow = j?.owners as { full_name: string | null; phone: string | null } | null;
    const p = j?.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
    if (b) locked = { owner: ow?.full_name ?? null, phone: ow?.phone ?? null, address: fullAddress(p?.address_line, p?.suburb, p?.postcode), start: b.scheduled_start, end: b.scheduled_end };
  }
  // Accepted (owner picking): the installer's own open times, so the accepted state can list them (approved state M5-accepted).
  const times = o.kind === "ready_check" && o.status === "accepted" && liveAsg ? (await (await import("./ready-check-times.server")).installerReadyCheckState(o.job_id, userId).catch(() => null)) : null;
  return {
    id: o.id, jobId: o.job_id, kind: o.kind, status: o.status, expiresAt: o.expires_at, windows, locked, rcDays, piesaDays, boss: c.boss, accepted: o.status === "accepted" && !!liveAsg,
    canSuggest: o.kind !== "ready_check" && o.status === "pending" && timing.canSuggest, suggestUnlockLabel: timing.unlockLabel, takenByOther: o.status === "withdrawn" || o.status === "superseded",
    suburb: s.suburb ?? null, distanceKm: s.distance_km ?? null, ...offerMoney(c.boss, s), jobNumber: jn?.job_number ?? null,
    area: says.areaM2 ?? s.approx_area_m2 ?? null, areaSource: (s.area_source ?? "owner_estimate") as AreaSource, insulation: (says.insulation ?? s.insulation_now ?? "unknown") as InsulationNow,
    offeredTimes: times && times.turn === "owner_to_answer" ? times.open.filter((t) => t.by === "installer").map((t) => t.starts_at) : [],
  };
}

/** Take a time. Staged TEST offers use one atomic conditional update; real offers go through the existing atomic paths. */
export async function tradeTakeTime(offerId: string, windowId: string, userId: string) {
  const c = await ctxOrThrow(userId);
  const { data: o } = await admin.from("partner_offers").select("id, job_id, business_id, kind, status, summary").eq("id", offerId).maybeSingle();
  if (!o || o.business_id !== c.biz.id) throw new WorkflowError("This offer isn't for your business.");
  const { data: job } = await admin.from("jobs").select("source").eq("id", o.job_id).single();
  const staged = job?.source === "qa_test" && (o.summary as { test_staged?: boolean })?.test_staged;
  if (!staged) {
    // Jo 24 Oct 2026: Ready Check offers are accepted by offering the owner 3 times (tradeOfferReadyCheckTimes).
    if (o.kind === "ready_check") throw new WorkflowError("To accept, offer the owner 3 Ready Check times.");
    const { takeJoOffer } = await import("./jo-tradie.server");
    return { tooSlow: (await takeJoOffer(offerId, windowId, userId)).tooSlow };
  }
  const now = new Date().toISOString();
  const { data: won } = await admin.from("partner_offers").update({ status: "accepted", responded_by: userId, responded_at: now }).eq("id", offerId).eq("status", "pending").select("id").maybeSingle();
  if (!won) return { tooSlow: true };
  await admin.from("partner_offers").update({ status: "withdrawn", superseded_at: now }).eq("job_id", o.job_id).eq("kind", o.kind).eq("status", "pending");
  const isRc = o.kind === "ready_check";
  const { data: w } = isRc ? await admin.from("ready_check_windows").select("starts_at, ends_at").eq("id", windowId).single() : await admin.from("appointment_proposals").select("starts_at, ends_at").eq("id", windowId).single();
  if (!w) throw new WorkflowError("That time is no longer available.");
  const role = isRc ? "installer" : "electrician";
  await admin.from("job_assignments").insert({ job_id: o.job_id, user_id: userId, business_id: c.biz.id, role, assigned_by: userId, booking_confirmed_at: now } as never);
  await admin.from("bookings").insert({ job_id: o.job_id, kind: isRc ? "ready_check" : "assessment", scheduled_start: w.starts_at, scheduled_end: w.ends_at, status: "confirmed", booked_by: userId, contractor_id: userId, business_id: c.biz.id, notes: "TEST booking (trade view)" } as never);
  await admin.from("jobs").update({ stage: isRc ? "ready_check_scheduled" : "piesa_scheduled" } as never).eq("id", o.job_id);
  await logEvent(o.job_id, userId, "booking_confirmed", `TEST: ${isRc ? "Ready Check" : "Pre Insulation Electrical Safety Assessment (PIESA)"} taken from the trade view`, { window_id: windowId }, { internal: true });
  // Same as a real booking: the Ready Check form is created (TEST jobs use the TEST Mitti assignee).
  if (isRc) await (await import("./mitti-create.server")).onReadyCheckBooked(o.job_id, userId).catch((e) => console.error("TEST Ready Check form not scheduled", (e as Error).message));
  return { tooSlow: false };
}

export { offerSuggestHours } from "./offer-dispatch.server";
import { offerSuggestHours } from "./offer-dispatch.server";

/** "Not for me" (decline) or "Can't make these" (tell the office, keep the offer open for others). */
export async function tradeOfferReply(offerId: string, userId: string, reply: "not_for_me" | "cant_make", note: string | null) {
  const c = await ctxOrThrow(userId);
  const { data: o } = await admin.from("partner_offers").select("id, job_id, business_id, kind, status, offered_at").eq("id", offerId).maybeSingle();
  if (!o || o.business_id !== c.biz.id) throw new WorkflowError("This offer isn't for your business.");
  if (o.status !== "pending") throw new WorkflowError(o.status === "withdrawn" ? "This job has been taken." : "This offer is no longer open.");
  if (reply === "cant_make") {
    if (o.kind === "ready_check") throw new WorkflowError("Offer the owner 3 Ready Check times that suit you, or say \"Not for me\".");
    const hours = await offerSuggestHours();
    if (!offerTiming(o.offered_at, hours).canSuggest) throw new WorkflowError(`You can suggest another time once the job has been out for ${hours} hours with no taker. For now, pick one of the owner's times or say "Not for me".`);
  }
  if (reply === "not_for_me") {
    if (o.kind === "ready_check") { const { respondToReadyCheckOffer } = await import("./readycheck-booking.server"); await respondToReadyCheckOffer(offerId, userId, false, note, null); return { ok: true }; }
    await admin.from("partner_offers").update({ status: "declined", responded_by: userId, responded_at: new Date().toISOString(), decline_reason: note }).eq("id", offerId).eq("status", "pending");
    await logEvent(o.job_id, userId, "partner_offer_declined", `${c.biz.name} passed on this job`, { reason: note, business_id: c.biz.id }, { internal: true });
    return { ok: true };
  }
  await logEvent(o.job_id, userId, "trade_cant_make_times", `Needs me: ${c.biz.name} can't make the owner's times${note ? ` — suggests: ${note}` : ""}`, { business_id: c.biz.id, note, needs_office: true }, { internal: true });
  return { ok: true };
}

// ---- Our-lead Ready Check times (Jo 24 Oct 2026, decision 52). Business-scoped; rules in ready-check-times.core. ----

/** Accept a Ready Check offer by offering the owner 3 times. */
export async function tradeOfferReadyCheckTimes(offerId: string, userId: string, picks: { day: string; time: string }[]) {
  const c = await ctxOrThrow(userId);
  const { data: o } = await admin.from("partner_offers").select("id, business_id, kind").eq("id", offerId).maybeSingle();
  if (!o || o.business_id !== c.biz.id) throw new WorkflowError("This offer isn't for your business.");
  if (o.kind !== "ready_check") throw new WorkflowError("This offer cannot be accepted here.");
  return (await import("./ready-check-times.server")).acceptOfferWithTimes(offerId, userId, picks);
}

/** The installer's side of the Ready Check times on an assigned job. */
export async function tradeReadyCheckTimes(jobId: string, userId: string, pre?: TradeJobAccess) {
  await requireTradeJob(userId, jobId, pre);
  return (await import("./ready-check-times.server")).installerReadyCheckState(jobId, userId);
}

export async function tradeReadyCheckOfferNew(jobId: string, userId: string, picks: { day: string; time: string }[]) {
  await requireTradeJob(userId, jobId);
  return (await import("./ready-check-times.server")).installerOfferNewTimes(jobId, userId, picks);
}

export async function tradeReadyCheckTakeDay(jobId: string, proposalId: string, time: string, userId: string) {
  await requireTradeJob(userId, jobId);
  return (await import("./ready-check-times.server")).installerTakeOwnerDay(jobId, proposalId, userId, time);
}

/** Decision 80: the installer changes a booked our-lead Ready Check to a new day + time. */
export async function tradeReadyCheckChange(jobId: string, pick: { day: string; time: string }, userId: string) {
  await requireTradeJob(userId, jobId);
  return (await import("./ready-check-times.server")).installerChangeReadyCheck(jobId, userId, pick);
}

/** Day page for any of the three visit kinds. */
/** A trade context that has already passed `requireTradeJob` for exactly this user and job (speed, decision 280: the job
 *  bundle checks once and hands the same answer to every section instead of re-deriving it eight times). */
export type TradeJobAccess = NonNullable<Awaited<ReturnType<typeof tradeContext>>> & { readonly checkedFor: { readonly userId: string; readonly jobId: string } };

/** The one server check for every trade job read: active assignment for this job AND this business (staff: assigned to them).
 *  `pre` is reused only when it was checked for the same user AND job; anything else runs the full check again. */
export async function requireTradeJob(userId: string, jobId: string, pre?: TradeJobAccess): Promise<TradeJobAccess> {
  if (pre && pre.checkedFor.userId === userId && pre.checkedFor.jobId === jobId) return pre;
  // Speed (installer screens, Task 6): the job's assignments need only the job id, so they are read alongside the sign-in
  // context — one round, not two. The sign-in refusal still wins (the context is awaited first).
  const asgP = early(admin.from("job_assignments").select("job_id, business_id, user_id, active").eq("job_id", jobId).eq("active", true));
  const c = await ctxOrThrow(userId);
  const { data } = await asgP;
  if (!tradeJobAllowed({ signedIn: true, userId, businessId: c.biz.id, boss: c.boss, jobId, assignments: (data ?? []) as AccessAssignment[] })) throw new WorkflowError("This job isn't assigned to you.");
  return { ...c, checkedFor: { userId, jobId } };
}

export async function tradeDay(jobId: string, userId: string) {
  const c = await requireTradeJob(userId, jobId);
  const kinds = c.kind === "installer" ? ["installation", "ready_check"] : ["assessment", "rectification"];
  // Speed (installer screens, Task 7): two rounds for the installer's day — (1) the one access check, (2) every read below in
  // one round trip (decision 280). The install form's Mitti id is read in that same round whenever it could be shown (an
  // installer business with "Mitti account invited"), and used only on an install day — two small read-only reads that a
  // Ready Check day drops. An electrician's fixes form still waits for the day kind (its own chain).
  const installFormP = c.kind === "installer" && c.biz.mitti_account_invited === true ? early(installFormFacts(jobId)) : null;
  const [{ data: bks }, { data: j }, { data: a }, { data: rc }, { data: cm }, { data: miss }, { data: fixes }, { data: mine }, { data: cgi }] = await Promise.all([
    admin.from("bookings").select("kind, scheduled_start, scheduled_end, status").eq("job_id", jobId).in("kind", kinds as never).neq("status", "cancelled").order("scheduled_start", { ascending: false }),
    admin.from("jobs").select("job_number, stage, channel, eligibility_outcome, owners(full_name, phone), properties(address_line, suburb, postcode)").eq("id", jobId).single(),
    admin.from("assessments").select("status, piesa_outcome, external_mitti_id").eq("job_id", jobId).maybeSingle(),
    admin.from("ready_checks").select("status, submitted_at, external_mitti_id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("ceiling_measurements").select("external_source, external_id").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("evidence_requirements").select("label, category, gate").eq("job_id", jobId).eq("required", true).in("status", ["outstanding", "rejected"]),
    admin.from("rectification_items").select("description").eq("job_id", jobId).neq("status", "cancelled"),
    admin.from("bookings").select("status").eq("job_id", jobId).eq("business_id", c.biz.id).in("kind", kinds as never),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "trade_couldnt_get_in").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const b = (bks ?? [])[0] ?? null;
  const dayKind: DayKind = b?.kind === "rectification" ? "fixes" : b?.kind === "installation" ? "install" : b?.kind === "ready_check" ? "ready_check" : "safety_check";
  const cgiD = cgi?.details as { reason?: string; visit?: string } | null;
  const cgiNow = couldntGetInDay({ stage: j?.stage ?? null, last: cgi ? cgiD : null });
  const historicalVisit = !cgiNow && c.kind === "installer" && historicalReadyCheckDay(j?.stage ?? null, b?.kind ?? null);
  const showContact = contactVisible(mine ?? []);
  const installMittiId = dayKind === "install" && c.biz.mitti_account_invited === true && installFormP ? (await installFormP).auditId : null;
  const fixesMittiId = dayKind === "fixes" && c.biz.mitti_account_invited === true ? (await (await import("./fixes-day.server")).fixesFormState(jobId)).auditId : null;
  const p = j?.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
  const ow = j?.owners as { full_name: string | null; phone: string | null } | null;
  let outcome: null | { kind: "all_clear" } | { kind: "fixes"; items: string[] } | { kind: "quoted" } | { kind: "not_eligible"; reason: string | null } | { kind: "wrap" } | { kind: "missing"; items: string[] } | { kind: "couldnt_get_in"; reason: string; visit: "ready_check" | "install" } = null;
  // Decision 214: after a report the booking is cancelled, so the day reads from the report itself, not a booking.
  if (cgiNow) outcome = { kind: "couldnt_get_in", ...cgiNow };
  else if (dayKind === "safety_check" && a?.status === "complete") outcome = a.piesa_outcome === "pass" ? { kind: "all_clear" } : { kind: "fixes", items: (fixes ?? []).map((f) => f.description) };
  else if (dayKind === "ready_check" && (rc?.status === "submitted" || j?.stage === "ready_check_complete" || j?.stage === "measured_estimate_ready" || j?.stage === "measured_quote_accepted")) outcome = j?.eligibility_outcome === "does_not_appear_eligible" ? { kind: "not_eligible", reason: "Existing insulation doesn't qualify for this rebate." } : { kind: "quoted" };
  else if (dayKind === "install" && ["evidence_outstanding", "ap_review", "ready_for_veec", "complete"].includes(j?.stage ?? "")) { const open = withoutRetiredInstallDayPhotos(miss ?? []); outcome = open.length ? { kind: "missing", items: open.map((m) => m.label) } : { kind: "wrap" }; }
  const shownKind = cgiNow ? (cgiNow.visit === "install" ? "install" : "ready_check") : dayKind;
  return {
    historicalVisit,
    kind: shownKind as "safety_check" | "ready_check" | "install" | "fixes", channel: j?.channel ?? null, jobNumber: j?.job_number ?? null, owner: showContact ? ow?.full_name ?? null : null, surname: showContact ? surname(ow?.full_name) : null, phone: showContact ? ow?.phone ?? null : null,
    address: showContact ? fullAddress(p?.address_line, p?.suburb, p?.postcode) : null, contactHidden: !showContact, start: b?.scheduled_start ?? null, end: b?.scheduled_end ?? null, outcome,
    // Mitti stays invisible to partners until the office ticks "Mitti account invited".
    mittiInvited: c.biz.mitti_account_invited === true,
    mittiId: c.biz.mitti_account_invited === true ? (dayKind === "ready_check" ? rc?.external_mitti_id ?? (cm?.external_source === "mitti" ? cm.external_id : null) : dayKind === "fixes" ? fixesMittiId : dayKind === "install" ? installMittiId : a?.external_mitti_id) ?? null : null,
  };
}

/** Ready Check "Couldn't get in?": office Needs me item; the re-offer goes back to this installer first. */
export async function tradeCouldntGetIn(jobId: string, reason: string, userId: string) {
  const c = await ctxOrThrow(userId);
  if (!(COULDNT_GET_IN as readonly string[]).includes(reason)) throw new WorkflowError("Pick one of the reasons.");
  const aq = admin.from("job_assignments").select("id").eq("job_id", jobId).eq("business_id", c.biz.id).eq("role", "installer").eq("active", true);
  const { data: asg } = await (c.boss ? aq : aq.eq("user_id", userId)).limit(1).maybeSingle();
  if (!asg) throw new WorkflowError("This job isn't assigned to you.");
  // Review E: only from a booked Ready Check whose visit is today or past (Melbourne date), via the central guarded transition.
  // Decision 214: the same on a booked install day — the booking is returned to "offer 3 install days" (changeInstallDay,
  // installDayTurn rules; 30-day window and payer per decision 158 untouched) and the office is alerted. Installer keeps the job.
  const [{ data: job }, { data: bk }, { data: ib }] = await Promise.all([
    admin.from("jobs").select("stage").eq("id", jobId).single(),
    admin.from("bookings").select("id, scheduled_start").eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
    admin.from("bookings").select("id, scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const { couldntGetInPlan } = await import("./trade-view.core");
  const plan = couldntGetInPlan({ stage: job?.stage ?? null, readyCheckStart: bk?.scheduled_start ?? null, installStart: ib?.scheduled_start ?? null, now: new Date() });
  if ("blocker" in plan) throw new WorkflowError(plan.blocker);
  if (plan.visit === "install") {
    // Decision 215: office alerted only on the SECOND no-access on this job; the owner is told at once (text + email).
    const { count: priorCount } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "trade_couldnt_get_in").contains("details", { visit: "install" });
    const { installNoAccessAlertsOffice } = await import("./install-no-access-notice.core");
    const alertOffice = installNoAccessAlertsOffice(priorCount ?? 0);
    const { changeInstallDay } = await import("./install-days.server");
    await changeInstallDay(jobId, userId, "installer", { couldntGetIn: reason });
    await logEvent(jobId, userId, "trade_couldnt_get_in", `${alertOffice ? "Needs me: second time the " : "The "}installer couldn't get in on the install day (${reason}). ${c.biz.name} offers the owner 3 new days inside the 30-day window.`, { reason, visit: "install", business_id: c.biz.id, booking_id: ib!.id, needs_office: alertOffice, prior_install_no_access: priorCount ?? 0 }, { internal: true });
    const notice = await (await import("./install-no-access-notice.server")).sendInstallNoAccessNotice({ jobId, bookingId: ib!.id, wasStart: ib!.scheduled_start, reason }).catch((e: Error) => `notice failed — ${e.message}`);
    return { ok: true, visit: "install" as const, notice };
  }
  const { transition } = await import("./workflow.server");
  await transition(jobId, "ready_check_ready_to_schedule", userId, `Installer couldn't get in (${reason})`, { reason, business_id: c.biz.id }, { nextAction: `Installer offers the owner new Ready Check times (${reason}).` });
  await admin.from("bookings").update({ status: "cancelled" }).eq("id", bk!.id).eq("status", "confirmed");
  await logEvent(jobId, userId, "trade_couldnt_get_in", "Installer keeps the job and offers the owner new Ready Check times", { reason, visit: "ready_check", business_id: c.biz.id, reoffer_first_to: c.biz.id, needs_office: true }, { internal: true });
  return { ok: true, visit: "ready_check" as const };
}

/** Required acknowledgement before an installer starts a Ready Check on a Home Insulation Victoria customer. */
export async function confirmHivicReadyCheckPricing(jobId: string, userId: string) {
  await requireTradeJob(userId, jobId);
  const { data: job } = await admin.from("jobs").select("channel").eq("id", jobId).maybeSingle();
  if (!job || job.channel !== "hivic_sourced") throw new WorkflowError("This confirmation only applies to Home Insulation Victoria customers.");
  const { data: booking } = await admin.from("bookings").select("id").eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed").limit(1).maybeSingle();
  if (!booking) throw new WorkflowError("A confirmed Ready Check is required.");
  const { HIVIC_READY_CHECK_PRICING_TICK } = await import("./owner-confirm.core");
  await logEvent(jobId, userId, "installer_hivic_pricing_acknowledged", "Installer confirmed Home Insulation Victoria controls all owner pricing discussions", { wording: HIVIC_READY_CHECK_PRICING_TICK, booking_id: booking.id, confirmed_at: new Date().toISOString() }, { internal: true });
  return { ok: true };
}

/** Money rows: own pay only. Paid = office marked paid; Coming = installers 7 days after AP approval (decisions 30/109/344),
 *  electricians within 7 days of the office approving the completed Mitti form (decision 410; never waits for the owner); else Being checked. */
async function tradeMoneyRows(bizId: string, kind: TradeKind, testOnly: boolean) {
  const mine = kind === "installer" ? ["ready_check", "installation"] : ["assessment", "rectification"];
  // Night run 25 Oct 2026: the safety check booking stays "confirmed" after the PIESA (only the fixes / install visits are
  // marked completed), so the electrician's Money showed the Fixes row only. A confirmed safety check counts as done once
  // the job's PIESA (A3) Mitti form is Complete (`assessments.mitti_completed`, the same fact the payout gate reads).
  // Speed (installer screens, Task 5): two rounds of reads instead of up to a dozen in a row — (1) own visits, their
  // safety checks, the display payer and (electricians) the PIESA rate; (2) everything that needs the job ids. The
  // PIESA form fact comes embedded in the visit rows. Module loads are cached after the first request (no database round).
  const sel = "id, job_id, kind, scheduled_start, status, business_id, businesses(name, trading_name), jobs!inner(deleted_at, job_number, source, channel, stage, electrician_choice, originating_installer_business_id, owners(full_name), properties(suburb), assessments!assessments_job_id_fkey(mitti_completed))";
  const [{ readInstallerPaidElectricians, safetyCheckPayeesFor }, { electricalBillingSource }, { payoutGateFacts, safetyVisitFacts }, { tradePayoutBlockers, safetyVisitPaidAt, visitGateFacts }, { ownerPaidInFullAt }] = await Promise.all([
    import("./installer-paid-electricians.server"), import("./installer-led.core"), import("./trade-payout-gate.server"), import("./trade-payout-gate.core"), import("./trade-view.core"),
  ]);
  type Book = { id: string; job_id: string; kind: string; scheduled_start: string; status: string; business_id: string | null; businesses: unknown; jobs: unknown };
  // A confirmed safety check counts as done once the job's A3 form is Complete (`assessments.mitti_completed`).
  const formComplete = (b: Book) => { const a = (b.jobs as { assessments?: { mitti_completed: boolean | null } | { mitti_completed: boolean | null }[] | null } | null)?.assessments; return Array.isArray(a) ? a.some((x) => x?.mitti_completed === true) : a?.mitti_completed === true; };
  const doneOf = (books: Book[]) => {
    const safetyDone = new Set(books.filter((b) => b.status === "confirmed" && b.kind === "assessment" && formComplete(b)).map((b) => b.job_id));
    return books.filter((b) => b.status === "completed" || (b.kind === "assessment" && safetyDone.has(b.job_id)));
  };
  const checkJobsOf = (done: Book[]) => [...new Map(done.filter((b) => b.kind === "assessment").map((b) => [b.job_id, { id: b.job_id, originating_installer_business_id: (b.jobs as { originating_installer_business_id?: string | null }).originating_installer_business_id ?? null }])).values()];
  // Jo 26 Oct 2026: an installer that pays its own electricians (Reinsulate) is paid for the safety checks they did.
  const displayP = kind === "installer" ? readInstallerPaidElectricians(bizId).catch((error: unknown) => {
    console.error("In-house partner display read failed", error);
    return null;
  }) : Promise.resolve(null);
  // Those safety checks are read now and kept only when the display payer allows them (as before; a read error = none).
  const theirP: PromiseLike<{ data: Book[] | null }> = kind === "installer"
    ? admin.from("bookings").select(sel).is("jobs.deleted_at", null).eq("jobs.originating_installer_business_id", bizId).eq("kind", "assessment").in("status", ["completed", "confirmed"]).order("scheduled_start", { ascending: false }) as unknown as PromiseLike<{ data: Book[] | null }>
    : Promise.resolve({ data: [] });
  // An installer's safety-check payees come only from those checks, so their read starts as soon as the checks are in.
  const theirPayeesP = kind === "installer" ? Promise.resolve(theirP).then(({ data }) => safetyCheckPayeesFor(checkJobsOf(doneOf(data ?? [])))) : null;
  theirPayeesP?.catch(() => undefined); // used (with its logged catch) only when those checks are kept
  const [{ data: ownBooks }, displayPayer, { data: theirAll }, { data: piesaRates }] = await Promise.all([
    admin.from("bookings").select(sel).is("jobs.deleted_at", null).eq("business_id", bizId).in("status", kind === "electrician" ? ["completed", "confirmed"] : ["completed"]).in("kind", mine as never).order("scheduled_start", { ascending: false }) as unknown as PromiseLike<{ data: Book[] | null }>,
    displayP,
    theirP,
    kind === "electrician" ? admin.from("electrician_rates").select("rate_inc_gst, effective_from").eq("business_id", bizId).eq("service_type", "piesa").in("status", ["active", "approved"]).order("effective_from", { ascending: false }).limit(1) : Promise.resolve({ data: [] as { rate_inc_gst: number | string | null }[] }),
  ]);
  const keepTheirs = !!displayPayer && !displayPayer.release_hold_reason;
  const books = [...(ownBooks ?? []), ...(keepTheirs ? theirAll ?? [] : [])];
  const done = doneOf(books);
  const checkJobs = checkJobsOf(done);
  // One safety check row per job (a completed and a confirmed booking for the same job are one payout).
  const seenSafety = new Set<string>();
  const rows = done.filter((b) => b.kind !== "ready_check" && (!testOnly || (b.jobs as { source: string }).source === "qa_test") && (b.kind !== "assessment" || (seenSafety.has(b.job_id) ? false : (seenSafety.add(b.job_id), true))));
  const ids = [...new Set(rows.map((r) => r.job_id))];
  const none = ["00000000-0000-0000-0000-000000000000"];
  // Speed (decision 280): every follow-up read depends only on the job ids — one round trip.
  const [payees, { data: paid }, { data: ap }, { data: offers }, { data: invs }, { data: accQ }, gate, safety, ep] = await Promise.all([
    (keepTheirs && theirPayeesP ? theirPayeesP : safetyCheckPayeesFor(checkJobs)).catch((error: unknown) => {
      console.error("In-house safety-check display read failed", error);
      return new Map<string, import("./installer-paid-electricians.core").InstallerPaidElectricians | null>();
    }),
    admin.from("workflow_events").select("job_id, created_at, details").eq("event_type", "payout_marked_paid").in("job_id", ids.length ? ids : none),
    admin.from("workflow_events").select("job_id, created_at").eq("event_type", "stage_changed").eq("to_stage", "ready_for_veec").in("job_id", ids.length ? ids : none),
    admin.from("partner_offers").select("job_id, kind, summary").eq("business_id", bizId).eq("status", "accepted").in("job_id", ids.length ? ids : none),
    // Owner paid in full (Xero mirror): needed alongside AP approval before the 7-day payout clock starts.
    admin.from("invoices").select("job_id, kind, status, balance_paid_at, paid_at, updated_at").in("job_id", ids.length ? ids : none).eq("kind", "installation"),
    // Committed contract snapshot: does the accepted HIV quote carry this electrical line?
    admin.from("quotes").select("job_id, kind, quote_items(code, description), quote_internals(cost_ex_gst)").in("job_id", ids.length ? ids : none).eq("status", "accepted"),
    // Decision 318: no complete Mitti form (with every geotagged photo/video), no payment — unpaid rows are held with reasons.
    payoutGateFacts(ids),
    // Batch 1 F5: a safety check is paid and gated per visit — the new electrician after a reopen never sees the earlier
    // visit's "Paid" or its completed form.
    rows.some((r) => r.kind === "assessment") ? safetyVisitFacts(ids) : Promise.resolve(new Map<string, never>()),
    // Decision 410 (Jo 27 Oct 2026): electricians — within 7 days of the office approving the completed Mitti form.
    kind === "electrician" || rows.some((r) => r.kind === "assessment") ? import("./electrician-pay.core") : Promise.resolve(null),
  ]);
  // Our leads: the install pay is the installer's agreed-rate cost on the accepted quote (inc GST) until the office records the payout.
  const ratePay = (jobId: string): number | null => {
    const q = (accQ ?? []).find((x) => x.job_id === jobId && x.kind === "installation");
    const qi = q?.quote_internals as { cost_ex_gst: number | string | null } | { cost_ex_gst: number | string | null }[] | null | undefined;
    const cost = Number((Array.isArray(qi) ? qi[0] : qi)?.cost_ex_gst);
    return Number.isFinite(cost) && cost > 0 ? Math.round(cost * 1.1 * 100) / 100 : null;
  };
  // Night run 25 Oct 2026: the electrician's amounts were empty when no offer summary carried them (e.g. the installer's
  // own customer, no PIESA offer; fixes never have an offer). Same sources as the office Payouts: the safety check = this
  // business's agreed PIESA rate (electrician_rates, inc GST); the fixes = the accepted fixes quote's electrician cost
  // (quote_internals.cost_ex_gst, shown inc GST like the installer's agreed-rate pay). Never the customer price.
  const piesaRate = (() => { const r = Number((piesaRates ?? [])[0]?.rate_inc_gst); return Number.isFinite(r) && r > 0 ? r : null; })();
  const fixesPay = (jobId: string): number | null => {
    const q = (accQ ?? []).find((x) => x.job_id === jobId && x.kind === "rectification");
    const qi = q?.quote_internals as { cost_ex_gst: number | string | null } | { cost_ex_gst: number | string | null }[] | null | undefined;
    const cost = Number((Array.isArray(qi) ? qi[0] : qi)?.cost_ex_gst);
    return Number.isFinite(cost) && cost > 0 ? Math.round(cost * 1.1 * 100) / 100 : null;
  };
  const committed = (jobId: string, kind: string): boolean | null => {
    const qs = (accQ ?? []).filter((q) => q.job_id === jobId); if (!qs.length) return null;
    const items = qs.flatMap((q) => [...((q.quote_items as { code: string | null; description: string | null }[] | null) ?? []).map((i) => ({ ...i, qk: q.kind }))]);
    return kind === "assessment" ? items.some((i) => i.code === "PIESA") : items.some((i) => i.qk === "rectification" || (i.description ?? "").startsWith("Electrical rectification:"));
  };
  const paidInFull = (jobId: string) => ownerPaidInFullAt((invs ?? []).filter((x) => x.job_id === jobId));
  return rows.map((b) => {
    const j = b.jobs as { job_number: string; owners: { full_name: string | null } | null; properties: { suburb: string | null } | null };
    const visitPaidAt = b.kind === "assessment" ? safetyVisitPaidAt((paid ?? []).filter((p) => p.job_id === b.job_id) as { created_at: string; details: { kind?: string; booking_id?: string } | null }[], safety.get(b.job_id), b.id) : null;
    const pe = b.kind === "assessment"
      ? (paid ?? []).find((p) => p.job_id === b.job_id && p.created_at === visitPaidAt && (p.details as { kind?: string })?.kind === "assessment")
      : (paid ?? []).find((p) => p.job_id === b.job_id && ((p.details as { kind?: string })?.kind ?? b.kind) === b.kind);
    const of = (offers ?? []).find((o) => o.job_id === b.job_id && (o.kind === "piesa" ? "assessment" : o.kind === "installer" ? "installation" : o.kind) === b.kind);
    const sum = (of?.summary ?? {}) as { electrician_rate_inc_gst?: number; installer_pay_inc_gst?: number; fixes_pay_inc_gst?: number };
    const payee = b.kind === "assessment" ? payees.get(b.job_id) ?? null : null;
    const amount = payee ? payee.piesaIncGst : Number((pe?.details as { amount?: number })?.amount ?? (b.kind === "assessment" ? sum.electrician_rate_inc_gst ?? piesaRate : b.kind === "rectification" ? sum.fixes_pay_inc_gst ?? fixesPay(b.job_id) : sum.installer_pay_inc_gst ?? ((b.jobs as { channel?: string }).channel === "hivic_sourced" ? ratePay(b.job_id) : null)) ?? 0) || null;
    const gf0 = gate.get(b.job_id);
    const gf = gf0 && b.kind === "assessment" ? visitGateFacts(gf0, safety.get(b.job_id), b.id) : gf0;
    const elecKind = b.kind === "assessment" || b.kind === "rectification" ? b.kind : null;
    const et = ep && elecKind ? ep.electricianPayTiming(elecKind, gf) : null;
    const timed: PayState = et
      ? electricianPayState({ paidAt: pe?.created_at ?? null, approvedAt: et.approvedAt })
      : payState({ paidAt: pe?.created_at ?? null, apApprovedAt: (ap ?? []).find((x) => x.job_id === b.job_id)?.created_at ?? null, installerSupplied: (b.jobs as { channel?: string }).channel === "installer_sourced", ownerPaidInFullAt: paidInFull(b.job_id) });
    // Decision 318 form blockers, plus the decision-410 waiting-for-office-approve line (electricians) and the audit-F19
    // AP/owner-payment wait (installers) — the same reasons the office Payouts tab and Mark paid show.
    const held = timed.kind === "paid" || !gf ? [] : [...tradePayoutBlockers(b.kind as "assessment" | "rectification" | "installation", gf), ...(et?.waiting ?? []), ...(b.kind === "installation" && timed.kind === "checking" ? installerPayHeldReasons({ installerSupplied: (b.jobs as { channel?: string }).channel === "installer_sourced", apApprovedAt: (ap ?? []).find((x) => x.job_id === b.job_id)?.created_at ?? null, ownerPaidInFullAt: paidInFull(b.job_id) }) : [])];
    // A held payout is never "Coming": it stays with the jobs being checked until the form is fixed (amounts unchanged).
    const state: PayState = held.length ? { kind: "checking" } : timed;
    const approvedAt = (ap ?? []).find((x) => x.job_id === b.job_id)?.created_at ?? null;
    const jj = b.jobs as { channel?: string | null; electrician_choice?: string | null };
    // A kind-less payout event is the job/installer payout; only an explicit electrical-kind event proves an HIV electrical payment.
    const explicitPaid = pe && (pe.details as { kind?: string })?.kind === b.kind ? pe.created_at : null;
    // The installer's own electrician is paid by the installer: that row belongs on the installer's Money, not theirs.
    const billing = payee ? (payee.businessId === bizId ? "hivic" as const : "installer_paid" as const)
      : b.kind === "assessment" || b.kind === "rectification"
      ? electricalBillingSource({ channel: jj.channel ?? null, choice: jj.electrician_choice ?? null, committedLineOnAcceptedQuote: committed(b.job_id, b.kind), hivPaidAt: explicitPaid })
      : "hivic" as const;
    const biz = b.businesses as { name: string | null; trading_name: string | null } | null;
    const what = payee && payee.businessId === bizId ? `Safety check by ${biz?.trading_name || biz?.name || "your electrician"}` : VISIT[b.kind] ?? "Job";
    return { billing, jobId: b.job_id, jobNumber: j.job_number, surname: surname(j.owners?.full_name), suburb: j.properties?.suburb ?? null, what, kind: b.kind, amount, state, held, doneAt: b.scheduled_start, approvedAt, channel: jj.channel ?? null };
  });
}

/** Decision 244 reply drafter: one business's own pay STATES (no amounts) for an email reply to that business.
 *  Server-only, business-scoped by the caller (sender address = the business's own email). Read-only. */
export async function partnerPayStates(bizId: string, kind: TradeKind, testOnly: boolean): Promise<{ jobNumber: string; what: string; state: import("./trade-view.core").PayState; channel: string | null }[]> {
  return (await tradeMoneyRows(bizId, kind, testOnly)).filter((r) => r.billing === "hivic").map((r) => ({ jobNumber: r.jobNumber, what: r.what, state: r.state, channel: r.channel }));
}

export async function tradeMoney(userId: string) {
  const c = await ctxOrThrow(userId);
  if (!c.boss) throw new WorkflowError("Money is only shown to the business owner.");
  const all = await tradeMoneyRows(c.biz.id, c.kind, c.isTest);
  // Owner-direct electrical work is invoiced to the owner by the electrician: never an HIV payout, never in our totals.
  const rows = all.filter((r) => r.billing === "hivic");
  const ownerDirect = all.filter((r) => r.billing === "owner_direct").map((r) => ({ jobId: r.jobId, jobNumber: r.jobNumber, surname: r.surname, suburb: r.suburb, what: r.what, doneAt: r.doneAt }));
  // Jo 26 Oct 2026: safety checks done for an installer that pays its own electricians — paid by that installer, not us.
  const paidByInstaller = all.filter((r) => r.billing === "installer_paid").map((r) => ({ jobId: r.jobId, jobNumber: r.jobNumber, surname: r.surname, suburb: r.suburb, what: r.what, doneAt: r.doneAt }));
  const now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const coming = rows.filter((r) => r.state.kind === "coming");
  const next = coming.map((r) => (r.state as { on: string }).on).sort()[0] ?? null;
  const nextRows = next ? coming.filter((r) => (r.state as { on: string }).on.slice(0, 10) === next.slice(0, 10)) : [];
  const sum = (xs: typeof rows) => xs.reduce((t, r) => t + (r.amount ?? 0), 0);
  // Only the last 4 digits of the saved account: enough to recognise it, never the full number.
  const { data: bank } = await admin.from("business_bank_details").select("account_number").eq("business_id", c.biz.id).maybeSingle();
  return { kind: c.kind, boss: c.boss, business: c.biz.name, bankEnding: accountEnding(bank?.account_number), next: next ? { on: next, total: sum(nextRows), jobs: nextRows.length } : null, month: sum(rows.filter((r) => r.doneAt && new Date(r.doneAt) >= m0)), allTime: sum(rows), rows, ownerDirect, paidByInstaller };
}

/**
 * My business (approved mock-up M7, decision 204). Business-scoped: every row is the signed-in owner's own business.
 * Team facts per person: mobile (staff row), Mitti login (the stored Mitti user link on their profile, decision 161 —
 * never a live claim), ESC privacy notice (decision 130), CII clearance facts for `crewClearance` (decision 153).
 * Business file: usual electrician (config events, decisions 157/173), details, rates agreed date, masked bank line,
 * insurance expiries, agreement, notice summary. The NEXT panel is derived by pure `businessNext`. Never quotes,
 * prices or other partners.
 */
/** The team rows with `declarations_due`. Until 0230 is live the column is missing: re-read without it (nobody is due). */
async function loadTeamWorkers(businessId: string): Promise<{ data: { id: string; full_legal_name: string; trade_role: string; profile_id: string | null; email: string | null; mobile: string | null; certification: unknown; worker_role?: string | null; declarations_due?: boolean; licence_expires_on: string | null }[] | null; error?: { code?: string } | null }> {
  const load = (cols: string) => (admin as unknown as { from: (t: string) => any }).from("partner_workers").select(cols).eq("business_id", businessId).is("removed_at", null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const base = "id, full_legal_name, trade_role, approval_status, licence_expires_on, profile_id, email, mobile, certification_status, certification, worker_role";
  const first = await load(`${base}, declarations_due`);
  if (first.error && (await import("./schema-compat.core")).isMissingDbObject(first.error)) return await load(base);
  return first;
}

export async function tradeBusiness(userId: string) {
  const c = await ctxOrThrow(userId);
  const today = melbourneToday();
  // Staff logins get only the business name and job-taking status: no rates, bank, agreement, insurance or team.
  const staffOnly = { kind: c.kind, boss: false as boolean, name: c.biz.name, taking: c.biz.accepting_new_jobs !== false, approvedSince: null as string | null, area: null as string | null, licenceExpires: null as string | null, liabilityExpires: null as string | null, rate: null as number | null, agreementSigned: false, bankSaved: false,
    team: [] as TeamMemberView[], next: null as BusinessNext, usualElectrician: null as UsualElectrician | null, details: null as null | { legal: string | null; name: string; abn: string | null; baseSuburb: string | null; allVictoria: boolean }, ratesAgreedAt: null as string | null, hasRates: false, bankLine: null as string | null, credentials: [] as CredentialView[], agreement: null as null | { version: string; signer: string; signedAt: string }, notice: [] as { name: string; state: string }[] };
  if (!c.boss) return staffOnly;
  const r = admin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [{ data: creds, error: credsError }, { data: workers, error: workersError }, { data: rate }, { data: agr }, { data: bank }, { data: biz }, { data: cards }, { data: members }] = await Promise.all([
    admin.from("business_credentials").select("kind, label, expires_at, verification").eq("business_id", c.biz.id),
    loadTeamWorkers(c.biz.id),
    c.kind === "electrician" ? r.from("electrician_rates").select("rate_inc_gst").eq("business_id", c.biz.id).eq("service_type", "piesa").eq("status", "active").maybeSingle() : Promise.resolve({ data: null }),
    admin.from("partner_agreements").select("version, signer_name, signed_at").eq("business_id", c.biz.id).order("signed_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("business_bank_details").select("account_name, bsb, account_number").eq("business_id", c.biz.id).limit(1).maybeSingle(),
    admin.from("businesses").select("legal_name, trading_name, abn, approved_at").eq("id", c.biz.id).maybeSingle(),
    admin.from("rate_cards").select("effective_from, created_at").eq("business_id", c.biz.id).eq("is_active", true),
    admin.from("business_members").select("user_id, member_role").eq("business_id", c.biz.id).eq("active", true),
  ]);
  const ownerIds = (members ?? []).filter((m) => m.member_role === "business_admin").map((m) => m.user_id);
  const profileIds = [...new Set([...ownerIds, ...(workers ?? []).map((w) => w.profile_id).filter((x): x is string => !!x)])];
  const { data: profs } = profileIds.length ? await admin.from("profiles").select("id, full_name, phone, email, mitti_user_id, mitti_checked_email, mitti_checked_at").in("id", profileIds) : { data: [] as never[] };
  const profile = (id: string | null | undefined) => (profs ?? []).find((p) => p.id === id) ?? null;
  const { mittiAccessOf } = await import("./mitti-membership.core");
  const mittiLogin = (id: string | null | undefined): MittiLogin => { const p = profile(id); if (!p) return "not_set"; const a = mittiAccessOf(p as never); return a === "member" ? "linked" : a === "email_changed" ? "email_changed" : "not_set"; };
  // CII clearance facts (decision 153) and privacy notice acknowledgements (decision 130) for installer staff rows.
  const staffRows = (workers ?? []) as { id: string; full_legal_name: string; trade_role: string; profile_id: string | null; email: string | null; mobile: string | null; certification: unknown; worker_role?: string | null; declarations_due?: boolean }[];
  // Decision 319: each installer person's White Card (office-verified once).
  const { whiteCardState } = await import("./worker-compliance.core");
  const whiteCardOfRow = (w: { trade_role: string; certification: unknown }) => w.trade_role === "installer" ? whiteCardState(w) : null;
  const [cii, notice] = c.kind === "installer" || staffRows.some((w) => w.trade_role === "installer")
    ? await Promise.all([
      (await import("./piisa-a3.server")).crewStaff(c.biz.id).catch(() => [] as { workerId: string; eecVerified: boolean; clearanceReason?: string | null; level?: string | null; expiresOn?: string | null }[]),
      (await import("./esc-collection-notice.server")).businessNoticeStatuses(c.biz.id).catch(() => [] as { workerId: string | null; name: string; state: string }[]),
    ])
    : [[], []];
  const ciiFacts = (workerId: string, role: string): TeamMemberView["cii"] => {
    if (role !== "installer") return null;
    const s = cii.find((x) => x.workerId === workerId);
    if (!s) return { certStatus: null, level: null, expiresOn: null };
    return { certStatus: s.eecVerified ? "verified" : s.clearanceReason === CREW_CLEARANCE_REASON.withdrawn ? "rejected" : null, level: s.level ?? null, expiresOn: s.expiresOn ?? null };
  };
  const noticeOf = (workerId: string, role: string) => role !== "installer" ? null : notice.find((n) => n.workerId === workerId)?.state === "acknowledged";
  // Jo 28 Oct: Lead / Crew per installer staff row (null = not applicable).
  const roles = await (await import("./mitti-invite.server")).workerRolesFor(staffRows);
  // Office Mitti records (linked, invited, reactivated, marked done) per worker: Crew show "Mitti ✓" once the office has added them.
  const mittiRecordedIds = new Set<string>();
  let mittiRecordsKnown = true;
  if (staffRows.length) {
    const { data: recs, error: recsError } = await admin.from("admin_config_events").select("details").in("event_type", ["mitti_user_linked", "mitti_user_invited", "mitti_invite_linked", "mitti_user_reactivated", "mitti_invite_office_done"]).in("details->>worker_id", staffRows.map((w) => w.id));
    if (recsError) { mittiRecordsKnown = false; console.error("tradeBusiness: Mitti records could not be read", recsError.code ?? "unknown"); }
    for (const e of recs ?? []) { const id = (e.details as { worker_id?: unknown } | null)?.worker_id; if (typeof id === "string") mittiRecordedIds.add(id); }
  }
  const ownerEmails = new Set(ownerIds.map((id) => (profile(id)?.email ?? "").trim().toLowerCase()).filter(Boolean));
  const ownerRow = (uid: string) => staffRows.find((w) => w.profile_id === uid) ?? staffRows.find((w) => !!w.email && w.email.trim().toLowerCase() === (profile(uid)?.email ?? "").trim().toLowerCase()) ?? null;
  const team: TeamMemberView[] = [
    ...ownerIds.map((uid) => {
      const p = profile(uid), w = ownerRow(uid);
      return { id: w?.id ?? null, name: (p?.full_name ?? w?.full_legal_name ?? "Business owner").trim(), role: "owner" as const, mobile: w?.mobile ?? p?.phone ?? null, email: p?.email ?? w?.email ?? null, hasLogin: true,
        mittiLogin: mittiLogin(uid), mittiRecorded: !mittiRecordsKnown ? null : w ? mittiRecordedIds.has(w.id) : false, noticeAcknowledged: w ? noticeOf(w.id, w.trade_role) : null, cii: w ? ciiFacts(w.id, w.trade_role) : null, whiteCard: w ? whiteCardOfRow(w) : null, workerRole: w ? roles.get(w.id) ?? null : null, declarationsDue: w?.declarations_due === true };
    }),
    ...staffRows.filter((w) => !ownerIds.includes(w.profile_id ?? "") && !ownerEmails.has((w.email ?? "").trim().toLowerCase())).map((w) => ({
      id: w.id as string | null, name: w.full_legal_name.trim(), role: (w.trade_role === "installer" ? "installer" : "electrician") as TeamMemberView["role"], mobile: w.mobile ?? null, email: w.email, hasLogin: !!w.profile_id,
      mittiLogin: mittiLogin(w.profile_id), mittiRecorded: mittiRecordsKnown ? mittiRecordedIds.has(w.id) : null, noticeAcknowledged: noticeOf(w.id, w.trade_role), cii: ciiFacts(w.id, w.trade_role), whiteCard: whiteCardOfRow(w), workerRole: roles.get(w.id) ?? null, declarationsDue: w.declarations_due === true,
    })),
  ];
  const credentials: CredentialView[] = (creds ?? []).map((x) => ({ kind: x.kind, label: x.label, expires: x.expires_at, verified: x.verification === "verified" }));
  const liability = latestExpiry(credentials, "public_liability_insurance");
  const licence = c.kind === "electrician" ? (workers ?? []).map((w) => w.licence_expires_on).filter(Boolean).sort()[0] ?? null : null;
  const usual = c.kind === "installer" ? (await (await import("./usual-electrician.server")).readUsualElectrician(c.biz.id)).electrician : null;
  // Licence/cover warnings only from facts we actually read: any failed read leaves them unknown (no panel), never a false warning.
  let electrician: BusinessNextFacts["electrician"];
  if (c.kind === "electrician") {
    const [{ data: bz, error: bzError }, { data: act, error: actError }] = await Promise.all([
      admin.from("businesses").select("public_liability_cover_amount").eq("id", c.biz.id).maybeSingle(),
      admin.from("partner_activations").select("application_id").eq("business_id", c.biz.id).limit(1).maybeSingle(),
    ]);
    const { data: app, error: appError } = !actError && act?.application_id ? await admin.from("rec_onboarding_applications").select("data").eq("id", act.application_id).maybeSingle() : { data: null, error: null };
    const failed = [["credentials", credsError], ["workers", workersError], ["business", bzError], ["activation", actError], ["application", appError]].filter(([, e]) => e) as [string, { code?: string }][];
    for (const [what, e] of failed) console.error(`tradeBusiness: electrician ${what} could not be read`, e.code ?? "unknown");
    if (!failed.length) {
      const cover = bz?.public_liability_cover_amount;
      electrician = { licenceExpires: latestExpiry(credentials, "electrical_licence") ?? licence, plCover: cover == null ? null : Number(cover), worksUnderRec: (app?.data as { works_under_rec?: unknown } | null)?.works_under_rec === true };
    }
  }
  const hasRates = c.kind === "installer" ? (cards ?? []).length > 0 : !!rate;
  const ratesAgreedAt = (cards ?? []).map((k) => k.effective_from ?? k.created_at).filter(Boolean).sort().at(-1) ?? agr?.signed_at ?? null;
  const details = { legal: biz?.legal_name ?? null, name: biz?.trading_name ?? c.biz.name, abn: biz?.abn ?? null, baseSuburb: c.biz.base_suburb ?? null, allVictoria: c.biz.covers_all_victoria === true };
  const noticeStatuses = notice.map((n) => ({ name: n.name, state: n.state }));
  const next = businessNext({
    installer: c.kind === "installer", publicLiabilityExpires: liability, bankSaved: !!bank, agreementSigned: !!agr?.signed_at,
    noticeOutstanding: noticeStatuses.filter((n) => n.state !== "acknowledged").map((n) => ({ name: n.name })), usualElectrician: !!usual, ...(electrician ? { electrician } : {}),
    ciiBlocked: team.filter((m) => m.cii && !crewClearance(m.cii, today).cleared).map((m) => ({ name: m.name })),
  }, today);
  return {
    ...staffOnly, boss: true, approvedSince: biz?.approved_at ?? agr?.signed_at ?? null,
    area: c.biz.covers_all_victoria ? "Anywhere in Victoria" : `Up to ${c.biz.coverage_radius_km ?? "?"} km from ${c.biz.base_suburb ?? "your base"}`,
    licenceExpires: licence, liabilityExpires: liability, rate: rate ? Number((rate as { rate_inc_gst: number }).rate_inc_gst) : null,
    agreementSigned: !!agr?.signed_at, bankSaved: !!bank,
    team, next, usualElectrician: usual, details, ratesAgreedAt, hasRates, bankLine: bankLine(bank ?? null), credentials,
    agreement: agr ? { version: String(agr.version), signer: agr.signer_name, signedAt: agr.signed_at } : null, notice: noticeStatuses,
  };
}

export async function tradeSetTaking(userId: string, taking: boolean) {
  const c = await ctxOrThrow(userId);
  if (!c.boss) throw new WorkflowError("Only the business boss can change this.");
  await admin.from("businesses").update({ accepting_new_jobs: taking }).eq("id", c.biz.id);
  await admin.from("admin_config_events").insert({ actor_id: userId, event_type: "trade_taking_new_jobs", summary: `${c.biz.name}: ${taking ? "taking new jobs" : "paused new offers"}`, details: { business_id: c.biz.id, taking } });
  return { taking };
}

/** Quick setup: each tick is stored (append-only) so it follows the person across phones. */
export async function tradeSetup(userId: string) {
  const c = await ctxOrThrow(userId);
  const { data: ev } = await admin.from("admin_config_events").select("details, created_at").eq("event_type", "trade_setup_step").eq("actor_id", userId).order("created_at");
  const done: Partial<Record<SetupKey, boolean>> = {};
  for (const e of ev ?? []) { const d = e.details as { key?: SetupKey; done?: boolean }; if (d.key) done[d.key] = !!d.done; }
  const biz = await tradeBusiness(userId);
  if (biz.bankSaved) done.bank = done.bank ?? false;
  return { kind: c.kind, business: c.biz.name, firstName: c.firstName, boss: c.boss, mobile: c.profile?.phone ?? null, email: c.profile?.email ?? null, area: biz.area, rate: biz.rate, bankSaved: biz.bankSaved, done, steps: SETUP_STEPS.map((s) => s.key) };
}

export async function tradeSetupMark(userId: string, key: SetupKey, done: boolean) {
  const c = await ctxOrThrow(userId);
  await admin.from("admin_config_events").insert({ actor_id: userId, event_type: "trade_setup_step", summary: `${c.biz.name}: setup ${key} ${done ? "done" : "undone"}`, details: { key, done, business_id: c.biz.id } });
  return { ok: true };
}

/** My business sections (Jo, 7 Oct): read-only facts for the trade-style pages. Partners never edit details or rates here. */
export async function tradeBusinessFile(userId: string) {
  const c = await bossOrThrow(userId);
  const usual = c.kind === "installer" ? await (await import("./usual-electrician.server")).readUsualElectrician(c.biz.id) : null;
  const r = admin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [{ data: b }, { data: creds }, { data: agr }, { data: cards }, { data: erates }, { data: open }] = await Promise.all([
    admin.from("businesses").select("id, name, legal_name, trading_name, abn, phone, email, address, base_suburb, coverage_radius_km, covers_all_victoria, typical_days, lead_time, public_liability_cover_amount, onboarding_status").eq("id", c.biz.id).single(),
    admin.from("business_credentials").select("id, kind, label, number, issuer, expires_at, verification, document_path").eq("business_id", c.biz.id).order("created_at", { ascending: false }),
    admin.from("partner_agreements").select("version, signer_name, signed_at").eq("business_id", c.biz.id).order("signed_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("rate_cards").select("name, version, effective_from, rate_card_items(description, unit, display_unit, unit_price_ex_gst, sort)").eq("business_id", c.biz.id).eq("is_active", true),
    c.kind === "electrician" ? r.from("electrician_rates").select("service_type, rate_inc_gst").eq("business_id", c.biz.id).eq("status", "active") : Promise.resolve({ data: [] }),
    r.from("partner_change_requests").select("kind, message, created_at").eq("business_id", c.biz.id).eq("status", "open").order("created_at", { ascending: false }),
  ]);
  if (!b) throw new WorkflowError("Business not found.");
  const cents = (n: number) => Math.round(n * 100) / 100; // display of stored ex-GST rate; avoids 29.99 for 30.00
  const rates = [
    ...((cards ?? []) as { rate_card_items: { description: string; unit: string; display_unit: string | null; unit_price_ex_gst: number; sort: number | null }[] }[])
      .flatMap((cd) => [...cd.rate_card_items].sort((a, z) => (a.sort ?? 0) - (z.sort ?? 0)).map((i) => ({ label: i.description, unit: i.display_unit ?? i.unit, inc_gst: cents(Number(i.unit_price_ex_gst) * 1.1) }))),
    ...((erates ?? []) as { service_type: string; rate_inc_gst: number }[]).map((e) => ({ label: e.service_type === "piesa" ? "Pre Insulation Electrical Safety Assessment (PIESA)" : e.service_type.replace(/_/g, " "), unit: "each", inc_gst: Number(e.rate_inc_gst) })),
  ];
  return {
    businessId: b.id, kind: c.kind, boss: c.boss, usualElectrician: usual?.electrician ?? null,
    details: { name: b.trading_name ?? b.name, legal: b.legal_name, abn: b.abn, phone: b.phone, email: b.email, address: b.address,
      area: b.covers_all_victoria ? "Anywhere in Victoria" : `Up to ${b.coverage_radius_km ?? "?"} km from ${b.base_suburb ?? "your base"}`,
      days: (b.typical_days ?? []).join(", ") || null, leadTime: b.lead_time, liabilityCover: b.public_liability_cover_amount },
    credentials: (creds ?? []).map((x) => ({ id: x.id, label: x.label, expires: x.expires_at, verified: x.verification === "verified", hasFile: !!x.document_path, path: x.document_path })),
    agreement: agr ? { version: agr.version, signer: agr.signer_name, signedAt: agr.signed_at } : null,
    rates, openRequests: (open ?? []) as { kind: string; message: string; created_at: string }[],
    // Rates agreed date: the active rate card's effective date (installer), else the signed agreement date.
    ratesAgreedAt: ((cards ?? []) as { effective_from?: string | null }[]).map((k) => k.effective_from).filter((x): x is string => !!x).sort().at(-1) ?? agr?.signed_at ?? null,
  };
}

export async function tradeAgreementPdf(userId: string) {
  const c = await bossOrThrow(userId);
  const { data: a } = await admin.from("partner_agreements").select("version, body, signer_name, signed_at").eq("business_id", c.biz.id).order("signed_at", { ascending: false }).limit(1).maybeSingle();
  if (!a) throw new WorkflowError("There's no signed agreement on file yet.");
  const { textToPdf } = await import("./signed-pdf.server");
  const signed = new Date(a.signed_at).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" });
  const bytes = await textToPdf(`Home Insulation Victoria partner agreement v${a.version} - ${c.biz.name}`, `${a.body}\n\nSigned by ${a.signer_name} on ${signed} (Melbourne time).`);
  return { fileName: `agreement-v${a.version}.pdf`, base64: toB64(bytes) };
}

/** Jo 22 Oct: this nomination alone is editable; legal details, rate cards and approvals are unchanged. */
export async function tradeSaveUsualElectrician(userId: string, value: unknown) {
  const c = await bossOrThrow(userId);
  if (c.kind !== "installer") throw new WorkflowError("Only installer businesses can save a usual electrician.");
  const { usualElectrician, USUAL_ELECTRICIAN_EVENT } = await import("./usual-electrician.core");
  const electrician = usualElectrician(value);
  if (!electrician) throw new WorkflowError("Enter the electrician name and licence number.");
  const { error } = await admin.from("admin_config_events").insert({ actor_id: userId, event_type: USUAL_ELECTRICIAN_EVENT,
    summary: "Installer saved usual electrician", details: { business_id: c.biz.id, electrician } });
  if (error) throw new WorkflowError("Could not save your usual electrician.");
  return { electrician };
}

function toB64(u: Uint8Array): string {
  let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function tradeChangeRequest(userId: string, kind: "details" | "rates" | "area" | "other", message: string) {
  const c = await ctxOrThrow(userId);
  if (!c.boss) throw new WorkflowError("Only the business boss can ask for changes.");
  const r = admin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { error } = await r.from("partner_change_requests").insert({ business_id: c.biz.id, kind, message: message.trim(), requested_by: userId });
  if (error) throw new WorkflowError(`Couldn't send your request: ${error.message}`);
  await admin.from("admin_config_events").insert({ actor_id: userId, event_type: "partner_change_requested", summary: `${c.biz.name} asked to change ${kind}`, details: { business_id: c.biz.id, kind } });
  return { ok: true };
}

/** TEST partners only: re-issue the caller's own set-password link through the same path the office uses, for walkthroughs. Sends nothing. */
export async function tradeTestSetPasswordLink(userId: string, base: string) {
  const c = await ctxOrThrow(userId);
  if (!c.isTest) throw new WorkflowError("Only for TEST partners.");
  const allowed = ["http://localhost:8080", "https://id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app"];
  if (!allowed.includes(base)) throw new WorkflowError("Not an allowed preview address.");
  const email = c.profile?.email;
  if (!email) throw new WorkflowError("No email on this sign-in.");
  const { issueSetPasswordLink } = await import("./set-password-link.server");
  await admin.from("admin_config_events").insert({ actor_id: userId, event_type: "test_partner_set_password_link", summary: `TEST partner set-password link issued (nothing sent)`, details: { business_id: c.biz.id } });
  return { link: await issueSetPasswordLink(email, base) };
}

/** Boss taps "Send login invite" for a team member already listed at onboarding. Office sends it (sending stays office-controlled); nothing is sent here. */
export async function tradeRequestLoginInvite(userId: string, workerId: string) {
  const c = await ctxOrThrow(userId);
  if (!c.boss) throw new WorkflowError("Only the business boss can invite the team.");
  const { data: w } = await admin.from("partner_workers").select("id, full_legal_name, business_id, profile_id").eq("id", workerId).is("removed_at", null).maybeSingle();
  if (!w || w.business_id !== c.biz.id) throw new WorkflowError("Team member not found.");
  if (w.profile_id) return { ok: true, already: true };
  return { ...(await tradeChangeRequest(userId, "other", `Please send a login invite to ${w.full_legal_name} (team member ${w.id}).`)), already: false };
}

/** Decision 377: the business owner saves a team member's mobile once on My business (partner_workers.mobile, +61
 *  format; empty clears it). Their own safety plan sign link is texted there. Business-scoped, owner only. */
export async function tradeSetWorkerMobile(userId: string, workerId: string, raw: string) {
  const c = await bossOrThrow(userId);
  const { crewMobileInput } = await import("./swms-sign-text.core");
  const v = crewMobileInput(raw);
  if (!v.ok) throw new WorkflowError(v.error);
  const { data: w } = await admin.from("partner_workers").select("id, business_id, mobile").eq("id", workerId).is("removed_at", null).maybeSingle();
  if (!w || w.business_id !== c.biz.id) throw new WorkflowError("Team member not found.");
  if ((w.mobile ?? null) === v.mobile) return { ok: true, mobile: v.mobile };
  const { error } = await admin.from("partner_workers").update({ mobile: v.mobile }).eq("id", w.id).eq("business_id", c.biz.id);
  if (error) throw new WorkflowError("The mobile couldn't be saved. Try again.");
  return { ok: true, mobile: v.mobile };
}

/** Jo 29 Oct: the boss adds a person with no email needed (mobile can come later). Installers start as Lead or Crew with
 *  the CII certificate unchecked; electricians need a licence number. Always pending, and they must sign the worker
 *  declarations (declarations_due) before any job. Sends nothing. */
export async function tradeAddTeamPerson(userId: string, p: { name: string; workerRole: import("./worker-role.core").WorkerRole; mobile: string | null; email: string | null; licenceNumber: string | null }): Promise<{ workerId: string }> {
  const c = await bossOrThrow(userId);
  const name = p.name.trim();
  if (!name) throw new WorkflowError("Add their full name.");
  const licence = p.licenceNumber?.trim() || null;
  if (c.kind === "electrician" && !licence) throw new WorkflowError("Add their electrical licence number.");
  const { crewMobileInput } = await import("./swms-sign-text.core");
  const v = crewMobileInput(p.mobile);
  if (!v.ok) throw new WorkflowError(v.error);
  const email = p.email?.trim().toLowerCase() || null;
  const { installerQualification } = await import("./partner-activation.core");
  const row = c.kind === "installer"
    ? { trade_role: c.kind, qualification: installerQualification({}), certification_status: "unverified", worker_role: p.workerRole, licence_number: null }
    : { trade_role: c.kind, licence_number: licence, worker_role: null };
  const { data, error } = await admin.from("partner_workers").insert({ business_id: c.biz.id, full_legal_name: name, email, mobile: v.mobile, ...row, approval_status: "pending", declarations_due: true, added_by: userId } as never).select("id").single();
  if (error) {
    const needsDbUpdate = "Adding someone without an email needs the office's database update first.";
    if (error.code === "23502") throw new WorkflowError(needsDbUpdate);
    // Before 0230 (declarations_due) is live: same plain message, no retry without the column.
    if (error.code === "PGRST204" || (await import("./schema-compat.core")).isMissingDbObject(error)) throw new WorkflowError(needsDbUpdate);
    if (error.code === "23505") throw new WorkflowError("Someone with that email is already on your team.");
    throw new WorkflowError("Couldn't add them. Please try again.");
  }
  return { workerId: (data as { id: string }).id };
}

/** Whether the caller's business has been invited to Mitti by the office (false when unknown). */
export async function tradeMittiInvited(userId: string) {
  // Speed (installer screens, Task 6): the settings row is read alongside the context (one round) and used for installers only.
  const [c, { data: settingsRow }] = await Promise.all([
    tradeContext(userId),
    admin.from("workflow_settings").select("mitti_ready_check_priced_template_id").eq("id", 1).maybeSingle(),
  ]);
  const settings = c?.kind === "installer" ? settingsRow : null;
  const template = settings?.mitti_ready_check_priced_template_id;
  return { invited: c?.biz.mitti_account_invited === true, newReadyCheckUrl: template ? `https://app.au.mitti.com/inspection/new?templateId=${encodeURIComponent(template)}` : null };
}

/** Office only: tick/untick "Mitti account invited" for a partner. */
/** Jo 24 Oct 2026 (decision 110): on the installer's own job (A1) the installer enters the Ready Check day and time.
 *  Business-scoped (the business that supplied the customer), the same slots the owner's times link offers, written
 *  as the normal ready_check booking so the 6:30am daily text lists it with the Mitti link. No owner notification. */
export async function tradeSetReadyCheckTime(userId: string, jobId: string, pick: { day: string; time: string }, now = new Date(), call?: import("./mitti.core").MittiCall) {
  const c = await ctxOrThrow(userId);
  if (c.kind !== "installer") throw new WorkflowError("Only the installer enters the Ready Check time.");
  const { a1ReadyCheckEntryAllowed, a1ReadyCheckTimeBlockers, readyCheckStartAt } = await import("./ready-check-times.core");
  const { data: j } = await admin.from("jobs").select("id, channel, stage, deleted_at, originating_installer_business_id").eq("id", jobId).maybeSingle();
  if (!j || j.deleted_at || j.originating_installer_business_id !== c.biz.id) throw new WorkflowError("This job isn't one of your supplied customers.");
  if (!a1ReadyCheckEntryAllowed(j)) throw new WorkflowError("This job isn't waiting for a Ready Check time.");
  const b = a1ReadyCheckTimeBlockers(pick, now);
  if (b.length) throw new WorkflowError(b.join(" "));
  const start = readyCheckStartAt(pick.day, pick.time).toISOString();
  const { confirmBooking } = await import("./booking.server");
  await confirmBooking(jobId, "ready_check", start, userId, "installer (time entered on own job)");
  const { READY_CHECK_BOOKED } = await import("./installer-ready-check.core");
  await admin.from("jobs").update({ next_action: READY_CHECK_BOOKED }).eq("id", jobId);
  // Idempotent: a form already made at Add a job (decision 115) is found and kept; otherwise the booking starts it.
  await (await import("./mitti-create.server")).onReadyCheckBooked(jobId, userId, call).catch((e) => console.error("ready check form not scheduled", (e as Error).message));
  await logEvent(jobId, userId, "installer_ready_check_time_entered", "Installer entered the Ready Check day and time on his own job (nothing sent to the owner)", { starts_at: start, business_id: c.biz.id });
  return { ok: true, startsAt: start };
}

/** Own in-house business membership, not an offer or a customer's time-picking action. */
export async function inHouseBookingAccess(userId: string, jobId: string, client = admin): Promise<{ allowed: boolean; blockers: string[]; bookings?: { id: string; kind: string; scheduled_start: string | null; status: string }[] }> {
  const { readInHouseDispatchState } = await import("./in-house-suppression.server");
  const state = await readInHouseDispatchState([jobId]);
  if (state.failed) return { allowed: false, blockers: ["Couldn't check the job's partner — please try again."] };
  if (!state.held.has(jobId)) return { allowed: false, blockers: ["forbidden"] };
  const { data: assignment, error: assignmentError } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (assignmentError) throw new Error(assignmentError.message);
  if (!assignment?.business_id) return { allowed: false, blockers: ["forbidden"] };
  const { data: member, error: memberError } = await client.from("business_members").select("business_id").eq("user_id", userId).eq("business_id", assignment.business_id).eq("active", true).maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) return { allowed: false, blockers: ["forbidden"] };
  const { data: job, error: jobError } = await admin.from("jobs").select("id").eq("id", jobId).is("deleted_at", null).neq("source", "qa_test").maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) return { allowed: false, blockers: ["forbidden"] };
  const { data: bookings, error: bookingError } = await admin.from("bookings").select("id, kind, scheduled_start, status").eq("job_id", jobId).neq("status", "cancelled").order("created_at", { ascending: false });
  if (bookingError) throw new Error(bookingError.message);
  return { allowed: true, blockers: [], bookings: bookings ?? [] };
}

/** A thin member-scoped wrapper: all booking rules and writes stay in confirmBooking. */
export async function inHouseBookVisit(userId: string, input: { jobId: string; kind: import("./booking.server").BookingKind; start: string }, client = admin): Promise<{ ok: true; bookingId: string } | { ok: false; blockers: string[] }> {
  const access = await inHouseBookingAccess(userId, input.jobId, client);
  if (!access.allowed) return { ok: false, blockers: access.blockers };
  const existingReadyCheck = input.kind === "ready_check" ? access.bookings?.find(b => b.kind === "ready_check" && b.status === "confirmed" && b.scheduled_start && new Date(b.scheduled_start).getTime() === new Date(input.start).getTime()) : undefined;
  if (existingReadyCheck) return { ok: true, bookingId: existingReadyCheck.id };
  const { confirmBooking } = await import("./booking.server");
  try {
    await confirmBooking(input.jobId, input.kind, input.start, userId, "in-house partner");
  } catch (error) {
    if (error instanceof WorkflowError) return { ok: false, blockers: [error.message] };
    throw error;
  }
  if (input.kind === "ready_check") {
    const { READY_CHECK_BOOKED } = await import("./installer-ready-check.core");
    const { error: nextError } = await admin.from("jobs").update({ next_action: READY_CHECK_BOOKED }).eq("id", input.jobId);
    if (nextError) throw new Error(nextError.message);
    await (await import("./mitti-create.server")).onReadyCheckBooked(input.jobId, userId).catch((e) => console.error("ready check form not scheduled", (e as Error).message));
    const { data: assignment, error: assignmentError } = await admin.from("job_assignments").select("business_id").eq("job_id", input.jobId).eq("role", "installer").eq("active", true).maybeSingle();
    if (assignmentError) throw new Error(assignmentError.message);
    await logEvent(input.jobId, userId, "installer_ready_check_time_entered", "Partner entered the Ready Check day and time (nothing sent to the owner)", { starts_at: input.start, business_id: assignment?.business_id ?? null });
  }
  const { data: booking, error } = await admin.from("bookings").select("id").eq("job_id", input.jobId).eq("kind", input.kind).eq("status", "confirmed").eq("scheduled_start", input.start).eq("booked_by", userId).order("created_at", { ascending: false }).limit(1).single();
  if (error || !booking) throw new Error(error?.message ?? "Booking could not be read back.");
  return { ok: true, bookingId: booking.id };
}

export async function setMittiInvited(actorId: string, businessId: string, invited: boolean) {
  const { error } = await admin.from("businesses").update({ mitti_account_invited: invited, mitti_account_invited_at: invited ? new Date().toISOString() : null, mitti_account_invited_by: invited ? actorId : null }).eq("id", businessId);
  if (error) throw new WorkflowError(error.message);
  await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: "partner_mitti_invited", summary: `Mitti account invited ${invited ? "ticked" : "unticked"}`, details: { business_id: businessId, invited } });
  return { ok: true };
}

// ---- Installer screens M2/M4/M6 (Jo 24 Oct 2026, decisions 196–203). Business-scoped reads only; labels in
// installer-screens.core. Never the owner's price or our margin: the installer's pay is the agreed-rate cost on the quote. ----

/** The signed PIESA says an electrician must be present at the start (B1 "rectification not possible"). */
async function piesaNeedsElectricianAtStart(jobId: string): Promise<boolean> {
  try {
    const pe = await (await import("./official-forms.server")).currentCopy(jobId, "piesa");
    if (!pe.copy) return false;
    return (officialFormsCore.answersFromDocument(pe.copy.snapshot.document) as Record<string, unknown>)["b1"] === officialFormsCore.B1_OPTIONS[2];
  } catch { return false; }
}

/** Installer pay on this job = agreed-rate cost (ex GST) on the latest installation quote, shown inc GST. Null until a quote exists. */
async function installerPayForJob(jobId: string): Promise<number | null> {
  const { data: q } = await admin.from("quotes").select("id, status, created_at, quote_internals(cost_ex_gst)").eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]).order("created_at", { ascending: false }).limit(5);
  const pick = (q ?? []).find((x) => x.status === "accepted") ?? (q ?? [])[0];
  const qi = pick?.quote_internals as { cost_ex_gst: number | string | null } | { cost_ex_gst: number | string | null }[] | null | undefined;
  const cost = Number((Array.isArray(qi) ? qi[0] : qi)?.cost_ex_gst);
  return Number.isFinite(cost) && cost > 0 ? Math.round(cost * 1.1 * 100) / 100 : null;
}

/** Mitti install form (PIISA): its audit id and whether it is Complete (signed installer declaration read from the completed form). */
async function installFormFacts(jobId: string): Promise<{ auditId: string | null; complete: boolean }> {
  const [{ data: ev }, { data: decl }] = await Promise.all([
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_piisa_audit_created").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("installer_declarations").select("id").eq("job_id", jobId).eq("status", "signed").limit(1).maybeSingle(),
  ]);
  const id = (ev?.details as { audit_id?: unknown } | null)?.audit_id;
  return { auditId: id ? String(id) : null, complete: !!decl };
}

async function rebateSignedByInstaller(jobId: string): Promise<boolean> {
  const { data } = await admin.from("customer_assignments").select("installer_signed_at").eq("job_id", jobId).eq("record_kind", "final_veec_assignment").neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return !!data?.installer_signed_at;
}

/** Job page facts (M2): Ready Check visit, quote status, own pay, PIESA/clearance, install form, rebate signing. */
/** Decision 251: the owner's side of a booked install for the installer's job page — consent signed? 10% deposit paid?
 *  Read-only, server-side, after `requireTradeJob` has scoped the job to the caller's business. Returns states only:
 *  no amounts, no owner prices, no ledger rows leave this function. Unknown → null (the page shows nothing for it). */
async function ownerReadyFacts(jobId: string): Promise<import("./installer-screens.core").OwnerReadyFacts> {
  const [{ data: consent }, deposit] = await Promise.all([
    admin.from("owner_esc_consents").select("owner_signed_at").eq("job_id", jobId).not("status", "in", "(stale,cancelled)").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    (async () => {
      const v = await paymentsServer.jobPaymentView(jobId);
      if (!v) return null;
      return isStepPaid(v.steps, "install_deposit") ? "paid" as const : "waiting" as const;
    })().catch(() => null),
  ]);
  return { consent: consent ? (consent.owner_signed_at ? "signed" : "waiting") : null, deposit };
}

export async function tradeJobPage(jobId: string, userId: string, pre?: TradeJobAccess) {
  const c = await requireTradeJob(userId, jobId, pre);
  // Speed (installer screens, Task 6): every read that needs only the job id starts in ONE round — the page facts, the
  // panel dates/names, the notes and the boss's own pay rows. The reads that are gated on another fact keep their gate and
  // start the moment that fact is in: the owner's side once the install booking is read (decision 251), the PIESA owner
  // confirmation and the electrician-at-start line once clearance is known (decision 296/327), the price flag once the job's
  // channel is read. Modules are imported at module scope.
  const jobP = early(admin.from("jobs").select("job_number, stage, channel, next_action, installation_completed_at").eq("id", jobId).single());
  const inBookP = early(admin.from("bookings").select("scheduled_start, status").eq("job_id", jobId).eq("kind", "installation").neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle());
  const clearanceP = early(allocationServer.clearanceFacts(jobId).then(electricalClearance));
  // Decision 251: the owner's side is read only once the install is booked (the M2-install-booked state); nothing is read before that.
  const ownerReadyP = early(inBookP.then(async ({ data: inBook }) => inBook?.status === "confirmed" ? await ownerReadyFacts(jobId).catch(() => null) : null));
  // Decision 278: only whether the boss has entered the price (true/false on the installer's own jobs, null otherwise).
  const priceEnteredP = early(jobP.then(async ({ data: j }) => j?.channel === "installer_sourced" ? !!(await installerPriceServer.readInstallerPrice(jobId).catch(() => null)) : null));
  // Decision 296: the owner's PIESA confirmation; decision 327: the electrician at the start of the install day. Read only once cleared.
  const piesaConfirmedP = early(clearanceP.then((cl) => cl.cleared ? piesaOwnerConfirmServer.ownerPiesaConfirmFacts(jobId).then((f) => (f ? !!f.confirmation : null)).catch(() => null) : null));
  const attendanceP = early(clearanceP.then((cl) => cl.cleared ? installerAttendanceView(jobId).catch(() => null) : null));
  const [{ data: j }, { data: rcBook }, { data: inBook }, { data: m }, { data: a }, rebateSigned, quote, pay, form, clearance, mitti, payRows,
    { data: declinedEv }, { data: basicsDone }, { data: piesaBook }, { data: elecAsg }, { data: fixes }, { data: evEv }, { data: alloc }, { data: decl }, { data: finalAsg }, ownerReady, notes,
    priceEntered, ownerPiesaConfirmed, electricianAttendance] = await Promise.all([
    jobP,
    admin.from("bookings").select("scheduled_start, status").eq("job_id", jobId).eq("kind", "ready_check").neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    inBookP,
    admin.from("ceiling_measurements").select("measured_area_m2, removal_m2, removal_required").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("assessments").select("status, piesa_outcome, completed_at").eq("job_id", jobId).maybeSingle(),
    rebateSignedByInstaller(jobId),
    loadInstallerQuote(jobId),
    installerPayForJob(jobId),
    installFormFacts(jobId),
    clearanceP,
    c.kind === "installer" ? mittiJobPresentationServer.mittiJobPresentation(jobId, userId, c).catch(() => ({ applies: false as const })) : Promise.resolve({ applies: false as const }),
    c.boss ? tradeMoneyRows(c.biz.id, c.kind, c.isTest).then((rows) => rows.filter((r) => r.jobId === jobId && r.kind === "installation")) : Promise.resolve([] as Awaited<ReturnType<typeof tradeMoneyRows>>),
    // Approved states (decision 234): the dates and names each panel prints, every one a recorded fact.
    admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", "quote_declined").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", "ready_check_basics").contains("details", { completed: true }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "assessment").in("status", ["confirmed", "completed"]).order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
    admin.from("job_assignments").select("profiles:user_id(full_name)").eq("job_id", jobId).eq("role", "electrician").eq("active", true).limit(1).maybeSingle(),
    admin.from("rectification_items").select("description, status").eq("job_id", jobId).not("status", "in", "(cancelled,removed)"),
    admin.from("workflow_events").select("details, created_at").eq("job_id", jobId).eq("event_type", "install_evidence_synced").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_events").select("event_type, details, created_at").eq("job_id", jobId).eq("event_type", "visit_allocated").order("created_at", { ascending: false }),
    admin.from("installer_declarations").select("installer_name, signed_at, installed_product, installed_area_m2").eq("job_id", jobId).eq("status", "signed").order("signed_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("customer_assignments").select("installer_signed_at, consumer_final_signed_at, ap_signed_at, installed_product, installed_area_m2").eq("job_id", jobId).eq("record_kind", "final_veec_assignment").neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ownerReadyP,
    // AI replies step 2: the office's notes about the job (e.g. the owner wants R7.0), newest first.
    aiEmailReplyServer.installerNotes(jobId),
    priceEnteredP,
    piesaConfirmedP,
    attendanceP,
  ]);
  const qq = quote.quote as { sent_at?: string | null; accepted_at?: string | null } | null;
  const elecName = (elecAsg?.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null;
  const evidence = (evEv?.details as { summary?: { blockers?: string[] } ; blockers?: string[] } | null) ?? null;
  const evidenceBlockers = evidence?.summary?.blockers ?? evidence?.blockers ?? null;
  const installAlloc = currentAllocation((alloc ?? []) as { event_type: string; details: unknown; created_at: string }[], "install");
  const rcAlloc = currentAllocation((alloc ?? []) as { event_type: string; details: unknown; created_at: string }[], "ready_check");
  const crew = [...new Set([decl?.installer_name, installAlloc?.worker_name, rcAlloc?.worker_name].filter((x): x is string => !!x && x.trim().length > 0))];
  const product = decl?.installed_product ?? finalAsg?.installed_product ?? null;
  const payRow = payRows[0] ?? null;
  return {
    jobNumber: j?.job_number ?? null, stage: j?.stage ?? null, channel: j?.channel ?? null, notes,
    readyCheck: { bookedAt: rcBook?.scheduled_start ?? null, done: rcBook?.status === "completed" },
    install: { bookedAt: inBook?.scheduled_start ?? null, recordedAt: j?.installation_completed_at ?? null, form, rebateSigned, formCompletedAt: decl?.signed_at ?? null, evidenceChecked: Array.isArray(evidenceBlockers) ? evidenceBlockers.length === 0 : false, crew, ownerReady },
    form: mitti.applies
      ? { linked: true, auditId: mitti.auditId, completed: mitti.completed, missing: mitti.missing, stops: mitti.stops, electrician: mitti.electrician as string | null, needsFinishing: needsFinishingTask(j?.next_action ?? ""), needsFinishingItems: needsFinishingList(j?.next_action ?? ""), completedAt: basicsDone?.created_at ?? null, hasAnswers: mitti.hasAnswers as boolean | null }
      : { linked: false, auditId: null as string | null, completed: false, missing: [] as string[], stops: [] as string[], electrician: null as string | null, needsFinishing: null as string | null, needsFinishingItems: [] as string[], completedAt: null as string | null, hasAnswers: null as boolean | null },
    // Decision 278: only whether the boss has entered the price (true/false on the installer's own jobs, null otherwise).
    // The price itself is read by the boss-only card (installer-price.functions) and never travels with the page.
    price: { entered: priceEntered },
    boss: c.boss,
    quote: quote.applies ? { line: installerQuoteLine(quote), sent: quote.sent, accepted: quote.accepted, declined: quote.declined, held: quote.held, formCompleted: quote.formCompleted === true, sentAt: qq?.sent_at ?? null, acceptedAt: qq?.accepted_at ?? null, declinedAt: quote.declined ? declinedEv?.created_at ?? null : null } : null,
    pay: { amount: c.boss ? pay : null, areaM2: m?.measured_area_m2 == null ? null : Number(m.measured_area_m2), removalM2: m?.removal_required && m.removal_m2 != null ? Number(m.removal_m2) : null },
    piesa: { passedOn: a?.status === "complete" && a.piesa_outcome === "pass" ? a.completed_at ?? null : null, bookedAt: a?.status === "complete" ? null : piesaBook?.scheduled_start ?? null, electrician: elecName, fixesNote: (fixes ?? []).length ? (fixes ?? []).map((f) => f.description).join(", ") : null,
      // Jo 28 Oct: the PIESA found fixes and Section C is not signed yet (clearance not given).
      fixesOpen: a?.status === "complete" && a.piesa_outcome !== "pass" && !clearance.cleared },
    clearance: { cleared: clearance.cleared, clearedOn: clearance.timingDate },
    // Decision 296: whether the owner has confirmed the current PIESA on their secure link (null = no PIESA record yet). Read only once cleared.
    ownerPiesaConfirmed,
    // Decision 327: electrician at the start of the install day — one line (confirmed / waiting) or the "can't make it" alert.
    electricianAttendance,
    mittiInvited: c.biz.mitti_account_invited === true,
    // M2-complete summary (read-only; owner contact is hidden by the page once every visit is done).
    complete: { product, piisaSignedAt: decl?.signed_at ?? null, installerSignedAt: finalAsg?.installer_signed_at ?? null, ownerSignedAt: finalAsg?.consumer_final_signed_at ?? null, apSignedAt: finalAsg?.ap_signed_at ?? null,
      pay: payRow ? { amount: payRow.amount, state: payRow.state } : null },
  };
}

/** Today's job extras (M4): the job facts and own pay, the electrician-on-site rule, install form state. */
export async function tradeDayExtras(jobId: string, userId: string) {
  // Speed (installer screens, Task 7): every read that needs only the job id starts with the trade access check (one round);
  // this business's own bookings and the electrician's name (only when the signed PIESA asks for them) follow it. The safety
  // plan runs its own chain beside them (crew → staff → certifications). The access refusal is always awaited first; reads
  // started before it are read-only and dropped when refused. Same reads, same value, same failure rules.
  const jP = early(admin.from("jobs").select("channel, installation_completed_at").eq("id", jobId).single());
  const mP = early(admin.from("ceiling_measurements").select("measured_area_m2, removal_m2, removal_required, access_difficulty").eq("job_id", jobId).eq("is_current", true).maybeSingle());
  const qP = early(admin.from("quotes").select("status, created_at, quote_items(code, description, sort)").eq("job_id", jobId).eq("kind", "installation").in("status", ["issued", "accepted", "draft"]).order("created_at", { ascending: false }).limit(1).maybeSingle());
  const rebateP = early(rebateSignedByInstaller(jobId));
  const payP = early(installerPayForJob(jobId));
  const formP = early(installFormFacts(jobId));
  const needsElecP = early(piesaNeedsElectricianAtStart(jobId));
  const dlP = early(admin.from("job_piesa_deadlines").select("install_deadline").eq("job_id", jobId).maybeSingle());
  const allocP = early(admin.from("workflow_events").select("event_type, details, created_at").eq("job_id", jobId).eq("event_type", "visit_allocated").order("created_at", { ascending: false }));
  const declP = early(admin.from("installer_declarations").select("installer_name, signed_at").eq("job_id", jobId).eq("status", "signed").order("signed_at", { ascending: false }).limit(1).maybeSingle());
  const evEvP = early(admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "install_evidence_synced").order("created_at", { ascending: false }).limit(1).maybeSingle());
  const saysP = early(ownerSaysFor(jobId));
  const ownerRowP = early(admin.from("jobs").select("owners(full_name), properties(address_line, suburb)").eq("id", jobId).maybeSingle());
  // Decision 261: the portal safety plan (SWMS) signed by everyone listed (display only: a failed read is "not complete").
  // Lazy import (see the module-scope note); once loaded it resolves without a timer tick, so the reads start in round one.
  const swmsP = early(import("./swms.server").then((m) => m.swmsStatusFor(jobId)));
  const c = await requireTradeJob(userId, jobId);
  const mineBkP = early(admin.from("bookings").select("status").eq("job_id", jobId).eq("business_id", c.biz.id).in("kind", ["ready_check", "installation"] as never));
  const elP = early(needsElecP.then(async (needsElec) => needsElec ? await admin.from("job_assignments").select("profiles:user_id(full_name, phone)").eq("job_id", jobId).eq("role", "electrician").eq("active", true).limit(1).maybeSingle() : { data: null }));
  const [{ data: j }, { data: m }, { data: q }, rebateSigned, pay, form, needsElec] = await Promise.all([jP, mP, qP, rebateP, payP, formP, needsElecP]);
  const { data: el } = await elP;
  const prof = (el?.profiles as unknown as { full_name: string | null; phone: string | null } | null) ?? null;
  const items = ((q?.quote_items as { code: string | null; description: string | null; sort: number | null }[] | null) ?? []).sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0));
  const product = items.find((i) => !["PIESA", "AP_FEE", "INSTALLER_PRICE"].includes(i.code ?? "") && !/removal|safety assessment|accredited person/i.test(i.description ?? ""))?.description ?? null;
  // Approved M4 states: the 30-day end date (couldn't-get-in sheet), who the visit is allocated to, the owner's own
  // answers (Ready Check day "What we know"), the install form's Complete time and the PIISA signature (sign-rebate ticks).
  const [{ data: dl }, { data: alloc }, { data: decl }, { data: evEv }, says, { data: ownerRow }, { data: mineBk }] = await Promise.all([dlP, allocP, declP, evEvP, saysP, ownerRowP, mineBkP]);
  const evs = (alloc ?? []) as { event_type: string; details: unknown; created_at: string }[];
  const allocated = currentAllocation(evs, "install")?.worker_name ?? currentAllocation(evs, "ready_check")?.worker_name ?? null;
  const evidence = (evEv?.details as { summary?: { blockers?: string[] }; blockers?: string[] } | null) ?? null;
  const blockers = evidence?.summary?.blockers ?? evidence?.blockers ?? null;
  const swmsComplete = (await swmsP)?.complete === true;
  const showContact = contactVisible(mineBk ?? []);
  const ow = ownerRow?.owners as { full_name: string | null } | null;
  const p = ownerRow?.properties as { address_line: string | null; suburb: string | null } | null;
  return {
    channel: j?.channel ?? null, product, areaM2: m?.measured_area_m2 == null ? null : Number(m.measured_area_m2), removalM2: m?.removal_required && m.removal_m2 != null ? Number(m.removal_m2) : null,
    access: m?.access_difficulty ?? null, pay: c.boss ? pay : null, installForm: { ...form, completedAt: decl?.signed_at ?? null, piisaSigned: !!decl?.signed_at, swmsComplete: swmsComplete === true, evidenceChecked: Array.isArray(blockers) ? blockers.length === 0 : false, crew: [...new Set([decl?.installer_name, allocated].filter((x): x is string => !!x))] },
    installationRecorded: !!j?.installation_completed_at, rebateSigned,
    electrician: { required: needsElec, name: prof?.full_name ?? null, phone: prof?.phone ?? null },
    installDeadline: dl?.install_deadline ? String(dl.install_deadline) : null, allocatedTo: allocated, ownerSays: says,
    ownerFirstName: showContact ? (ow?.full_name ?? "").trim().split(/\s+/)[0] || null : null,
    streetAddress: showContact ? shortAddress(p?.address_line, p?.suburb) : null,
  };
}

/** The owner's own words on the enquiry (never a measurement): the website size and the declared insulation answer. */
async function ownerSaysFor(jobId: string): Promise<{ areaM2: number | null; insulation: InsulationNow | null }> {
  const { data: j } = await admin.from("jobs").select("estimated_area_m2, estimated_area_unknown, properties(enrichment)").eq("id", jobId).maybeSingle();
  const enrich = (j?.properties as { enrichment?: Record<string, unknown> | null } | null)?.enrichment ?? null;
  const b44 = (enrich?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
  const ins = eligibilityCore.normaliseInsulation(enquiryCore.declaredExtras(b44.raw?.answers ?? null).existing_insulation);
  const area = j?.estimated_area_unknown ? null : j?.estimated_area_m2 == null ? null : Number(j.estimated_area_m2);
  return { areaM2: Number.isFinite(area as number) && (area as number) > 0 ? area : null, insulation: ins === "none" ? "none" : ins === "present" ? "some" : ins === "unknown" ? "unknown" : null };
}

/** M6 per-job pay detail (approved state M6-job-detail): own pay only, business owner only, facts from the same rows as Money. */
export async function tradeMoneyJob(jobId: string, userId: string) {
  const c = await bossOrThrow(userId);
  await requireTradeJob(userId, jobId);
  const rows = (await tradeMoneyRows(c.biz.id, c.kind, c.isTest)).filter((r) => r.jobId === jobId && r.billing === "hivic");
  const row = rows.find((r) => r.kind === "installation") ?? rows[0] ?? null;
  const [{ data: bank }, { data: decl }, { data: finalAsg }, { data: alloc }, { data: m }, { data: invs }] = await Promise.all([
    admin.from("business_bank_details").select("account_number").eq("business_id", c.biz.id).maybeSingle(),
    admin.from("installer_declarations").select("installer_name, installed_product, installed_area_m2").eq("job_id", jobId).eq("status", "signed").order("signed_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("customer_assignments").select("installer_signed_at, consumer_final_signed_at, installed_product, installed_area_m2").eq("job_id", jobId).eq("record_kind", "final_veec_assignment").neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_events").select("event_type, details, created_at").eq("job_id", jobId).eq("event_type", "visit_allocated").order("created_at", { ascending: false }),
    admin.from("ceiling_measurements").select("measured_area_m2, removal_m2, removal_required").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("invoices").select("kind, status, balance_paid_at, paid_at, updated_at").eq("job_id", jobId).eq("kind", "installation"),
  ]);
  const { currentAllocation } = await import("./visit-allocation.core");
  const evs = (alloc ?? []) as { event_type: string; details: unknown; created_at: string }[];
  const crew = [...new Set([decl?.installer_name, currentAllocation(evs, "install")?.worker_name].filter((x): x is string => !!x))];
  // Batch 3b: the install invoice only (the shared rule — fixes / repeat safety check invoices never hold installer pay).
  const paidInFull = (await import("./trade-view.core")).ownerPaidInFullAt(invs ?? []);
  return {
    found: !!row, jobId, jobNumber: row?.jobNumber ?? null, suburb: row?.suburb ?? null, channel: row?.channel ?? null, doneAt: row?.doneAt ?? null,
    amount: row?.amount ?? null, state: row?.state ?? { kind: "checking" as const }, accountEnding: accountEnding(bank?.account_number),
    product: decl?.installed_product ?? finalAsg?.installed_product ?? null,
    areaM2: finalAsg?.installed_area_m2 != null ? Number(finalAsg.installed_area_m2) : m?.measured_area_m2 != null ? Number(m.measured_area_m2) : null,
    removalM2: m?.removal_required && m.removal_m2 != null ? Number(m.removal_m2) : null, crew,
    installerSignedAt: finalAsg?.installer_signed_at ?? null, ownerSignedAt: finalAsg?.consumer_final_signed_at ?? null, apApprovedAt: row?.approvedAt ?? null, ownerPaidInFullAt: paidInFull, held: row?.held ?? [],
  };
}

/** Money extras (M6): masked bank line parts and the account name. Business owner only. */
export async function tradeMoneyExtras(userId: string) {
  const c = await bossOrThrow(userId);
  const [{ data: bank }, { data: b }] = await Promise.all([
    admin.from("business_bank_details").select("account_name, account_number, bsb").eq("business_id", c.biz.id).maybeSingle(),
    admin.from("businesses").select("legal_name, name").eq("id", c.biz.id).maybeSingle(),
  ]);
  const bsb = String(bank?.bsb ?? "").replace(/\D/g, "");
  return { accountName: bank?.account_name ?? b?.legal_name ?? b?.name ?? c.biz.name, bsbStart: bsb.length >= 3 ? bsb.slice(0, 3) : null, accountEnding: accountEnding(bank?.account_number) };
}


/** Decision 261: the safety plan (SWMS) card on the installer's job page — from the install booking until the install is
 *  recorded (read-only afterwards). Business-scoped through requireTradeJob; holds no prices or other partners. */
export async function tradeSwms(jobId: string, userId: string, pre?: TradeJobAccess) {
  const c = await requireTradeJob(userId, jobId, pre);
  if (c.kind !== "installer") return { show: false as const };
  const [{ data: j }, { data: inBook }] = await Promise.all([
    admin.from("jobs").select("installation_completed_at").eq("id", jobId).single(),
    admin.from("bookings").select("status").eq("job_id", jobId).eq("kind", "installation").neq("status", "cancelled").limit(1).maybeSingle(),
  ]);
  if (!inBook) return { show: false as const };
  const { loadSwms } = await import("./swms.server");
  const [{ plan, signatures, status }, myKeys] = await Promise.all([loadSwms(jobId), mySwmsKeys(userId, c.biz.id)]);
  return { show: true as const, editable: !j?.installation_completed_at, plan, signatures, status, myKeys };
}
/** Decision 364: the signed-in person's own sign-off keys — their worker record(s) in the installing business. */
async function mySwmsKeys(userId: string, businessId: string): Promise<string[]> {
  const { data } = await admin.from("partner_workers").select("id").eq("business_id", businessId).eq("profile_id", userId).is("removed_at", null);
  const { swmsSignerKey } = await import("./swms.core");
  return (data ?? []).map((w) => swmsSignerKey({ name: "", workerId: w.id }));
}
async function requireOpenSwms(jobId: string, userId: string) {
  const c = await requireTradeJob(userId, jobId);
  if (c.kind !== "installer") throw new WorkflowError("Only the installing business signs the safety plan.");
  const { data: j } = await admin.from("jobs").select("installation_completed_at").eq("id", jobId).single();
  if (j?.installation_completed_at) throw new WorkflowError("The installation is recorded; the safety plan can't be changed now.");
  return c;
}
export async function tradeSwmsNote(jobId: string, userId: string, note: string) {
  await requireOpenSwms(jobId, userId);
  return (await import("./swms.server")).saveSwmsSiteNote(jobId, userId, note);
}
/** Decision 364: a signed-in person signs ONLY their own line (crew without a login use their own text link). */
export async function tradeSwmsSign(jobId: string, userId: string, key: string, typedName: string) {
  const c = await requireOpenSwms(jobId, userId);
  const swms = await import("./swms.server");
  const { swmsOwnLineBlocker } = await import("./swms.core");
  const [{ plan }, myKeys] = await Promise.all([swms.loadSwms(jobId), mySwmsKeys(userId, c.biz.id)]);
  const block = swmsOwnLineBlocker(plan, key, myKeys);
  if (block) throw new WorkflowError(block);
  return swms.signSwms(jobId, userId, key, typedName, "login");
}

/** Jo 30 Oct 2026: a crew member's phone is dead — the Lead opens that person's OWN sign link on the Lead's phone. The
 *  person still types their own name; the signature is recorded as "signed on the Lead's phone". */
export async function tradeSwmsLeadPhoneLink(jobId: string, userId: string, key: string) {
  const c = await requireOpenSwms(jobId, userId);
  const swms = await import("./swms.server");
  const { swmsLeadPhoneBlocker } = await import("./swms.core");
  const [{ plan, signatures }, myKeys] = await Promise.all([swms.loadSwms(jobId), mySwmsKeys(userId, c.biz.id)]);
  const block = swmsLeadPhoneBlocker(plan, signatures, key, myKeys);
  if (block) throw new WorkflowError(block);
  return { link: await (await import("./swms-link.server")).swmsSignLink(jobId, key, Date.now(), "lead") };
}

// ---- Decision 315: the electrician's "Fixes times" card (/field/{jobId}#fixes-times). Electricians only, business-scoped
// through requireTradeJob + an active ELECTRICIAN assignment for this business. Rules in pure fixes-times.core. ----
async function requireJobElectrician(jobId: string, userId: string) {
  const c = await requireTradeJob(userId, jobId);
  if (c.kind !== "electrician") return null;
  const { count } = await admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "electrician").eq("business_id", c.biz.id).eq("active", true);
  return count ? c : null;
}

export async function tradeFixesTimes(jobId: string, userId: string) {
  const c = await requireJobElectrician(jobId, userId);
  if (!c) return { show: false as const };
  const { FIXES_TIMES_LINK_EVENT, fixesTimesCardState } = await import("./fixes-times.core");
  const r = await import("./rectification.server");
  const [facts, { data: ws }, { count: links }] = await Promise.all([
    r.fixesTimesFacts(jobId),
    admin.from("appointment_proposals").select("starts_at, ends_at, status").eq("job_id", jobId).eq("kind", "rectification").eq("electrician_window", true).order("starts_at"),
    admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", FIXES_TIMES_LINK_EVENT),
  ]);
  const windows = (ws ?? []).map((w) => ({ starts_at: w.starts_at, ends_at: w.ends_at, status: w.status }));
  const state = fixesTimesCardState({ electrician: true, timesNeeded: facts.timesNeeded, piesaCompleted: facts.piesaCompleted, linkSent: (links ?? 0) > 0, windowsExist: windows.length > 0 });
  return state.show ? { show: true as const, given: state.given, windows } : { show: false as const };
}

export async function tradeSaveFixesTimes(jobId: string, userId: string, hours: number, windows: { date: string; slot: import("./piesa-windows.core").PiesaSlot }[]) {
  const c = await requireJobElectrician(jobId, userId);
  if (!c) throw new WorkflowError("Only the electrician on this job can give the electrical fixes times.");
  const view = await tradeFixesTimes(jobId, userId);
  if (!view.show) throw new WorkflowError("No electrical fixes times are needed on this job.");
  if (view.given) throw new WorkflowError("The electrical fixes times have already been given.");
  // The same shared write as the old portal PIESA submit (same validation, rows and `rectification_windows_given` event).
  await (await import("./rectification.server")).recordRectificationWindows(jobId, userId, hours, windows);
  return { ok: true };
}

// ---- Decision 327: electrician on site at the start of the install day. The electrician's card (/field/{jobId}#install-
// attendance) is electricians only, business-scoped through requireJobElectrician; the installer reads one line via
// tradeJobPage. Rules + wording in pure install-attendance.core / trade-view.core; writes in install-attendance.server. ----
async function attendanceFacts(jobId: string) {
  const ia = installAttendanceServer;
  const [booking, events, { data: j }] = await Promise.all([
    ia.currentInstallBooking(jobId), ia.attendanceEvents(jobId),
    admin.from("jobs").select("properties(address_line, suburb)").eq("id", jobId).maybeSingle(),
  ]);
  const p = (j as unknown as { properties: { address_line: string | null; suburb: string | null } | null } | null)?.properties ?? null;
  return { booking, events, address: installerTextAddress(p?.address_line, p?.suburb) };
}

async function installerAttendanceView(jobId: string): Promise<{ line: string | null; alert: string | null } | null> {
  const core = installAttendanceCore;
  const f = await attendanceFacts(jobId);
  if (f.booking) {
    const line = installerAttendanceLine(core.attendanceState(f.events, f.booking.id)?.state ?? null);
    return line ? { line, alert: null } : null;
  }
  // Released by the electrician: the same words the installer was texted, until a day is booked.
  const limit = core.canDoRestriction(f.events);
  const decl = limit ? [...f.events].reverse().find((e) => e.event_type === core.ATTENDANCE_DECLINED_EVENT) : null;
  if (!limit || !decl) return null;
  const d = decl.details ?? {};
  const reason = core.isAttendanceReason(d["reason"]) ? core.attendanceReasonLabel(d["reason"], (d["reason_text"] as string | null) ?? null) : "unavailable";
  return { line: null, alert: core.installerCantAttendText({ wasStartIso: String(d["was"] ?? decl.created_at), reason, days: limit.days }) };
}

export async function tradeInstallAttendance(jobId: string, userId: string) {
  const c = await requireJobElectrician(jobId, userId);
  if (!c) return { show: false as const };
  const core = await import("./install-attendance.core");
  const f = await attendanceFacts(jobId);
  const s = f.booking ? core.attendanceState(f.events, f.booking.id) : null;
  if (f.booking && s) {
    // The days they could do instead ("Can't make it"): inside the 30-day window, never the booked day.
    const [{ installDayContext }, { allowedInstallDays }, { melbourneYmd }] = await Promise.all([import("./install-days.server"), import("./install-days.core"), import("./piesa-windows.core")]);
    const ctx = await installDayContext(jobId);
    const booked = melbourneYmd(new Date(f.booking.scheduled_start));
    const days = allowedInstallDays({ deadline: ctx.deadline }).filter((d) => d !== booked);
    return { show: true as const, bookingId: f.booking.id, line: core.attendancePageLine({ address: f.address, startIso: f.booking.scheduled_start }), state: s.state, auto: s.auto, days, deadline: ctx.deadline, released: null as string | null };
  }
  const decl = [...f.events].reverse().find((e) => e.event_type === core.ATTENDANCE_DECLINED_EVENT);
  if (!f.booking && decl) {
    const d = decl.details ?? {};
    const days = Array.isArray(d["can_do_days"]) ? (d["can_do_days"] as unknown[]).map(String) : [];
    const released = d["no_days"] === true ? "Thanks — you can't make the install day. Home Insulation Victoria will be in touch." : `Thanks — the install day is released. The installer is offering the owner the days you can do: ${core.canDoDaysLabel(days)}. You'll get a text when one is booked.`;
    return { show: true as const, bookingId: null, line: null, state: "declined" as const, auto: false, days: [] as string[], deadline: null as string | null, released };
  }
  return { show: false as const };
}

export async function tradeAnswerInstallAttendance(jobId: string, userId: string, a: { bookingId: string; answer: "yes" } | { bookingId: string; answer: "no"; reason: import("./install-attendance.core").AttendanceReason; otherText: string | null; days: string[]; noDays: boolean }) {
  const c = await requireJobElectrician(jobId, userId);
  if (!c) throw new WorkflowError("Only the electrician on this job can answer.");
  const ia = await import("./install-attendance.server");
  if (a.answer === "yes") return ia.confirmAttendance(jobId, userId, a.bookingId);
  return ia.declineAttendance(jobId, userId, { bookingId: a.bookingId, reason: a.reason, otherText: a.otherText, days: a.days, noDays: a.noDays });
}

// ---- Decision 317: the electrician's "Safety check (PIESA)" document row (/field/{jobId}). Electricians only,
// business-scoped through requireJobElectrician (active ELECTRICIAN assignment for this business). The PDF is the same
// document the electrician is emailed (official-piesa-pdf.server), returned as bytes — no public URL. Never a sender. ----
export async function tradeSafetyCheckDoc(jobId: string, userId: string) {
  const c = await requireJobElectrician(jobId, userId);
  if (!c) return { show: false as const };
  const { currentCopy } = await import("./official-forms.server");
  const [pe, { data: rec }] = await Promise.all([
    currentCopy(jobId, "piesa").catch(() => ({ copy: null, unavailable: true })),
    admin.from("piesa_records").select("kind, created_at").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
  ]);
  if (pe.unavailable || !pe.copy) return { show: false as const };
  const signedAt = pe.copy.snapshot?.serverTimestamp ? Date.parse(pe.copy.snapshot.serverTimestamp) : NaN;
  const afterFixes = rec?.kind === "post_rectification" && Number.isFinite(signedAt) && signedAt >= Date.parse(rec.created_at);
  const { SAFETY_CHECK_DOC_TITLE, safetyCheckDocLine } = await import("./trade-view.core");
  return { show: true as const, title: SAFETY_CHECK_DOC_TITLE, line: safetyCheckDocLine({ signatureDate: pe.copy.signatureDate, afterFixes }) };
}

export async function tradeSafetyCheckPdf(jobId: string, userId: string) {
  const c = await requireJobElectrician(jobId, userId);
  if (!c) throw new WorkflowError("Only the electrician on this job can download the safety check.");
  const { data: job } = await admin.from("jobs").select("job_number").eq("id", jobId).maybeSingle();
  if (!job) throw new WorkflowError("Job not found.");
  const pdf = await (await import("./official-piesa-pdf.server")).officialPiesaPdf(jobId, job.job_number);
  if (!pdf) throw new WorkflowError("The official safety check isn't ready yet.");
  return { fileName: pdf.fileName, base64: toB64(pdf.bytes) };
}

/** Decision 328: "Check my form now" on /field/day/{jobId} and /field/{jobId}. Installers only, business-scoped through
 *  requireTradeJob; runs the single-job A5 sync (install-day-confirm.server) and returns only the result lines — no
 *  prices, no other partners. A Complete form on the install day also gets the result text once per revision. */
export async function tradeCheckInstallForm(jobId: string, userId: string) {
  const c = await requireTradeJob(userId, jobId);
  if (c.kind !== "installer") throw new WorkflowError("Only the installing business checks the install day form.");
  const r = await (await import("./install-day-confirm.server")).checkInstallDayForm(jobId, { actorId: userId });
  return { state: r.state, title: r.title, body: r.body, good: r.good, missing: r.missing.slice(0, 10), texted: !!r.texted };
}

// ---- Decision 333: PIESA times (electrician offers the owner 3). Business-scoped; rules in piesa-times.core. ----

/** Accept a PIESA offer (no owner windows) by offering the owner 3 times. */
export async function tradeOfferPiesaTimes(offerId: string, userId: string, picks: { day: string; time: string }[]) {
  const c = await ctxOrThrow(userId);
  const { data: o } = await admin.from("partner_offers").select("id, business_id, kind").eq("id", offerId).maybeSingle();
  if (!o || o.business_id !== c.biz.id || o.kind !== "piesa") throw new WorkflowError("This offer isn't for your business.");
  return (await import("./piesa-times.server")).acceptPiesaOfferWithTimes(offerId, userId, picks);
}
