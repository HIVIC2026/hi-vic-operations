// "Jo as a fake tradie": one TEST electrician partner + TEST jobs, messages only to Jo (test-send allowlist).
// Owner-side steps (paperwork, quote, payment) are simulated for these TEST jobs only and logged as such.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { TEST_ALLOWLIST, TEST_PARTNER_MARK, isTestPartner } from "./test-send.core";
import { TEST_APP_BASE, sendTestEmail, sendTestSms, simpleEmail, type SendResult } from "./test-send.server";

export const JO_BUSINESS = "Jo Test Electrical";
const JO_EMAIL = TEST_ALLOWLIST.email[0];
const JO_MOBILE = TEST_ALLOWLIST.sms[0];
const MEL_OFFSET_H = 11; // AEDT in October

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" });

async function joBusiness() {
  const { data } = await admin.from("businesses").select("*").eq("name", JO_BUSINESS).maybeSingle();
  return data;
}

export async function setupJoPartner(actorId: string) {
  const now = new Date().toISOString();
  let biz = await joBusiness();
  const fields = {
    name: JO_BUSINESS, legal_name: JO_BUSINESS, trading_name: JO_BUSINESS, business_type: "rec" as const, email: JO_EMAIL, phone: JO_MOBILE,
    commercial_route: "hivic_full_invoice", default_comms_owner: "hivic", onboarding_status: "approved", is_active: true,
    approved_by: actorId, approved_at: now, gst_registered: true, onboarding_notes: `${TEST_PARTNER_MARK} Jo as a fake tradie. Not a real partner.`,
    base_suburb: "Fraser Rise VIC 3336", coverage_lat: -37.7075, coverage_lng: 144.7181, coverage_radius_km: 50, covers_all_victoria: false,
    declared_service_origin: "Fraser Rise VIC 3336", declared_travel_radius_km: 50, capabilities: ["electrician"], service_postcodes: ["3336", "3335", "3337", "3029", "3030", "3038"],
    rec_number: "TEST-REC-JO", licence_number: "TEST-ESV-JO", signer_name: "Jo", signer_position: "Owner", signer_mobile: JO_MOBILE, signer_email: JO_EMAIL,
    accepting_new_jobs: true, receives_hivic_leads: true, weekly_capacity: 10,
  };
  if (biz) await admin.from("businesses").update(fields as never).eq("id", biz.id);
  else {
    const { data, error } = await admin.from("businesses").insert(fields as never).select("*").single();
    if (error) throw new WorkflowError(`Could not create ${JO_BUSINESS}: ${error.message}`);
    biz = data;
  }
  // Jo's sign-in (her own email). Marked qa_test so she is never treated as a real trade.
  let uid: string;
  const { data: prof } = await admin.from("profiles").select("id").eq("email", JO_EMAIL).maybeSingle();
  if (prof) {
    uid = prof.id;
    // Keep the auth user's email in sync with the allowlist (Jo corrected her test email once already).
    const { data: au } = await admin.auth.admin.getUserById(uid);
    if (au.user && au.user.email !== JO_EMAIL) {
      const { error: ue } = await admin.auth.admin.updateUserById(uid, { email: JO_EMAIL, email_confirm: true });
      if (ue) throw new WorkflowError(`Could not update Jo's sign-in email: ${ue.message}`);
    }
  }
  else {
    const { data, error } = await admin.auth.admin.createUser({ email: JO_EMAIL, email_confirm: true, password: crypto.randomUUID() + "Aa1!", user_metadata: { full_name: "Jo", qa_test: true, jo_tradie: true } });
    if (error || !data.user) throw new WorkflowError(`Could not create Jo's sign-in: ${error?.message}`);
    uid = data.user.id;
  }
  await admin.from("profiles").upsert({ id: uid, full_name: "Jo", email: JO_EMAIL, phone: JO_MOBILE, business_id: biz!.id });
  await admin.from("user_roles").upsert({ user_id: uid, role: "electrician" }, { onConflict: "user_id,role" });
  await admin.from("business_members").upsert({ business_id: biz!.id, user_id: uid, member_role: "business_admin", active: true, added_by: actorId }, { onConflict: "business_id,user_id" });
  const { data: w } = await admin.from("partner_workers").select("id").eq("business_id", biz!.id).eq("profile_id", uid).maybeSingle();
  if (!w) await admin.from("partner_workers").insert({ business_id: biz!.id, profile_id: uid, trade_role: "electrician", full_legal_name: "Jo", email: JO_EMAIL, mobile: JO_MOBILE, licence_number: "TEST-ESV-JO", approval_status: "approved", approved_by: actorId, approved_at: now, account_status: "linked" } as never);
  const r = admin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: rate } = await r.from("electrician_rates").select("id").eq("business_id", biz!.id).eq("service_type", "piesa").eq("status", "active").maybeSingle();
  if (!rate) {
    const { error } = await r.from("electrician_rates").insert({ business_id: biz!.id, service_type: "piesa", rate_inc_gst: 200, gst_included: true, effective_from: now.slice(0, 10), status: "active", approved_by: actorId, approved_at: now, source_note: "TEST partner rate for Jo as a fake tradie", created_by: actorId });
    if (error) throw new WorkflowError(`Could not save the $200 rate: ${error.message}`);
  }
  return { businessId: biz!.id, userId: uid };
}

async function both(ctx: { jobId: string | null; jobSource: string | null; label: string; actorId: string | null }, sms: string, subject: string, mail: { html: string; text: string }): Promise<SendResult[]> {
  const biz = await joBusiness();
  const c = { ...ctx, partnerIsTest: isTestPartner(biz) };
  return [await sendTestSms(c, JO_MOBILE, sms), await sendTestEmail(c, JO_EMAIL, subject, mail.html, mail.text)];
}

export async function sendJoWelcome(actorId: string) {
  const { businessId } = await setupJoPartner(actorId);
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: JO_EMAIL, options: { redirectTo: `${TEST_APP_BASE}/reset-password?next=/field/setup` } });
  if (error || !data.properties?.action_link) throw new WorkflowError(`Could not make Jo's set-up link: ${error?.message}`);
  const link = data.properties.action_link;
  await admin.from("businesses").update({ approval_message_status: "sent_test", approval_message_queued_at: new Date().toISOString() } as never).eq("id", businessId);
  return both({ jobId: null, jobSource: null, label: "welcome", actorId },
    `HIV: Welcome aboard! ${JO_BUSINESS} is approved ✅ Set your password and finish setup (2 mins): ${link}`,
    "You're approved — welcome aboard",
    simpleEmail("Welcome aboard, Jo", [
      `${JO_BUSINESS} is approved to take safety-check jobs from Home Insulation Victoria.`,
      "Tap the button to set your password. Then a short checklist gets you ready for job alerts: check your details, rates and area, bank and job alerts.",
      "Your work area: Fraser Rise VIC 3336, 50 km. Your Pre Insulation Electrical Safety Assessment (PIESA) rate: $200.",
    ], { label: "Set up my account", url: link }));
}

export async function createJoTestJob(actorId: string) {
  const biz = await joBusiness();
  if (!biz) throw new WorkflowError("Create Jo Test Electrical first.");
  const { data: owner, error: oe } = await admin.from("owners").insert({ full_name: "TEST Owner Fraser Rise", email: "qa.owner.fraserrise@hivic-test.example", phone: "0400000999" }).select("id").single();
  if (oe) throw new WorkflowError(oe.message);
  const n = Math.floor(10 + Math.random() * 80);
  const { data: prop, error: pe } = await admin.from("properties").insert({ owner_id: owner.id, address_line: `${n} Test Street`, suburb: "Fraser Rise", state: "VIC", postcode: "3336", occupancy: "owner_occupied", is_residential: true }).select("id").single();
  if (pe) throw new WorkflowError(pe.message);
  const { data: job, error: je } = await admin.from("jobs").insert({ property_id: prop.id, owner_id: owner.id, source: "qa_test", business_unit: "hivic", stage: "piesa_and_install_window_pending", next_action: "TEST: electrician to take one of the owner's times", estimated_area_m2: 120 } as never).select("id, job_number").single();
  if (je) throw new WorkflowError(je.message);
  await logEvent(job.id, actorId, "qa_staged", "TEST job for Jo as a fake tradie: owner paperwork, quote and payment steps simulated", { business_id: biz.id }, { internal: true });
  // Owner's times: three 2-hour windows on the next three days.
  const base = new Date(); base.setUTCHours(0, 0, 0, 0);
  const slots = [8, 10, 12].map((h, i) => {
    const s = new Date(base.getTime() + (i + 1) * 86_400_000 + (h - MEL_OFFSET_H) * 3_600_000);
    return { job_id: job.id, kind: "assessment" as const, proposed_by: actorId, proposer_role: "owner", starts_at: s.toISOString(), ends_at: new Date(s.getTime() + 7_200_000).toISOString(), status: "proposed", piesa_window_round: 1, note: "TEST owner time" };
  });
  const { error: we } = await admin.from("appointment_proposals").insert(slots as never);
  if (we) throw new WorkflowError(we.message);
  await (await import("./offer-guard.server")).assertOfferPairsAllowed(job.id, [biz.id]);
  const { data: offer, error: ofe } = await admin.from("partner_offers").insert({
    job_id: job.id, business_id: biz.id, kind: "piesa", batch: 1, offered_by: actorId, expires_at: new Date(Date.now() + 4 * 3_600_000).toISOString(),
    summary: { job_number: job.job_number, suburb: "Fraser Rise", postcode: "3336", approx_area_m2: 120, access_summary: "Manhole in hallway", electrician_rate_inc_gst: 200, rate_to_confirm: false, test_staged: true, distance_km: 4 },
  } as never).select("id").single();
  if (ofe) throw new WorkflowError(ofe.message);
  const link = `${TEST_APP_BASE}/field/offer/${offer.id}`;
  const sent = await both({ jobId: job.id, jobSource: "qa_test", label: "offer", actorId },
    `HIV: New job in Fraser Rise, your rate $200. The first trade to accept gets the job. ${link}`,
    "New job in Fraser Rise — $200",
    simpleEmail("New job in Fraser Rise", ["Pre Insulation Electrical Safety Assessment (PIESA) — your rate $200.", "About 120 m² of ceiling. The owner has offered three times. The first trade to accept gets the job."], { label: "See the job", url: link }));
  return { jobId: job.id, jobNumber: job.job_number, offerId: offer.id, sent };
}

async function membership(userId: string) {
  const { data } = await admin.from("business_members").select("business_id").eq("user_id", userId).eq("active", true);
  return new Set((data ?? []).map((m) => m.business_id));
}

/** Trade view of one offer. Owner and address only once this business has taken it. */
export async function offerView(offerId: string, userId: string) {
  const { data: o } = await admin.from("partner_offers").select("id, job_id, business_id, kind, status, summary, expires_at, responded_by").eq("id", offerId).maybeSingle();
  if (!o || !(await membership(userId)).has(o.business_id)) throw new WorkflowError("This offer isn't for your business.");
  const { data: windows } = await admin.from("appointment_proposals").select("id, starts_at, ends_at, status").eq("job_id", o.job_id).not("piesa_window_round", "is", null).order("starts_at");
  const mine = o.status === "accepted";
  let locked: null | { owner: string | null; phone: string | null; address: string; start: string; end: string | null } = null;
  if (mine) {
    const [{ data: b }, { data: j }] = await Promise.all([
      admin.from("bookings").select("scheduled_start, scheduled_end").eq("job_id", o.job_id).eq("kind", "assessment").neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("jobs").select("owners(full_name, phone), properties(address_line, suburb, state, postcode)").eq("id", o.job_id).single(),
    ]);
    const ow = j?.owners as { full_name: string | null; phone: string | null } | null;
    const p = j?.properties as { address_line: string; suburb: string | null; state: string | null; postcode: string | null } | null;
    if (b) locked = { owner: ow?.full_name ?? null, phone: ow?.phone ?? null, address: [p?.address_line, p?.suburb, p?.state, p?.postcode].filter(Boolean).join(" "), start: b.scheduled_start, end: b.scheduled_end };
  }
  return { id: o.id, jobId: o.job_id, status: o.status, summary: o.summary as { suburb?: string; postcode?: string; approx_area_m2?: number; access_summary?: string; electrician_rate_inc_gst?: number; distance_km?: number }, expiresAt: o.expires_at, windows: (windows ?? []).filter((w) => w.status === "proposed" || w.status === "accepted"), locked };
}

export async function takeJoOffer(offerId: string, proposalId: string, userId: string) {
  const { data: o } = await admin.from("partner_offers").select("id, job_id, business_id, summary, status").eq("id", offerId).maybeSingle();
  if (!o || !(await membership(userId)).has(o.business_id)) throw new WorkflowError("This offer isn't for your business.");
  const { data: job } = await admin.from("jobs").select("source").eq("id", o.job_id).single();
  const staged = job?.source === "qa_test" && (o.summary as { test_staged?: boolean })?.test_staged;
  if (!staged) {
    const { respondToRecOffer } = await import("./allocation.server");
    return { ...(await respondToRecOffer(offerId, userId, true, null, proposalId)), tooSlow: false };
  }
  const { data, error } = await admin.rpc("accept_partner_offer_slot" as never, { _offer: offerId, _user: userId, _proposal: proposalId } as never);
  if (error) throw new Error(error.message);
  const row = (data as unknown as { outcome: string; assignment_id: string | null }[] | null)?.[0];
  if (row?.outcome !== "accepted") return { ok: false, tooSlow: true, outcome: row?.outcome ?? "not_found" };
  const { data: p } = await admin.from("appointment_proposals").select("starts_at, ends_at").eq("id", proposalId).single();
  await admin.from("bookings").insert({ job_id: o.job_id, kind: "assessment", scheduled_start: p!.starts_at, scheduled_end: p!.ends_at, status: "confirmed", booked_by: userId, contractor_id: userId, assignment_id: row.assignment_id, business_id: o.business_id, notes: "TEST booking (Jo as a fake tradie)" } as never);
  await admin.from("jobs").update({ stage: "piesa_scheduled", next_action: "TEST: Pre Insulation Electrical Safety Assessment (PIESA) booked" } as never).eq("id", o.job_id);
  await logEvent(o.job_id, userId, "booking_confirmed", `TEST: Pre Insulation Electrical Safety Assessment (PIESA) booked for ${when(p!.starts_at)}`, { proposal_id: proposalId }, { internal: true });
  const link = `${TEST_APP_BASE}/field/day/${o.job_id}`;
  await both({ jobId: o.job_id, jobSource: "qa_test", label: "booked", actorId: userId },
    `HIV: Locked in ✅ Pre Insulation Electrical Safety Assessment (PIESA) ${when(p!.starts_at)}, Fraser Rise. Details: ${link}`,
    "Locked in — Pre Insulation Electrical Safety Assessment (PIESA) booked",
    simpleEmail("Job accepted — you're booked", [`Pre Insulation Electrical Safety Assessment (PIESA) on ${when(p!.starts_at)} in Fraser Rise.`, "The owner's name, address and phone are on the job page. Add it to your calendar from there."], { label: "Open the job", url: link }));
  return { ok: true, tooSlow: false };
}

export async function joReminder(jobId: string, actorId: string) {
  const { data: b } = await admin.from("bookings").select("scheduled_start, jobs!inner(source, properties(address_line, suburb))").eq("job_id", jobId).eq("kind", "assessment").eq("status", "confirmed").maybeSingle();
  if (!b) throw new WorkflowError("No booked Pre Insulation Electrical Safety Assessment (PIESA) on this TEST job yet.");
  const j = b.jobs as { source: string; properties: { address_line: string; suburb: string | null } | null };
  if (j.source !== "qa_test") throw new WorkflowError("TEST jobs only.");
  const link = `${TEST_APP_BASE}/field/day/${jobId}`;
  const at = when(b.scheduled_start);
  return both({ jobId, jobSource: "qa_test", label: "reminder", actorId },
    `HIV: Reminder — Pre Insulation Electrical Safety Assessment (PIESA) tomorrow ${at}, ${j.properties?.address_line}, ${j.properties?.suburb}. Before you go: ${link}`,
    "Reminder — Pre Insulation Electrical Safety Assessment (PIESA) tomorrow",
    simpleEmail("See you tomorrow", [`Pre Insulation Electrical Safety Assessment (PIESA) ${at} at ${j.properties?.address_line}, ${j.properties?.suburb}.`, "Open the day page before you leave: phone check, sharp-photo tips and location steps."], { label: "Open day page", url: link }));
}

export async function simulateJoAllClear(jobId: string, actorId: string) {
  const { data: job } = await admin.from("jobs").select("source").eq("id", jobId).single();
  if (job?.source !== "qa_test") throw new WorkflowError("TEST jobs only.");
  const now = new Date().toISOString();
  const { data: a } = await admin.from("assessments").select("id").eq("job_id", jobId).maybeSingle();
  const fields = { status: "complete", piesa_outcome: "pass", completed_at: now, assessed_on: now.slice(0, 10), no_rectification_confirmed: true, notes: "TEST: simulated Mitti form result (all clear)" };
  if (a) await admin.from("assessments").update(fields as never).eq("id", a.id);
  else await admin.from("assessments").insert({ job_id: jobId, ...fields } as never);
  await admin.from("bookings").update({ status: "completed" }).eq("job_id", jobId).eq("kind", "assessment").eq("status", "confirmed");
  await admin.from("jobs").update({ stage: "piesa_complete", next_action: "TEST: all clear — office sign-off, then payout" } as never).eq("id", jobId);
  await logEvent(jobId, actorId, "qa_simulated_result", "TEST: simulated Mitti PIESA result — all clear", {}, { internal: true });
  const link = `${TEST_APP_BASE}/field/money`;
  return both({ jobId, jobSource: "qa_test", label: "all_clear", actorId },
    `HIV: All clear ✅ Nice work. $200 is on its way once the office signs it off. ${link}`,
    "All clear — $200 on its way",
    simpleEmail("All clear — nice work", ["No fixes needed. $200 is coming your way once the office signs the job off."], { label: "See Money", url: link }));
}

export async function joDay(jobId: string, userId: string) {
  const ids = await membership(userId);
  const { data: asg } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle();
  if (!asg?.business_id || !ids.has(asg.business_id)) throw new WorkflowError("This job isn't assigned to you.");
  const [{ data: b }, { data: j }, { data: a }, { data: s }] = await Promise.all([
    admin.from("bookings").select("scheduled_start, scheduled_end, status").eq("job_id", jobId).eq("kind", "assessment").neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("jobs").select("job_number, stage, owners(full_name, phone), properties(address_line, suburb, state, postcode)").eq("id", jobId).single(),
    admin.from("assessments").select("status, piesa_outcome, external_mitti_id").eq("job_id", jobId).maybeSingle(),
    admin.from("workflow_settings").select("mitti_piesa_template_id").eq("id", 1).maybeSingle(),
  ]);
  const p = j?.properties as { address_line: string; suburb: string | null; state: string | null; postcode: string | null } | null;
  const ow = j?.owners as { full_name: string | null; phone: string | null } | null;
  return {
    jobNumber: j?.job_number, stage: j?.stage, owner: ow?.full_name ?? null, phone: ow?.phone ?? null,
    address: [p?.address_line, p?.suburb, p?.state, p?.postcode].filter(Boolean).join(" "),
    start: b?.scheduled_start ?? null, end: b?.scheduled_end ?? null,
    outcome: a?.status === "complete" ? (a.piesa_outcome === "pass" ? "all_clear" : "fixes") : null,
    mittiReady: !!s?.mitti_piesa_template_id, mittiId: a?.external_mitti_id ?? null,
  };
}

/** Money: this business's taken safety checks with their agreed rate and where each is up to. */
export async function tradeMoney(userId: string) {
  const ids = [...(await membership(userId))];
  if (!ids.length) return { rows: [], upcoming: 0, month: 0, allTime: 0 };
  const { data } = await admin.from("partner_offers").select("job_id, summary, responded_at, jobs!inner(job_number, stage, channel, electrician_choice, properties(suburb))").in("business_id", ids).eq("status", "accepted").order("responded_at", { ascending: false });
  // Owner-direct (installer's own electrician) work is invoiced to the owner, never an HIV payout. Accepted HIV quotes with a PIESA line stay payable.
  const { electricalBillingSource } = await import("./installer-led.core");
  const jids = [...new Set((data ?? []).map((o) => o.job_id))];
  const { data: accQ } = jids.length ? await admin.from("quotes").select("job_id, quote_items(code)").in("job_id", jids).eq("status", "accepted") : { data: [] as { job_id: string; quote_items: { code: string | null }[] }[] };
  const withLine = (id: string) => { const q = (accQ ?? []).filter((x) => x.job_id === id); return q.length ? q.some((x) => ((x.quote_items as { code: string | null }[] | null) ?? []).some((i) => i.code === "PIESA")) : null; };
  const done = new Set(["piesa_complete", "installation_scheduling", "installation_booked", "evidence_outstanding", "ap_review", "ready_for_veec", "complete"]);
  const m0 = new Date(); m0.setDate(1);
  const rows = (data ?? []).filter((o) => { const j = o.jobs as { channel: string | null; electrician_choice: string | null }; return electricalBillingSource({ channel: j.channel, choice: j.electrician_choice, committedLineOnAcceptedQuote: withLine(o.job_id), hivPaidAt: null }) === "hivic"; }).map((o) => {
    const j = o.jobs as { job_number: string; stage: string; properties: { suburb: string | null } | null };
    const amount = Number((o.summary as { electrician_rate_inc_gst?: number })?.electrician_rate_inc_gst ?? 0);
    const status = done.has(j.stage) ? "Waiting for office sign-off" : "Booked — do the check first";
    return { jobId: o.job_id, jobNumber: j.job_number, suburb: j.properties?.suburb ?? null, amount, status, earned: done.has(j.stage), at: o.responded_at };
  });
  const earned = rows.filter((r) => r.earned);
  return { rows, upcoming: earned.reduce((t, r) => t + r.amount, 0), month: earned.filter((r) => r.at && new Date(r.at) >= m0).reduce((t, r) => t + r.amount, 0), allTime: earned.reduce((t, r) => t + r.amount, 0) };
}

/** Setup checklist facts for the signed-in boss. */
export async function tradeSetup(userId: string) {
  const ids = [...(await membership(userId))];
  const { data: b } = ids.length ? await admin.from("businesses").select("id, name, base_suburb, coverage_radius_km, covers_all_victoria, rec_number").in("id", ids).limit(1).maybeSingle() : { data: null };
  if (!b) return null;
  const r = admin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [{ data: rate }, { count: bank }, { data: prof }] = await Promise.all([
    r.from("electrician_rates").select("rate_inc_gst").eq("business_id", b.id).eq("service_type", "piesa").eq("status", "active").maybeSingle(),
    admin.from("business_bank_details").select("business_id", { count: "exact", head: true }).eq("business_id", b.id),
    admin.from("profiles").select("full_name, phone, email").eq("id", userId).maybeSingle(),
  ]);
  return { business: b.name, name: prof?.full_name ?? null, mobile: prof?.phone ?? null, email: prof?.email ?? null, area: b.covers_all_victoria ? "Anywhere in Victoria" : `${b.base_suburb ?? "—"}, ${b.coverage_radius_km ?? "?"} km`, rate: rate ? Number(rate.rate_inc_gst) : null, bankDone: !!bank };
}

export async function joStatus() {
  const biz = await joBusiness();
  if (!biz) return { business: null, jobs: [] as { id: string; job_number: string; stage: string }[] };
  const { data: offers } = await admin.from("partner_offers").select("job_id, jobs!inner(job_number, stage, source, qa_archived_at)").eq("business_id", biz.id).order("offered_at", { ascending: false }).limit(10);
  const jobs = (offers ?? []).map((o) => ({ id: o.job_id, ...(o.jobs as { job_number: string; stage: string }) }));
  const { data: sends } = await admin.from("admin_config_events").select("summary, details, created_at").eq("event_type", "test_send").order("created_at", { ascending: false }).limit(12);
  return { business: { id: biz.id, name: biz.name }, jobs, sends: sends ?? [] };
}
