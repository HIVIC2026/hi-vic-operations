// Trade view reads + the few trade actions (Jo-approved designs, 6 Oct 2026). Every read is scoped to the signed-in
// person's own business. Trades never see customer prices, margins, the office's electrician list or other partners.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { fullAddress } from "./address";
import { isTestPartner } from "./test-send.core";
import { offerTiming } from "./offer-timing.core";
import { placeWorkJob, type WorkPlace } from "./work-places.core";
import { COULDNT_GET_IN, payState, surname, type AreaSource, type InsulationNow, type TradeKind, SETUP_STEPS, type SetupKey, tradeJobAllowed, contactVisible, type AccessAssignment } from "./trade-view.core";
import { eecState } from "./worker-compliance.core";

type Biz = { id: string; name: string; business_type: string | null; capabilities: string[] | null; base_suburb: string | null; coverage_radius_km: number | null; covers_all_victoria: boolean | null; accepting_new_jobs: boolean | null; onboarding_notes: string | null; mitti_account_invited?: boolean | null };

export async function tradeContext(userId: string) {
  const [{ data: mem }, { data: roles }, { data: prof }] = await Promise.all([
    admin.from("business_members").select("business_id, member_role").eq("user_id", userId).eq("active", true),
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin.from("profiles").select("full_name, phone, email").eq("id", userId).maybeSingle(),
  ]);
  const m = (mem ?? [])[0];
  if (!m) return null;
  const { data: b } = await admin.from("businesses").select("id, name, business_type, capabilities, base_suburb, coverage_radius_km, covers_all_victoria, accepting_new_jobs, onboarding_notes, mitti_account_invited").eq("id", m.business_id).single();
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

/** My work: open offers, things that need this trade, booked visits, and this month. */
export async function tradeHome(userId: string) {
  const c = await ctxOrThrow(userId);
  const now = new Date();
  const [{ data: offers }, { data: asg }] = await Promise.all([
    admin.from("partner_offers").select("id, job_id, kind, summary, expires_at").eq("business_id", c.biz.id).eq("status", "pending").order("offered_at", { ascending: false }),
    assignmentQuery(c, userId),
  ]);
  const jobIds = [...new Set((asg ?? []).map((a) => a.job_id))];
  const none = ["00000000-0000-0000-0000-000000000000"];
  const [{ data: jobs }, { data: books }, { data: missing }] = await Promise.all([
    admin.from("jobs").select("id, job_number, stage, source, channel, qa_archived_at, deleted_at, installer_quoted, installer_site_check, installer_site_check_date, installer_quoted_price_inc_gst, installer_price_includes, next_action, owners(full_name), properties(address_line, suburb, postcode)").in("id", jobIds.length ? jobIds : none),
    admin.from("bookings").select("job_id, kind, status, scheduled_start, scheduled_end").in("job_id", jobIds.length ? jobIds : none).in("status", ["confirmed", "completed"]).order("scheduled_start"),
    admin.from("evidence_requirements").select("job_id").in("job_id", jobIds.length ? jobIds : none).eq("required", true).in("status", ["outstanding", "rejected"]),
  ]);
  const mine = c.kind === "installer" ? ["ready_check", "installation"] : ["assessment", "rectification"];
  const live = (jobs ?? []).filter((j) => !j.qa_archived_at && !j.deleted_at && !["cancelled"].includes(j.stage) && (!c.isTest || j.source === "qa_test"));
  const byId = new Map(live.map((j) => [j.id, j]));
  const miss = new Map<string, number>(); for (const r of missing ?? []) miss.set(r.job_id, (miss.get(r.job_id) ?? 0) + 1);
  const label = (j: (typeof live)[number]) => { const o = j.owners as { full_name: string | null } | null; const p = j.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null; return { owner: o?.full_name ?? null, surname: surname(o?.full_name), suburb: p?.suburb ?? null, address: fullAddress(p?.address_line, p?.suburb, p?.postcode) }; };
  const upcomingOf = (id: string) => (books ?? []).filter((b) => b.job_id === id && b.status === "confirmed" && mine.includes(b.kind) && new Date(b.scheduled_end ?? b.scheduled_start).getTime() > now.getTime() - 12 * 3_600_000);
  const offerJobs = new Set((offers ?? []).filter((o) => (c.kind === "installer" ? o.kind === "ready_check" || o.kind === "installer" : o.kind === "piesa" || o.kind === "rectification")).map((o) => o.job_id));
  const yourMove: { jobId: string; title: string; detail: string }[] = [];
  const coming: { jobId: string; kind: string; what: string; start: string; end: string | null; owner: string | null; surname: string | null; suburb: string | null; address: string }[] = [];
  const placeOf = new Map<string, WorkPlace>();
  const answers = await (await import("./installer-intake.server")).intakeQuoteAnswers(live.filter((j) => (j as { channel?: string }).channel === "installer_sourced").map((j) => j.id));
  for (const j of live) {
    const l = label(j);
    const up = upcomingOf(j.id);
    const p = placeWorkJob({ jobId: j.id, stage: j.stage, trade: c.kind, installerSourced: (j as { channel?: string }).channel === "installer_sourced", quoted: ((a) => a === "have_quote" ? "yes" : a === "not_quoted" ? "no" : (j.installer_quoted as "yes" | "no" | null))(answers.get(j.id)), siteCheck: j.installer_site_check as "yes" | "no" | null, missingPhotos: miss.get(j.id) ?? 0, pendingOffer: offerJobs.has(j.id), upcoming: up });
    placeOf.set(j.id, p.place);
    if (p.place === "needs_me") yourMove.push({ jobId: j.id, title: p.title, detail: `${l.owner ?? "Owner"}, ${l.suburb ?? ""}` });
    if (p.place === "coming_up") { const b = up[0]!; coming.push({ jobId: b.job_id, kind: b.kind, what: VISIT[b.kind] ?? "Visit", start: b.scheduled_start, end: b.scheduled_end, ...l }); }
  }
  coming.sort((a, b) => a.start.localeCompare(b.start));
  const wk0 = new Date(now); wk0.setDate(now.getDate() - ((now.getDay() + 6) % 7)); wk0.setHours(0, 0, 0, 0);
  const wk1 = new Date(wk0.getTime() + 7 * 86_400_000);
  const week = (books ?? []).filter((b) => mine.includes(b.kind) && byId.has(b.job_id) && new Date(b.scheduled_start) >= wk0 && new Date(b.scheduled_start) < wk1).length;
  const money = c.boss ? (await tradeMoneyRows(c.biz.id, c.kind, c.isTest)).filter((r) => r.billing === "hivic") : [];
  const m0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const month = money.filter((r) => r.doneAt && new Date(r.doneAt) >= m0);
  const offerList = (offers ?? []).filter((o) => (c.kind === "installer" ? o.kind === "ready_check" || o.kind === "installer" : o.kind === "piesa" || o.kind === "rectification"))
    .map((o) => ({ id: o.id, kind: o.kind, suburb: (o.summary as { suburb?: string | null })?.suburb ?? null, expiresAt: o.expires_at }));
  const STATUS: Record<string, string> = { ready_check_ready_to_schedule: "Waiting for owner to pick Ready Check times", ready_check_complete: "Office checking your Ready Check", on_hold: "On hold (office review)" };
  // Installer-sourced jobs: his own site-check answer and price (labels only; never HIV owner prices or margins).
  const { statusFactsFor, statusView } = await import("./job-status.server");
  const sf = await statusFactsFor(c, live.map((j) => j.id));
  const allJobs = live.map((j) => ({ jobId: j.id, jobNumber: j.job_number, channel: j.channel, place: placeOf.get(j.id)!, status: (j as { next_action?: string | null }).next_action?.startsWith("Needs finishing") ? (j as { next_action: string }).next_action : STATUS[j.stage] ?? "In progress", line: sf.get(j.id) ? statusView(c, sf.get(j.id)!) : null, ...label(j),
    facts: j.installer_site_check || j.installer_quoted_price_inc_gst != null || (j as { channel?: string }).channel === "installer_sourced" ? { quoted: j.installer_quoted as "yes" | "no" | null, site_check: j.installer_site_check as "yes" | "no" | null, site_check_date: j.installer_site_check_date, quoted_price_inc_gst: j.installer_quoted_price_inc_gst == null ? null : Number(j.installer_quoted_price_inc_gst), price_includes: j.installer_price_includes } : null }));
  // Done tab: only actual final stages. Active-assignment jobs keep their link; ended assignments get a read-only summary
  // (job number, suburb, terminal reason) — no owner, address, contact or price, and no reopened access.
  const { installerTab, doneReason } = await import("./installer-progress.core");
  const jobsTabbed = allJobs.map((j) => ({ ...j, stage: byId.get(j.jobId)!.stage, tab: installerTab(j.place, byId.get(j.jobId)!.stage) }));
  const histQ = admin.from("job_assignments").select("job_id").eq("business_id", c.biz.id).eq("active", false);
  const { data: ended } = await (c.boss ? histQ : histQ.eq("user_id", userId));
  const histIds = [...new Set([...(ended ?? []).map((a) => a.job_id), ...(jobs ?? []).filter((j) => j.stage === "cancelled").map((j) => j.id)])].filter((id) => !byId.has(id));
  const { data: histJobs } = histIds.length
    ? await admin.from("jobs").select("id, job_number, stage, source, qa_archived_at, deleted_at, updated_at, properties(suburb)").in("id", histIds).in("stage", ["complete", "cancelled"])
    : { data: [] as never[] };
  const done = [
    ...jobsTabbed.filter((j) => j.tab === "done").map((j) => ({ jobId: j.jobId, jobNumber: j.jobNumber, suburb: j.suburb, reason: doneReason(j.stage), open: true })),
    ...(histJobs ?? []).filter((j) => !j.qa_archived_at && !j.deleted_at && (!c.isTest || j.source === "qa_test")).map((j) => ({ jobId: j.id, jobNumber: j.job_number, suburb: (j.properties as { suburb: string | null } | null)?.suburb ?? null, reason: doneReason(j.stage), open: false })),
  ];
  return { kind: c.kind, boss: c.boss, business: c.biz.name, firstName: c.firstName, isTest: c.isTest, week, offers: offerList, yourMove, coming, jobs: jobsTabbed, done, month: c.boss ? { jobs: month.length, earned: month.reduce((t, r) => t + (r.amount ?? 0), 0) } : null };
}

/** One offer, trade-side. Owner and address only once this business has taken it. */
export async function tradeOffer(offerId: string, userId: string) {
  const c = await ctxOrThrow(userId);
  const { data: o } = await admin.from("partner_offers").select("id, job_id, business_id, kind, status, summary, expires_at, offered_at, superseded_at").eq("id", offerId).maybeSingle();
  if (!o || o.business_id !== c.biz.id) throw new WorkflowError("This offer isn't for your business.");
  const timing = offerTiming(o.offered_at, await offerSuggestHours());
  const s = (o.summary ?? {}) as { suburb?: string; postcode?: string; distance_km?: number; electrician_rate_inc_gst?: number | null; approx_area_m2?: number; area_source?: AreaSource; insulation_now?: InsulationNow; installer_rate_per_m2?: number | null };
  const { data: winRows } = o.kind === "ready_check"
    ? await admin.from("ready_check_windows").select("id, starts_at, ends_at, status").eq("job_id", o.job_id).order("starts_at")
    : await admin.from("appointment_proposals").select("id, starts_at, ends_at, status").eq("job_id", o.job_id).not("piesa_window_round", "is", null).order("starts_at");
  const windows = (winRows ?? []).filter((w) => w.status === "open" || w.status === "proposed").map((w) => ({ id: w.id, start: w.starts_at, end: w.ends_at }));
  let locked: null | { owner: string | null; phone: string | null; address: string; start: string; end: string | null } = null;
  // Review B: contact details only while this business still holds an ACTIVE assignment on the job (and, for a worker, their own).
  const { data: liveAsg } = o.status === "accepted" ? await assignmentQuery(c, userId).eq("job_id", o.job_id).limit(1).maybeSingle() : { data: null };
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
  return {
    id: o.id, jobId: o.job_id, kind: o.kind, status: o.status, expiresAt: o.expires_at, windows, locked,
    canSuggest: o.status === "pending" && timing.canSuggest, suggestUnlockLabel: timing.unlockLabel, takenByOther: o.status === "withdrawn" || o.status === "superseded",
    suburb: s.suburb ?? null, distanceKm: s.distance_km ?? null, pay: s.electrician_rate_inc_gst ?? null,
    area: s.approx_area_m2 ?? null, areaSource: (s.area_source ?? "owner_estimate") as AreaSource, insulation: (s.insulation_now ?? "unknown") as InsulationNow, ratePerM2: s.installer_rate_per_m2 ?? null,
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
    if (o.kind === "ready_check") {
      const { respondToReadyCheckOffer } = await import("./readycheck-booking.server");
      try { await respondToReadyCheckOffer(offerId, userId, true, null, windowId); return { tooSlow: false }; } catch (e) { if (/just been taken|no longer/.test((e as Error).message)) return { tooSlow: true }; throw e; }
    }
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

/** Day page for any of the three visit kinds. */
/** The one server check for every trade job read: active assignment for this job AND this business (staff: assigned to them). */
export async function requireTradeJob(userId: string, jobId: string) {
  const c = await ctxOrThrow(userId);
  const { data } = await admin.from("job_assignments").select("job_id, business_id, user_id, active").eq("job_id", jobId).eq("active", true);
  if (!tradeJobAllowed({ signedIn: true, userId, businessId: c.biz.id, boss: c.boss, jobId, assignments: (data ?? []) as AccessAssignment[] })) throw new WorkflowError("This job isn't assigned to you.");
  return c;
}

export async function tradeDay(jobId: string, userId: string) {
  const c = await requireTradeJob(userId, jobId);
  const kinds = c.kind === "installer" ? ["installation", "ready_check"] : ["assessment", "rectification"];
  const [{ data: bks }, { data: j }, { data: a }, { data: rc }, { data: cm }, { data: q }, { data: miss }, { data: ws }, { data: fixes }] = await Promise.all([
    admin.from("bookings").select("kind, scheduled_start, scheduled_end, status").eq("job_id", jobId).in("kind", kinds as never).neq("status", "cancelled").order("scheduled_start", { ascending: false }),
    admin.from("jobs").select("job_number, stage, channel, eligibility_outcome, owners(full_name, phone), properties(address_line, suburb, postcode)").eq("id", jobId).single(),
    admin.from("assessments").select("status, piesa_outcome, external_mitti_id").eq("job_id", jobId).maybeSingle(),
    admin.from("ready_checks").select("status, submitted_at, external_mitti_id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("ceiling_measurements").select("external_source, external_id").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("quotes").select("id").eq("job_id", jobId).eq("kind", "installation").limit(1).maybeSingle(),
    admin.from("evidence_requirements").select("label").eq("job_id", jobId).eq("required", true).in("status", ["outstanding", "rejected"]),
    admin.from("workflow_settings").select("mitti_piesa_template_id").eq("id", 1).maybeSingle(),
    admin.from("rectification_items").select("description").eq("job_id", jobId).neq("status", "cancelled"),
  ]);
  const b = (bks ?? [])[0] ?? null;
  const { data: mine } = await admin.from("bookings").select("status").eq("job_id", jobId).eq("business_id", c.biz.id).in("kind", kinds as never);
  const showContact = contactVisible(mine ?? []);
  const dayKind = b?.kind === "installation" ? "install" : b?.kind === "ready_check" ? "ready_check" : "safety_check";
  const p = j?.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
  const ow = j?.owners as { full_name: string | null; phone: string | null } | null;
  const { data: cgi } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "trade_couldnt_get_in").order("created_at", { ascending: false }).limit(1).maybeSingle();
  let outcome: null | { kind: "all_clear" } | { kind: "fixes"; items: string[] } | { kind: "quoted" } | { kind: "not_eligible"; reason: string | null } | { kind: "wrap" } | { kind: "missing"; items: string[] } | { kind: "couldnt_get_in"; reason: string } = null;
  if (cgi && dayKind === "ready_check" && j?.stage === "ready_check_ready_to_schedule") outcome = { kind: "couldnt_get_in", reason: String((cgi.details as { reason?: string })?.reason ?? "") };
  else if (dayKind === "safety_check" && a?.status === "complete") outcome = a.piesa_outcome === "pass" ? { kind: "all_clear" } : { kind: "fixes", items: (fixes ?? []).map((f) => f.description) };
  else if (dayKind === "ready_check" && (rc?.status === "submitted" || j?.stage === "ready_check_complete" || j?.stage === "measured_estimate_ready" || j?.stage === "measured_quote_accepted")) outcome = j?.eligibility_outcome === "does_not_appear_eligible" ? { kind: "not_eligible", reason: "Existing insulation doesn't qualify for this rebate." } : q ? { kind: "quoted" } : { kind: "quoted" };
  else if (dayKind === "install" && ["evidence_outstanding", "ap_review", "ready_for_veec", "complete"].includes(j?.stage ?? "")) outcome = (miss ?? []).length ? { kind: "missing", items: (miss ?? []).map((m) => m.label) } : { kind: "wrap" };
  return {
    kind: dayKind as "safety_check" | "ready_check" | "install", channel: j?.channel ?? null, jobNumber: j?.job_number ?? null, owner: showContact ? ow?.full_name ?? null : null, surname: showContact ? surname(ow?.full_name) : null, phone: showContact ? ow?.phone ?? null : null,
    address: showContact ? fullAddress(p?.address_line, p?.suburb, p?.postcode) : null, contactHidden: !showContact, start: b?.scheduled_start ?? null, end: b?.scheduled_end ?? null, outcome,
    // Mitti stays invisible to partners until the office ticks "Mitti account invited".
    mittiInvited: c.biz.mitti_account_invited === true,
    mittiReady: dayKind === "safety_check" ? !!ws?.mitti_piesa_template_id : false, mittiId: c.biz.mitti_account_invited === true ? (dayKind === "ready_check" ? rc?.external_mitti_id ?? (cm?.external_source === "mitti" ? cm.external_id : null) : a?.external_mitti_id) ?? null : null,
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
  const [{ data: job }, { data: bk }] = await Promise.all([
    admin.from("jobs").select("stage").eq("id", jobId).single(),
    admin.from("bookings").select("id, scheduled_start").eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const { couldntGetInBlocker } = await import("./trade-view.core");
  const blocker = couldntGetInBlocker(job?.stage ?? null, bk?.scheduled_start ?? null, new Date());
  if (blocker) throw new WorkflowError(blocker);
  const { transition } = await import("./workflow.server");
  await transition(jobId, "ready_check_ready_to_schedule", userId, `Installer couldn't get in (${reason})`, { reason, business_id: c.biz.id }, { nextAction: `Needs me: rebook the Ready Check (${reason}). Offer back to ${c.biz.name} first.` });
  await admin.from("bookings").update({ status: "cancelled" }).eq("id", bk!.id).eq("status", "confirmed");
  await admin.from("job_assignments").update({ active: false, ended_at: new Date().toISOString(), end_reason: `Couldn't get in: ${reason}` } as never).eq("id", asg.id);
  await logEvent(jobId, userId, "trade_couldnt_get_in", `Needs me: installer couldn't get in (${reason}). Rebook with the owner; offer back to ${c.biz.name} first.`, { reason, business_id: c.biz.id, reoffer_first_to: c.biz.id, needs_office: true }, { internal: true });
  return { ok: true };
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

/** Money rows: own pay only. Paid = office marked paid; Coming = 7 days after AP approval; else Being checked. */
async function tradeMoneyRows(bizId: string, kind: TradeKind, testOnly: boolean) {
  const mine = kind === "installer" ? ["ready_check", "installation"] : ["assessment", "rectification"];
  const { data: books } = await admin.from("bookings").select("job_id, kind, scheduled_start, status, jobs!inner(deleted_at, job_number, source, channel, stage, electrician_choice, owners(full_name), properties(suburb))").is("jobs.deleted_at", null).eq("business_id", bizId).eq("status", "completed").in("kind", mine as never).order("scheduled_start", { ascending: false });
  const rows = (books ?? []).filter((b) => b.kind !== "ready_check" && (!testOnly || (b.jobs as { source: string }).source === "qa_test"));
  const ids = [...new Set(rows.map((r) => r.job_id))];
  const none = ["00000000-0000-0000-0000-000000000000"];
  const [{ data: paid }, { data: ap }, { data: offers }] = await Promise.all([
    admin.from("workflow_events").select("job_id, created_at, details").eq("event_type", "payout_marked_paid").in("job_id", ids.length ? ids : none),
    admin.from("workflow_events").select("job_id, created_at").eq("event_type", "stage_changed").eq("to_stage", "ready_for_veec").in("job_id", ids.length ? ids : none),
    admin.from("partner_offers").select("job_id, kind, summary").eq("business_id", bizId).eq("status", "accepted").in("job_id", ids.length ? ids : none),
  ]);
  // Owner paid in full (Xero mirror): needed alongside AP approval before the 7-day payout clock starts.
  const { data: invs } = await admin.from("invoices").select("job_id, status, balance_paid_at, paid_at, updated_at").in("job_id", ids.length ? ids : none);
  // Committed contract snapshot: does the accepted HIV quote carry this electrical line?
  const { data: accQ } = await admin.from("quotes").select("job_id, kind, quote_items(code, description)").in("job_id", ids.length ? ids : none).eq("status", "accepted");
  const committed = (jobId: string, kind: string): boolean | null => {
    const qs = (accQ ?? []).filter((q) => q.job_id === jobId); if (!qs.length) return null;
    const items = qs.flatMap((q) => [...((q.quote_items as { code: string | null; description: string | null }[] | null) ?? []).map((i) => ({ ...i, qk: q.kind }))]);
    return kind === "assessment" ? items.some((i) => i.code === "PIESA") : items.some((i) => i.qk === "rectification" || (i.description ?? "").startsWith("Electrical rectification:"));
  };
  const { electricalBillingSource } = await import("./installer-led.core");
  const paidInFull = (jobId: string) => { const i = (invs ?? []).filter((x) => x.job_id === jobId); if (!i.length || i.some((x) => x.status !== "fully_paid")) return null; return i.map((x) => x.balance_paid_at ?? x.paid_at ?? x.updated_at).sort().at(-1) ?? null; };
  return rows.map((b) => {
    const j = b.jobs as { job_number: string; owners: { full_name: string | null } | null; properties: { suburb: string | null } | null };
    const pe = (paid ?? []).find((p) => p.job_id === b.job_id && ((p.details as { kind?: string })?.kind ?? b.kind) === b.kind);
    const of = (offers ?? []).find((o) => o.job_id === b.job_id && (o.kind === "piesa" ? "assessment" : o.kind === "installer" ? "installation" : o.kind) === b.kind);
    const sum = (of?.summary ?? {}) as { electrician_rate_inc_gst?: number; installer_pay_inc_gst?: number; fixes_pay_inc_gst?: number };
    const amount = Number((pe?.details as { amount?: number })?.amount ?? (b.kind === "assessment" ? sum.electrician_rate_inc_gst : b.kind === "rectification" ? sum.fixes_pay_inc_gst : sum.installer_pay_inc_gst) ?? 0) || null;
    const state = payState({ paidAt: pe?.created_at ?? null, apApprovedAt: (ap ?? []).find((x) => x.job_id === b.job_id)?.created_at ?? null, installerSupplied: (b.jobs as { channel?: string }).channel === "installer_sourced", ownerPaidInFullAt: paidInFull(b.job_id) });
    const approvedAt = (ap ?? []).find((x) => x.job_id === b.job_id)?.created_at ?? null;
    const jj = b.jobs as { channel?: string | null; electrician_choice?: string | null };
    // A kind-less payout event is the job/installer payout; only an explicit electrical-kind event proves an HIV electrical payment.
    const explicitPaid = pe && (pe.details as { kind?: string })?.kind === b.kind ? pe.created_at : null;
    const billing = b.kind === "assessment" || b.kind === "rectification"
      ? electricalBillingSource({ channel: jj.channel ?? null, choice: jj.electrician_choice ?? null, committedLineOnAcceptedQuote: committed(b.job_id, b.kind), hivPaidAt: explicitPaid })
      : "hivic" as const;
    return { billing, jobId: b.job_id, jobNumber: j.job_number, surname: surname(j.owners?.full_name), suburb: j.properties?.suburb ?? null, what: VISIT[b.kind] ?? "Job", kind: b.kind, amount, state, doneAt: b.scheduled_start, approvedAt };
  });
}

export async function tradeMoney(userId: string) {
  const c = await ctxOrThrow(userId);
  if (!c.boss) throw new WorkflowError("Money is only shown to the business owner.");
  const all = await tradeMoneyRows(c.biz.id, c.kind, c.isTest);
  // Owner-direct electrical work is invoiced to the owner by the electrician: never an HIV payout, never in our totals.
  const rows = all.filter((r) => r.billing === "hivic");
  const ownerDirect = all.filter((r) => r.billing === "owner_direct").map((r) => ({ jobId: r.jobId, jobNumber: r.jobNumber, surname: r.surname, suburb: r.suburb, what: r.what, doneAt: r.doneAt }));
  const now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const coming = rows.filter((r) => r.state.kind === "coming");
  const next = coming.map((r) => (r.state as { on: string }).on).sort()[0] ?? null;
  const nextRows = next ? coming.filter((r) => (r.state as { on: string }).on.slice(0, 10) === next.slice(0, 10)) : [];
  const sum = (xs: typeof rows) => xs.reduce((t, r) => t + (r.amount ?? 0), 0);
  // Only the last 3 digits of the saved account: enough to recognise it, never the full number.
  const { data: bank } = await admin.from("business_bank_details").select("account_number").eq("business_id", c.biz.id).maybeSingle();
  const digits = String(bank?.account_number ?? "").replace(/\D/g, "");
  return { kind: c.kind, boss: c.boss, business: c.biz.name, bankEnding: digits.length >= 3 ? digits.slice(-3) : null, next: next ? { on: next, total: sum(nextRows), jobs: nextRows.length } : null, month: sum(rows.filter((r) => r.doneAt && new Date(r.doneAt) >= m0)), allTime: sum(rows), rows, ownerDirect };
}

export async function tradeBusiness(userId: string) {
  const c = await ctxOrThrow(userId);
  // Staff logins get only the business name and job-taking status: no rates, bank, agreement, insurance or team.
  if (!c.boss) return { kind: c.kind, boss: false, name: c.biz.name, taking: c.biz.accepting_new_jobs !== false, area: null as string | null, licenceExpires: null, liabilityExpires: null, rate: null as number | null, agreementSigned: false, bankSaved: false, team: [] as { id: string | null; name: string; role: string; hasLogin: boolean; eec: string }[] };
  const r = admin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [{ data: creds }, { data: workers }, { data: rate }, { data: agr }, { data: bank }] = await Promise.all([
    admin.from("business_credentials").select("kind, label, expires_at, verification").eq("business_id", c.biz.id),
    admin.from("partner_workers").select("id, full_legal_name, trade_role, approval_status, licence_expires_on, profile_id, certification_status, certification").eq("business_id", c.biz.id).is("removed_at", null),
    c.kind === "electrician" ? r.from("electrician_rates").select("rate_inc_gst").eq("business_id", c.biz.id).eq("service_type", "piesa").eq("status", "active").maybeSingle() : Promise.resolve({ data: null }),
    admin.from("partner_agreements").select("signed_at").eq("business_id", c.biz.id).order("signed_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("business_bank_details").select("business_id").eq("business_id", c.biz.id).limit(1).maybeSingle(),
  ]);
  const { data: boss } = await admin.from("business_members").select("user_id, member_role, profiles!business_members_user_id_fkey(full_name)").eq("business_id", c.biz.id).eq("active", true);
  const licence = c.kind === "electrician" ? (workers ?? []).map((w) => w.licence_expires_on).filter(Boolean).sort()[0] ?? null : null;
  const liability = (creds ?? []).find((x) => /liab/i.test(x.kind) || /liab/i.test(x.label))?.expires_at ?? null;
  return {
    kind: c.kind, boss: c.boss, name: c.biz.name, taking: c.biz.accepting_new_jobs !== false,
    area: c.biz.covers_all_victoria ? "Anywhere in Victoria" : `Up to ${c.biz.coverage_radius_km ?? "?"} km from ${c.biz.base_suburb ?? "your base"}`,
    licenceExpires: licence, liabilityExpires: liability, rate: rate ? Number((rate as { rate_inc_gst: number }).rate_inc_gst) : null,
    agreementSigned: !!agr?.signed_at, bankSaved: !!bank,
    team: [
      ...(boss ?? []).filter((m) => m.member_role === "business_admin").map((m) => ({ id: null as string | null, name: (m.profiles as { full_name: string | null } | null)?.full_name ?? "Business owner", role: "Business owner", hasLogin: true, eec: "not_applicable" })),
      ...(workers ?? []).filter((w) => !(boss ?? []).some((m) => m.user_id === w.profile_id && m.member_role === "business_admin")).map((w) => ({ id: w.id as string | null, name: w.full_legal_name, role: w.trade_role === "installer" ? "Installer" : "Electrician", hasLogin: !!w.profile_id, eec: eecState({ trade_role: w.trade_role, certification_status: w.certification_status, certification: w.certification } as never) })),
    ],
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
  return { kind: c.kind, business: c.biz.name, firstName: c.firstName, mobile: c.profile?.phone ?? null, email: c.profile?.email ?? null, area: biz.area, rate: biz.rate, bankSaved: biz.bankSaved, done, steps: SETUP_STEPS.map((s) => s.key) };
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
  if (!electrician) throw new WorkflowError("Enter the electrician name, licence number and a valid price inc GST.");
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

/** Whether the caller's business has been invited to Mitti by the office (false when unknown). */
export async function tradeMittiInvited(userId: string) {
  const c = await tradeContext(userId);
  return { invited: c?.biz.mitti_account_invited === true };
}

/** Office only: tick/untick "Mitti account invited" for a partner. */
export async function setMittiInvited(actorId: string, businessId: string, invited: boolean) {
  const { error } = await admin.from("businesses").update({ mitti_account_invited: invited, mitti_account_invited_at: invited ? new Date().toISOString() : null, mitti_account_invited_by: invited ? actorId : null }).eq("id", businessId);
  if (error) throw new WorkflowError(error.message);
  await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: "partner_mitti_invited", summary: `Mitti account invited ${invited ? "ticked" : "unticked"}`, details: { business_id: businessId, invited } });
  return { ok: true };
}

