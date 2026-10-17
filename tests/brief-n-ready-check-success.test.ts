// Brief N — the READY CHECK SUCCESS PATH, end to end, against the disposable local Supabase stack.
//
// Coverage: Homeowner availability → Office dispatch → Installer visibility → Installer acceptance →
// Installer Ready Check submission → Office handoff, plus the negative/RLS cases around it.
//
// Every business step is driven through the application's OWN service functions (the same ones the
// server-function handlers delegate to), against the real database. Nothing is mocked except the external
// boundary, which is *removed* rather than stubbed: no Mitti token, no mail/SMS transport.
//
// Run on its own (bun shares mock.module across files in one process):
//   bun test tests/brief-n-ready-check-success.test.ts
import { beforeAll, describe, expect, test } from "bun:test";
import {
  ALL_JOBS, ID, asAnon, asUser, assignmentsFor, assertAppClientIsReal, eventsFor, externalActionsFor,
  failure, jobRow, offersFor, preflight, seedFixtures, serviceAdmin, windowsFor, type Admin,
} from "./brief-n/harness";
import { FULL_RC_VALUES, MESSAGES } from "./brief-n/messages";

let admin: Admin;

/** Allowed owner days, computed from the same rule the owner's times page uses. */
async function ownerPicks(count = 3) {
  const { allowedPiesaDays } = await import("@/lib/piesa-windows.core");
  const days = allowedPiesaDays(new Date());
  const slots = ["10-12", "12-14", "8-10", "14-16"] as const;
  return Array.from({ length: count }, (_, i) => ({ date: days[i]!, slot: slots[i % slots.length]! }));
}

function ymd(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}


/**
 * The visit evidence the installer records on site. The disposable stack has no object-storage bucket, so the
 * evidence *record* is written (that is what the Ready Check progress gate reads) and the requirement is moved
 * to "uploaded". No real property, no real photo.
 */
async function recordVisitEvidence(jobId: string) {
  const { data: req } = await admin.from("evidence_requirements").select("id, category, status")
    .eq("job_id", jobId).eq("category", "measurement").maybeSingle();
  if (!req) throw new Error(`no measurement evidence requirement on ${jobId}`);
  if ((req as { status: string }).status !== "outstanding") return;
  const { error } = await admin.from("evidence_files").insert({
    requirement_id: (req as { id: string }).id, job_id: jobId,
    storage_path: `${jobId}/brief-n/ceiling-measurement.jpg`, file_name: "ceiling-measurement.jpg",
    mime_type: "image/jpeg", size_bytes: 128, uploaded_by: ID.installerAProfile,
    lat: -37.8183, lng: 144.9986, location_accuracy_m: 10, captured_at: new Date().toISOString(),
    distance_m: 5, location_source: "device",
  } as never);
  if (error) throw new Error(`evidence record: ${error.message}`);
  await admin.from("evidence_requirements").update({ status: "uploaded" }).eq("id", (req as { id: string }).id);
}

/** The measure-up row the installer's on-site form writes (same shape saveMeasurement writes: draft, current). */
async function recordMeasureUpDraft(jobId: string) {
  await admin.from("ceiling_measurements").update({ is_current: false }).eq("job_id", jobId).eq("is_current", true);
  const { error } = await admin.from("ceiling_measurements").insert({
    job_id: jobId, status: "draft", is_current: true, source_role: "installer", created_by: ID.installerAProfile,
    measured_area_m2: 120, insulation_present: false, removal_required: false, access_difficulty: "easy",
  } as never);
  if (error) throw new Error(`measure-up draft: ${error.message}`);
}

beforeAll(async () => {
  await preflight();
  admin = await serviceAdmin();
  await assertAppClientIsReal();
  await seedFixtures(admin);
});

describe("0 — environment and fixture integrity", () => {
  test("the disposable stack is local and the fixtures are synthetic", async () => {
    expect(process.env["SUPABASE_URL"]).toBe("http://localhost:54331");
    const { data } = await admin.from("jobs").select("source, job_number").in("id", ALL_JOBS as unknown as string[]);
    expect((data ?? []).length).toBe(ALL_JOBS.length);
    for (const j of data ?? []) {
      expect((j as { source: string }).source).toBe("qa_test");
      expect((j as { job_number: string }).job_number.startsWith("BRIEF-N-")).toBe(true);
    }
  });

  test("Gate A consent exists for every synthetic job (offer dispatch depends on it)", async () => {
    const { data } = await admin.from("owner_contact_consents").select("job_id")
      .in("job_id", ALL_JOBS as unknown as string[]).eq("source", "onsite_ready_check").eq("consent_status", "granted");
    expect(new Set((data ?? []).map((c) => (c as { job_id: string }).job_id)).size).toBe(ALL_JOBS.length);
  });
});

describe("A — homeowner provides Ready Check availability", () => {
  test("A1/A2/A4/A5/A6 — valid windows persist as open booking windows and the office can see them", async () => {
    const { submitReadyCheckWindows, readyCheckWindowRound, ownerReadyCheckWindowState } = await import("@/lib/readycheck-booking.server");
    const picks = await ownerPicks(3);

    const res = await submitReadyCheckWindows(ID.jobFlow, picks as never);
    expect(res.ok).toBe(true);
    expect(res.round).toBe(1);

    const windows = await windowsFor(admin, ID.jobFlow);
    expect(windows.length).toBe(3);
    for (const w of windows) {
      expect(w.round).toBe(1);
      expect(w.status).toBe("open");
      // The schema/rule is a two-hour window, on the day the owner picked.
      const hours = (Date.parse(w.ends_at) - Date.parse(w.starts_at)) / 3_600_000;
      expect(hours).toBe(2);
    }
    // Three different days, as the rule requires (compared in Melbourne time, which is what the owner sees).
    const { melbourneYmd } = await import("@/lib/piesa-windows.core");
    expect(new Set(windows.map((w) => melbourneYmd(new Date(w.starts_at)))).size).toBe(3);

    const round = await readyCheckWindowRound(ID.jobFlow);
    expect(round.open.length).toBe(3);

    const state = await ownerReadyCheckWindowState(ID.jobFlow);
    expect(state.canPick).toBe(false);
    expect(state.windows.length).toBe(3);

    // The office sees the times as open (this is what officeStatus keys "Owner picked times" on).
    const { data: job } = await admin.from("jobs").select("next_action, stage").eq("id", ID.jobFlow).single();
    expect((job as { next_action: string }).next_action).toBe("Waiting for an installer to take one of the owner's Ready Check times");
    expect((job as { stage: string }).stage).toBe("ready_check_ready_to_schedule");
  });

  test("A3 — invalid windows are rejected with the real rule messages", async () => {
    const { submitReadyCheckWindows } = await import("@/lib/readycheck-booking.server");
    const picks = await ownerPicks(3);

    // Two times also fails the "three different days" rule, so both reasons come back together.
    expect(await failure(() => submitReadyCheckWindows(ID.jobWrongStage, [picks[0]!, picks[1]!] as never)))
      .toContain(MESSAGES.tooFewTimes);

    expect(await failure(() => submitReadyCheckWindows(ID.jobWrongStage, [
      { date: picks[0]!.date, slot: "10-12" }, { date: picks[0]!.date, slot: "12-14" }, { date: picks[1]!.date, slot: "10-12" },
    ] as never))).toBe(MESSAGES.notEnoughDays);

    expect(await failure(() => submitReadyCheckWindows(ID.jobWrongStage, [
      picks[0]!, picks[0]!, picks[1]!,
    ] as never))).toContain(MESSAGES.duplicateTime);

    // Today/tomorrow/the day after are inside the lead time, so they are not offered days at all.
    expect(await failure(() => submitReadyCheckWindows(ID.jobWrongStage, [
      { date: ymd(0), slot: "10-12" }, { date: ymd(1), slot: "10-12" }, { date: ymd(2), slot: "10-12" },
    ] as never))).toBe(MESSAGES.outsideAllowedDays);

    // Nothing was written by any rejected attempt.
    expect((await windowsFor(admin, ID.jobWrongStage)).length).toBe(0);

    // A second round of times is refused while the first round is still open with installers.
    expect(await failure(() => submitReadyCheckWindows(ID.jobFlow, picks as never)))
      .toBe(MESSAGES.windowsAlreadyWithInstallers);
  });

  test("A7 — providing times sends nothing and queues no external action", async () => {
    expect(await externalActionsFor(admin, ID.jobFlow)).toEqual([]);
    expect(await externalActionsFor(admin, ID.jobWrongStage)).toEqual([]);
  });
});

describe("B — office sends the Ready Check offer", () => {
  test("B1–B4 — the exact preconditions hold before dispatch", async () => {
    const job = await jobRow(admin, ID.jobFlow);
    expect(job.stage).toBe("ready_check_ready_to_schedule");
    expect((await assignmentsFor(admin, ID.jobFlow)).length).toBe(0);
    expect((await offersFor(admin, ID.jobFlow)).length).toBe(0);
    expect((await windowsFor(admin, ID.jobFlow)).filter((w) => w.status === "open").length).toBe(3);
  });

  test("B5 — the unapproved business is a candidate but carries a hard blocker, so it can never be offered", async () => {
    const { installerCandidatesFor } = await import("@/lib/readycheck-booking.server");
    const { candidates } = await installerCandidatesFor(ID.jobFlow);
    const byId = new Map(candidates.map((c) => [c.business_id, c]));
    expect(byId.get(ID.bizA)?.blocker).toBeNull();
    expect(byId.get(ID.bizB)?.blocker).toBeNull();
    // It IS evaluated (it is an active TEST partner covering the postcode) but is refused by the approval rule.
    expect(byId.get(ID.bizUnapproved)?.blocker).toBe("Installer business is not approved and active.");
  });

  test("B6–B8 — dispatch writes the offer, the booking context and the workflow event", async () => {
    const { startReadyCheckOffers } = await import("@/lib/readycheck-booking.server");
    const res = await startReadyCheckOffers(ID.jobFlow, ID.officeProfile, [ID.bizA], { adding: false });
    expect(res.offered).toBe(1);
    expect(res.exhausted).toBe(false);

    const offers = await offersFor(admin, ID.jobFlow);
    expect(offers.length).toBe(1);
    const o = offers[0]!;
    expect(o.job_id).toBe(ID.jobFlow);
    expect(o.business_id).toBe(ID.bizA);
    expect(o.kind).toBe("ready_check");
    expect(o.status).toBe("pending");
    expect(o.batch).toBe(1);
    expect(o.offered_by).toBe(ID.officeProfile);
    expect(Date.parse(o.expires_at!)).toBeGreaterThan(Date.now());

    const summary = o.summary as Record<string, unknown>;
    expect(summary["job_number"]).toBe("BRIEF-N-FLOW-1");
    expect(summary["suburb"]).toBe("Richmond");
    expect(summary["postcode"]).toBe("3121");
    expect(summary["visit"]).toBe("ready_check");
    expect(summary["office_choice"]).toBe(true);
    expect(String(summary["unpaid_note"])).toContain("Free Ready Check");

    const events = await eventsFor(admin, ID.jobFlow);
    const chosen = events.find((e) => e.event_type === "trade_chosen_by_office");
    expect(chosen).toBeTruthy();
    expect((chosen!.details as { business_ids: string[] }).business_ids).toEqual([ID.bizA]);

    // The job stage is unchanged: offering does not assign.
    expect((await jobRow(admin, ID.jobFlow)).stage).toBe("ready_check_ready_to_schedule");
    expect((await assignmentsFor(admin, ID.jobFlow)).length).toBe(0);
  });

  test("B — no real external notification was generated by the offer", async () => {
    expect(await externalActionsFor(admin, ID.jobFlow)).toEqual([]);
  });
});

describe("C — installer receives the offer", () => {
  test("C1/C2 — it appears in the intended installer's My work with the owner's times", async () => {
    const { tradeHome, tradeOffer } = await import("@/lib/trade-view.server");
    const { readyCheckOfferWindows } = await import("@/lib/readycheck-booking.server");
    const home = await tradeHome(ID.installerAProfile);
    const offer = home.offers.find((o) => o.kind === "ready_check");
    expect(offer).toBeTruthy();
    expect(offer!.suburb).toBe("Richmond");

    const offers = await offersFor(admin, ID.jobFlow);
    const detail = await tradeOffer(offers[0]!.id, ID.installerAProfile);
    expect(detail.windows.length).toBe(3);
    expect(detail.status).toBe("pending");
    expect(detail.locked).toBeNull(); // no owner contact before it is taken
    expect(detail.jobId).toBe(ID.jobFlow);

    const windows = await readyCheckOfferWindows([ID.jobFlow]);
    expect(windows.length).toBe(3);
    // Ordered by start, and only times that are still in the future are returned.
    expect(windows.map((w) => w.starts_at)).toEqual([...windows.map((w) => w.starts_at)].sort());
    expect(windows.every((w) => Date.parse(w.starts_at) > Date.now())).toBe(true);
  });

  test("C3/C4/C5 — another installer, an anonymous caller and a direct read are all refused", async () => {
    const { tradeHome, tradeOffer } = await import("@/lib/trade-view.server");
    const otherHome = await tradeHome(ID.installerBProfile);
    expect(otherHome.offers.length).toBe(0);

    const offers = await offersFor(admin, ID.jobFlow);
    expect(await failure(() => tradeOffer(offers[0]!.id, ID.installerBProfile))).toBe(MESSAGES.notYourOffer);

    // Real RLS: PostgREST as role `authenticated` with auth.uid() = the user.
    const a = await asUser(ID.installerAProfile);
    const b = await asUser(ID.installerBProfile);
    const anon = await asAnon();

    const aSees = await a.from("partner_offers").select("id").eq("job_id", ID.jobFlow);
    expect((aSees.data ?? []).length).toBe(1);

    const bSees = await b.from("partner_offers").select("id").eq("job_id", ID.jobFlow);
    expect((bSees.data ?? []).length).toBe(0);

    const anonSees = await anon.from("partner_offers").select("id").eq("job_id", ID.jobFlow);
    expect((anonSees.data ?? []).length).toBe(0);

    // Job data before acceptance: the offer alone must not open the job.
    const aJob = await a.from("jobs").select("id").eq("id", ID.jobFlow);
    expect((aJob.data ?? []).length).toBe(0);
    const aAccess = await a.rpc("can_access_job", { _job: ID.jobFlow });
    expect(aAccess.data).toBe(false);
    const anonAccess = await anon.rpc("can_access_job", { _job: ID.jobFlow });
    expect(anonAccess.data).toBe(false);

    // Owner times are office-only over RLS; the installer gets them through the scoped service call only.
    const aWindows = await a.from("ready_check_windows").select("id").eq("job_id", ID.jobFlow);
    expect((aWindows.data ?? []).length).toBe(0);
  });

  test("C6 — viewing the offer does not assign anybody", async () => {
    expect((await assignmentsFor(admin, ID.jobFlow)).length).toBe(0);
    expect((await offersFor(admin, ID.jobFlow))[0]!.status).toBe("pending");
  });
});

describe("D — installer accepts the offer", () => {
  let offerId = "";
  let windowId = "";

  test("D1–D3/D7 — the intended installer takes a time; assignment, booking and events are written", async () => {
    const { tradeTakeTime } = await import("@/lib/trade-view.server");
    const offers = await offersFor(admin, ID.jobFlow);
    offerId = offers[0]!.id;
    const windows = (await windowsFor(admin, ID.jobFlow)).filter((w) => w.status === "open");
    windowId = windows[0]!.id;

    const took = await tradeTakeTime(offerId, windowId, ID.installerAProfile);
    expect(took.tooSlow).toBe(false);

    const after = (await offersFor(admin, ID.jobFlow))[0]!;
    expect(after.status).toBe("accepted");
    expect(after.responded_by).toBe(ID.installerAProfile);
    expect(after.responded_at).toBeTruthy();

    const asg = await assignmentsFor(admin, ID.jobFlow);
    expect(asg.length).toBe(1);
    expect(asg[0]!.user_id).toBe(ID.installerAProfile);
    expect(asg[0]!.business_id).toBe(ID.bizA);
    expect(asg[0]!.role).toBe("installer");
    expect(asg[0]!.active).toBe(true);
    expect(asg[0]!.first_response_at).toBeTruthy();
    expect(asg[0]!.booking_confirmed_at).toBeTruthy();

    // The taken window is marked taken, the other owner times close.
    const windowsAfter = await windowsFor(admin, ID.jobFlow);
    const taken = windowsAfter.find((w) => w.id === windowId)!;
    expect(taken.status).toBe("taken");
    expect(taken.taken_by).toBe(ID.installerAProfile);
    expect(taken.taken_offer_id).toBe(offerId);
    expect(windowsAfter.filter((w) => w.status === "open").length).toBe(0);

    // The booking is the real one confirmBooking writes, at the owner's chosen start.
    const { data: booking } = await admin.from("bookings").select("kind, status, scheduled_start, scheduled_end, business_id, contractor_id")
      .eq("job_id", ID.jobFlow).eq("kind", "ready_check").maybeSingle();
    expect(booking).toBeTruthy();
    expect((booking as { status: string }).status).toBe("confirmed");
    expect((booking as { scheduled_start: string }).scheduled_start).toBe(taken.starts_at);
    expect((booking as { business_id: string }).business_id).toBe(ID.bizA);

    // Contact release: the trade only gets owner contact with a recorded release.
    const { data: release } = await admin.from("contact_releases").select("visit_kind, owner_notice, trade_notice")
      .eq("job_id", ID.jobFlow).eq("visit_kind", "ready_check").maybeSingle();
    expect(release).toBeTruthy();
    expect((release as { trade_notice: string }).trade_notice).toContain("Do not use them for unrelated marketing");

    const events = await eventsFor(admin, ID.jobFlow);
    expect(events.some((e) => e.event_type === "ready_check_window_taken")).toBe(true);
    expect(events.some((e) => e.event_type === "stage_changed" && e.to_stage === "ready_check_scheduled")).toBe(true);
  });

  test("D3/D4 — the job moves to Ready Check booked and becomes visible to the assigned installer only", async () => {
    expect((await jobRow(admin, ID.jobFlow)).stage).toBe("ready_check_scheduled");

    const a = await asUser(ID.installerAProfile);
    const b = await asUser(ID.installerBProfile);
    const aJob = await a.from("jobs").select("id, job_number").eq("id", ID.jobFlow);
    expect((aJob.data ?? []).length).toBe(1);
    expect(await a.rpc("can_access_job", { _job: ID.jobFlow })).toMatchObject({ data: true });

    const bJob = await b.from("jobs").select("id").eq("id", ID.jobFlow);
    expect((bJob.data ?? []).length).toBe(0);
    expect(await b.rpc("can_access_job", { _job: ID.jobFlow })).toMatchObject({ data: false });

    const { requireTradeJob } = await import("@/lib/trade-view.server");
    expect((await requireTradeJob(ID.installerAProfile, ID.jobFlow)).biz.id).toBe(ID.bizA);
    expect(await failure(() => requireTradeJob(ID.installerBProfile, ID.jobFlow))).toBe(MESSAGES.notYourJob);
  });

  test("D — the installer now sees the owner contact and the booked time", async () => {
    const { tradeOffer } = await import("@/lib/trade-view.server");
    const offers = await offersFor(admin, ID.jobFlow);
    const detail = await tradeOffer(offers[0]!.id, ID.installerAProfile);
    expect(detail.status).toBe("accepted");
    expect(detail.locked).toBeTruthy();
    expect(detail.locked!.owner).toBe("Brief N Owner");
    expect(detail.locked!.address).toContain("1 Brief N Street");
    expect(detail.locked!.phone).toBe("0400000000");
  });

  test("D8 — accepting twice does not create a second assignment", async () => {
    const { tradeTakeTime } = await import("@/lib/trade-view.server");
    const again = await tradeTakeTime(offerId, windowId, ID.installerAProfile);
    expect(again.tooSlow).toBe(true);
    expect((await assignmentsFor(admin, ID.jobFlow)).length).toBe(1);
    expect((await offersFor(admin, ID.jobFlow))[0]!.status).toBe("accepted");
  });

  test("D — an unrelated installer cannot take the offer (cross-business refusal)", async () => {
    const { startReadyCheckOffers } = await import("@/lib/readycheck-booking.server");
    // Second run of the same workflow on a fresh job, so the refusal is tested on a live offer.
    await (await import("@/lib/readycheck-booking.server")).submitReadyCheckWindows(ID.jobRepeat, (await ownerPicks(3)) as never);
    await startReadyCheckOffers(ID.jobRepeat, ID.officeProfile, [ID.bizA], { adding: false });
    const offer = (await offersFor(admin, ID.jobRepeat))[0]!;
    const window = (await windowsFor(admin, ID.jobRepeat)).find((w) => w.status === "open")!;

    const { respondToReadyCheckOffer } = await import("@/lib/readycheck-booking.server");
    const msg = await failure(() => respondToReadyCheckOffer(offer.id, ID.installerBProfile, true, null, window.id));
    expect(msg).toBe(MESSAGES.differentBusiness);
    // Nothing was assigned and the offer is still open for the right installer.
    expect((await assignmentsFor(admin, ID.jobRepeat)).length).toBe(0);
    expect((await offersFor(admin, ID.jobRepeat))[0]!.status).toBe("pending");

    // …and the right installer can then take it.
    const { tradeTakeTime } = await import("@/lib/trade-view.server");
    expect((await tradeTakeTime(offer.id, window.id, ID.installerAProfile)).tooSlow).toBe(false);
    expect((await assignmentsFor(admin, ID.jobRepeat)).length).toBe(1);
  });
});

describe("E — installer performs and submits the Ready Check", () => {
  test("E1/E2 — the required pricing acknowledgement is recorded on the booked visit", async () => {
    const { confirmHivicReadyCheckPricing } = await import("@/lib/trade-view.server");
    expect(await confirmHivicReadyCheckPricing(ID.jobFlow, ID.installerAProfile)).toEqual({ ok: true });
    const events = await eventsFor(admin, ID.jobFlow);
    expect(events.some((e) => e.event_type === "installer_hivic_pricing_acknowledged")).toBe(true);
  });

  test("E3/E4 — invalid Ready Check answers are rejected, valid ones save as a draft", async () => {
    const { saveRcDraft, loadRcDraft } = await import("@/lib/ready-check-draft.server");

    // Invalid enum + impossible number: refused by the canonical field model, nothing persisted.
    const bad = await failure(() => saveRcDraft(ID.jobFlow, ID.installerAProfile, ID.bizA, {
      "measure.method": "eyeball", "measure.eligible_area_m2": "-5",
    }));
    expect(bad).toContain("Measurement method: choose an option");
    expect(bad).toContain("Measured eligible ceiling area (m²): enter a number");
    expect((await loadRcDraft(ID.jobFlow)).status).toBe("none");

    // Partial draft is allowed and durable.
    const partial = await saveRcDraft(ID.jobFlow, ID.installerAProfile, ID.bizA, {
      "measure.eligible_area_m2": "120", "insulation.existing": "none",
    });
    expect(partial.status).toBe("draft");
    expect(partial.values["measure.eligible_area_m2"]).toBe("120");
    expect(partial.progress.missingAnswers.length).toBeGreaterThan(0);

    // Submitting an incomplete Ready Check is refused with the exact missing answers.
    const { submitRcDraft } = await import("@/lib/ready-check-draft.server");
    const notReady = await failure(() => submitRcDraft(ID.jobFlow, ID.installerAProfile));
    expect(notReady.startsWith(MESSAGES.submitNotReadyPrefix)).toBe(true);
    // The area was saved by the partial draft, so it is no longer listed; the rest of the form still is.
    expect(notReady).toContain("Answer needed: Attended at");
    expect(notReady).toContain("Photo or video needed: Ceiling measurement evidence");
  });

  test("E5/E6/E7/E8/E10 — the submitted Ready Check is persisted against the right job and installer", async () => {
    const { saveRcDraft, submitRcDraft, loadRcDraft } = await import("@/lib/ready-check-draft.server");

    // The job carries the standard assessment-gate evidence requirements (created with the job).
    // The Ready Check cannot be submitted while a required one is outstanding — record the visit evidence.
    await recordVisitEvidence(ID.jobFlow);

    await saveRcDraft(ID.jobFlow, ID.installerAProfile, ID.bizA, FULL_RC_VALUES);
    const done = await submitRcDraft(ID.jobFlow, ID.installerAProfile);
    expect(done.status).toBe("submitted");
    expect(done.progress.evidence.missing).toEqual([]);
    expect(loadRcDraft).toBeTruthy();

    const { data: rc } = await admin.from("ready_checks")
      .select("id, job_id, version, status, submitted_at, installer_user_id, installer_business_id, external_mitti_id")
      .eq("job_id", ID.jobFlow).eq("status", "submitted").maybeSingle();
    expect(rc).toBeTruthy();
    const row = rc as Record<string, unknown>;
    expect(row["job_id"]).toBe(ID.jobFlow);
    expect(row["installer_user_id"]).toBe(ID.installerAProfile);
    expect(row["installer_business_id"]).toBe(ID.bizA);
    expect(row["submitted_at"]).toBeTruthy();
    expect(row["external_mitti_id"]).toBeNull(); // portal submission, not a Mitti audit

    const { data: obs } = await admin.from("ready_check_observations").select("field_key, value").eq("ready_check_id", row["id"] as string);
    expect((obs ?? []).length).toBe(Object.keys(FULL_RC_VALUES).length);
    const byKey = new Map((obs ?? []).map((o) => [(o as { field_key: string }).field_key, (o as { value: unknown }).value]));
    expect(byKey.get("measure.eligible_area_m2")).toBe(120);
    expect(byKey.get("insulation.existing")).toBe("none");
    expect(byKey.get("elec.downlight_count")).toBe(6);

    const events = await eventsFor(admin, ID.jobFlow);
    expect(events.filter((e) => e.event_type === "ready_check_draft_saved").length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.event_type === "ready_check_submitted")).toBe(true);

    // Submitting is explicitly NOT a stage change and sends nothing.
    expect((await jobRow(admin, ID.jobFlow)).stage).toBe("ready_check_scheduled");
    expect(await externalActionsFor(admin, ID.jobFlow)).toEqual([]);
  });

  test("E — the installer's own day page reflects the submission", async () => {
    const { tradeDay } = await import("@/lib/trade-view.server");
    const day = await tradeDay(ID.jobFlow, ID.installerAProfile);
    expect(day.kind).toBe("ready_check");
    expect(day.contactHidden).toBe(false);
    expect(day.owner).toBe("Brief N Owner");
    expect(day.outcome).toEqual({ kind: "quoted" });
  });

  test("E — a submitted Ready Check cannot be edited by the installer", async () => {
    const { saveRcDraft } = await import("@/lib/ready-check-draft.server");
    expect(await failure(() => saveRcDraft(ID.jobFlow, ID.installerAProfile, ID.bizA, { "measure.eligible_area_m2": "130" })))
      .toBe(MESSAGES.alreadySubmitted);
  });
});

describe("F — office receives and reviews the results", () => {
  test("F1/F2/F3/F4 — the office read model shows the submitted Ready Check on the right job", async () => {
    const { loadOffice } = await import("@/lib/office.server");
    const { jobs } = await loadOffice(admin, { includeTest: true, onlyIds: [ID.jobFlow] });
    expect(jobs.length).toBe(1);
    const job = jobs[0]!;
    expect(job.jobNumber).toBe("BRIEF-N-FLOW-1");
    expect(job.stage).toBe("ready_check_scheduled");
    expect(job.facts.rcSubmittedAt).toBeTruthy();
    expect(job.facts.rcBookingAt).toBeTruthy();
    // The office rulebook keys "started onsite" off a ceiling-measurement row, not off the portal submission,
    // so a submitted Ready Check with no measure-up yet still reads as "Booked" — and that is what it shows.
    expect(job.status?.key).toBe("ready_check.booked");
    expect(job.status?.label).toBe("Booked");
    expect(job.status?.waitingOn).toBe("Installer");

    // The moment the installer's measure-up row exists (the shape saveMeasurement writes), the office status
    // moves to "Started onsite, measure-up not finished" — the handoff is driven by recorded facts, not by a flag.
    await recordMeasureUpDraft(ID.jobFlow);
    const after = await loadOffice(admin, { includeTest: true, onlyIds: [ID.jobFlow] });
    expect(after.jobs[0]!.status?.key).toBe("ready_check.onsite_started");
    expect(after.jobs[0]!.status?.label).toBe("Started onsite, measure-up not finished");
  });

  test("F5/F6 — the next action and the responsible party come from the stage rules, not free text", async () => {
    const { nextStep } = await import("@/lib/nextstep.core");
    const job = await jobRow(admin, ID.jobFlow);
    const step = nextStep(job);
    expect(step.label).toBe("Ready Check booked");
    expect(step.next).toBe("Installer to complete Ready Check");
    expect(step.waitingOn).toBe("Installer");
  });

  test("F — the office's 'Confirm eligible' gate refuses while the wider evidence pack is incomplete", async () => {
    const { recordVerification } = await import("@/lib/verified-eligibility.server");
    const office = await asUser(ID.officeProfile);
    const msg = await failure(() => recordVerification(office as never, ID.jobFlow, "eligible", null, "Brief N: office confirmed from the submitted Ready Check"));
    // The verification gate is stricter than the Ready Check submission gate — it names exactly what is missing.
    expect(msg).toContain("Eligible needs all mandatory Ready Check evidence.");
    expect(msg).toContain("Office check: previous Activity 48 / VEU ceiling-insulation evidence");
    const { data } = await admin.from("eligibility_verifications").select("id").eq("job_id", ID.jobFlow);
    expect((data ?? []).length).toBe(0);
  });

  test("F7/F8 — the office moves the job on through the central transition guard; no other job is touched", async () => {
    const { transition } = await import("@/lib/workflow.server");
    await transition(ID.jobFlow, "ready_check_complete", ID.officeProfile, "Brief N: office completed the Ready Check review");

    expect((await jobRow(admin, ID.jobFlow)).stage).toBe("ready_check_complete");

    const { loadOffice } = await import("@/lib/office.server");
    const { jobs } = await loadOffice(admin, { includeTest: true, onlyIds: [ID.jobFlow] });
    expect(jobs[0]!.status?.key).toBe("ready_check.evidence_in");
    expect(jobs[0]!.status?.label).toBe("Evidence in, confirm eligible");
    expect(jobs[0]!.status?.waitingOn).toBe("Us");
    expect(jobs[0]!.status?.action).toBe("Confirm eligible");

    const { nextStep } = await import("@/lib/nextstep.core");
    expect(nextStep(await jobRow(admin, ID.jobFlow))).toMatchObject({
      label: "Ready Check Complete", next: "Measured estimate generates automatically", waitingOn: "Home Insulation Victoria",
    });

    // Every other synthetic job is exactly where it was.
    expect((await jobRow(admin, ID.jobWrongStage)).stage).toBe("preliminary_estimate_ready");
    expect((await jobRow(admin, ID.jobNoWindows)).stage).toBe("ready_check_ready_to_schedule");
    expect((await assignmentsFor(admin, ID.jobNoWindows)).length).toBe(0);
  });

  test("F — nothing was sent to the owner or any external service across the whole workflow", async () => {
    expect(await externalActionsFor(admin, ID.jobFlow)).toEqual([]);
    expect(await externalActionsFor(admin, ID.jobRepeat)).toEqual([]);
  });
});

describe("N — negative guards", () => {
  test("an offer cannot start without open owner times", async () => {
    const { startReadyCheckOffers } = await import("@/lib/readycheck-booking.server");
    expect(await failure(() => startReadyCheckOffers(ID.jobNoWindows, ID.officeProfile, [ID.bizA], { adding: false })))
      .toBe(MESSAGES.offerNoWindows);
  });

  test("an offer cannot start from the wrong workflow stage", async () => {
    const { startReadyCheckOffers } = await import("@/lib/readycheck-booking.server");
    const msg = await failure(() => startReadyCheckOffers(ID.jobWrongStage, ID.officeProfile, [ID.bizA], { adding: false }));
    expect(msg).toContain(MESSAGES.offerWrongStage);
  });

  test("an offer cannot start when an installer is already assigned", async () => {
    const { startReadyCheckOffers } = await import("@/lib/readycheck-booking.server");
    const msg = await failure(() => startReadyCheckOffers(ID.jobAssigned, ID.officeProfile, [ID.bizA], { adding: false }));
    expect(msg).toContain(MESSAGES.offerAssigned);
  });

  test("a second open offer is refused, and the office cannot re-send to the same trade", async () => {
    const { startReadyCheckOffers } = await import("@/lib/readycheck-booking.server");
    const msg = await failure(() => startReadyCheckOffers(ID.jobOpenOffer, ID.officeProfile, [ID.bizB], { adding: false }));
    expect(msg).toContain(MESSAGES.offerAlreadyOpen);

    // sendChosenOffers' own guard: the same business cannot be offered the same job twice.
    const { newRecipients } = await import("@/lib/offer-dispatch.core");
    expect(newRecipients([ID.bizA], new Set([ID.bizA]))).toEqual([]);
  });

  test("an unapproved business cannot receive an offer", async () => {
    const { startReadyCheckOffers, submitReadyCheckWindows } = await import("@/lib/readycheck-booking.server");
    // A job with open times and no offers yet.
    await submitReadyCheckWindows(ID.jobNoWindows, (await ownerPicks(3)) as never);
    expect(await failure(() => startReadyCheckOffers(ID.jobNoWindows, ID.officeProfile, [ID.bizUnapproved], { adding: false })))
      .toBe("Brief N Unapproved can't take this Ready Check: Installer business is not approved and active.");
    expect((await offersFor(admin, ID.jobNoWindows)).length).toBe(0);
  });

  test("an unrelated installer cannot accept another business's offer", async () => {
    // Covered in D: respondToReadyCheckOffer for business B's user returns not_member, and the offer stays open.
    expect((await offersFor(admin, ID.jobRepeat))[0]!.status).toBe("accepted");
    expect((await assignmentsFor(admin, ID.jobRepeat)).length).toBe(1);
    expect((await assignmentsFor(admin, ID.jobRepeat))[0]!.business_id).toBe(ID.bizA);
  });

  test("an anonymous user cannot read protected job data", async () => {
    const anon = await asAnon();
    expect((await anon.from("jobs").select("id").eq("id", ID.jobFlow)).data ?? []).toEqual([]);
    expect((await anon.from("partner_offers").select("id").eq("job_id", ID.jobFlow)).data ?? []).toEqual([]);
    expect((await anon.from("ready_checks").select("id").eq("job_id", ID.jobFlow)).data ?? []).toEqual([]);
    expect((await anon.from("owners").select("id").eq("id", ID.owner)).data ?? []).toEqual([]);
    // The atomic acceptance RPC is service-role only.
    const rpc = await anon.rpc("accept_ready_check_offer", { _offer: "00000000-0000-4000-8000-000000000000", _user: ID.installerAProfile, _window: null });
    expect(rpc.error).toBeTruthy();
  });

  test("a failed dispatch leaves no partial rows behind", async () => {
    const before = (await offersFor(admin, ID.jobAssigned)).length;
    expect(before).toBe(0);
    const { startReadyCheckOffers } = await import("@/lib/readycheck-booking.server");
    await failure(() => startReadyCheckOffers(ID.jobAssigned, ID.officeProfile, [ID.bizA], { adding: false }));
    expect((await offersFor(admin, ID.jobAssigned)).length).toBe(0);
    expect((await windowsFor(admin, ID.jobAssigned)).length).toBe(0);
    expect((await assignmentsFor(admin, ID.jobAssigned)).length).toBe(1); // the pre-existing fixture only
  });
});

describe("R — repeatability", () => {
  test("the same workflow runs a second time on a second job and lands in the same state", async () => {
    const job = await jobRow(admin, ID.jobRepeat);
    expect(job.stage).toBe("ready_check_scheduled");
    expect((await offersFor(admin, ID.jobRepeat)).length).toBe(1);
    expect((await assignmentsFor(admin, ID.jobRepeat)).length).toBe(1);
    expect((await windowsFor(admin, ID.jobRepeat)).filter((w) => w.status === "taken").length).toBe(1);

    const { saveRcDraft, submitRcDraft } = await import("@/lib/ready-check-draft.server");
    await recordVisitEvidence(ID.jobRepeat);
    await recordMeasureUpDraft(ID.jobRepeat);
    await saveRcDraft(ID.jobRepeat, ID.installerAProfile, ID.bizA, FULL_RC_VALUES);
    expect((await submitRcDraft(ID.jobRepeat, ID.installerAProfile)).status).toBe("submitted");

    const { loadOffice } = await import("@/lib/office.server");
    const { jobs } = await loadOffice(admin, { includeTest: true, onlyIds: [ID.jobRepeat] });
    expect(jobs[0]!.facts.rcSubmittedAt).toBeTruthy();
    expect(jobs[0]!.status?.key).toBe("ready_check.onsite_started");
  });

  test("fixture reset is repeatable: seeding again restores the same starting state", async () => {
    const before = (await offersFor(admin, ID.jobFlow)).length;
    await seedFixtures(admin);
    expect((await offersFor(admin, ID.jobFlow)).length).toBe(0);
    expect((await windowsFor(admin, ID.jobFlow)).length).toBe(0);
    expect((await assignmentsFor(admin, ID.jobFlow)).length).toBe(0);
    expect((await jobRow(admin, ID.jobFlow)).stage).toBe("ready_check_ready_to_schedule");
    // Append-only history is preserved, never deleted to force a clean slate.
    expect((await eventsFor(admin, ID.jobFlow)).length).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
  });
});
