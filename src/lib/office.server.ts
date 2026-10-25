import { melbourneToday } from "./melbourne-time.core";
import { onsiteOnlyOfficeJobIds } from "./insulation-details-office.server";
// Gathers facts for the office rulebook in bulk (paged, admin client) and applies the pure rules.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { limits, officeStatus, type JobFacts, type OfficeStatus } from "./office-status.core";
import { buildNeedsMe, type NeedsJob, type PartnerItem, type Snooze } from "./needs-me.core";

type Admin = SupabaseClient<Database>;
type Row = Record<string, unknown>;

/** Reads every row (pages of 1000) and fails loudly — a failed read must never look like "nothing to do". */
async function all(what: string, page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) return out;
  }
}
const s = (v: unknown) => (v == null ? null : String(v));
const latest = (m: Map<string, string>, k: string, v: string | null) => { if (v && (!m.has(k) || m.get(k)! < v)) m.set(k, v); };

export type OfficeJob = { id: string; jobNumber: string; owner: string | null; suburb: string | null; source: string | null; stage: string; status: OfficeStatus | null; facts: JobFacts; needs: NeedsJob };

export async function loadOffice(admin: Admin, opts: { includeTest?: boolean; onlyIds?: string[] } = {}) {
  const now = Date.now();
  const scope = <T extends { in: (c: string, v: string[]) => T }>(q: T) => (opts.onlyIds ? q.in("job_id", opts.onlyIds) : q);
  const jobQ = () => {
    let q = admin.from("jobs").select("id, job_number, stage, source, channel, installer_site_check, created_at, last_activity_at, hold_revisit_at, cancelled_reason, next_action, installation_completed_at, qa_archived_at, deleted_at, offer_dispatch_override, owners(full_name), properties(suburb, postcode)");
    if (opts.onlyIds) q = q.in("id", opts.onlyIds);
    return q;
  };
  const [jobs, settingsRes, onsiteOnly] = await Promise.all([
    all("jobs", (a, b) => jobQ().order("created_at").range(a, b)),
    admin.from("workflow_settings").select("office_time_limits").eq("id", 1).maybeSingle(),
    opts.onlyIds ? Promise.resolve(new Set<string>()) : onsiteOnlyOfficeJobIds(admin),
  ]);
  if (settingsRes.error) throw new Error(`Could not load time limits: ${settingsRes.error.message}`);
  const lim = limits((settingsRes.data?.office_time_limits ?? {}) as Record<string, unknown>);
  const live = jobs.filter((j) => !onsiteOnly.has(String(j['id'])) && (opts.includeTest ? true : j["source"] !== "qa_test") && !j["qa_archived_at"] && !j["deleted_at"]);
  const ids = live.map((j) => String(j["id"]));
  const want = (r: Row) => !opts.onlyIds || opts.onlyIds.includes(String(r["job_id"]));
  const [stageEv, camp, links, wins, offers, books, props, quotes, inv, piesa, rcs, ev, veec, payoutEv, deadlines, invErr, esc, outbox, comms, emails, snoozes, apps, creds, reassigs] = await Promise.all([
    all("stage changes", (a, b) => scope(admin.from("workflow_events").select("job_id, to_stage, created_at").eq("event_type", "stage_changed")).order("created_at").range(a, b)),
    all("campaign replies", (a, b) => scope(admin.from("lead_campaign_responses").select("job_id, spot_saved_at, opted_out_at, video_requested, media_received_at, desk_check_status, queue_priority, created_at")).range(a, b)),
    all("estimate links", (a, b) => scope(admin.from("customer_estimate_links").select("job_id, created_at").is("revoked_at", null)).range(a, b)),
    all("owner times", (a, b) => scope(admin.from("ready_check_windows").select("job_id, status, created_at")).range(a, b)),
    all("offers", (a, b) => scope(admin.from("partner_offers").select("job_id, kind, status, offered_at").eq("status", "pending")).range(a, b)),
    all("bookings", (a, b) => scope(admin.from("bookings").select("job_id, kind, status, scheduled_start").in("status", ["proposed", "confirmed", "completed"])).range(a, b)),
    all("suggested times", (a, b) => scope(admin.from("appointment_proposals").select("job_id, kind, created_at").eq("status", "proposed")).range(a, b)),
    all("quotes", (a, b) => scope(admin.from("quotes").select("job_id, kind, status, release_state, release_hold_reason, sent_at, accepted_at, created_at").neq("status", "superseded")).order("created_at").range(a, b)),
    all("payments", (a, b) => scope(admin.from("invoice_status").select("job_id, deposit_cleared, effective_status")).range(a, b)),
    all("PIESAs", (a, b) => scope(admin.from("piesa_records").select("job_id, outcome, completed_date, section_c_signed_at").eq("is_current", true)).range(a, b)),
    all("Ready Checks", (a, b) => scope(admin.from("ready_checks").select("job_id, submitted_at")).range(a, b)),
    all("evidence", (a, b) => scope(admin.from("evidence_requirements").select("job_id, status, required")).eq("required", true).eq("status", "outstanding").range(a, b)),
    all("VEECs", (a, b) => scope(admin.from("veec_lodgements").select("job_id, status, submitted_date")).range(a, b)),
    all("payouts", (a, b) => scope(admin.from("workflow_events").select("job_id, created_at").eq("event_type", "payout_marked_paid")).range(a, b)),
    all("install deadlines", (a, b) => scope(admin.from("job_piesa_deadlines").select("job_id, install_deadline")).range(a, b)),
    all("Xero problems", (a, b) => scope(admin.from("invoices").select("job_id, status, last_sync_error")).or("last_sync_error.not.is.null,status.eq.xero_sync_error").range(a, b)),
    all("ESC notices", (a, b) => scope(admin.from("esc_notifications").select("job_id, last_error")).not("last_error", "is", null).is("sent_at", null).range(a, b)),
    all("outgoing actions", (a, b) => scope(admin.from("external_action_outbox").select("job_id, action_type, last_error_code, status")).eq("status", "failed").range(a, b)),
    all("messages", (a, b) => scope(admin.from("job_communications").select("job_id, channel, delivery_status")).in("delivery_status", ["bounced", "failed", "undelivered"]).range(a, b)),
    all("emails", (a, b) => scope(admin.from("customer_email_sends").select("job_id, status, error")).in("status", ["failed", "bounced"]).range(a, b)),
    all("snoozes", (a, b) => admin.from("office_snoozes").select("job_id, rule_key, snoozed_until, snooze_count").range(a, b)),
    opts.onlyIds ? Promise.resolve([]) : all("applications", (a, b) => admin.from("partner_enquiries").select("id, name, enquiry_type, source, status, created_at").in("status", ["new", "submitted"]).neq("enquiry_type", "property_manager").range(a, b)),
    opts.onlyIds ? Promise.resolve([]) : all("certificates", (a, b) => admin.from("business_credentials").select("id, label, kind, expires_at, businesses(name)").not("expires_at", "is", null).lte("expires_at", melbourneToday(new Date(now + lim["credential_warning_days"]! * 86_400_000))).range(a, b)),
    // D-10: homeowner requests for a different installer/electrician belong in Needs me (same "open" rule as the old To-action list).
    all("reassignment requests", (a, b) => scope(admin.from("reassignment_requests").select("job_id, role, reason, created_at").is("resolved_at", null)).range(a, b)),
  ]);
  const picks = await all("office picks", (a, b) => scope(admin.from("partner_offers").select("job_id, kind, status, offered_at, summary, businesses(name)").contains("summary", { office_choice: true })).range(a, b));
  const pickJobs = [...new Set(picks.map((p) => String(p["job_id"])))];
  const pickAll = pickJobs.length ? await all("offers after picks", (a, b) => admin.from("partner_offers").select("job_id, kind, status, offered_at, summary, businesses(name)").in("job_id", pickJobs).range(a, b)) : [];
  const { chosenTradeNoAnswer } = await import("./trade-choice.core");
  const tradeChoice = new Map<string, NonNullable<NeedsJob["tradeChoice"]>>();
  for (const id of pickJobs) {
    const rows = pickAll.filter((o) => String(o["job_id"]) === id).map((o) => ({ kind: String(o["kind"]), status: String(o["status"]), offered_at: String(o["offered_at"]), summary: o["summary"], business_name: (o["businesses"] as { name?: string } | null)?.name ?? null }));
    for (const k of ["ready_check", "piesa", "rectification"] as const) { const r = chosenTradeNoAnswer(rows, k); if (r) { tradeChoice.set(id, { kind: k, ...r }); break; } }
  }
  // Office picks first (Jo, 7 Oct): "Choose trades for this job", and "no taker after 24h — add more trades".
  const offerChoice = new Map<string, NonNullable<NeedsJob["offerChoice"]>>();
  const timed = live.filter((j) => j["stage"] === "ready_check_ready_to_schedule" || j["stage"] === "piesa_and_install_window_pending");
  if (timed.length) {
    const tIds = timed.map((j) => String(j["id"]));
    const [tOffers, tAsg, mode, hours] = await Promise.all([
      all("timed offers", (a, b) => admin.from("partner_offers").select("id, job_id, kind, status, offered_at").in("kind", ["ready_check", "piesa"]).in("job_id", tIds).range(a, b)),
      all("trade assignments", (a, b) => admin.from("job_assignments").select("job_id, role").eq("active", true).in("job_id", tIds).range(a, b)),
      (await import("./offer-dispatch.server")).dispatchMode(),
      (await import("./offer-dispatch.server")).offerSuggestHours(),
    ]);
    const { officePicks, needsChooseTrades } = await import("./offer-dispatch.core");
    const { offersWithNoTaker } = await import("./offer-timing.core");
    const rows = tOffers.map((o) => ({ id: String(o["id"]), job_id: String(o["job_id"]), kind: String(o["kind"]), status: String(o["status"]), offered_at: String(o["offered_at"]) }));
    const noTaker = new Set(offersWithNoTaker(rows, hours, new Date(now)).map((r) => `${r.job_id}:${r.kind}`));
    for (const j of timed) {
      const id = String(j["id"]); const k = j["stage"] === "ready_check_ready_to_schedule" ? "ready_check" as const : "piesa" as const;
      const hasTrade = tAsg.some((a) => String(a["job_id"]) === id && a["role"] === (k === "piesa" ? "electrician" : "installer"));
      if (k === "ready_check") {
        // Jo 24 Oct 2026: our leads — the office picks ONE installer; a returned offer shows once as "Choose installer".
        if (tradeChoice.has(id)) continue;
        const { readyCheckOfficeItem } = await import("./ready-check-times.core");
        const item = readyCheckOfficeItem({ channel: s(j["channel"]), stage: String(j["stage"]), hasInstaller: hasTrade, offers: rows.filter((o) => o.job_id === id && o.kind === k) });
        if (item) offerChoice.set(id, { kind: k, state: "choose", hours });
        continue;
      }
      if (noTaker.has(`${id}:${k}`)) { offerChoice.set(id, { kind: k, state: "no_taker", hours }); continue; }
      const out = rows.filter((o) => o.job_id === id && o.kind === k && (o.status === "pending" || o.status === "accepted")).length;
      const readyForOffer = k === "piesa" || wins.some((w) => String(w["job_id"]) === id && w["status"] === "open");
      if (needsChooseTrades({ officePicks: officePicks(mode, s(j["offer_dispatch_override"])), readyForOffer, hasTrade, offersThisRound: out })) offerChoice.set(id, { kind: k, state: "choose", hours });
    }
  }
  // D-10: one open reassignment request per job for Needs me — installer requests win over electrician, oldest wins per role.
  const reassign = new Map<string, NonNullable<NeedsJob["reassignment"]>>();
  for (const r of reassigs) {
    const id = String(r["job_id"]);
    const role: "installer" | "electrician" = String(r["role"]) === "electrician" ? "electrician" : "installer";
    const cur = reassign.get(id);
    const better = !cur || (role === "installer" && cur.role !== "installer") || (role === cur.role && (!cur.since || String(r["created_at"]) < cur.since));
    if (better) reassign.set(id, { role, reason: String(r["reason"] ?? "").trim().slice(0, 200) || "Owner didn't give a reason", since: s(r["created_at"]) });
  }
  const sendRows = await Promise.all([
    all("owner emails sent", (a, b) => scope(admin.from("customer_email_sends").select("job_id, sent_at")).not("sent_at", "is", null).range(a, b)),
    all("owner messages sent", (a, b) => scope(admin.from("job_communications").select("job_id, sent_at")).eq("direction", "outbound").not("sent_at", "is", null).range(a, b)),
  ]);
  const contacted = new Map<string, string>();
  for (const r of sendRows.flat()) { const k = String(r["job_id"]), v = String(r["sent_at"]); const cur = contacted.get(k); if (!cur || v < cur) contacted.set(k, v); }
  const acc = await all("Ready Check requests", (a, b) => scope(admin.from("ready_check_acceptances").select("job_id")).range(a, b));
  const accepted = new Set(acc.map((r) => String(r["job_id"])));
  const mittiErr = opts.onlyIds ? [] : await all("Mitti syncs", (a, b) => admin.from("external_sync_logs").select("entity_id, system, error, created_at").eq("status", "error").gte("created_at", new Date(now - 3 * 86_400_000).toISOString()).range(a, b));

  const entered = new Map<string, string>();
  for (const e of stageEv) if (want(e)) entered.set(`${e["job_id"]}:${e["to_stage"]}`, String(e["created_at"]));
  const by = <T,>(rows: Row[], f: (r: Row) => T) => { const m = new Map<string, T[]>(); for (const r of rows) { const k = String(r["job_id"] ?? r["entity_id"]); if (!m.has(k)) m.set(k, []); m.get(k)!.push(f(r)); } return m; };
  const campaign = new Map(camp.map((c) => [String(c["job_id"]), c]));
  const estLink = new Map<string, string>(); for (const l of links) latest(estLink, String(l["job_id"]), s(l["created_at"]));
  const winOpen = by(wins.filter((w) => ["open", "offered", "pending"].includes(String(w["status"]))), () => 1);
  const offerAt = new Map<string, string>(); for (const o of offers) latest(offerAt, `${o["job_id"]}:${o["kind"] === "piesa" ? "piesa" : "rc"}`, s(o["offered_at"]));
  const bookAt = new Map<string, string>(); for (const b of books) if (b["status"] !== "completed") latest(bookAt, `${b["job_id"]}:${b["kind"]}`, s(b["scheduled_start"]));
  const installStarted = new Set(books.filter((b) => b["kind"] === "installation" && (b["status"] === "completed" || new Date(String(b["scheduled_start"])).getTime() <= now)).map((b) => String(b["job_id"])));
  const proposal = new Map(props.map((p) => [String(p["job_id"]), { kind: String(p["kind"]), since: String(p["created_at"]) }]));
  const instQ = new Map<string, Row>(), rectQ = new Map<string, Row>();
  for (const q of quotes) (q["kind"] === "rectification" ? rectQ : instQ).set(String(q["job_id"]), q);
  const paid = new Set(inv.filter((v) => v["deposit_cleared"]).map((v) => String(v["job_id"])));
  const pie = new Map(piesa.map((p) => [String(p["job_id"]), p]));
  const rcSub = new Map<string, string>(); for (const r of rcs) latest(rcSub, String(r["job_id"]), s(r["submitted_at"]));
  const meas = ids.length ? await all("measure-ups", (a, b) => scope(admin.from("ceiling_measurements").select("job_id, created_at").eq("is_current", true)).range(a, b)) : [];
  const measAt = new Map<string, string>(); for (const r of meas) { const k = String(r["job_id"]), v = String(r["created_at"]); if (!measAt.has(k) || v < measAt.get(k)!) measAt.set(k, v); }
  const evMissing = by(ev, () => 1);
  const veecAt = new Map<string, string>(); for (const v of veec) if (v["submitted_date"]) latest(veecAt, String(v["job_id"]), s(v["submitted_date"]));
  const payoutPaid = new Set(payoutEv.map((p) => String(p["job_id"])));
  const deadline = new Map(deadlines.map((d) => [String(d["job_id"]), s(d["install_deadline"])]));
  const fails = new Map<string, string[]>();
  const fail = (id: unknown, why: string) => { const k = String(id); if (!fails.has(k)) fails.set(k, []); if (!fails.get(k)!.includes(why)) fails.get(k)!.push(why); };
  for (const r of invErr) fail(r["job_id"], `Xero: ${s(r["last_sync_error"]) ?? "invoice or payment failed"}`);
  for (const r of esc) fail(r["job_id"], `ESC notice failed: ${s(r["last_error"])}`);
  for (const r of outbox) fail(r["job_id"], `Couldn't send ${String(r["action_type"]).replace(/_/g, " ")}${r["last_error_code"] ? ` (${r["last_error_code"]})` : ""}`);
  for (const r of comms) fail(r["job_id"], `${r["channel"] === "sms" ? "Text" : "Email"} ${r["delivery_status"]}`);
  for (const r of emails) fail(r["job_id"], `Email ${r["status"]}${r["error"] ? `: ${String(r["error"]).slice(0, 80)}` : ""}`);
  for (const r of mittiErr) if (r["system"] === "mitti" && ids.includes(String(r["entity_id"]))) fail(r["entity_id"], `Mitti sync failed: ${String(r["error"] ?? "").slice(0, 80)}`);

  // Owner paperwork: jobs sitting in (or waiting to start) a stage whose gate isn't signed.
  {
    const { evaluateOwnerGates, gatesForStage, installerVisitFromSiteCheck } = await import("./owner-gates.core");
    const { approvedVersions } = await import("./owner-gates.server");
    // Bounded id batches: one URL carrying every live job id exceeds the gateway limit (400 + client retries ≈ 60 s each).
    const batches: string[][] = []; for (let i = 0; i < ids.length; i += 200) batches.push(ids.slice(i, i + 200));
    const inBatches = async (what: string, q: (b: string[], a: number, z: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) =>
      (await Promise.all(batches.map((b) => all(what, (a, z) => q(b, a, z))))).flat();
    const [gsigRows, appr] = await Promise.all([
      inBatches("owner paperwork signatures", (b, a, z) => admin.from("owner_gate_signatures").select("job_id, doc_key, doc_version, doc_draft, answers").in("job_id", b).order("signed_at").order("id").range(a, z)),
      approvedVersions(),
    ]);
    const gsig = gsigRows as { job_id: string; doc_key: string; doc_version: string; doc_draft: boolean; answers: unknown }[];
    for (const j of live) {
      const id = String(j["id"]); const stage = String(j["stage"]);
      const need = new Set(gatesForStage(stage));
      if (["ready_check_ready_to_schedule", "assessment_booking", "awaiting_electrician"].includes(stage)) need.add("A");
      need.delete("C"); need.delete("D"); // C/D items have their own blockers already shown
      if (!need.size) continue;
      const mine = (gsig ?? []).filter((x) => x.job_id === id);
      const ans = (k: string) => mine.filter((x) => x.doc_key === k).at(-1)?.answers as Record<string, unknown> | undefined;
      const r = evaluateOwnerGates({ isTest: j["source"] === "qa_test", signed: mine.map((x) => ({ key: x.doc_key, version: x.doc_version, draft: x.doc_draft })), approved: appr,
        tenant: ans("details_confirmation")?.["role"] === "tenant", lifeSupport: false, visitedByInstaller: installerVisitFromSiteCheck(j["installer_site_check"]),
        hasQuote: true, agreementSigned: true, agreementWordingApproved: true, escConsentSigned: true, piesaCopyDelivered: true, piesaDeclarationMappingApproved: false, assignmentEffective: true });
      const g = r.find((x) => need.has(x.gate) && !x.complete);
      if (g) fail(id, `Owner paperwork ${g.gate} not complete: ${g.items.filter((i) => !i.done || (i.draft && j["source"] !== "qa_test")).map((i) => i.label).join(", ")}`);
    }
  }

  const out: OfficeJob[] = live.map((j) => {
    const id = String(j["id"]), stage = String(j["stage"]);
    const c = campaign.get(id); const q = instQ.get(id); const rq = rectQ.get(id); const p = pie.get(id);
    const prop = j["properties"] as { suburb?: string; postcode?: string } | null;
    const apAt = entered.get(`${id}:ready_for_veec`) ?? null;
    const facts: JobFacts = {
      id, stage, createdAt: String(j["created_at"]), lastActivityAt: s(j["last_activity_at"]), enteredStageAt: entered.get(`${id}:${stage}`) ?? null,
      holdRevisitAt: s(j["hold_revisit_at"]), cancelledReason: s(j["cancelled_reason"]), ownJob: j["channel"] === "installer_sourced",
      campaign: c ? { spotSavedAt: s(c["spot_saved_at"]), optedOutAt: s(c["opted_out_at"]), videoRequested: !!c["video_requested"], mediaReceivedAt: s(c["media_received_at"]), deskCheckStatus: s(c["desk_check_status"]), createdAt: String(c["created_at"]), queuePriority: s(c["queue_priority"]) } : null,
      estimateSentAt: estLink.get(id) ?? null, ownerContactedAt: contacted.get(id) ?? null, rcWindowsOpen: winOpen.get(id)?.length ?? 0, rcAccepted: accepted.has(id), rcOfferAt: offerAt.get(`${id}:rc`) ?? null, rcBookingAt: bookAt.get(`${id}:ready_check`) ?? null, rcSubmittedAt: rcSub.get(id) ?? null, measurementStartedAt: measAt.get(id) ?? null,
      proposalPending: proposal.get(id) ?? null,
      quote: q ? { releaseState: s(q["release_state"]), holdReason: s(q["release_hold_reason"]), sentAt: s(q["sent_at"]), status: String(q["status"]), acceptedAt: s(q["accepted_at"]) } : null,
      rectQuote: rq ? { releaseState: s(rq["release_state"]), sentAt: s(rq["sent_at"]), status: String(rq["status"]) } : null,
      paymentCleared: paid.has(id),
      piesa: p ? { completedAt: s(p["completed_date"]), passed: p["outcome"] === "pass", sectionCAt: s(p["section_c_signed_at"]) } : null,
      elecOfferAt: offerAt.get(`${id}:piesa`) ?? null, elecBookingAt: bookAt.get(`${id}:assessment`) ?? null, rectBookingAt: bookAt.get(`${id}:rectification`) ?? null,
      installDeadline: deadline.get(id) ?? null, installBookingAt: bookAt.get(`${id}:installation`) ?? null, installedAt: s(j["installation_completed_at"]), evidenceMissing: evMissing.get(id)?.length ?? 0,
      apApprovedAt: apAt, veecSubmittedAt: veecAt.get(id) ?? null,
      payoutsOpen: stage === "ready_for_veec" && !payoutPaid.has(id) ? 1 : 0, payoutDueAt: apAt ? new Date(new Date(apAt).getTime() + 7 * 86_400_000).toISOString() : null,
    };
    const status = officeStatus(facts, now, lim);
    const jobNumber = String(j["job_number"]);
    return {
      id, jobNumber, owner: (j["owners"] as { full_name?: string } | null)?.full_name ?? null, suburb: prop?.suburb ?? null, source: s(j["source"]), stage, status, facts,
      needs: { parked: status?.stage === "waiting_list", id, jobNumber, suburb: prop?.suburb ?? null, owner: null, stage, status, statusCount: status ? 1 : 0, lastActivityAt: s(j["last_activity_at"]), nextAction: s(j["next_action"]), installDeadline: facts.installDeadline ?? null, installStarted: installStarted.has(id) || !!facts.installedAt, holdRevisitAt: facts.holdRevisitAt ?? null, failures: fails.get(id) ?? [], tradeChoice: tradeChoice.get(id) ?? null, offerChoice: offerChoice.get(id) ?? null, reassignment: reassign.get(id) ?? null },
    };
  });
  const changeReqs = opts.onlyIds ? [] : await all("partner change requests", (a, b) => (admin as unknown as { from: (t: string) => any }).from("partner_change_requests").select("id, kind, message, created_at, businesses(name)").eq("status", "open").range(a, b)); // eslint-disable-line @typescript-eslint/no-explicit-any
  const textFails = opts.onlyIds ? [] : await all("trade text failures", (a, b) => (admin as unknown as { from: (t: string) => any }).from("trade_text_log").select("id, detail, melbourne_date, businesses(name)").eq("status", "failed").is("acknowledged_at", null).range(a, b)); // eslint-disable-line @typescript-eslint/no-explicit-any
  const { movedFromTodo } = await import("./needs-me.core");
  const moved = opts.onlyIds ? [] : movedFromTodo({
    formIds: ((await admin.from("workflow_settings").select("*").eq("id", 1).maybeSingle()).data as unknown as Record<string, string | null> | null), // whole row: the decision-293 fixes column may not exist yet
    pendingWorkers: await all("pending workers", (a, b) => admin.from("partner_workers").select("id, full_legal_name, businesses(name)").eq("approval_status", "pending").is("removed_at", null).range(a, b)).then((rows) => rows.map((w) => ({ id: String(w["id"]), full_legal_name: (w["full_legal_name"] as string | null) ?? null, business: (w["businesses"] as { name?: string } | null)?.name ?? null }))),
  });
  const dts = opts.onlyIds ? null : await (await import("./daily-mitti-text.server")).dailyTextSettings();
  const partners: PartnerItem[] = [
    ...moved,
    ...(dts?.enabled && dts.missing.length ? [{ key: "dailytext:formids", title: "Daily Mitti links text is ON but not sending", why: `Missing: ${dts.missing.join(", ")}. Nothing is sent until these are set.`, dueAt: null, href: "/admin/settings" }] : []),
    ...textFails.map((t) => ({ key: `text:${t["id"]}`, title: `Daily text to ${(t["businesses"] as { name?: string } | null)?.name ?? "a trade"} failed`, why: String(t["detail"] ?? "Twilio did not deliver it").slice(0, 140), dueAt: null, href: "/admin/partners" })),
    ...changeReqs.map((c) => ({ key: `chg:${c["id"]}`, title: `${(c["businesses"] as { name?: string } | null)?.name ?? "Partner"} asks to change ${c["kind"] === "rates" ? "their rates" : c["kind"] === "details" ? "their details" : c["kind"]}`, why: String(c["message"]).slice(0, 140), dueAt: null, href: "/admin/partners" })),
    ...apps.filter((a) => !String(a["source"] ?? "").endsWith("_test")).map((a) => ({ key: `app:${a["id"]}`, title: `New application: ${String(a["name"] ?? "").trim() || "name not given"}`, why: "Application ready to review", dueAt: null, href: "/admin/partners" })),
    ...creds.map((c) => ({ key: `cred:${c["id"]}`, title: `${(c["businesses"] as { name?: string } | null)?.name ?? "Partner"}: ${c["label"] ?? c["kind"]} expiring`, why: `Expires ${c["expires_at"]}`, dueAt: String(c["expires_at"]), href: "/admin/businesses" })),
  ];
  const snz: Snooze[] = snoozes.map((x) => ({ jobId: String(x["job_id"]), ruleKey: String(x["rule_key"]), until: String(x["snoozed_until"]), count: Number(x["snooze_count"]) }));
  const needs = buildNeedsMe({ now, jobs: out.map((o) => o.needs), partners, snoozes: snz, lim });
  return { now, lim, jobs: out, needs };
}
