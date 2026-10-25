import { melbourneToday } from "./melbourne-time.core";
import { onsiteOnlyOfficeJobIds } from "./insulation-details-office.server";
// Gathers facts for the office rulebook in bulk (paged, admin client) and applies the pure rules.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { limits, officeStatus, type JobFacts, type OfficeStatus } from "./office-status.core";
import { buildNeedsMe, type NeedsJob, type PartnerItem, type Snooze } from "./needs-me.core";
import { withoutRetiredInstallDayPhotos } from "./ready-check-chase.core";

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

/** Job-id lookups go in bounded chunks (AGENTS: one all-ids URL stalled Office reads), all chunks in flight together. */
const CHUNK = 200;
const chunksOf = (ids: string[]) => { const out: string[][] = []; for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK)); return out; };
type Ranged = { range: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> };
/** Every row of a per-job read for `ids`: one paged query per chunk of ids, all chunks in flight together. */
const byChunks = (what: string, ids: string[], q: (chunk: string[]) => Ranged): Promise<Row[]> =>
  ids.length ? Promise.all(chunksOf(ids).map((c) => all(what, (a, b) => q(c).range(a, b)))).then((r) => r.flat()) : Promise.resolve([]);

export async function loadOffice(admin: Admin, opts: { includeTest?: boolean; onlyIds?: string[]; openOnly?: boolean; statusOnly?: boolean } = {}) {
  const now = Date.now();
  const listMode = !opts.onlyIds;
  // Jobs › Active (perf 25 Oct 2026, decision 383): only `status` is used, so the reads that feed Needs me alone
  // (snoozes, trade picks/timed offers, failures, reassignments, owner paperwork, dispatch settings) are skipped and
  // every per-job read starts in the FIRST wave, scoped to the given ids (rows of jobs that drop out are never used).
  const statusOnly = !!opts.statusOnly && !!opts.onlyIds;
  const none = <T,>(empty: T, read: () => PromiseLike<T>): PromiseLike<T> => (statusOnly ? Promise.resolve(empty) : read());
  // Perf 25 Oct 2026: the job read is filtered in the database (deleted / QA-archived / TEST, and — for Needs me —
  // complete / cancelled, whose status is always "ended"), and every per-job read below is scoped to those job ids
  // instead of reading whole tables (stage history, sends, bookings, quotes, the PIESA-deadline view…). Two waves:
  // the jobs + everything independent of them, then every per-job read at once.
  const jobQ = (chunk?: string[]) => {
    let q = admin.from("jobs").select("id, job_number, stage, source, channel, installer_site_check, created_at, last_activity_at, hold_revisit_at, cancelled_reason, next_action, installation_completed_at, qa_archived_at, deleted_at, offer_dispatch_override, owners(full_name), properties(suburb, postcode)")
      .is("deleted_at", null).is("qa_archived_at", null);
    if (!opts.includeTest) q = q.or("source.is.null,source.neq.qa_test");
    if (opts.openOnly) q = q.not("stage", "in", "(complete,cancelled)");
    if (chunk) q = q.in("id", chunk);
    return q;
  };
  const dispatch = statusOnly ? null : import("./offer-dispatch.server");
  // Started now, awaited where the partner rows are built (an unhandled rejection is impossible: it is always awaited
  // unless an earlier read throws, and then the whole load fails anyway).
  const expiryReads = listMode ? tradeExpiryReads(admin) : null;
  expiryReads?.catch(() => undefined);
  // Per-job reads (all chunks in flight together). statusOnly: started with the first wave on the given ids.
  const perJob = (ids: string[], pickJobs: string[], tIds: string[]) => {
    const scoped = (what: string, q: (chunk: string[]) => Ranged) => byChunks(what, ids, q);
    const skip = (what: string, q: (chunk: string[]) => Ranged) => (statusOnly ? Promise.resolve([] as Row[]) : scoped(what, q));
    return Promise.all([
    scoped("stage changes", (c) => admin.from("workflow_events").select("job_id, to_stage, created_at").eq("event_type", "stage_changed").in("job_id", c).order("created_at")),
    scoped("campaign replies", (c) => admin.from("lead_campaign_responses").select("job_id, spot_saved_at, opted_out_at, video_requested, media_received_at, desk_check_status, queue_priority, created_at").in("job_id", c)),
    scoped("estimate links", (c) => admin.from("customer_estimate_links").select("job_id, created_at").is("revoked_at", null).in("job_id", c)),
    scoped("owner times", (c) => admin.from("ready_check_windows").select("job_id, status, created_at").in("job_id", c)),
    scoped("offers", (c) => admin.from("partner_offers").select("job_id, kind, status, offered_at").eq("status", "pending").in("job_id", c)),
    scoped("bookings", (c) => admin.from("bookings").select("job_id, kind, status, scheduled_start").in("status", ["proposed", "confirmed", "completed"]).in("job_id", c)),
    scoped("suggested times", (c) => admin.from("appointment_proposals").select("job_id, kind, created_at").eq("status", "proposed").in("job_id", c)),
    scoped("quotes", (c) => admin.from("quotes").select("job_id, kind, status, release_state, release_hold_reason, sent_at, accepted_at, created_at").neq("status", "superseded").in("job_id", c).order("created_at")),
    scoped("payments", (c) => admin.from("invoice_status").select("job_id, deposit_cleared, effective_status").in("job_id", c)),
    scoped("PIESAs", (c) => admin.from("piesa_records").select("job_id, outcome, completed_date, section_c_signed_at").eq("is_current", true).in("job_id", c)),
    scoped("Ready Checks", (c) => admin.from("ready_checks").select("job_id, submitted_at").in("job_id", c)),
    scoped("evidence", (c) => admin.from("evidence_requirements").select("job_id, status, required, category, gate, label").eq("required", true).eq("status", "outstanding").in("job_id", c)),
    scoped("VEECs", (c) => admin.from("veec_lodgements").select("job_id, status, submitted_date").in("job_id", c)),
    scoped("payouts", (c) => admin.from("workflow_events").select("job_id, created_at").eq("event_type", "payout_marked_paid").in("job_id", c)),
    // Only a set deadline is used (deadline.get(id) ?? null), and the view's PIESA lookup now runs for these ids only.
    scoped("install deadlines", (c) => admin.from("job_piesa_deadlines").select("job_id, install_deadline").not("install_deadline", "is", null).in("job_id", c)),
    skip("Xero problems", (c) => admin.from("invoices").select("job_id, status, last_sync_error").or("last_sync_error.not.is.null,status.eq.xero_sync_error").in("job_id", c)),
    skip("ESC notices", (c) => admin.from("esc_notifications").select("job_id, last_error").not("last_error", "is", null).is("sent_at", null).in("job_id", c)),
    skip("outgoing actions", (c) => admin.from("external_action_outbox").select("job_id, action_type, last_error_code, status").eq("status", "failed").in("job_id", c)),
    skip("messages", (c) => admin.from("job_communications").select("job_id, channel, delivery_status").in("delivery_status", ["bounced", "failed", "undelivered"]).in("job_id", c)),
    skip("emails", (c) => admin.from("customer_email_sends").select("job_id, status, error").in("status", ["failed", "bounced"]).in("job_id", c)),
    // Decision 371: every stored expiry (a renewal supersedes the old date), so ONE row per document is decided below.
    listMode ? all("certificates", (a, b) => admin.from("business_credentials").select("id, business_id, profile_id, label, kind, expires_at").not("expires_at", "is", null).range(a, b)) : Promise.resolve([]),
    // D-10: homeowner requests for a different installer/electrician belong in Needs me (same "open" rule as the old To-action list).
    skip("reassignment requests", (c) => admin.from("reassignment_requests").select("job_id, role, reason, created_at").is("resolved_at", null).in("job_id", c)),
    byChunks("offers after picks", pickJobs, (c) => admin.from("partner_offers").select("job_id, kind, status, offered_at, summary, businesses(name)").in("job_id", c)),
    byChunks("timed offers", tIds, (c) => admin.from("partner_offers").select("id, job_id, kind, status, offered_at").in("kind", ["ready_check", "piesa"]).in("job_id", c)),
    byChunks("trade assignments", tIds, (c) => admin.from("job_assignments").select("job_id, role").eq("active", true).in("job_id", c)),
    scoped("owner emails sent", (c) => admin.from("customer_email_sends").select("job_id, sent_at").not("sent_at", "is", null).in("job_id", c)),
    scoped("owner messages sent", (c) => admin.from("job_communications").select("job_id, sent_at").eq("direction", "outbound").not("sent_at", "is", null).in("job_id", c)),
    scoped("Ready Check requests", (c) => admin.from("ready_check_acceptances").select("job_id").in("job_id", c)),
    scoped("measure-ups", (c) => admin.from("ceiling_measurements").select("job_id, created_at").eq("is_current", true).in("job_id", c)),
    skip("owner paperwork signatures", (c) => admin.from("owner_gate_signatures").select("job_id, doc_key, doc_version, doc_draft, answers").in("job_id", c).order("signed_at").order("id")),
    ]);
  };
  const early = statusOnly ? perJob(opts.onlyIds!, [], []) : null;
  early?.catch(() => undefined);
  const [jobs, settingsRes, onsiteOnly, snoozes, apps, picks, mittiErr, changeReqs, textFails, pendingWorkersRows, dts, mode, hours, appr] = await Promise.all([
    opts.onlyIds ? byChunks("jobs", opts.onlyIds, (c) => jobQ(c).order("created_at")) : all("jobs", (a, b) => jobQ().order("created_at").range(a, b)),
    // Whole row: office_time_limits + the form ids for movedFromTodo (the decision-293 fixes column may not exist yet).
    admin.from("workflow_settings").select("*").eq("id", 1).maybeSingle(),
    listMode ? onsiteOnlyOfficeJobIds(admin) : Promise.resolve(new Set<string>()),
    none([] as Row[], () => all("snoozes", (a, b) => admin.from("office_snoozes").select("job_id, rule_key, snoozed_until, snooze_count").range(a, b))),
    listMode ? all("applications", (a, b) => admin.from("partner_enquiries").select("id, name, enquiry_type, source, status, created_at").in("status", ["new", "submitted"]).neq("enquiry_type", "property_manager").range(a, b)) : Promise.resolve([]),
    statusOnly ? Promise.resolve([] as Row[]) : opts.onlyIds
      ? byChunks("office picks", opts.onlyIds, (c) => admin.from("partner_offers").select("job_id, kind, status, offered_at, summary, businesses(name)").contains("summary", { office_choice: true }).in("job_id", c))
      : all("office picks", (a, b) => admin.from("partner_offers").select("job_id, kind, status, offered_at, summary, businesses(name)").contains("summary", { office_choice: true }).range(a, b)),
    listMode ? all("Mitti syncs", (a, b) => admin.from("external_sync_logs").select("entity_id, system, error, created_at").eq("status", "error").gte("created_at", new Date(now - 3 * 86_400_000).toISOString()).range(a, b)) : Promise.resolve([]),
    listMode ? all("partner change requests", (a, b) => (admin as unknown as { from: (t: string) => any }).from("partner_change_requests").select("id, kind, message, created_at, businesses(name)").eq("status", "open").range(a, b)) : Promise.resolve([]), // eslint-disable-line @typescript-eslint/no-explicit-any
    listMode ? all("trade text failures", (a, b) => (admin as unknown as { from: (t: string) => any }).from("trade_text_log").select("id, detail, melbourne_date, businesses(name)").eq("status", "failed").is("acknowledged_at", null).range(a, b)) : Promise.resolve([]), // eslint-disable-line @typescript-eslint/no-explicit-any
    listMode ? all("pending workers", (a, b) => admin.from("partner_workers").select("id, full_legal_name, businesses(name)").eq("approval_status", "pending").is("removed_at", null).range(a, b)) : Promise.resolve([]),
    listMode ? import("./daily-mitti-text.server").then((m) => m.dailyTextSettings()) : Promise.resolve(null),
    dispatch ? dispatch.then((m) => m.dispatchMode()) : null,
    dispatch ? dispatch.then((m) => m.offerSuggestHours()) : 0,
    none({} as Record<string, string>, () => import("./owner-gates.server").then((m) => m.approvedVersions())),
  ]);
  if (settingsRes.error) throw new Error(`Could not load time limits: ${settingsRes.error.message}`);
  const settingsRow = (settingsRes.data ?? null) as unknown as Record<string, unknown> | null;
  const lim = limits((settingsRow?.["office_time_limits"] ?? {}) as Record<string, unknown>);
  const live = jobs.filter((j) => !onsiteOnly.has(String(j['id'])) && (opts.includeTest ? true : j["source"] !== "qa_test") && !j["qa_archived_at"] && !j["deleted_at"]);
  const ids = live.map((j) => String(j["id"]));
  const idSet = new Set(ids);
  const want = (r: Row) => idSet.has(String(r["job_id"]));
  const pickJobs = [...new Set(picks.map((p) => String(p["job_id"])))];
  const timed = live.filter((j) => j["stage"] === "ready_check_ready_to_schedule" || j["stage"] === "piesa_and_install_window_pending");
  const tIds = timed.map((j) => String(j["id"]));
  const [stageEv, camp, links, wins, offers, books, props, quotes, inv, piesa, rcs, ev, veec, payoutEv, deadlines, invErr, esc, outbox, comms, emails, creds, reassigs, pickAll, tOffers, tAsg, emailsSent, messagesSent, acc, meas, gsigRows] = await (early ?? perJob(ids, pickJobs, tIds));
  const { chosenTradeNoAnswer } = await import("./trade-choice.core");
  const tradeChoice = new Map<string, NonNullable<NeedsJob["tradeChoice"]>>();
  const pickAllBy = new Map<string, Row[]>(); for (const o of pickAll) { const k = String(o["job_id"]); if (!pickAllBy.has(k)) pickAllBy.set(k, []); pickAllBy.get(k)!.push(o); }
  for (const id of pickJobs) {
    const rows = (pickAllBy.get(id) ?? []).map((o) => ({ kind: String(o["kind"]), status: String(o["status"]), offered_at: String(o["offered_at"]), summary: o["summary"], business_name: (o["businesses"] as { name?: string } | null)?.name ?? null }));
    for (const k of ["ready_check", "piesa", "rectification"] as const) { const r = chosenTradeNoAnswer(rows, k); if (r) { tradeChoice.set(id, { kind: k, ...r }); break; } }
  }
  // Office picks first (Jo, 7 Oct): "Choose trades for this job", and "no taker after 24h — add more trades".
  const offerChoice = new Map<string, NonNullable<NeedsJob["offerChoice"]>>();
  if (timed.length && !statusOnly) {
    const { officePicks, needsChooseTrades } = await import("./offer-dispatch.core");
    const { offersWithNoTaker } = await import("./offer-timing.core");
    const { readyCheckOfficeItem } = await import("./ready-check-times.core");
    const rows = tOffers.map((o) => ({ id: String(o["id"]), job_id: String(o["job_id"]), kind: String(o["kind"]), status: String(o["status"]), offered_at: String(o["offered_at"]) }));
    const noTaker = new Set(offersWithNoTaker(rows, hours, new Date(now)).map((r) => `${r.job_id}:${r.kind}`));
    // Decision 389: a spot released and waiting for the owner's Confirm needs nothing from the office.
    const rcIds = timed.filter((j) => j["stage"] === "ready_check_ready_to_schedule" && j["channel"] === "hivic_sourced").map((j) => String(j["id"]));
    const { spotReleaseStates } = await import("./spot-release.server");
    const releases = rcIds.length ? await spotReleaseStates(rcIds) : new Map();
    for (const j of timed) {
      const id = String(j["id"]); const k = j["stage"] === "ready_check_ready_to_schedule" ? "ready_check" as const : "piesa" as const;
      const hasTrade = tAsg.some((a) => String(a["job_id"]) === id && a["role"] === (k === "piesa" ? "electrician" : "installer"));
      if (k === "ready_check") {
        // Jo 24 Oct 2026: our leads — the office picks ONE installer; a returned offer shows once as "Choose installer".
        if (tradeChoice.has(id)) continue;
        const item = readyCheckOfficeItem({ channel: s(j["channel"]), stage: String(j["stage"]), hasInstaller: hasTrade, offers: rows.filter((o) => o.job_id === id && o.kind === k) });
        if (item && releases.get(id)?.state !== "pending") offerChoice.set(id, { kind: k, state: "choose", hours });
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
  const contacted = new Map<string, string>();
  for (const r of [...emailsSent, ...messagesSent]) { const k = String(r["job_id"]), v = String(r["sent_at"]); const cur = contacted.get(k); if (!cur || v < cur) contacted.set(k, v); }
  const accepted = new Set(acc.map((r) => String(r["job_id"])));

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
  const measAt = new Map<string, string>(); for (const r of meas) { const k = String(r["job_id"]), v = String(r["created_at"]); if (!measAt.has(k) || v < measAt.get(k)!) measAt.set(k, v); }
  // Decision 396: rows the retired install-day photo chase created are not missing evidence.
  const evMissing = by(withoutRetiredInstallDayPhotos(ev as { category?: string | null; gate?: string | null; label?: string | null }[]) as typeof ev, () => 1);
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
  for (const r of mittiErr) if (r["system"] === "mitti" && idSet.has(String(r["entity_id"]))) fail(r["entity_id"], `Mitti sync failed: ${String(r["error"] ?? "").slice(0, 80)}`);

  // Owner paperwork: jobs sitting in (or waiting to start) a stage whose gate isn't signed.
  if (!statusOnly) {
    const { evaluateOwnerGates, gatesForStage, installerVisitFromSiteCheck } = await import("./owner-gates.core");
    // Signatures were read with the other per-job reads (bounded id chunks), in signed order.
    type Sig = { job_id: string; doc_key: string; doc_version: string; doc_draft: boolean; answers: unknown };
    const sigsBy = new Map<string, Sig[]>();
    for (const x of gsigRows as Sig[]) { if (!sigsBy.has(x.job_id)) sigsBy.set(x.job_id, []); sigsBy.get(x.job_id)!.push(x); }
    for (const j of live) {
      const id = String(j["id"]); const stage = String(j["stage"]);
      const need = new Set(gatesForStage(stage));
      if (["ready_check_ready_to_schedule", "assessment_booking", "awaiting_electrician"].includes(stage)) need.add("A");
      need.delete("C"); need.delete("D"); // C/D items have their own blockers already shown
      if (!need.size) continue;
      const mine = sigsBy.get(id) ?? [];
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
  const { movedFromTodo } = await import("./needs-me.core");
  const moved = opts.onlyIds ? [] : movedFromTodo({
    formIds: settingsRow as unknown as Record<string, string | null> | null, // whole row: the decision-293 fixes column may not exist yet
    pendingWorkers: pendingWorkersRows.map((w) => ({ id: String(w["id"]), full_legal_name: (w["full_legal_name"] as string | null) ?? null, business: (w["businesses"] as { name?: string } | null)?.name ?? null })),
  });
  const partners: PartnerItem[] = [
    ...moved,
    ...(dts?.enabled && dts.missing.length ? [{ key: "dailytext:formids", title: "Daily Mitti links text is ON but not sending", why: `Missing: ${dts.missing.join(", ")}. Nothing is sent until these are set.`, dueAt: null, href: "/admin/settings" }] : []),
    ...textFails.map((t) => ({ key: `text:${t["id"]}`, title: `Daily text to ${(t["businesses"] as { name?: string } | null)?.name ?? "a trade"} failed`, why: String(t["detail"] ?? "Twilio did not deliver it").slice(0, 140), dueAt: null, href: "/admin/partners" })),
    ...changeReqs.map((c) => ({ key: `chg:${c["id"]}`, title: `${(c["businesses"] as { name?: string } | null)?.name ?? "Partner"} asks to change ${c["kind"] === "rates" ? "their rates" : c["kind"] === "details" ? "their details" : c["kind"]}`, why: String(c["message"]).slice(0, 140), dueAt: null, href: "/admin/partners" })),
    ...apps.filter((a) => !String(a["source"] ?? "").endsWith("_test")).map((a) => ({ key: `app:${a["id"]}`, title: `New application: ${String(a["name"] ?? "").trim() || "name not given"}`, why: "Application ready to review", dueAt: null, href: "/admin/partners" })),
    ...(expiryReads ? await tradeExpiryItems(expiryReads, creds, melbourneToday(new Date(now)), lim["credential_warning_days"] ?? 30) : []),
  ];
  const snz: Snooze[] = snoozes.map((x) => ({ jobId: String(x["job_id"]), ruleKey: String(x["rule_key"]), until: String(x["snoozed_until"]), count: Number(x["snooze_count"]) }));
  const needs = buildNeedsMe({ now, jobs: out.map((o) => o.needs), partners, snoozes: snz, lim });
  return { now, lim, jobs: out, needs };
}

/** The reads behind tradeExpiryItems, started with the office's first wave (perf 25 Oct 2026). */
function tradeExpiryReads(admin: Admin): Promise<Row[][]> {
  return Promise.all([
    all("trade businesses", (a, b) => admin.from("businesses").select("id, name, is_active").range(a, b)),
    all("trade people", (a, b) => admin.from("partner_workers").select("id, business_id, email, full_legal_name, trade_role, licence_expires_on, removed_at").is("removed_at", null).range(a, b)),
    all("CII checks", (a, b) => admin.from("partner_worker_certifications").select("id, worker_id, worker_email, recorded_at").range(a, b)),
    all("CII levels", (a, b) => admin.from("worker_certification_levels").select("certification_id, expires_on, recorded_at").range(a, b)),
  ]);
}

/** Decision 371(a): ONE Needs me partner row per trade document (business insurance / certificate / REC registration /
 *  licence, each person's licence and CII) from 30 days before its latest stored expiry. Pure rules: trade-expiry.core. */
async function tradeExpiryItems(reads: Promise<Row[][]>, creds: Row[], today: string, warnDays: number): Promise<PartnerItem[]> {
  const { tradeExpiryRows, latestCiiExpiryByWorker } = await import("./trade-expiry.core");
  const [bizs = [], workers = [], certs = [], levels = []] = await reads;
  const installers = workers.filter((w) => w["trade_role"] === "installer").map((w) => ({ id: String(w["id"]), email: String(w["email"] ?? "") }));
  const cii = latestCiiExpiryByWorker(installers, certs.map((c) => ({ id: String(c["id"]), worker_id: s(c["worker_id"]), worker_email: String(c["worker_email"] ?? ""), recorded_at: String(c["recorded_at"]) })), levels.map((l) => ({ certification_id: String(l["certification_id"]), expires_on: String(l["expires_on"]), recorded_at: String(l["recorded_at"]) })));
  const rows = tradeExpiryRows({
    today, warnDays,
    businesses: bizs.map((b) => ({ id: String(b["id"]), name: String(b["name"] ?? "Partner"), active: b["is_active"] !== false })),
    credentials: creds.map((c) => ({ businessId: String(c["business_id"]), profileId: s(c["profile_id"]), kind: String(c["kind"]), label: String(c["label"] ?? c["kind"]), expiresAt: s(c["expires_at"]) })),
    people: workers.map((w) => ({ id: String(w["id"]), name: String(w["full_legal_name"] ?? "Worker"), businessId: String(w["business_id"]), licenceExpiresOn: w["trade_role"] === "electrician" ? s(w["licence_expires_on"]) : null, ciiExpiresOn: cii.get(String(w["id"])) ?? null })),
  });
  return rows.map((r) => ({ key: r.key, title: `${r.who}: ${r.document} ${r.expired ? "expired" : "expiring"}`, why: r.line, dueAt: r.expiresOn, href: r.subject === "person" ? "/admin/partners" : "/admin/businesses" }));
}
