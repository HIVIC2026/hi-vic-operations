import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const getTradeHome = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./trade-view.server")).tradeHome(context.userId).catch((e: Error) => { if (/isn't linked/.test(e.message)) return null; throw e; })));

/** Who this sign-in is in the trade area: boss, office, or none (Lead Installers, Crew and Electricians don't log in). */
export const getTradeRole = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./trade-view.server")).tradeRoleFor(context.userId)));

export const getTradeOffer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offerId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeOffer(data.offerId, context.userId)));

export const takeTradeTime = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offerId: uuid, windowId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeTakeTime(data.offerId, data.windowId, context.userId));

export const replyTradeOffer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offerId: uuid, reply: z.enum(["not_for_me", "cant_make"]), note: z.string().max(300).nullable() }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeOfferReply(data.offerId, context.userId, data.reply, data.note));

const rcPicks = z.array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/) })).length(3);

/** Jo 24 Oct 2026: accept a Ready Check offer by offering the owner 3 times. */
export const offerTradeReadyCheckTimes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offerId: uuid, picks: rcPicks }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeOfferReadyCheckTimes(data.offerId, context.userId, data.picks));

export const getTradeReadyCheckTimes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeReadyCheckTimes(data.jobId, context.userId)));

export const offerTradeReadyCheckNewTimes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, picks: rcPicks }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeReadyCheckOfferNew(data.jobId, context.userId, data.picks));

export const takeTradeReadyCheckDay = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, proposalId: uuid, time: z.string().regex(/^\d{2}:\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeReadyCheckTakeDay(data.jobId, data.proposalId, data.time, context.userId));

/** Decision 80: installer "Change time" on a booked our-lead Ready Check — new day + time, rebooked directly. */
export const changeTradeReadyCheckTime = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeReadyCheckChange(data.jobId, { day: data.day, time: data.time }, context.userId));

export const getTradeDayView = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeDay(data.jobId, context.userId)));

export const tradeCouldntGetInFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason: z.string().max(60) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeCouldntGetIn(data.jobId, data.reason, context.userId));

export const confirmHivicReadyCheckPricingFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).confirmHivicReadyCheckPricing(data.jobId, context.userId));

export const getTradeMoneyView = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./trade-view.server")).tradeMoney(context.userId)));

export const getTradeBusiness = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./trade-view.server")).tradeBusiness(context.userId)));

export const setTradeTaking = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ taking: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSetTaking(context.userId, data.taking));

export const getTradeSetupView = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./trade-view.server")).tradeSetup(context.userId)));

export const markTradeSetup = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ key: z.enum(["details", "rates", "bank", "alerts", "team"]), done: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSetupMark(context.userId, data.key, data.done));

export const getTradeBusinessFile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./trade-view.server")).tradeBusinessFile(context.userId)));


export const saveTradeUsualElectrician = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  // Decision 369: no price — the electrician's onboarding rate is the only rate (decision 353).
  .inputValidator((d) => z.object({ name: z.string().trim().min(1).max(200), licence: z.string().trim().min(1).max(100), email: z.string().trim().email().max(320).nullish(), phone: z.string().trim().max(40).nullish() }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSaveUsualElectrician(context.userId, data));

/** ESC collection notice: the business's installers and their acknowledgement state (boss sees all; a worker only their own row). */
export const getTradeCollectionNotice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./esc-collection-notice-send.server")).tradeNoticeView(context.userId)));

/** The signed-in installer acknowledges the current notice for themself (append-only; never on someone's behalf). */
export const acknowledgeTradeCollectionNotice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./esc-collection-notice-send.server")).tradeAcknowledgeNotice(context.userId)));

/** Business owner (own business) or office: send / re-send one installer person's secure notice link by text + email (guarded senders). */
export const sendCollectionNoticeLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin");
    return plain(await (await import("./esc-collection-notice-send.server")).sendNoticeLinkFor(context.userId, data.workerId, isAdmin === true));
  });

export const getTradeAgreementPdf = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await import("./trade-view.server")).tradeAgreementPdf(context.userId));

export const sendTradeChangeRequest = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ kind: z.enum(["details", "rates", "area", "other"]), message: z.string().trim().min(3).max(2000) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeChangeRequest(context.userId, data.kind, data.message));

export const testSetPasswordLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ base: z.string().url().max(200) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeTestSetPasswordLink(context.userId, data.base));

export const requestTeamLoginInvite = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeRequestLoginInvite(context.userId, data.workerId));

/** Decision 377: the business owner saves a team member's mobile (their own safety plan link is texted there). */
export const setTeamMemberMobile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: z.string().uuid(), mobile: z.string().trim().max(30) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSetWorkerMobile(context.userId, data.workerId, data.mobile));

/** Jo 3 Nov ~3pm (#134): the business fills a missing date of birth (anyone) or missing email (electricians) from the Team page. */
export const setTeamMemberMissing = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: z.string().uuid(), dateOfBirth: z.string().trim().max(10).nullable().optional(), email: z.string().trim().max(254).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeFillWorkerMissing(context.userId, data.workerId, { dateOfBirth: data.dateOfBirth ?? null, email: data.email ?? null }));

/** Jo 29 Oct: add a person to the team with no email needed; they sign their declarations by link before any job.
 *  Task 10 (Jo 2 Nov): role Office / Lead Installer / Crew / Electrician; mobile + date of birth required for everyone
 *  (checked server-side); electricians also give licence + REC. `workerRole` is kept for older callers. */
export const addTeamPerson = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    name: z.string().trim().min(1).max(120), role: z.enum(["office", "lead", "crew", "electrician"]).optional(), workerRole: z.enum(["lead", "crew"]).optional(), mobile: z.string().trim().max(30).nullable(),
    email: z.string().trim().max(200).email().or(z.literal("")).nullable().transform((v) => v || null), licenceNumber: z.string().trim().max(60).nullable(), recNumber: z.string().trim().max(60).nullable().optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeAddTeamPerson(context.userId, data));

/** Task 10b: the boss adds a date of birth for an existing Team person (private identity row; never read back). */
export const setTeamMemberDob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: uuid, dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSetWorkerDob(context.userId, data.workerId, data.dateOfBirth));

/** Task 10: the boss switches "Can see Money" on/off for an Office person. Boss only (refused server-side and in SQL). */
export const setTeamMoneyAccess = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: uuid, on: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSetMoneyAccess(context.userId, data.workerId, data.on));

/** Jo 24 Oct 2026 (decision 110): A1 installer enters the Ready Check day + time (same slots as the owner's times link). */
export const setA1ReadyCheckTimeFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSetReadyCheckTime(context.userId, data.jobId, { day: data.day, time: data.time }));

export const getInHouseBookingAccess = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).inHouseBookingAccess(context.userId, data.jobId, context.supabase));

/** Part 2: the installer office books the safety check (PIESA) on its own job (same booking function as the electrician's link). */
export const ownJobOfficeBookPiesa = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, start: z.string().datetime({ offset: true }) }).parse(d))
  .handler(async ({ data, context }) => (await import("./own-job-piesa.server")).officeBookOwnJobPiesa(context.userId, data.jobId, data.start, new Date(), context.supabase as never));

export const getInHouseBookingList = createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
  .inputValidator(z.object({jobIds:z.array(uuid).max(1000)}))
  .handler(async({data,context})=>(await import('./in-house-booking-list.server')).inHouseBookingList(context.userId,data.jobIds));

export const inHouseBookVisit = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  // G7 (Jo 4 Nov 2026): workerId may be left out ONLY for a Ready Check booked with "Not sure yet" (the server refuses it for every other kind).
  .inputValidator((d) => z.object({ jobId: uuid, kind: z.enum(["ready_check", "assessment", "rectification", "installation"]), start: z.string().datetime({ offset: true }), workerId: uuid.optional(), crewIds: z.array(uuid).max(2).default([]) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).inHouseBookVisit(context.userId, data, context.supabase));

export const getInHouseBookingTeam = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({jobId:uuid}))
  .handler(async({data,context})=>(await import('./in-house-booking.server')).bookingTeam(data.jobId,context.userId));

/** "Can't do this one": the whole flow (pull-back, cancel what is still booked, ESC ask, owner emails) is `handBackJob`. */
export const tradeHandBack = createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
  .inputValidator(z.object({jobId:uuid,reason:z.string().trim().min(3).max(480)}))
  .handler(async({data,context})=>(await import('./trade-view.server')).handBackJob(data.jobId,context.userId,data.reason));

export const tradeOwnerCancelled = createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
  .inputValidator(z.object({jobId:uuid,reason:z.string().trim().min(3).max(480)}))
  .handler(async({data,context})=>{
    await (await import('./in-house-booking.server')).bookingTeam(data.jobId,context.userId);
    const result=await (await import('./office-actions.server')).cancelJobFully(data.jobId,`Owner cancelled: ${data.reason}`,context.userId,{tell:{owner:false,installer:false},suppressRunNotice:true});
    await (await import('./in-house-booking-notices.server')).notifyOfficeOwnerCancelled(data.jobId,data.reason,context.userId);
    // Task 6: Part 9's ESC withdrawal ask after the cancel; the owner already knows, so no visit email (answer 4).
    try{await (await import('./esc.server')).requireEscWithdrawal(data.jobId,"owner_cancelled",context.userId);}
    catch(e){await (await import('./trade-view.server')).logTradeFollowUpFailed(data.jobId,context.userId,'ESC withdrawal',e);}
    return result;
  });

export const changeInHouseLeadInstaller = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({jobId:uuid,workerId:uuid}))
  .handler(async({data,context})=>{
    const m=await import('./in-house-booking.server');
    const team=await m.bookingTeam(data.jobId,context.userId);
    const w=team.workers.find(w=>w.id===data.workerId)??null;
    const why=(await import('./in-house-booking.core')).bookingWorkerBlocker('installation',w);
    if(why)throw Error(why);
    // Part 7 Task 6: locked from 5pm two days before the install (LEAD_LOCKED_MESSAGE), read against the current booking.
    await (await import('./lead-installer-confirm.server')).assertLeadInstallerUnlocked(data.jobId,{newLeadId:data.workerId});
    return (await import('./visit-allocation.server')).saveCrewWithLead(data.jobId,context.userId,{lead:data.workerId,additional:team.selection?.additional??[]});
  });

export const recordInHouseEscNoticeUpdated = createServerFn({ method:'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({jobId:uuid,changeId:uuid}))
  .handler(async({data,context})=>{
    await (await import('./workflow.server')).requireAdmin(context.supabase);
    const m=await import('./in-house-booking.server');
    const n=await m.latestLeadNotice(data.jobId);
    if(!n||n.id!==data.changeId)throw Error('The Lead Installer changed again. Refresh and update the current ESC notice.');
    if(n.acknowledged)return {ok:true};
    const {supabaseAdmin}=await import('@/integrations/supabase/client.server');
    const {stableUuid}=await import('./mitti-create-claim.core');
    const {error}=await supabaseAdmin.from('workflow_events').insert({id:await stableUuid(`esc-lead-updated:${n.id}`),job_id:data.jobId,actor_id:context.userId,event_type:'in_house_esc_notice_updated',summary:'Office confirmed ESC notice updated for the new Lead Installer',details:{change_id:n.id,worker_id:n.details.worker_id,start:n.details.start},internal:true});
    if(error&&error.code!=='23505')throw Error(error.message);
    return {ok:true};
  });

/** Task 9: who books the safety check and the upgrades day (boss only). */
export const setTradeWhoBooks = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ whoBooks: z.enum(["office", "electrician", "either"]) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSetWhoBooks(context.userId, data.whoBooks));

/** Task 9: the business logo for co-branded quotes (boss only; PNG/JPEG ≤ 2 MB, sent base64). */
export const uploadTradeLogo = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ name: z.string().trim().min(1).max(200), type: z.enum(["image/png", "image/jpeg"]), base64: z.string().min(1).max(3 * 1024 * 1024) }).parse(d))
  .handler(async ({ data, context }) => {
    const bytes = Uint8Array.from(atob(data.base64), (ch) => ch.charCodeAt(0));
    return (await import("./trade-view.server")).tradeUploadLogo(context.userId, { name: data.name, type: data.type, bytes });
  });

export const getMyMittiInvited = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await import("./trade-view.server")).tradeMittiInvited(context.userId));

export const getMittiJobPresentation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ context, data }) => (await import("./mitti-job-presentation.server")).mittiJobPresentation(data.jobId, context.userId));

export const setPartnerMittiInvited = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: z.string().uuid(), invited: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./trade-view.server")).setMittiInvited(context.userId, data.businessId, data.invited);
  });

export const getPartnerMittiInvited = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { data: b, error } = await context.supabase.from("businesses").select("mitti_account_invited, mitti_account_invited_at").eq("id", data.businessId).maybeSingle();
    if (error) throw new Error(error.message);
    return { invited: b?.mitti_account_invited === true, at: b?.mitti_account_invited_at ?? null };
  });

export const getTradeJobStatus = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./job-status.server")).tradeJobStatus(context.userId, data.jobId)));

export const askTradeReminder = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./job-status.server")).tradeAskReminder(context.userId, data.jobId));

/** Installer Job page (M2), Today's job extras (M4) and Money extras (M6) — decisions 196–203. Business-scoped reads. */
export const getTradeJobPage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeJobPage(data.jobId, context.userId)));

/** Speed (decision 280): the installer job page's first paint in ONE call — every section the page's cards read, each
 *  through the same server helper and role rule as its own server function (`trade-job-bundle.server.ts`). */
export const getTradeJobBundle = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-job-bundle.server")).tradeJobBundle(context.supabase, context.userId, data.jobId)));

export const getTradeDayExtras = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeDayExtras(data.jobId, context.userId)));

export const getTradeMoneyExtras = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./trade-view.server")).tradeMoneyExtras(context.userId)));

/** M6 per-job pay detail (approved state M6-job-detail): business owner only, own pay only. */
export const getTradeMoneyJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeMoneyJob(data.jobId, context.userId)));


/** Decision 315: the electrician's "Fixes times" card on their job page (electricians only; business-scoped read). */
export const getTradeFixesTimes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeFixesTimes(data.jobId, context.userId)));

/** Decision 315: save 3–5 fixes times + estimated hours (the same shared write as the old portal PIESA submit). */
export const saveTradeFixesTimes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: uuid, hours: z.number(),
    windows: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slot: z.enum(["8-10", "10-12", "12-14", "14-16"]) })).max(5),
  }).parse(d))
  .handler(async ({ data, context }) => {
    // Part 4 Task 14: the automatic fixes quote send to the owner is retired (the electrician quotes upgrades with the owner directly).
    return (await import("./trade-view.server")).tradeSaveFixesTimes(data.jobId, context.userId, data.hours, data.windows);
  });

/** Decision 327: the electrician's "Start of the install day" card (electricians only; business-scoped read). */
export const getTradeInstallAttendance = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeInstallAttendance(data.jobId, context.userId)));

/** Decision 327: "I'll be there" / "Can't make it" (reason + 1–5 days they can do, or none) for the current install booking. */
export const answerTradeInstallAttendance = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.discriminatedUnion("answer", [
    z.object({ jobId: uuid, bookingId: uuid, answer: z.literal("yes") }),
    z.object({
      jobId: uuid, bookingId: uuid, answer: z.literal("no"), reason: z.enum(["sick", "another_job", "short_notice", "other"]),
      otherText: z.string().trim().max(200).nullable(), days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(5), noDays: z.boolean(),
    }),
  ]).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeAnswerInstallAttendance(data.jobId, context.userId, data));

/** Decision 261: the safety plan (SWMS) on the installer's job page. */
export const getTradeSwms = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeSwms(data.jobId, context.userId)));

export const saveTradeSwmsNote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, note: z.string().max(2000) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSwmsNote(data.jobId, context.userId, data.note));

export const signTradeSwms = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, key: z.string().min(3).max(200), typedName: z.string().trim().min(2).max(200) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSwmsSign(data.jobId, context.userId, data.key, data.typedName));

/** Jo 30 Oct 2026: the Lead opens a crew member's own sign link on the Lead's phone (dead phone). */
export const leadPhoneSwmsLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, key: z.string().min(3).max(200) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSwmsLeadPhoneLink(data.jobId, context.userId, data.key));

/** Decision 317: the electrician's "Safety check (PIESA)" document row (electricians only; business-scoped read). */
export const getTradeSafetyCheckDoc = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeSafetyCheckDoc(data.jobId, context.userId)));

/** Decision 317: download the current official PIESA PDF (bytes, private — no public URL). */
export const getTradeSafetyCheckPdf = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSafetyCheckPdf(data.jobId, context.userId));

/** Decision 328: "Check my form now" — runs the single-job A5 Install day sync for this installer's job and returns the
 *  result (the same words as the text). Installers only; business-scoped through requireTradeJob. */
export const checkTradeInstallForm = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeCheckInstallForm(data.jobId, context.userId)));

/** Part 2: the installer's boss changes the electrician on its own job before the safety check (PIESA) is done. */
export const getTradeSwapElectricianOptions = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeSwapElectricianOptions(context.userId, data.jobId)));

export const tradeSwapElectrician = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, electricianBusinessId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSwapElectrician(context.userId, data.jobId, data.electricianBusinessId));

/** New job flow Part 6: the installer office uploads the Certificate of Electrical Safety (same record as the electrician's link). */
export const uploadCoesForJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, name: z.string().max(200), type: z.string().max(100), data: z.string().max(21_000_000) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeUploadCoes(data.jobId, context.userId, { name: data.name, type: data.type, bytes: new Uint8Array(Buffer.from(data.data, "base64")) }));

/** Photo-quote installers (Jo 5 Nov 2026): "Send for quote" on the Quote from photos box. Business-scoped in `submitPhotoQuote`. */
export const tradeSubmitPhotoQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, underR2: z.boolean().nullable(), removeM2: z.number().finite().nullable(), installM2: z.number().finite().nullable(), product: z.string().max(80).nullable() }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./photo-quote.server")).submitPhotoQuote(data.jobId, context.userId, { underR2: data.underR2, removeM2: data.removeM2, installM2: data.installM2, product: data.product })));

export const getPhotoQuoteMedia = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).photoQuoteMedia(data.jobId, context.userId)));

/** Photo-quote installers Part 2: "View quote (PDF)" — own customers only, price-seeing people only (checked server side). */
export const getOwnQuotePdf = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./own-photo-quote.server")).ownQuotePdfFor(data.jobId, context.userId));
