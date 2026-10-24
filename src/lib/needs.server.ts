// Office needs-attention list (read-only). Shared by the office queue and the daily brief.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

export async function loadNeedsHivic() {
  const ok = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
    if (r.error) throw new Error(`Could not load ${what}: ${r.error.message}`);
    return (r.data ?? []) as T;
  };
  const [jobs, exh, elec, rel, comms, rq, rp, unav, timing, esc, ev, veec, unappr, rsent] = await Promise.all([
    admin.from("jobs").select("id, job_number, source, stage, channel, properties(suburb, postcode)").not("stage", "in", "(complete,cancelled)").is("deleted_at", null),
    admin.from("workflow_events").select("job_id, created_at, details").eq("event_type", "rec_coverage_exhausted").order("created_at", { ascending: false }),
    admin.from("job_assignments").select("job_id").eq("role", "electrician").eq("active", true),
    admin.from("contact_releases").select("job_id, visit_kind, released_at, job_assignments!inner(active, booking_confirmed_at)").is("revoked_at", null),
    admin.from("job_communications").select("job_id, created_at").in("delivery_status", ["failed", "undelivered"]),
    admin.from("quotes").select("job_id, created_at").eq("kind", "rectification").eq("status", "declined"),
    admin.from("quotes").select("job_id, created_at").eq("kind", "rectification").eq("status", "draft").is("office_reviewed_at", null),
    admin.from("job_assignments").select("job_id, cannot_attend_at").eq("role", "installer").eq("active", true).not("cannot_attend_at", "is", null),
    admin.from("job_piesa_deadlines").select("job_id, urgency, piesa_expired, days_remaining"),
    admin.from("esc_notifications").select("job_id, created_at, due_by, last_error").is("sent_at", null),
    admin.from("evidence_requirements").select("job_id, verified_at").eq("status", "rejected"),
    admin.from("veec_lodgements").select("job_id, status, updated_at, query_received_at, reply_sent_at").in("status", ["query", "rejected"]),
    admin.from("workflow_events").select("job_id, created_at, details").eq("event_type", "rec_no_longer_approved"),
    admin.from("quotes").select("job_id, sent_at").eq("kind", "rectification").eq("status", "issued").not("sent_at", "is", null),
  ]);
  const { data: instEv } = await admin.from("workflow_events").select("job_id, event_type, created_at, details").in("event_type", ["install_ten_days_left", "install_days_declined"]).order("created_at", { ascending: false });
  const { data: rcEv } = await admin.from("workflow_events").select("job_id, created_at").eq("event_type", "ready_check_no_taker").order("created_at", { ascending: false });
  // Visit flags (cancellations / no-shows): open until a newer booking of that visit type exists, or the no-show is cleared.
  const { data: vEv } = await admin.from("workflow_events").select("job_id, created_at, details, summary").eq("event_type", "visit_needs_office").gte("created_at", new Date(Date.now() - 60 * 86_400_000).toISOString());
  const vJobs = [...new Set((vEv ?? []).map((e) => e.job_id).filter(Boolean))] as string[];
  const [{ data: vBk }, { data: vNs }, { data: vCl }] = await Promise.all([
    admin.from("bookings").select("job_id, kind, created_at").in("job_id", vJobs.length ? vJobs : ["00000000-0000-0000-0000-000000000000"]),
    admin.from("visit_events").select("id, booking_id").eq("event", "trade_no_show").in("job_id", vJobs.length ? vJobs : ["00000000-0000-0000-0000-000000000000"]),
    admin.from("visit_events").select("clears_event_id").eq("event", "no_show_cleared").in("job_id", vJobs.length ? vJobs : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  const clearedIds = new Set((vCl ?? []).map((c) => c.clears_event_id));
  const clearedBookings = new Set((vNs ?? []).filter((n) => clearedIds.has(n.id)).map((n) => n.booking_id));
  const visitFlags = (vEv ?? []).flatMap((e) => {
    const d = (e.details ?? {}) as { code?: string; kind?: string; booking_id?: string };
    if (!e.job_id || !d.code) return [];
    if (d.code === "trade_no_show" && d.booking_id && clearedBookings.has(d.booking_id)) return [];
    if ((vBk ?? []).some((b) => b.job_id === e.job_id && b.kind === d.kind && b.created_at > e.created_at)) return [];
    return [{ job_id: e.job_id, code: d.code as "trade_no_show", created_at: e.created_at, detail: e.summary ?? undefined }];
  });
  const [{ data: tOff }, { offersWithNoTaker }, { offerSuggestHours }] = await Promise.all([
    admin.from("partner_offers").select("id, job_id, kind, status, offered_at").in("kind", ["ready_check", "piesa"]).gte("offered_at", new Date(Date.now() - 30 * 86_400_000).toISOString()),
    import("./offer-timing.core"), import("./offer-dispatch.server"),
  ]);
  // Ready Check offers close after 24 hours and come back as "choose another installer" (below), never "no taker".
  const offerNoTaker = offersWithNoTaker((tOff ?? []).filter((o) => o.kind !== "ready_check"), await offerSuggestHours());
  // Office picks first: jobs ready for an offer with nothing out yet.
  const { officePicks, needsChooseTrades } = await import("./offer-dispatch.core");
  const mode = await (await import("./offer-dispatch.server")).dispatchMode();
  const ready = ok(jobs, "jobs").filter((j) => j.stage === "ready_check_ready_to_schedule" || j.stage === "piesa_and_install_window_pending");
  const readyIds = ready.map((j) => j.id);
  const [{ data: ovr }, { data: rcWin }, { data: trAsg }] = await Promise.all([
    admin.from("jobs").select("id, offer_dispatch_override").in("id", readyIds.length ? readyIds : ["00000000-0000-0000-0000-000000000000"]),
    admin.from("ready_check_windows").select("job_id, created_at").eq("status", "open").in("job_id", readyIds.length ? readyIds : ["00000000-0000-0000-0000-000000000000"]),
    admin.from("job_assignments").select("job_id, role").eq("active", true).in("job_id", readyIds.length ? readyIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  const ov = new Map((ovr ?? []).map((o) => [o.id, o.offer_dispatch_override]));
  // Jo 24 Oct 2026 (decisions 49–51): our-lead Ready Checks — ONE item per job: choose an installer, or (after
  // "Not for me" / 24 hours) choose another. Never both, and never the "no taker" item.
  const { readyCheckOfficeItem } = await import("./ready-check-times.core");
  const readyCheckReturned: { job_id: string; created_at: string; detail?: string }[] = [];
  const chooseTrades = ready.flatMap((j) => {
    const k = j.stage === "ready_check_ready_to_schedule" ? "ready_check" : "piesa";
    if (k === "ready_check") {
      const hasInst = (trAsg ?? []).some((a) => a.job_id === j.id && a.role === "installer");
      const offers = (tOff ?? []).filter((o) => o.job_id === j.id && o.kind === "ready_check");
      const item = readyCheckOfficeItem({ channel: j.channel, stage: j.stage, hasInstaller: hasInst, offers });
      if (item?.code === "offer_returned") { readyCheckReturned.push({ job_id: j.id, created_at: offers.map((o) => o.offered_at).sort().pop()!, detail: item.status === "declined" ? "(The installer said Not for me.)" : "(No times within 24 hours.)" }); return []; }
      return item?.code === "choose_installer" ? [{ job_id: j.id, kind: k, since: null }] : [];
    }
    const win = (rcWin ?? []).filter((w) => w.job_id === j.id);
    const readyForOffer = k === "piesa" || win.length > 0;
    const hasTrade = (trAsg ?? []).some((a) => a.job_id === j.id && a.role === (k === "piesa" ? "electrician" : "installer"));
    const live = (tOff ?? []).filter((o) => o.job_id === j.id && o.kind === k && o.status !== "expired" && o.status !== "withdrawn").length;
    return needsChooseTrades({ officePicks: officePicks(mode, ov.get(j.id) ?? null), readyForOffer, hasTrade, offersThisRound: live }) ? [{ job_id: j.id, kind: k, since: win.map((w) => w.created_at).sort()[0] ?? null }] : [];
  });
  const { data: rcInst } = await admin.from("job_assignments").select("job_id").eq("role", "installer").eq("active", true);
  const withInst = new Set((rcInst ?? []).map((a) => a.job_id));
  const jobRows = ok(jobs, "jobs").filter((j) => j.source !== "qa_test");
  const withElec = new Set(ok(elec, "assignments").map((a) => a.job_id));
  const seen = new Set<string>();
  const coverage = ok(exh, "allocation events").filter((e) => !withElec.has(e.job_id) && !seen.has(e.job_id) && seen.add(e.job_id))
    .map((e) => ({ job_id: e.job_id, created_at: e.created_at, detail: (e.details as { reason?: string } | null)?.reason === "owner_times" ? "No electrician could take the owner's times." : undefined }));
  // Still-relevant "no longer approved" events: the flagged business is still the active electrician.
  const { data: activeElec } = await admin.from("job_assignments").select("job_id, business_id").eq("role", "electrician").eq("active", true);
  const activeKey = new Set((activeElec ?? []).map((a) => `${a.job_id}:${a.business_id}`));
  const recNoLongerApproved = ok(unappr, "electrician approval events")
    .filter((e) => activeKey.has(`${e.job_id}:${(e.details as { business_id?: string } | null)?.business_id}`))
    .map((e) => ({ job_id: e.job_id, since: e.created_at }));
  const now = new Date();
  // Our-lead Ready Check times going back and forth between owner and installer: no office step (decision 52).
  const { READY_CHECK_TIME_NOTE } = await import("./ready-check-times.core");
  const { data: rcTimes } = await admin.from("appointment_proposals").select("job_id").eq("kind", "ready_check").eq("note", READY_CHECK_TIME_NOTE).eq("status", "proposed").gt("starts_at", now.toISOString());
  const rcTalking = new Set((rcTimes ?? []).map((r) => r.job_id));
  const { buildNeedsHivic } = await import("./allocation.core");
  const items = buildNeedsHivic({
    readyCheckReturned,
    recNoLongerApproved,
    now, jobs: jobRows.map((j) => { const p = j.properties as { suburb: string | null; postcode: string | null } | null; return { id: j.id, job_number: j.job_number, stage: j.stage, suburb: p ? [p.suburb, p.postcode].filter(Boolean).join(" ") : null }; }),
    coverageExhausted: coverage,
    releases: ok(rel, "contact releases").filter((r) => (r.job_assignments as { active: boolean }).active && !(r.visit_kind === "ready_check" && rcTalking.has(r.job_id))).map((r) => ({ job_id: r.job_id, visit_kind: r.visit_kind as never, released_at: r.released_at, confirmed_at: (r.job_assignments as { booking_confirmed_at: string | null }).booking_confirmed_at })),
    failedComms: ok(comms, "communications"),
    rectDeclined: ok(rq, "electrical fixes quotes"),
    rectPricing: ok(rp, "electrical fixes drafts"),
    installerUnavailable: ok(unav, "installer assignments").map((a) => ({ job_id: a.job_id, at: a.cannot_attend_at!, reason: null })),
    piesaTiming: ok(timing, "PIESA timing").filter((t): t is typeof t & { job_id: string } => !!t.job_id),
    escTiming: ok(esc, "ESC notices").filter((e) => e.last_error || (e.due_by && Date.parse(e.due_by) < now.getTime())),
    evidenceRejected: ok(ev, "evidence").map((e) => ({ job_id: e.job_id, created_at: e.verified_at })),
    registryQueries: ok(veec, "VEEC lodgements"),
    officeOverdue: [],
    rectUnanswered: ok(rsent, "electrical fixes quotes sent"),
    prestart: await (await import("./prestart.server")).prestartNeeds(now).catch((e) => { console.error("pre-start needs failed", (e as Error).message); return undefined; }),
    visitFlags,
    offerNoTaker,
    chooseTrades,
    readyCheckNoTaker: (rcEv ?? []).filter((e): e is { job_id: string; created_at: string } => !!e.job_id && !withInst.has(e.job_id)),
    installFlags: (instEv ?? []).filter((e) => !!e.job_id).map((e) => ({ job_id: e.job_id!, code: e.event_type as "install_ten_days_left" | "install_days_declined", created_at: e.created_at, detail: e.event_type === "install_ten_days_left" ? `Last day ${(e.details as { deadline?: string } | null)?.deadline ?? "?"}.` : undefined })),
  });
  // Never nag about closed, deleted or removed jobs (Jo 21 Oct).
  const closed = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("office_enquiry_index").select("id").eq("office_bucket", "closed").order("id").range(from, from + 999);
    if (error) throw new Error(`Could not load closed jobs: ${error.message}`);
    (data ?? []).forEach((r) => r.id && closed.add(r.id));
    if (!data || data.length < 1000) break;
  }
  const open = new Set(jobRows.filter((j) => !closed.has(j.id)).map((j) => j.id));
  const kept = items.filter((it) => !it.jobId || open.has(it.jobId));
  const { data: electricianEvents, error: ee } = await admin.from("workflow_events").select("job_id, details, created_at").eq("event_type", "mitti_electrician_recorded").order("created_at", { ascending: false });
  if (ee) throw new Error("Could not load Ready Check electrician holds.");
  const latestElectrical = new Set<string>();
  const { needsItem } = await import("./allocation.core");
  for (const e of electricianEvents ?? []) {
    if (!e.job_id || latestElectrical.has(e.job_id)) continue;
    latestElectrical.add(e.job_id);
    if (!open.has(e.job_id) || (e.details as { needsProfile?: boolean } | null)?.needsProfile !== true) continue;
    const j = jobRows.find((r) => r.id === e.job_id);
    kept.push(needsItem("installer_usual_electrician_missing", e.job_id, j?.job_number ?? null, e.created_at, undefined, j));
  }
  // Stage 8 (Jo 22 Oct): Mitti "Office needs to…" items from recorded events (latest per job; cleared by later events).
  {
    const { mittiOfficeItems } = await import("./ready-check-chase.core");
    const types = ["mitti_measureup_sync_failed", "mitti_measureup_synced", "mitti_sync_retried", "ready_check_needs_office", "installer_quote_held", "installer_quote_queued",
      "quote_hold_approved", "quote_requeued_after_review", "quote_hold_stopped", "quote_declined", "mitti_access_needed", "mitti_access_override", "mitti_audit_linked", "mitti_synced",
      "ready_check_incomplete", "ready_check_incomplete_cleared", "mitti_pickup_needs_review", "mitti_pickup_auto_created",
      "quote_auto_send_held", "quote_sent_automatically", "quote_sent_by_office"];
    const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
    const { data: mev, error: me } = await admin.from("workflow_events").select("job_id, event_type, created_at, details, summary").in("event_type", types).gte("created_at", since).order("created_at").limit(5000);
    if (me) throw new Error("Could not load Mitti office items.");
    for (const it of mittiOfficeItems((mev ?? []) as never, now)) {
      if (it.jobId && !open.has(it.jobId)) continue;
      const j = it.jobId ? jobRows.find((r) => r.id === it.jobId) : undefined;
      const n = needsItem(it.code, it.jobId, j?.job_number ?? null, it.since, it.detail ?? undefined, j);
      kept.push({ ...n, key: it.key });
    }
  }
  return { items: kept, checkedAt: now.toISOString() };
}
