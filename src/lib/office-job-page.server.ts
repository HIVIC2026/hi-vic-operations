// O2 Job page reads (office only): header facts, the one Next panel, the six stage cards, Money (+ office-only margin)
// and Contact history. Read-only. The Next panel uses the SAME facts as Needs me (office-needs.server gatherNeedsFacts).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { gatherNeedsFacts } from "./office-needs.server";
import { nextAction } from "./job-next-action.core";
import { jobsStage, surnameOf } from "./office-jobs.core";
import { buildStageCards, type StageCardFacts } from "./office-stage-cards.core";
import { mergeContactHistory, lastHeardFromUs, type CommRow, type EmailSendRow, type OwnerActionRow, type PortalMessageRow, type SmsRow } from "./contact-history.core";
import { splitAddress } from "./name-address-tidy.core";
import { ELIGIBILITY_WORDS } from "./job-wording";

const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
const DAY = 86_400_000;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" });
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" });

async function contactRows(jobId: string, job: { created_at: string; source: string; channel: string }) {
  const [emails, comms, sms, messages, accepted, payments] = await Promise.all([
    admin.from("customer_email_sends").select("id, purpose, status, sent_at, created_at, error, communication_id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(300),
    admin.from("job_communications").select("id, channel, direction, subject, body, delivery_status, provider, sent_at, received_at, created_at, visibility, source_event").eq("job_id", jobId).neq("visibility", "trade").order("created_at", { ascending: false }).limit(300),
    admin.from("sms_messages").select("id, message_type, status, body, created_at, to_number, business_id").eq("job_id", jobId).is("business_id", null).order("created_at", { ascending: false }).limit(300),
    admin.from("messages").select("id, body, created_at, internal, sender_label, channel").eq("job_id", jobId).order("created_at", { ascending: false }).limit(300),
    admin.from("quotes").select("id, accepted_at, kind").eq("job_id", jobId).not("accepted_at", "is", null),
    admin.from("workflow_events").select("id, created_at, details").eq("job_id", jobId).eq("event_type", "owner_payment_recorded").order("created_at", { ascending: false }).limit(50),
  ]);
  for (const r of [emails, comms, sms, messages, accepted, payments]) if (r.error) throw new Error(`Contact history could not load: ${r.error.message}`);
  const ownerActions: OwnerActionRow[] = [
    { id: `enquiry:${jobId}`, at: job.created_at, what: job.channel === "installer_sourced" ? "Installer added the job" : job.source === "base44" ? "Save my spot enquiry" : "Enquiry entered by the office", channel: job.source === "base44" ? "Website" : "Portal" },
    ...(accepted.data ?? []).map((q) => ({ id: `accept:${q.id}`, at: String(q.accepted_at), what: q.kind === "rectification" ? "Owner approved the electrical fixes quote" : "Owner accepted the quote and signed the agreement", channel: "Portal" as const })),
    ...(payments.data ?? []).map((p) => { const d = (p.details ?? {}) as { amount_cents?: number; source?: string }; return { id: `pay:${p.id}`, at: p.created_at, what: `Owner paid $${((d.amount_cents ?? 0) / 100).toLocaleString("en-AU")}${d.source ? ` · ${d.source === "xero" ? "Xero" : d.source}` : ""}`, channel: "Portal" as const }; }),
  ];
  return mergeContactHistory({ emails: (emails.data ?? []) as EmailSendRow[], comms: (comms.data ?? []) as CommRow[], sms: (sms.data ?? []) as SmsRow[], messages: (messages.data ?? []) as PortalMessageRow[], ownerActions });
}

export async function loadJobPage(jobId: string) {
  const { data: job, error } = await admin.from("jobs").select("id, job_number, stage, prior_stage, source, channel, created_at, hold_reason, hold_revisit_at, cancelled_reason, life_support, deleted_at, installation_completed_at, estimated_area_m2, eligibility_outcome, eligibility_review_required, originating_installer_business_id, owners(full_name, email, phone), properties(address_line, suburb, postcode, state, occupancy, enrichment)").eq("id", jobId).maybeSingle();
  if (error) throw new Error(`This job could not be loaded: ${error.message}`);
  if (!job) throw new Error("Job not found.");
  const now = Date.now();
  const owner = job.owners as { full_name: string | null; email: string | null; phone: string | null } | null;
  const prop = job.properties as { address_line: string | null; suburb: string | null; postcode: string | null; state: string | null; occupancy: string | null; enrichment: Record<string, unknown> | null } | null;
  const addr = splitAddress(prop?.address_line, prop?.suburb, prop?.postcode);

  const [gathered, consent, asg, offers, bookings, meas, diagram, quotes, piesa, rect, escConsent, escNotice, assignment, evidence, veec, campaign, links, media, readyForVeec, originBiz, proposals, contacts] = await Promise.all([
    gatherNeedsFacts({ includeTest: true, onlyIds: [jobId] }),
    admin.from("owner_contact_consents").select("consent_status, consented_at, created_at").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("job_assignments").select("role, business_id, assigned_at, active, businesses(name)").eq("job_id", jobId).eq("active", true),
    admin.from("partner_offers").select("kind, status, offered_at, responded_at, businesses(name)").eq("job_id", jobId).order("offered_at", { ascending: false }),
    admin.from("bookings").select("kind, status, scheduled_start").eq("job_id", jobId).in("status", ["confirmed", "completed"]).order("scheduled_start", { ascending: false }),
    admin.from("ceiling_measurements").select("measured_area_m2, status, external_source, completed_at, updated_at").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("documents").select("created_at").eq("job_id", jobId).eq("kind", "area_diagram").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("quotes").select("id, kind, status, release_state, release_hold_reason, sent_at, accepted_at, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, created_at").eq("job_id", jobId).neq("status", "superseded").order("created_at", { ascending: false }),
    admin.from("piesa_records").select("outcome, completed_date").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("quotes").select("status, customer_total_inc_gst, sent_at, accepted_at").eq("job_id", jobId).eq("kind", "rectification").neq("status", "superseded").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("owner_esc_consents").select("status, owner_signed_at, ap_signed_at").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("esc_notifications").select("status, sent_at, due_by").eq("job_id", jobId).not("status", "in", "(cancelled,stale)").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("customer_assignments").select("status, installer_signed_at, ap_signed_at, consumer_signed_at").eq("job_id", jobId).eq("record_kind", "final_veec_assignment").neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("evidence_requirements").select("status").eq("job_id", jobId).eq("required", true).eq("status", "outstanding"),
    admin.from("veec_lodgements").select("status, submitted_date").eq("job_id", jobId).maybeSingle(),
    admin.from("lead_campaign_responses").select("saved_total, saved_veu_discount, spot_saved_at").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("customer_estimate_links").select("created_at, last_viewed_at").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("documents").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "intake_media"),
    admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", "stage_changed").eq("to_stage", "ready_for_veec").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    job.originating_installer_business_id ? admin.from("businesses").select("name").eq("id", job.originating_installer_business_id).maybeSingle() : Promise.resolve({ data: null as { name: string } | null }),
    admin.from("appointment_proposals").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("install_day", true).eq("status", "proposed"),
    contactRows(jobId, { created_at: job.created_at, source: job.source, channel: job.channel }),
  ]);
  const bizOf = (role: string) => ((asg.data ?? []).find((a) => a.role === role)?.businesses as { name?: string } | null)?.name ?? null;
  const ownJob = job.channel === "installer_sourced";
  const installer = bizOf("installer") ?? (ownJob ? originBiz.data?.name ?? null : null);
  const officeJob = gathered.jobs.find((j) => j.id === jobId) ?? null;
  const status = officeJob?.status ?? null;
  const facts = gathered.facts.get(jobId) ?? null;
  const closed = job.stage === "complete" ? "complete" as const : job.stage === "cancelled" ? "cancelled" as const : null;
  const stage = jobsStage({ stage: job.stage, priorStage: job.prior_stage, hasInstaller: !!installer });
  const next = nextAction({
    facts, status: status ? { key: status.key, label: status.label, waitingOn: status.waitingOn, detail: status.detail, dueAt: status.dueAt } : null, stage,
    closed: closed ? { kind: closed, reason: job.cancelled_reason } : job.eligibility_outcome === "does_not_appear_eligible" && !stage ? { kind: "ineligible", reason: null } : null,
    onHold: job.stage === "on_hold" ? { reason: job.hold_reason, until: job.hold_revisit_at } : null,
  }, now);

  const rcOffer = (offers.data ?? []).find((o) => o.kind === "ready_check" && o.status === "accepted") ?? (offers.data ?? []).find((o) => o.kind === "ready_check");
  const piesaOffer = (offers.data ?? []).find((o) => o.kind === "piesa");
  const book = (k: string) => (bookings.data ?? []).find((b) => b.kind === k)?.scheduled_start ?? null;
  const instQ = (quotes.data ?? []).find((q) => q.kind === "installation") ?? null;
  const pay = await (await import("./payments.server")).jobPaymentView(jobId).catch(() => null);
  const step = (k: string) => pay?.steps.find((x) => x.key === k) ?? null;
  const deadline = officeJob?.facts.installDeadline ?? null;
  const daysLeft = deadline ? Math.ceil((Date.parse(`${deadline}T23:59:59+11:00`) - now) / DAY) : null;
  const b44 = ((prop?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } }).raw?.answers ?? null;
  const { declaredExtras } = await import("./enquiry.core");
  const { normaliseInsulation } = await import("./eligibility.core");
  const declared = normaliseInsulation(declaredExtras(b44).existing_insulation);
  const ownerSaid = [declared === "none" ? "No insulation" : declared === "present" ? "Some insulation" : declared === "unknown" ? "Not sure about insulation" : null, job.estimated_area_m2 ? `about ${Math.round(Number(job.estimated_area_m2))} m²` : null, prop?.occupancy ? prop.occupancy.replace(/_/g, "-") : null].filter(Boolean).join(" · ") || null;
  const deposit = step("install_deposit");
  const cardFacts: StageCardFacts = {
    current: stage, closed, ownJob,
    enquiry: { receivedAt: job.created_at, source: ownJob ? `added by ${installer ?? "the installer"}` : job.source === "base44" ? "website Save my spot" : job.source === "qa_test" ? "TEST" : "phone / office", estimateTotal: n(campaign.data?.saved_total), estimateRebate: n(campaign.data?.saved_veu_discount), linkSentAt: s(links.data?.created_at), linkViewedAt: s(links.data?.last_viewed_at), ownerSaid,
      eligibility: job.eligibility_review_required ? "Needs review" : job.eligibility_outcome ? ELIGIBILITY_WORDS[job.eligibility_outcome as keyof typeof ELIGIBILITY_WORDS] ?? job.eligibility_outcome : null, photos: media.count ?? 0 },
    readyCheck: { installer, chosenAt: rcOffer ? s(rcOffer.offered_at) : null, acceptedAt: rcOffer?.status === "accepted" ? s(rcOffer.responded_at) : null, visitAt: book("ready_check"),
      mitti: meas.data ? `${meas.data.status === "complete" ? "Complete" : "Started"} ${day(String(meas.data.completed_at ?? meas.data.updated_at))}${meas.data.external_source === "mitti" ? " · synced" : ""}` : null,
      measured: meas.data?.measured_area_m2 ? `${Math.round(Number(meas.data.measured_area_m2))} m²` : null, diagramAt: s(diagram.data?.created_at) },
    quote: { sentAt: s(instQ?.sent_at), held: instQ?.release_state === "held" ? instQ.release_hold_reason ?? "held" : null, subtotal: n(instQ?.subtotal_inc_gst), incentive: n(instQ?.veec_discount_inc_gst), ownerPays: n(instQ?.customer_total_inc_gst), acceptedAt: s(instQ?.accepted_at), signer: null,
      // The $349 is the first step, so it was paid by the earliest recorded payment (append-only ledger).
      safetyPaidAt: step("safety_check")?.state === "paid" ? ([...(pay?.ledger ?? [])].map((l) => l.paidAt).sort()[0] ?? null) : null, safetyCheckCents: step("safety_check")?.amountCents ?? null, declined: instQ?.status === "declined" ? "owner said not for them" : null },
    piesa: { electrician: bizOf("electrician"), offer: piesaOffer ? `${(piesaOffer.businesses as { name?: string } | null)?.name ?? "Electrician"} · ${piesaOffer.status === "pending" ? `offered ${day(piesaOffer.offered_at)}` : piesaOffer.status}` : null, visitAt: book("assessment"),
      outcome: piesa.data ? `${piesa.data.outcome === "pass" ? "Passed" : piesa.data.outcome === "fail" ? "Fixes needed" : String(piesa.data.outcome)} ${day(String(piesa.data.completed_date))}` : null,
      fixes: rect.data ? `${rect.data.status === "accepted" ? "Approved" : rect.data.sent_at ? "Quote sent" : "Quote being checked"} · $${Number(rect.data.customer_total_inc_gst).toLocaleString("en-AU", { maximumFractionDigits: 0 })}` : null },
    install: { deadline, daysLeft, deposit: deposit ? `$${(deposit.amountCents / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 })} (10%) · ${deposit.state === "paid" ? "paid" : deposit.state === "requested" ? `held until ${pay?.provisional.expiresAt ? dayTime(pay.provisional.expiresAt) : "paid"}` : deposit.state === "overdue" ? "overdue" : "to book · bank transfer"}` : null,
      installAt: book("installation"), daysOffered: proposals.count ?? 0,
      consent: escConsent.data ? (escConsent.data.ap_signed_at ? `Signed ${day(escConsent.data.ap_signed_at)}` : escConsent.data.owner_signed_at ? "Owner signed · AP to sign" : "Waiting for the owner") : null,
      escNotice: escNotice.data ? (escNotice.data.sent_at ? `Submitted ${day(escNotice.data.sent_at)}` : `Due by ${dayTime(escNotice.data.due_by)}`) : null },
    finalCheck: { installedAt: s(job.installation_completed_at), evidenceMissing: job.installation_completed_at ? (evidence.data ?? []).length : null,
      veecForm: assignment.data ? [assignment.data.installer_signed_at ? "Installer ✓" : "Installer —", assignment.data.ap_signed_at ? "AP ✓" : "AP —", assignment.data.consumer_signed_at ? "Owner ✓" : "Owner —"].join(" · ") : null,
      readyForVeecAt: s(readyForVeec.data?.created_at), lodged: veec.data?.submitted_date ? `VEEC lodged ${day(veec.data.submitted_date)}` : null },
  };
  const lastHeard = lastHeardFromUs(contacts);
  return {
    now,
    header: {
      jobId, jobNumber: job.job_number, isTest: job.source === "qa_test", ownJob, installerName: installer, stage: job.stage, deleted: !!job.deleted_at,
      ownerName: owner?.full_name ?? null, surname: surnameOf(owner?.full_name), phone: owner?.phone ?? null, email: owner?.email ?? null,
      street: addr.street || prop?.address_line || null, suburb: addr.suburb || null, postcode: addr.postcode || null,
      sourceLabel: ownJob ? `Installer's own customer · ${installer ?? "installer"}` : job.source === "base44" ? "Website enquiry" : job.source === "qa_test" ? "TEST job" : "Phone / office enquiry",
      receivedAt: job.created_at, permissionAt: consent.data?.consent_status === "granted" ? s(consent.data.consented_at ?? consent.data.created_at) : null, permissionState: consent.data?.consent_status ?? null,
      lastHeard: lastHeard ? { at: lastHeard.at, channel: lastHeard.channel } : null, lifeSupport: !!job.life_support,
      statusPill: closed === "cancelled" ? "Cancelled" : closed === "complete" ? "Complete" : job.stage === "on_hold" ? "On hold" : status?.label ?? null,
      installBy: deadline && !job.installation_completed_at ? deadline : null, escDue: escNotice.data && !escNotice.data.sent_at ? escNotice.data.due_by : null,
      canDelete: job.source === "qa_test", canReopen: job.stage !== "complete" && (job.stage === "cancelled" || job.eligibility_outcome === "does_not_appear_eligible" || job.source === "qa_test"),
    },
    next, cards: buildStageCards(cardFacts), stage,
    waitingFor: next.who === "nobody" ? "nothing — it happens automatically" : next.who === "us" ? `us — ${next.sentence.charAt(0).toLowerCase()}${next.sentence.slice(1)}` : `the ${next.who} — ${next.sentence.replace(/^Waiting for the [a-z]+: /, "").replace(/^Installer is /, "")}`,
    contacts,
  };
}

/** Money card (decisions 139–144, 152, 209, 230, 240): one invoice, four steps, Xero/Stripe only, office-only margin. */
export async function loadJobMoney(jobId: string) {
  const { jobPaymentView } = await import("./payments.server");
  const db = admin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [view, job, quote, rect, offers, payouts, lodg, ws, inv] = await Promise.all([
    jobPaymentView(jobId),
    admin.from("jobs").select("channel, installer_led, electrician_choice, estimated_area_m2").eq("id", jobId).maybeSingle(),
    admin.from("quotes").select("id, subtotal_inc_gst, gst_amount, veec_count, veec_discount_inc_gst, veec_unit_value_inc_gst, status, quote_items(code), quote_internals(cost_ex_gst)").eq("job_id", jobId).eq("kind", "installation").in("status", ["accepted", "issued", "draft"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("quotes").select("customer_total_inc_gst, quote_internals(calc_snapshot)").eq("job_id", jobId).eq("kind", "rectification").eq("status", "accepted").order("accepted_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("partner_offers").select("kind, summary").eq("job_id", jobId).eq("status", "accepted"),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "payout_marked_paid"),
    db.from("veec_lodgements").select("quantity, sale_price_per_veec").eq("job_id", jobId).maybeSingle(),
    db.from("workflow_settings").select("current_veec_price").limit(1).maybeSingle(),
    admin.from("invoices").select("xero_invoice_number, total_inc_gst, total_paid, last_synced_at, last_sync_error").eq("job_id", jobId).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const q = quote.data;
  const paidOut = (kind: string | null) => (payouts.data ?? []).map((p) => p.details as { kind?: string; amount?: number }).find((d) => (d?.kind ?? null) === kind && d?.amount != null)?.amount ?? null;
  const sum = (kind: string) => ((offers.data ?? []).find((o) => o.kind === kind)?.summary ?? {}) as { installer_pay_inc_gst?: number; electrician_rate_inc_gst?: number; fixes_pay_inc_gst?: number };
  const internals = (q?.quote_internals as unknown as { cost_ex_gst: number | null } | { cost_ex_gst: number | null }[] | null);
  const costEx = Number((Array.isArray(internals) ? internals[0] : internals)?.cost_ex_gst);
  const ex = (inc: number | null | undefined) => (inc == null ? null : Math.round((Number(inc) / 1.1) * 100) / 100);
  // Installer pay ex GST: recorded payout, else the accepted offer's pay, else the accepted quote's agreed-rate cost.
  const installerPayEx = ex(paidOut(null) ?? paidOut("installation") ?? sum("ready_check").installer_pay_inc_gst ?? sum("installation").installer_pay_inc_gst) ?? (Number.isFinite(costEx) && costEx > 0 ? costEx : null);
  const { electricalBillingSource } = await import("./installer-led.core");
  const piesaOwnerDirect = electricalBillingSource({ channel: job.data?.channel ?? null, choice: job.data?.electrician_choice ?? null, committedLineOnAcceptedQuote: q && q.status === "accepted" ? ((q.quote_items as { code: string | null }[] | null) ?? []).some((i) => i.code === "PIESA") : null, hivPaidAt: null }) === "owner_direct";
  const piesaCostEx = piesaOwnerDirect ? 0 : ex(paidOut("assessment") ?? sum("piesa").electrician_rate_inc_gst ?? null);
  const fixesPrice = rect.data ? Number(rect.data.customer_total_inc_gst) : null;
  // The $100 on fixes stays ours (decision 142) — only with OUR electrician (decision 349: the installer's own electrician
  // is passed through, margin 0). Without a recorded payout the electrician's cost is the price less the margin the
  // fixes quote recorded ($100 for older quotes that recorded none).
  const rectInternals = (rect.data as unknown as { quote_internals?: { calc_snapshot: { rectification_margin_inc_gst?: number } | null } | { calc_snapshot: { rectification_margin_inc_gst?: number } | null }[] | null } | null)?.quote_internals;
  const rectSnap = (Array.isArray(rectInternals) ? rectInternals[0] : rectInternals)?.calc_snapshot ?? null;
  const fixesMargin = rectSnap?.rectification_margin_inc_gst != null && Number.isFinite(Number(rectSnap.rectification_margin_inc_gst)) ? Number(rectSnap.rectification_margin_inc_gst) : 100;
  const fixesCostEx = fixesPrice == null ? 0 : ex(paidOut("rectification") ?? sum("rectification").fixes_pay_inc_gst ?? Math.max(0, fixesPrice - fixesMargin)) ?? 0;
  const { jobMargin, veecValueReceived } = await import("./job-margin.core");
  const veec = veecValueReceived({ lodgedQty: lodg.data?.quantity != null ? Number(lodg.data.quantity) : null, salePrice: lodg.data?.sale_price_per_veec != null ? Number(lodg.data.sale_price_per_veec) : null, quoteCount: q?.veec_count != null ? Number(q.veec_count) : null, spotPrice: ws.data?.current_veec_price != null ? Number(ws.data.current_veec_price) : null });
  const margin = { ...jobMargin({
    ownerPriceInc: q ? Number(q.subtotal_inc_gst) + (fixesPrice ?? 0) : null,
    installerPayEx, piesaCostEx, fixesCostEx, veecValue: veec.value, veecIncentive: q ? Number(q.veec_discount_inc_gst) : 0,
  }), veecBasis: veec.basis, quoteStatus: q?.status ?? null };
  return {
    invoice: inv.data ? { number: inv.data.xero_invoice_number, total: Number(inv.data.total_inc_gst), paid: Number(inv.data.total_paid), syncedAt: inv.data.last_synced_at, syncError: inv.data.last_sync_error } : null,
    view: view ? { invoiceId: view.invoiceId, steps: view.steps, paidCents: view.paidCents, reference: view.reference, bank: view.bank, onlineInvoiceUrl: view.onlineInvoiceUrl, provisional: view.provisional, grandTotalCents: view.plan.grandTotalCents } : null,
    margin, quoteStatus: q?.status ?? null,
  };
}
