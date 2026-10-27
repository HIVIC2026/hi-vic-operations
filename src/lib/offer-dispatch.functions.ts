// "How job offers go out" + "Choose trades for this job" (Jo, 7 Oct 2026). Admin only. Sending switches are untouched:
// an offer here is a portal offer the trade sees in My work; any email/SMS still follows the existing sending switches.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, WorkflowError, logEvent } from "./workflow.server";
import { requireOfficeJob, requireOfficeBusiness, officeTestBusinessIds, officeTestJobIds } from "./qa-office-access.server";

const kind = z.enum(["ready_check", "piesa"]);
const NONE = ["00000000-0000-0000-0000-000000000000"];

export const getDispatchSettings = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { dispatchMode } = await import("./offer-dispatch.server");
    const { offerSuggestHours } = await import("./offer-dispatch.server");
    return { mode: await dispatchMode(), suggestHours: await offerSuggestHours() };
  });

export const setDispatchMode = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ mode: z.enum(["office_picks", "automatic"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { error } = await admin.from("workflow_settings").update({ offer_dispatch_mode: data.mode }).eq("id", 1);
    if (error) throw new Error(error.message);
    await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: "offer_dispatch_mode", summary: `How job offers go out: ${data.mode === "automatic" ? "Automatic" : "Office picks first"}`, details: { mode: data.mode } } as never).then(() => null, () => null);
    return { ok: true };
  });

export const setJobOfficePicks = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), on: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { error } = await admin.from("jobs").update({ offer_dispatch_override: data.on ? "office_picks" : null }).eq("id", data.jobId);
    if (error) throw new Error(error.message);
    await logEvent(data.jobId, context.userId, "offer_dispatch_override", data.on ? "Office switched this job to “Office picks” for job offers" : "This job now follows the “How job offers go out” setting", { on: data.on }, { internal: true });
    return { ok: true };
  });

export const listChooseTrades = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), kind }).parse(d))
  .handler(async ({ data, context }) => {
    const officeRole = await requireOfficeJob(context.supabase, data.jobId);
    const testBusinesses = officeRole === "qa_office" ? await officeTestBusinessIds(context.supabase) : null;
    const testJobs = officeRole === "qa_office" ? await officeTestJobIds(context.supabase) : null;
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { chooseWarnings, distanceKm, officePicks } = await import("./offer-dispatch.core");
    const { installerOfferable } = await import("./readycheck-booking.core");
    const { melbourneToday } = await import("./melbourne-time.core");
    const { dispatchMode } = await import("./offer-dispatch.server");
    const isRc = data.kind === "ready_check";
    const r = isRc
      ? await (await import("./readycheck-booking.server")).installerCandidatesFor(data.jobId)
      : await (await import("./allocation.server")).recCandidatesFor(data.jobId);
    if (testBusinesses) r.candidates = r.candidates.filter(c => testBusinesses.includes(c.business_id));
    const ids = r.candidates.map((c) => c.business_id);
    const inIds = ids.length ? ids : NONE;
    const today = melbourneToday();
    const now = new Date();
    const wk0 = new Date(now); wk0.setDate(now.getDate() - ((now.getDay() + 6) % 7)); wk0.setHours(0, 0, 0, 0);
    const wk1 = new Date(wk0.getTime() + 7 * 86_400_000);
    const [{ data: biz }, { data: creds }, { data: workers }, { data: books }, { data: pend }, { data: mine }, { data: retail }, { data: job }] = await Promise.all([
      admin.from("businesses").select("id, name, trading_name, signer_name, service_postcodes, coverage_lat, coverage_lng, weekly_capacity, daily_job_limit, base_suburb").in("id", inIds),
      admin.from("business_credentials").select("business_id, kind, expires_at").in("business_id", inIds),
      admin.from("partner_workers").select("business_id, licence_expires_on").eq("approval_status", "approved").is("removed_at", null).in("business_id", inIds),
      (() => { const q = admin.from("bookings").select("business_id").eq("status", "confirmed").gte("scheduled_start", wk0.toISOString()).lt("scheduled_start", wk1.toISOString()).in("business_id", inIds); return testJobs ? q.in("job_id", testJobs.length ? testJobs : NONE) : q; })(),
      (() => { const q = admin.from("partner_offers").select("business_id").eq("status", "pending").in("business_id", inIds); return testJobs ? q.in("job_id", testJobs.length ? testJobs : NONE) : q; })(),
      admin.from("partner_offers").select("business_id, status, offered_at, expires_at").eq("job_id", data.jobId).eq("kind", data.kind),
      officeRole === "qa_office" ? Promise.resolve({ data: null }) : admin.from("retail_estimator_settings").select("piesa_assessment_inc_gst, r5_install_inc_gst_per_m2").eq("is_current", true).maybeSingle(),
      admin.from("jobs").select("job_number, source, channel, stage, offer_dispatch_override, properties(suburb, postcode)").eq("id", data.jobId).single(),
    ]);
    // Rate for this job: electricians = agreed PIESA rate (inc GST); installers = active installer rate card R5 line (inc GST per m²).
    let rates = new Map<string, number>();
    if (!isRc) rates = new Map([...(await (await import("./allocation.server")).agreedElectricianRates(ids, "piesa")).entries()].map(([k, v]) => [k, v.rate]));
    else {
      const { data: cards } = await admin.from("rate_cards").select("id, business_id, effective_from").eq("kind", "installer").eq("is_active", true).in("business_id", inIds).order("effective_from", { ascending: false });
      const latest = new Map<string, string>(); for (const c of cards ?? []) if (c.business_id && !latest.has(c.business_id)) latest.set(c.business_id, c.id);
      const cardIds = [...latest.values()];
      const { data: items } = await admin.from("rate_card_items").select("rate_card_id, r_value, unit, unit_price_ex_gst").in("rate_card_id", cardIds.length ? cardIds : NONE);
      for (const [b, cid] of latest) { const it = (items ?? []).find((i) => i.rate_card_id === cid && Number(i.r_value) === 5) ?? (items ?? []).find((i) => i.rate_card_id === cid); if (it) rates.set(b, Math.round(Number(it.unit_price_ex_gst) * 1.1 * 100) / 100); }
    }
    // Decision 374: no "installer's usual electrician" mark or preference on our leads — we choose the electrician.
    // HIV owner prices (and the "rate at or above owner price" warning) apply only to HIV leads (Jo 7 Oct); partner jobs aren't marked up.
    const ownerPrice = isRc ? (job?.channel === "installer_sourced" ? null : retail?.r5_install_inc_gst_per_m2 != null ? Number(retail.r5_install_inc_gst_per_m2) : null) : (retail?.piesa_assessment_inc_gst != null ? Number(retail.piesa_assessment_inc_gst) : null);
    const count = (rows: { business_id: string | null }[] | null, id: string) => (rows ?? []).filter((x) => x.business_id === id).length;
    const offered = new Map((mine ?? []).map((o) => [o.business_id, o.status]));
    const bz = new Map((biz ?? []).map((b) => [b.id, b]));
    const p = job?.properties as { suburb: string | null; postcode: string | null } | null;
    const trades = r.candidates.map((c) => {
      const b = bz.get(c.business_id);
      const rate = rates.get(c.business_id) ?? null;
      const accepted = c.acceptance_rate;
      return {
        id: c.business_id, business: b?.trading_name || c.name, contact: b?.signer_name ?? null,
        distanceKm: distanceKm({ lat: null, lng: null }, { lat: b?.coverage_lat ?? null, lng: b?.coverage_lng ?? null }),
        areaNote: c.exact_postcode ? `Covers ${r.postcode}` : b?.base_suburb ? `Based in ${b.base_suburb}` : "Nearby",
        rate, rateUnit: isRc ? "per m²" : "per visit",
        weekJobs: count(books, c.business_id), openOffers: count(pend, c.business_id),
        capacity: b?.weekly_capacity != null ? `${b.weekly_capacity}/week` : b?.daily_job_limit != null ? `${b.daily_job_limit}/day` : null,
        acceptRate: officeRole === "qa_office" ? null : typeof accepted === "number" ? Math.round(accepted * 100) : null,
        avgAcceptHours: officeRole === "qa_office" ? null : c.avg_accept_hours != null ? Math.round(c.avg_accept_hours * 10) / 10 : null,
        warnings: chooseWarnings({
          today, rate, ownerPrice,
          insuranceExpiresOn: (creds ?? []).filter((x) => x.business_id === c.business_id && /insurance/.test(x.kind)).map((x) => x.expires_at),
          certExpiresOn: [...(creds ?? []).filter((x) => x.business_id === c.business_id && /cert|licen/.test(x.kind)).map((x) => x.expires_at), ...(workers ?? []).filter((w) => w.business_id === c.business_id).map((w) => w.licence_expires_on)],
        }),
        // Choose installer: `installerOfferable` is the one rule the Choose installer list's "Installer ✓" also uses (HV-1509).
        blocker: c.blocker, matching: isRc ? installerOfferable(c as never) : !c.blocker && (c.covers_postcode || c.exact_postcode),
        inArea: c.covers_postcode || c.exact_postcode, alreadyOffered: offered.get(c.business_id) ?? null,
      };
    });
    if (isRc) { // "Choose installer": shared matching order (nearby that day → reliability → fewest recent → speed)
      const { rankedInstallers } = await import("./readycheck-booking.core");
      const order = rankedInstallers(r.candidates as never).map((c) => c.business_id);
      const at = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
      trades.sort((a, b) => at(a.id) - at(b.id));
    }
    const open = (mine ?? []).find((o) => o.status === "pending") ?? null;
    const { data: asgRc } = isRc ? await admin.from("job_assignments").select("business_id").eq("job_id", data.jobId).eq("role", "installer").eq("active", true).maybeSingle() : { data: null };
    return {
      channel: job?.channel ?? null, stage: job?.stage ?? null, hasInstaller: !!asgRc,
      openOffer: open ? { business: trades.find((t) => t.id === open.business_id)?.business ?? null, expiresAt: open.expires_at } : null,
      jobNumber: job?.job_number ?? null, suburb: [p?.suburb, p?.postcode].filter(Boolean).join(" "), ownerPrice, isTestJob: job?.source === "qa_test",
      officePicks: officeRole === "qa_office" ? true : officePicks(await dispatchMode(), job?.offer_dispatch_override ?? null), jobOverride: officeRole === "qa_office" ? false : job?.offer_dispatch_override === "office_picks",
      matching: trades.filter((t) => t.matching), others: trades.filter((t) => !t.matching),
    };
  });

export const sendChosenOffers = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), kind, businessIds: z.array(z.string().uuid()).min(1).max(50) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireOfficeJob(context.supabase, data.jobId);
    for (const businessId of data.businessIds) await requireOfficeBusiness(context.supabase, businessId);
    // Decision 389: a Ready Check is never offered to an installer before the owner confirms — the office Releases the
    // spot (owner "It's your turn"), and the offer runs on the owner's Confirm (or straight away for a confirmed owner).
    if (data.kind === "ready_check") {
      if (data.businessIds.length !== 1) throw new WorkflowError("Choose one installer.");
      const businessId = data.businessIds[0];
      if (!businessId) throw new WorkflowError("Choose one installer.");
      const r = await (await import("./spot-release.server")).releaseSpot(data.jobId, context.userId, businessId);
      return { offered: r.mode === "offered" ? 1 : 0, released: r.mode === "released" };
    }
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { newRecipients } = await import("./offer-dispatch.core");
    const { data: prior } = await admin.from("partner_offers").select("business_id, status").eq("job_id", data.jobId).eq("kind", data.kind).in("status", ["pending", "declined", "accepted"]);
    if ((prior ?? []).some((o) => o.status === "accepted")) throw new WorkflowError("This job has already been taken.");
    const fresh = newRecipients(data.businessIds, new Set((prior ?? []).map((o) => o.business_id)));
    if (!fresh.length) throw new WorkflowError("Those trades already have this offer.");
    const adding = (prior ?? []).some((o) => o.status === "pending");
    const r = await (await import("./allocation.server")).startPiesaAllocation(data.jobId, context.userId, "piesa", { onlyBusiness: fresh, adding });
    await logEvent(data.jobId, context.userId, "trades_chosen", `Office chose ${fresh.length} trade(s) for the Pre Insulation Electrical Safety Assessment (PIESA)${adding ? " (added to the open offer)" : ""}`, { kind: data.kind, business_ids: fresh, added: adding, chosen_by: context.userId, chosen_at: new Date().toISOString() }, { internal: true });
    return { offered: r.offered };
  });
