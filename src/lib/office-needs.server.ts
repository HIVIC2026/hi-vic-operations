// Needs me (O1) + the Job page Next panel (O2): gathers the facts once, then the pure rules in office-needs.core decide
// the rows and job-next-action.core the Next sentence. Read-only: never moves a job, never sends anything.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { loadOffice, type OfficeJob } from "./office.server";
import { buildNeedsRows, type EmailRowInput, type NeedsFacts, type NeedsRow, type SystemRow } from "./office-needs.core";
import { sendFailedRows } from "./send-failed.core";
import { AUTO_OFFER_RETURNED_EVENT } from "./auto-offer.core";
import { surnameOf } from "./office-jobs.core";
import { VEEC_OFFICE_ALERT_EVENT } from "./veec-assignment-form.core";
import { apAutoHoldAlert } from "./veec-ap-auto.core";
import { consentApHoldAlert } from "./consent-ap-auto.core";
import { PIESA_OWNER_CONFIRMED_EVENT, PIESA_OWNER_CONFIRM_OFFICE_ALERT_EVENT } from "./piesa-owner-confirm.core";
import { PIESA_FIXES_CONFIRMED_EVENT, PIESA_FIXES_CONFIRM_OFFICE_ALERT_EVENT } from "./piesa-fixes-confirm.core";
import { FIXES_TIMES_GIVEN_EVENT, FIXES_TIMES_LINK_EVENT, fixesTimesMissing } from "./fixes-times.core";
import { AUTO_FIXES_QUOTE_HELD_EVENT } from "./auto-fixes-quote-send.core";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));
const DAY = 86_400_000;

/** Reads every row (pages of 1000) and fails loudly — a failed read must never look like "nothing needs you". */
async function all(what: string, page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) return out;
  }
}
/** Job-id lookups are batched (AGENTS: one all-ids URL stalled Office reads for minutes). */
async function byIds(what: string, ids: string[], q: (chunk: string[], from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 150) { const chunk = ids.slice(i, i + 150); out.push(...(await all(what, (f, t) => q(chunk, f, t)))); }
  return out;
}

export type GatheredNeeds = {
  now: number; jobs: OfficeJob[]; facts: Map<string, NeedsFacts>; emails: EmailRowInput[];
  system: SystemRow[];
};

/** Facts for every live job (Needs me) or for `onlyIds` (the Job page). The same derivation feeds both. */
export async function gatherNeedsFacts(opts: { includeTest: boolean; onlyIds?: string[] }): Promise<GatheredNeeds> {
  const office = await loadOffice(admin, { includeTest: opts.includeTest, ...(opts.onlyIds ? { onlyIds: opts.onlyIds } : {}) });
  const now = office.now;
  const jobs = office.jobs.filter((j) => j.status?.stage !== "ended" || j.stage === "on_hold");
  const ids = jobs.map((j) => j.id);
  const idSet = new Set(ids);
  const facts = new Map<string, NeedsFacts>();
  for (const j of jobs) facts.set(j.id, { jobId: j.id, jobNumber: j.jobNumber, surname: surnameOf(j.owner), suburb: j.suburb, ...(j.source === "qa_test" ? { isTest: true } : {}) });
  const f = (id: string) => facts.get(id);
  const since7 = new Date(now - 7 * DAY).toISOString();
  const scoped = <T extends { in: (c: string, v: string[]) => T }>(q: T) => (opts.onlyIds ? q.in("job_id", opts.onlyIds) : q);

  const [consents, veecForms, escRows, emailFails, smsFails, tenDay, noAccess, veecAlerts, overdue, returned, provisionalBookings, piesaAlerts, piesaConfirms, fixesLinks, fixesGiven, fixesAlerts, fixesConfirms] = await Promise.all([
    all("ESC consents", (a, b) => scoped(admin.from("owner_esc_consents").select("job_id, owner_signed_at, ap_signed_at, status, scheduled_start, created_at")).not("owner_signed_at", "is", null).is("ap_signed_at", null).range(a, b)),
    all("VEEC forms", (a, b) => scoped(admin.from("customer_assignments").select("job_id, installer_signed_at, ap_signed_at, consumer_signed_at, status, created_at")).eq("record_kind", "final_veec_assignment").neq("status", "cancelled").range(a, b)),
    all("ESC notices", (a, b) => scoped(admin.from("esc_notifications").select("job_id, due_by, earliest_send_at, scheduled_start, sent_at, status")).is("sent_at", null).gt("scheduled_start", new Date(now).toISOString()).range(a, b)),
    all("failed emails", (a, b) => scoped(admin.from("customer_email_sends").select("job_id, purpose, status, created_at, error")).eq("status", "failed").gte("created_at", since7).range(a, b)),
    all("failed texts", (a, b) => scoped(admin.from("sms_messages").select("job_id, message_type, status, created_at, detail")).in("status", ["failed", "undelivered"]).gte("created_at", since7).range(a, b)),
    all("10-day flags", (a, b) => (opts.onlyIds ? admin.from("jobs").select("id, install_10day_flagged_at, stage").in("id", opts.onlyIds) : admin.from("jobs").select("id, install_10day_flagged_at, stage")).not("install_10day_flagged_at", "is", null).eq("stage", "installation_scheduling").range(a, b)),
    all("no-access reports", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at, details")).eq("event_type", "trade_couldnt_get_in").contains("details", { visit: "install", needs_office: true }).order("created_at", { ascending: false }).range(a, b)),
    all("VEEC day-10 alerts", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at")).eq("event_type", VEEC_OFFICE_ALERT_EVENT).range(a, b)),
    all("overdue invoices", (a, b) => scoped(admin.from("invoice_status").select("job_id, effective_status, total_inc_gst, total_paid, deposit_due_date, balance_due_date")).eq("effective_status", "overdue").range(a, b)),
    // Decision 246: automatic offers that came back to the office (2 misses or no covering trade) -> "Choose again".
    all("auto offers returned", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at, summary, details")).eq("event_type", AUTO_OFFER_RETURNED_EVENT).order("created_at", { ascending: false }).range(a, b)),
    all("install bookings on hold", (a, b) => scoped(admin.from("bookings").select("job_id, created_at, scheduled_start")).eq("kind", "installation").eq("status", "confirmed").gt("created_at", new Date(now - 2 * DAY).toISOString()).gt("scheduled_start", new Date(now).toISOString()).range(a, b)),
    // Decision 296: day-5 alerts for an unconfirmed PIESA, cleared by a confirmation of the same PIESA record.
    all("PIESA owner day-5 alerts", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at, details")).eq("event_type", PIESA_OWNER_CONFIRM_OFFICE_ALERT_EVENT).range(a, b)),
    all("PIESA owner confirmations", (a, b) => scoped(admin.from("workflow_events").select("job_id, details")).eq("event_type", PIESA_OWNER_CONFIRMED_EVENT).range(a, b)),
    // Decision 315: fixes-times links to electricians, cleared by the times being given (same event both paths write).
    all("fixes times links", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at")).eq("event_type", FIXES_TIMES_LINK_EVENT).range(a, b)),
    all("fixes times given", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at")).eq("event_type", FIXES_TIMES_GIVEN_EVENT).range(a, b)),
    // Decision 330: day-5 alerts for unconfirmed electrical fixes, cleared by a confirmation of the same fixes record.
    all("fixes owner day-5 alerts", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at, details")).eq("event_type", PIESA_FIXES_CONFIRM_OFFICE_ALERT_EVENT).range(a, b)),
    all("fixes owner confirmations", (a, b) => scoped(admin.from("workflow_events").select("job_id, details")).eq("event_type", PIESA_FIXES_CONFIRMED_EVENT).range(a, b)),
  ]);

  for (const j of jobs) {
    const x = f(j.id)!;
    const st = j.status;
    const n = j.needs;
    // Offer lapsed / declined (decision 220) — the office chooses again.
    if (n.tradeChoice) x.offerLapsed = { role: n.tradeChoice.kind === "ready_check" ? "installer" : "electrician", name: n.tradeChoice.name, declined: n.tradeChoice.status === "declined", at: j.facts.lastActivityAt ?? st?.since ?? new Date(now).toISOString() };
    else if (n.offerChoice?.state === "no_taker") x.offerLapsed = { role: n.offerChoice.kind === "ready_check" ? "installer" : "electrician", name: null, declined: false, at: st?.since ?? new Date(now).toISOString() };
    else if (n.offerChoice?.state === "choose" && n.offerChoice.kind === "ready_check") x.spotSaved = { at: j.facts.campaign?.spotSavedAt ?? st?.since ?? j.facts.createdAt };
    else if (n.offerChoice?.state === "choose" && n.offerChoice.kind === "piesa") x.electricianToChoose = { at: st?.since ?? j.facts.createdAt, usual: null };
    if (!x.spotSaved && !x.offerLapsed && st && ["enquiry.spot_saved", "enquiry.spot_saved_video"].includes(st.key)) x.spotSaved = { at: j.facts.campaign?.spotSavedAt ?? st.since };
    if (!x.electricianToChoose && !x.offerLapsed && st?.key === "quote.paid") x.electricianToChoose = { at: st.since, usual: null };
    if (st?.key === "safety.fix_held") x.fixesQuoteToCheck = { at: st.since, reason: st.detail };
    if (st?.key === "signoff.ap") x.finalCheck = { at: st.since, flags: 0 };
    // 30-day window lapsed with no install (decision 1/2): watch.
    if (j.facts.installDeadline && !j.facts.installedAt && ["installation_scheduling", "installation_booked", "piesa_complete"].includes(j.stage) && Date.parse(`${j.facts.installDeadline}T23:59:59+11:00`) < now) x.lapsedWindow = { deadline: j.facts.installDeadline };
  }

  // Decision 354: an electrician-priced fixes quote goes out by itself; a draft whose automatic send was held keeps the
  // "Electrical fixes quote to check" row with the latest reason (cleared once the draft is sent or replaced).
  const [rectDrafts, rectHolds] = await Promise.all([
    all("fixes quote drafts", (a, b) => scoped(admin.from("quotes").select("id, job_id, created_at")).eq("kind", "rectification").eq("status", "draft").range(a, b)),
    all("fixes quote holds", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at, details")).eq("event_type", AUTO_FIXES_QUOTE_HELD_EVENT).order("created_at", { ascending: false }).range(a, b)),
  ]);
  for (const q of rectDrafts) {
    const x = f(String(q["job_id"])); if (!x) continue;
    const h = rectHolds.find((e) => e["job_id"] === q["job_id"] && (e["details"] as { quote_id?: string } | null)?.quote_id === q["id"]);
    if (h) x.fixesQuoteToCheck = { at: String(h["created_at"]), reason: s((h["details"] as { reason?: string } | null)?.reason) };
  }

  // Quotes to check — the one shared read (held with reasons, ready drafts, declined by the owner).
  const { loadQuotesToCheck } = await import("./installer-quote-review.server");
  const q = await loadQuotesToCheck({ showTestJobs: false, ...(opts.onlyIds ? { onlyJobIds: opts.onlyIds } : {}) });
  const qTest = opts.includeTest && !opts.onlyIds ? await loadQuotesToCheck({ showTestJobs: true }) : null;
  for (const r of [...q.rows, ...(qTest?.rows ?? [])]) { const x = f(r.jobId); if (x) x.quoteToCheck = { at: r.at, reason: r.kind === "ready" ? null : r.note, ready: r.kind === "ready" }; }
  for (const r of [...q.declined, ...(qTest?.declined ?? [])]) { const x = f(r.jobId); if (x && !x.quoteToCheck) x.quoteToCheck = { at: r.at, reason: `owner declined${r.reason ? ` (“${r.reason}”)` : ""} · reopen or close`, ready: false }; }

  if (returned.length) {
    const rIds = [...new Set(returned.map((r) => String(r["job_id"])).filter((id) => idSet.has(id)))];
    const later = rIds.length ? await byIds("offers after return", rIds, (chunk, a, b) => admin.from("partner_offers").select("job_id, kind, offered_at").in("job_id", chunk).range(a, b)) : [];
    for (const r of returned) {
      const x = f(String(r["job_id"])); if (!x || x.offerLapsed) continue;
      const kind = String((r["details"] as { kind?: string } | null)?.kind ?? "ready_check");
      // Cleared as soon as a new offer of that kind goes out after the hand-back.
      if (later.some((o) => o["job_id"] === r["job_id"] && o["kind"] === kind && String(o["offered_at"]) > String(r["created_at"]))) continue;
      x.offerLapsed = { role: kind === "piesa" ? "electrician" : "installer", name: null, declined: false, at: String(r["created_at"]), note: String(r["summary"] ?? "") };
      if (kind === "ready_check") delete x.spotSaved; else delete x.electricianToChoose;
    }
  }
  // Decision 370: the consent's AP part signs itself; a row only once that has been held >24h (or the deadline is <24h away), with the reasons.
  const heldConsents = consents.filter((c) => f(String(c["job_id"])) && !["cancelled", "stale", "superseded"].includes(String(c["status"])) && consentApHoldAlert({ ownerSignedAt: s(c["owner_signed_at"]), scheduledStart: s(c["scheduled_start"]), now, reasons: ["pending"] }).alert);
  const consentReasons = new Map<string, string[]>();
  if (heldConsents.length && heldConsents.length <= 40) {
    const { consentApHoldReasons } = await import("./consent-ap-auto.server");
    await Promise.all(heldConsents.map(async (c) => consentReasons.set(String(c["job_id"]), await consentApHoldReasons(String(c["job_id"])).catch(() => ["The consent checks could not be read."]))));
  }
  for (const c of heldConsents) {
    const x = f(String(c["job_id"])); if (!x) continue;
    const reasons = heldConsents.length <= 40 ? consentReasons.get(String(c["job_id"])) ?? [] : ["The AP part has not signed itself yet (open the job)."];
    if (!reasons.length) continue; // nothing holds it — the next tick signs it
    const start = s(c["scheduled_start"]);
    x.consentToSign = { at: String(c["owner_signed_at"]), dueAt: start ? new Date(Date.parse(start) - DAY).toISOString() : null, reasons };
  }
  // Decision 271: Part A signs itself; the office sees a row only once the automatic signature has been held >24h, with the reasons.
  const partA = veecForms.filter((v) => v["installer_signed_at"] && !v["ap_signed_at"] && apAutoHoldAlert({ installerSignedAt: String(v["installer_signed_at"]), now, reasons: ["pending"] }).alert);
  if (partA.length && partA.length <= 40) {
    const { apAutoHoldReasons } = await import("./veec-ap-auto.server");
    await Promise.all(partA.map(async (v) => { const x = f(String(v["job_id"])); if (!x) return; const reasons = await apAutoHoldReasons(String(v["job_id"])).catch(() => ["Prerequisites could not be read."]); if (reasons.length) x.veecApHeld = { at: String(v["installer_signed_at"]), reasons }; }));
  } else for (const v of partA) { const x = f(String(v["job_id"])); if (x) x.veecApHeld = { at: String(v["installer_signed_at"]), reasons: ["Prerequisites still to record (open the job)."] }; }
  for (const e of escRows) {
    const x = f(String(e["job_id"])); if (!x || ["cancelled", "withdrawn", "superseded", "stale"].includes(String(e["status"]))) continue;
    const opens = s(e["earliest_send_at"]);
    if (opens && Date.parse(opens) > now) continue; // window not open yet — the robot submits inside it
    x.escWindow = { closesAt: String(e["due_by"]), opensAt: opens };
  }
  for (const r of sendFailedRows({ now, emails: emailFails.map((e) => ({ job_id: String(e["job_id"]), purpose: String(e["purpose"]), status: String(e["status"]), created_at: String(e["created_at"]), error: s(e["error"]) })), sms: smsFails.map((m) => ({ job_id: s(m["job_id"]), message_type: String(m["message_type"]), status: String(m["status"]), created_at: String(m["created_at"]), detail: s(m["detail"]) })) })) {
    const x = f(r.jobId); if (x) x.sendFailed = { at: r.latestAt, text: r.text };
  }
  // Decision 272: the ESC Registry robot failed on a job → the office does that submission by hand (cleared once it is recorded).
  const { openRobotFailureRows } = await import("./esc-registry-robot.server");
  for (const r of await openRobotFailureRows(opts.onlyIds)) { const x = f(r.jobId); if (x && !x.robotFailed) x.robotFailed = { at: r.at, text: r.text, task: r.task }; }
  // F15: the automatic install day (PIISA) form failed with the install today/tomorrow → one row until a form is created.
  {
    const { PIISA_AUDIT_CREATED_EVENT, PIISA_AUTOSEND_OFFICE_EVENT, piisaFormFailedOpen } = await import("./piisa-autosend.core");
    const alerts = await all("install day form alerts", (a, b) => scoped(admin.from("workflow_events").select("job_id, event_type, created_at, details")).eq("event_type", PIISA_AUTOSEND_OFFICE_EVENT).gte("created_at", new Date(now - 7 * DAY).toISOString()).range(a, b));
    const aIds = [...new Set(alerts.map((e) => String(e["job_id"])).filter((id) => idSet.has(id)))];
    const made = aIds.length ? await byIds("install day forms created", aIds, (chunk, a, b) => admin.from("workflow_events").select("job_id, event_type, created_at").in("job_id", chunk).eq("event_type", PIISA_AUDIT_CREATED_EVENT).range(a, b)) : [];
    for (const id of aIds) {
      const j = jobs.find((k) => k.id === id); const x = f(id);
      if (!x || j?.stage !== "installation_booked") continue;
      const open = piisaFormFailedOpen([...alerts, ...made].filter((e) => e["job_id"] === id).map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: (e["details"] ?? null) as { message?: string | null } | null })));
      if (open) x.piisaFormFailed = open;
    }
  }
  for (const t of tenDay) { const x = f(String(t["id"])); if (x) x.tenDaysLeft ={ at: String(t["install_10day_flagged_at"]), deadline: jobs.find((j) => j.id === t["id"])?.facts.installDeadline ?? null }; }
  for (const e of noAccess) { const x = f(String(e["job_id"])); const j = jobs.find((k) => k.id === e["job_id"]); if (x && !x.secondNoAccess && j?.stage === "installation_scheduling") x.secondNoAccess = { at: String(e["created_at"]), reason: s((e["details"] as { reason?: string } | null)?.reason) }; }
  // Decision 296: the alert names its PIESA record; a confirmation of that record (or the install already booked) clears the row.
  const confirmedRecords = new Set(piesaConfirms.map((c) => `${c["job_id"]}:${(c["details"] as { piesa_record_id?: string } | null)?.piesa_record_id ?? ""}`));
  for (const e of piesaAlerts) {
    const id = String(e["job_id"]), rec = (e["details"] as { piesa_record_id?: string; completed_date?: string } | null) ?? null;
    const x = f(id); const j = jobs.find((k) => k.id === id);
    if (!x || !j || !["piesa_complete", "electrical_variation_pending", "awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling"].includes(j.stage)) continue;
    if (confirmedRecords.has(`${id}:${rec?.piesa_record_id ?? ""}`)) continue;
    if (!x.piesaOwnerUnsigned || String(e["created_at"]) > x.piesaOwnerUnsigned.at) x.piesaOwnerUnsigned = { at: String(e["created_at"]), completedDate: s(rec?.completed_date) };
  }
  // Decision 330: the alert names its fixes record; a confirmation of that record clears the row (closed jobs never show).
  const fixesConfirmed = new Set(fixesConfirms.map((c) => `${c["job_id"]}:${(c["details"] as { piesa_record_id?: string } | null)?.piesa_record_id ?? ""}`));
  for (const e of fixesAlerts) {
    const id = String(e["job_id"]), rec = (e["details"] as { piesa_record_id?: string; fixes_date?: string } | null) ?? null;
    const x = f(id); const j = jobs.find((k) => k.id === id);
    if (!x || !j || ["complete", "cancelled"].includes(j.stage)) continue;
    if (fixesConfirmed.has(`${id}:${rec?.piesa_record_id ?? ""}`)) continue;
    if (!x.fixesOwnerUnsigned || String(e["created_at"]) > x.fixesOwnerUnsigned.at) x.fixesOwnerUnsigned = { at: String(e["created_at"]), fixesDate: s(rec?.fixes_date) };
  }
  // Decision 315: 24h after the fixes-times link with no times → one "Electrician hasn't given fixes times" row.
  for (const [id, r] of fixesTimesMissing({ links: fixesLinks.map((e) => ({ job_id: String(e["job_id"]), created_at: String(e["created_at"]) })), given: fixesGiven.map((e) => ({ job_id: String(e["job_id"]), created_at: String(e["created_at"]) })), now })) {
    const x = f(id); if (x) x.fixesTimesMissing = { at: r.at };
  }
  const unsigned = new Set(veecForms.filter((v) => !v["consumer_signed_at"]).map((v) => String(v["job_id"])));
  for (const e of veecAlerts) { const x = f(String(e["job_id"])); if (x && unsigned.has(String(e["job_id"]))) x.veecDay10 = { at: String(e["created_at"]) }; }
  for (const i of overdue) { const x = f(String(i["job_id"])); if (x) x.paymentOverdue = { at: String(i["balance_due_date"] ?? i["deposit_due_date"] ?? new Date(now).toISOString()), text: `$${Math.max(0, Number(i["total_inc_gst"] ?? 0) - Number(i["total_paid"] ?? 0)).toLocaleString("en-AU", { maximumFractionDigits: 0 })} owing` }; }
  // Install deposit (10%) not in Xero while the 48h provisional hold runs (decisions 139/240): watch only.
  if (provisionalBookings.length && provisionalBookings.length <= 40) {
    const { jobPaymentView } = await import("./payments.server");
    await Promise.all(provisionalBookings.map(async (b) => {
      const x = f(String(b["job_id"])); if (!x) return;
      const v = await jobPaymentView(String(b["job_id"]), new Date(now)).catch(() => null);
      if (v?.provisional.decision !== "provisional") return;
      const dep = v.steps.find((st) => st.key === "install_deposit");
      x.paymentNotInXero = { at: String(b["created_at"]), text: `Deposit $${((dep?.amountCents ?? 0) / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 })}${v.provisional.expiresAt ? ` · hold ends ${new Date(v.provisional.expiresAt).toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" })}` : ""}` };
    }));
  }
  // Final check flags: failed compliance checks on jobs at Final check.
  const finalIds = [...facts.values()].filter((x) => x.finalCheck).map((x) => x.jobId);
  if (finalIds.length) for (const c of await byIds("final check flags", finalIds, (chunk, a, b) => admin.from("compliance_checks").select("job_id, status").in("job_id", chunk).eq("status", "fail").range(a, b))) { const x = f(String(c["job_id"])); if (x?.finalCheck) x.finalCheck.flags++; }

  // Email rows (decisions 245/247): the backend's open items (email-office.server). Renders nothing when there are none.
  const { openEmailItems } = await import("./email-office.server");
  const { CHANGE_LINE } = await import("./office-needs.core");
  const items = await openEmailItems();
  type Guess = { job_id: string; job_number: string; why?: string[] };
  const guessOf = (u: Record<string, unknown>) => ((u["guesses"] as Guess[] | undefined) ?? [])[0] ?? null;
  const askJobIds = [...new Set([...items.changes.map((c) => c.jobId as string | null), ...items.unmatched.map((u) => guessOf(u as Record<string, unknown>)?.job_id ?? null)].filter((x): x is string => !!x))];
  const askJobs = new Map<string, { jobNumber: string; surname: string; suburb: string | null; source: string | null }>();
  for (const r of askJobIds.length ? await byIds("email ask jobs", askJobIds, (chunk, a, b) => admin.from("jobs").select("id, job_number, source, owners(full_name), properties(suburb)").in("id", chunk).range(a, b)) : [])
    askJobs.set(String(r["id"]), { jobNumber: String(r["job_number"]), surname: surnameOf((r["owners"] as { full_name?: string } | null)?.full_name), suburb: (r["properties"] as { suburb?: string } | null)?.suburb ?? null, source: s(r["source"]) });
  const wantJob = (id: string | null) => !opts.onlyIds || (id != null && idSet.has(id));
  const emails: EmailRowInput[] = [];
  for (const c of items.changes as unknown as { eventId: string; jobId: string; at: string; intent?: string; phrase?: string }[]) {
    const j = askJobs.get(c.jobId);
    if (!wantJob(c.jobId) || (!opts.includeTest && j?.source === "qa_test")) continue;
    const line = CHANGE_LINE[(c.intent ?? "other") as keyof typeof CHANGE_LINE] ?? CHANGE_LINE.other;
    emails.push({ type: "change", eventId: c.eventId, jobId: c.jobId, jobNumber: j?.jobNumber ?? null, surname: j?.surname ?? "", suburb: j?.suburb ?? null, line: `${line}${c.phrase ? ` · “${c.phrase}”` : ""}`, at: c.at, intent: c.intent ?? null });
  }
  for (const u of items.unmatched as unknown as ({ eventId: string; at: string; from?: string | null; subject?: string | null } & Record<string, unknown>)[]) {
    const g = guessOf(u);
    if (!wantJob(g?.job_id ?? null)) continue;
    const j = g ? askJobs.get(g.job_id) : undefined;
    emails.push({ type: "unmatched", eventId: u.eventId, guessJobId: g?.job_id ?? null, jobNumber: j?.jobNumber ?? g?.job_number ?? null, surname: j?.surname ?? "", suburb: j?.suburb ?? null,
      line: `Email from ${u.from ?? "an unknown sender"}${u.subject ? ` · “${String(u.subject).slice(0, 60)}”` : ""}${g ? ` · best guess ${g.job_number}${g.why?.length ? ` (${g.why[0]})` : ""}` : " · no guess"}`, at: u.at });
  }

  // Partner & system fold (decision 221): partner items from the office rulebook + per-job system failures + quotes not drafted.
  const system: SystemRow[] = [];
  if (!opts.onlyIds) {
    for (const p of office.needs.items.filter((i) => i.rule === "j_partner")) system.push({ key: p.key, tag: /application/i.test(p.what) ? "Application" : /worker|staff/i.test(p.what) ? "Person" : /form/i.test(p.what) ? "Mitti" : "Partner", who: p.what, line: p.why, since: p.dueAt, button: "Review", href: p.href ?? "/admin/partners" });
    for (const j of jobs) for (const why of j.needs.failures) if (!/^(Email|Text) /.test(why)) system.push({ key: `fail:${j.id}:${why}`, tag: "System", who: `${j.jobNumber} ${surnameOf(j.owner)}`.trim(), line: why, since: null, button: "Open job", href: `/admin/jobs/${j.id}`, jobId: j.id });
    // Decision 303: "<REC> onboarded and linked to <installer> — n quote(s) ready to check" (or the conflict the office decides).
    for (const r of await (await import("./rec-auto-link.server")).recentRecLinkItems().catch(() => [])) system.push({ key: r.key, tag: "Partner", who: r.recName, line: r.line, since: r.since, button: r.conflict ? "Decide" : "Quotes to check", href: r.conflict ? "/admin/partners" : "/admin/quotes" });
    for (const r of [...q.notDrafted, ...(qTest?.notDrafted ?? [])]) if (idSet.has(r.jobId)) system.push({ key: `nodraft:${r.jobId}`, tag: "Quote", who: `${r.jobNumber} ${surnameOf(r.owner)}`.trim(), line: `Quote not drafted yet · ${r.note}`, since: r.at, button: "Open job", href: `/admin/jobs/${r.jobId}`, jobId: r.jobId });
    // Decision 335: 1–3 star private feedback from the My job review screen → ONE row per job for 14 days (the job is
    // often already closed, so this reads the events directly rather than the live-job list).
    const { OWNER_REVIEW_FEEDBACK_EVENT, REVIEW_FEEDBACK_ROW_DAYS, reviewFeedbackRows } = await import("./owner-review.core");
    const fb = await all("review feedback", (a, b) => admin.from("workflow_events").select("job_id, created_at, details").eq("event_type", OWNER_REVIEW_FEEDBACK_EVENT).gte("created_at", new Date(now - REVIEW_FEEDBACK_ROW_DAYS * DAY).toISOString()).range(a, b));
    if (fb.length) {
      const fbIds = [...new Set(fb.map((e) => String(e["job_id"])))];
      const fbJobs = new Map<string, { jobNumber: string; surname: string; isTest?: boolean }>();
      for (const r of await byIds("review feedback jobs", fbIds, (chunk, a, b) => admin.from("jobs").select("id, job_number, source, owners(full_name)").in("id", chunk).range(a, b)))
        fbJobs.set(String(r["id"]), { jobNumber: String(r["job_number"]), surname: surnameOf((r["owners"] as { full_name?: string } | null)?.full_name), ...(r["source"] === "qa_test" ? { isTest: true } : {}) });
      system.push(...reviewFeedbackRows(fb.map((e) => ({ job_id: String(e["job_id"]), created_at: String(e["created_at"]), details: (e["details"] ?? null) as { stars?: number; feedback?: string } | null })), fbJobs, now, opts.includeTest));
    }
  }
  return { now, jobs, facts, emails, system };
}

export type NeedsMePage = { now: number; groups: Record<"today" | "week" | "watch", NeedsRow[]>; system: SystemRow[]; total: number };

export async function loadNeedsMePage(includeTest: boolean): Promise<NeedsMePage> {
  const g = await gatherNeedsFacts({ includeTest });
  const groups = buildNeedsRows({ now: g.now, jobs: [...g.facts.values()], emails: g.emails });
  return { now: g.now, groups, system: g.system, total: groups.today.length + groups.week.length + groups.watch.length };
}
