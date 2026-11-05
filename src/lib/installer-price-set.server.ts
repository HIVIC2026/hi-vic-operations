// Decision 278 (Jo 25 Oct 2026): the business owner's "Your price" card — reading it and saving it. Kept apart from the
// read-only `installer-price.server.ts` (which sits on the autoAdvance graph) because saving re-runs the guarded Mitti
// sync to prepare the owner's quote. Part 10 Task 4 (Jo 3 Nov 2026): the BOSS or the OFFICE enters the price (Part 5 role
// rule `seesPrices` via `canEnterPrice`); Lead Installers, crew and electricians are refused server-side and the card returns
// null for them. Append-only event. "Send quote to owner" (only while OWN_CUSTOMER_SEND_ON_PRESS_ENABLED) releases through
// the SAME guarded auto-send (`maybeAutoSendInstallerQuote`, every check); otherwise this module never sends anything.
// Decision 289: price + what is included only; the electrician was chosen at Add a job and is shown read-only.
// Decision 290 (corrected): the card shows the Ready Check's access rating and issue notes as the flag (no fee question).
import { jobAdmin as admin } from "./job-facts.server"; // speed (Task 11): the admin client; inside the job page bundle it answers from the job's rows
import { WorkflowError, logEvent } from "./workflow.server";
import {
  INSTALLER_PRICE_EVENT,
  PRICE_ENTRY_REFUSED,
  PRICE_LOCKED,
  canEnterPrice,
  priceCardLocked,
  priceEventSummary,
  priceFromPortal,
  validateInstallerPrice,
  type InstallerPriceInput,
} from "./installer-price.core";
import { IN_HOUSE_PIESA_HOLD_REASON } from "./installer-paid-electricians.core";
import { readInstallerPriceState, type StoredInstallerPrice } from "./installer-price.server";
import { early } from "./early-read";
import { sharedFor, type SharedJobReads } from "./job-shared-reads";
import { partialA1QuoteCore } from "./own-customer-partial-a1.core";
// Namespaces: tests replace these modules with partial mocks; a namespace never fails on a missing export.
import * as installerElectriciansServer from "./installer-electricians.server";
import * as electricianChoiceServer from "./electrician-choice.server";
import * as quoteStatusServer from "./installer-quote-status.server";
const loadInstallerQuote = (jobId: string) => quoteStatusServer.loadInstallerQuote(jobId);

/** Newest sent_at across ALL the job's installation quotes (a later unsent draft must not unlock the card). Throws on a read error: fail closed. */
export async function latestQuoteSentAt(jobId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("quotes")
    .select("sent_at")
    .eq("job_id", jobId)
    .eq("kind", "installation")
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new WorkflowError("The quote status could not be read.");
  return (data?.sent_at as string | null | undefined) ?? null;
}

async function a1JobOrThrow(jobId: string) {
  const { data: j, error } = await admin
    .from("jobs")
    .select("id, channel, originating_installer_business_id, stage, deleted_at")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !j) throw new WorkflowError("Job not found.");
  if (!priceFromPortal(j.channel) || !j.originating_installer_business_id)
    throw new WorkflowError("Only your own customers' jobs take your price here.");
  if (j.deleted_at) throw new WorkflowError("This job is closed.");
  return j as {
    id: string;
    channel: string;
    originating_installer_business_id: string;
    stage: string | null;
  };
}

/** Part 10 Task 4: Boss or Office of the job's business (Part 5 `seesPrices`); anyone else is refused before any write. */
async function requireCanEnterPrice(userId: string, businessId: string): Promise<void> {
  if (!canEnterPrice(await memberRoleFor(userId, businessId))) throw new WorkflowError(PRICE_ENTRY_REFUSED);
}
/** The sign-in's ACTIVE membership row for this business (`business_members.member_role`: business_admin / office /
 *  member), read directly — `myBusinesses` folds Office into "member". Null = not a member. Read errors fail closed. */
async function memberRoleFor(userId: string, businessId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("business_members")
    .select("member_role")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new WorkflowError("Your business membership could not be read.");
  return (data as { member_role?: string | null } | null)?.member_role ?? null;
}

/** The current Ready Check snapshot's entries (empty when no Mitti form yet) and whether it says removal is needed
 *  (null when there is no current Ready Check at all). Read-only. */
async function currentReadyCheck(jobId: string): Promise<{
  entries: { label: string; value: string | null }[];
  removalRequired: boolean | null;
  hasReadyCheck: boolean;
  installAreaM2: number | null;
  removalM2: number | null;
  /** Jo 4 Nov 2026: the new-wording Ready Check's per-area layout answers (ceiling_measurements.zones[].layout), read with the same row. */
  layout: { areas: import("./ceiling-layout.core").LayoutArea[]; thicker: 6 | 7 | null } | null;
  quoteCore: ReturnType<typeof partialA1QuoteCore>;
}> {
  const { data: m, error } = await admin
    .from("ceiling_measurements")
    .select("raw_snapshot, removal_required, measured_area_m2, zones")
    .eq("job_id", jobId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw new WorkflowError("The Ready Check could not be read. Try again.");
  const raw = (m as { raw_snapshot?: unknown } | null)?.raw_snapshot;
  const list = Array.isArray(raw) ? raw : [];
  const entries = (list as { label?: unknown; value?: unknown }[])
    .filter((e) => e && typeof e.label === "string")
    .map((e) => ({ label: String(e.label), value: e.value == null ? null : String(e.value) }));
  const { readyCheckRemovalRequired, removalTotalM2 } = await import("./ready-check-answers.core");
  const removalRequired = readyCheckRemovalRequired(
    entries,
    m as { removal_required?: boolean | null } | null,
  );
  const measured = (m as { measured_area_m2?: number | null } | null)?.measured_area_m2 ?? null;
  const zones = Array.isArray((m as { zones?: unknown } | null)?.zones) ? ((m as { zones: { layout?: unknown }[] }).zones) : [];
  const areas = zones.map((z) => z?.layout).filter(Boolean) as import("./ceiling-layout.core").LayoutArea[];
  const layout = areas.length ? { areas, thicker: (await import("./ceiling-layout.core")).readLayoutOutcome(entries as { label: string; value: unknown }[]).thicker } : null;
  return {
    entries,
    quoteCore: partialA1QuoteCore({ areaM2: measured == null ? null : Number(measured), areas: zones as import("./mitti.core").MittiArea[], entries }),
    removalRequired,
    hasReadyCheck: !!m,
    installAreaM2: measured == null ? null : Number(measured),
    removalM2: removalTotalM2(entries),
    layout,
  };
}

export type LayoutPriceInput = { mainPicks: ({ brand: import("./ceiling-layout.core").Brand; r: number } | null)[]; thickerPicks?: ({ brand: import("./ceiling-layout.core").Brand; r: number } | null)[] | undefined; thickerTotalIncGst?: number | null | undefined };

/** The Boss's / Office's "Your price" card: the saved price, the job's electrician choice (read-only) and the access flag. Everyone else: null (nothing shown). */
export async function installerPriceView(jobId: string, userId: string, sharedReads?: SharedJobReads) {
  const shared = sharedFor(sharedReads, userId, jobId);
  // Speed (installer screens, Task 6): the job, the caller's memberships and every card read that needs only the job id
  // start together; the usual electrician follows the job's business. Nothing is used or returned until the job and the
  // business-owner checks pass, in the same order as before (a refused caller gets null; read errors surface as before).
  const jobP = early(
    admin
      .from("jobs")
      .select(
        "channel, originating_installer_business_id, properties(address_line,suburb,state,postcode)",
      )
      .eq("id", jobId)
      .maybeSingle(),
  );
  const roleP = early(jobP.then(({ data: jj }) => (jj?.originating_installer_business_id ? memberRoleFor(userId, jj.originating_installer_business_id) : null)));
  const stateP = early(readInstallerPriceState(jobId));
  const usualP = early(
    jobP.then(({ data: jj }) =>
      jj?.originating_installer_business_id
        ? // Jo 5 Nov 2026: the installer's Main electrician (never ticked = the old saved usual electrician).
          installerElectriciansServer
            .readMainElectrician(jj.originating_installer_business_id)
            .catch(() => ({ electrician: null }))
        : { electrician: null },
    ),
  );
  const recordedP = early(electricianChoiceServer.readElectricianChoice(jobId).catch(() => null));
  // G7 (Jo 4 Nov 2026): the Electrician row names the Team electrician on the job (allocated, else picked at Add a job).
  // A read failure is NOT "nobody" — the row then says the check failed rather than falling back to a wrong name.
  const teamP = early(
    import("./in-house-electrician.server").then((m) => m.teamElectricianOnJob(jobId)).then(
      (team) => ({ team, failed: false }),
      () => ({ team: null, failed: true }),
    ),
  );
  const readyCheckP = early(
    currentReadyCheck(jobId).catch(() => ({
      entries: [] as { label: string; value: string | null }[],
      removalRequired: null,
      hasReadyCheck: false,
      installAreaM2: null,
      removalM2: null,
      layout: null,
    })),
  );
  const quoteP = early(shared ? shared.quote() : loadInstallerQuote(jobId));
  // J3 (4): the business's own PIESA rate starts with the other reads (no serial query after them); inside the job page
  // bundle it is answered from the business facts (rate cards + lines), outside it is one request.
  const piesaCheckP = early(jobP.then(({ data: jj }) => readPiesaRate(jj?.originating_installer_business_id)));
  const sentAtP = early(
    latestQuoteSentAt(jobId).then(
      (at) => ({ at, failed: false }),
      () => ({ at: null as string | null, failed: true }),
    ),
  );
  const { data: j } = await jobP;
  if (!j || !priceFromPortal(j.channel) || !j.originating_installer_business_id) return null;
  if (!canEnterPrice(await roleP)) return null;
  const [state, usual, recorded, readyCheck, teamRead] = await Promise.all([
    stateP,
    usualP,
    recordedP,
    readyCheckP,
    teamP,
  ]);
  const stored = state.stored;
  const { entries, removalRequired } = readyCheck;
  const { resolveElectricianChoice, priceCardElectricianLine } =
    await import("./electrician-choice.core");
  const { TEAM_ELECTRICIAN_GONE, TEAM_ELECTRICIAN_CHECK_FAILED } = await import("./rec-onboarded.core");
  const { contactAnswersFromEntries } = await import("./mitti.core");
  const { accessFlagFromEntries } = await import("./ready-check-answers.core");
  // Jo 27 Oct 2026 (redone): the card's Ready Check rows — same source the quote uses (current measurement + form removal m²).
  const { readyCheckDetailLines, accessFlagLine, NOT_ON_READY_CHECK } =
    await import("./installer-price.core");
  const legacy =
    stored?.record.electrician?.choice ?? contactAnswersFromEntries(entries).electricianChoice;
  const choice = resolveElectricianChoice({ recorded, legacy, usual: usual.electrician });
  const access = accessFlagFromEntries(entries);
  const rc = readyCheckDetailLines({
    hasReadyCheck: readyCheck.hasReadyCheck,
    installAreaM2: readyCheck.installAreaM2,
    removalRequired,
    removalM2: readyCheck.removalM2,
  });
  const { resolveMittiProduct } = await import("./insulation-product.core");
  const { formatPropertyAddress } = await import("./address");
  const product = resolveMittiProduct(contactAnswersFromEntries(entries).productOption).product;
  const address = formatPropertyAddress(j.properties);
  await quoteP;
  const sent = await sentAtP;
  const locked =
    sent.failed ||
    priceCardLocked({ quoteSentAt: sent.at, newQuoteRequestedAt: state.newQuoteRequestedAt });
  const { APPROVED_PRODUCTS } = await import("./insulation-product.core");
  // The HIV electrician switch left the price card (main, 2 Nov 2026): the choice is made once at Add a job.
  const hivSwitch: { priceIncGst: number } | null = null;
  const { OWN_CUSTOMER_SEND_ON_PRESS_ENABLED } = await import("./auto-quote-send.core");
  // Jo 4 Nov 2026: the owner's PIESA line is this business's own PIESA rate; with none set the quote can't be sent.
  // J1 (2): a read failure is NOT "not set" — the card says the check failed and holds (button "Save"), never PIESA_PRICE_NOT_SET.
  const piesaCheck = await piesaCheckP;
  const { PIESA_PRICE_NOT_SET, PIESA_PRICE_CHECK_FAILED } = await import("./own-customer-price.core");
  // Join (#135 read budget): the layout rides on the Ready Check row read above; the saved picks on the price state (same event).
  const layoutNow = readyCheck.layout;
  const { a1PriceLinkView } = await import("./ceiling-layout.core");
  const savedLayout = (state.stored?.layout as LayoutPriceInput | null | undefined) ?? null;
  const quoteCore = "quoteCore" in readyCheck ? readyCheck.quoteCore : { ready: false, missing: ["Ready Check details"], information: [] as string[] };
  if (!access.rating && !quoteCore.information.includes('Ceiling access')) quoteCore.information.push('Ceiling access');
  if (!product && !quoteCore.information.includes('Insulation product')) quoteCore.information.push('Insulation product');
  return {
    canSet: true as const,
    quoteCore,
    layout: layoutNow ? { ...a1PriceLinkView(layoutNow.areas, layoutNow.thicker), thickerTarget: layoutNow.thicker, saved: savedLayout } : null,
    current: stored,
    locked,
    /** Task 4: the button says "Send quote to owner" only while pressing it sends (`enterPriceButton`). */
    sendOnPress: OWN_CUSTOMER_SEND_ON_PRESS_ENABLED,
    /** Jo 4 Nov 2026: false → the card says `piesaPriceNote` and the button is "Save" (the price is saved, the quote holds). */
    piesaPriceSet: piesaCheck.kind === "set",
    /** Why the quote can't be sent yet: no rate set (ask the office) or the rate could not be checked just now (try again). */
    piesaPriceNote: piesaCheck.kind === "set" ? null : piesaCheck.kind === "failed" ? PIESA_PRICE_CHECK_FAILED : PIESA_PRICE_NOT_SET,
    productOptions: APPROVED_PRODUCTS.map((p) => p.option),
    mittiProduct: product?.option ?? null,
    hivSwitch,
    electrician: teamRead.failed
      ? TEAM_ELECTRICIAN_CHECK_FAILED
      : priceCardElectricianLine({
          team: teamRead.team,
          choice,
          usual: usual.electrician,
          legacyName: stored?.record.electrician?.name ?? contactAnswersFromEntries(entries).electricianName,
          goneLine: TEAM_ELECTRICIAN_GONE,
        }),
    access,
    removalRequired,
    readyCheck: {
      address: address || NOT_ON_READY_CHECK,
      install: rc.install,
      removal: rc.removal,
      access: accessFlagLine(access) ?? NOT_ON_READY_CHECK,
      product: product?.option ?? NOT_ON_READY_CHECK,
    },
  };
}

export type PriceSendOutcome = { sent: boolean; reasons: string[] };
const NOT_COMPLETE: PriceSendOutcome = { sent: false, reasons: ["Ready Check not marked Complete in Mitti yet"] };

/** Prepare the owner's quote from the portal price through the existing guarded Ready Check paths: the regular sync while
 *  the form is open; the completed-form draft + the auto-send decision once it is Complete. `send` (Task 4, only with
 *  OWN_CUSTOMER_SEND_ON_PRESS_ENABLED) asks that ONE auto-send decision to release now (`enabled: true`) — every existing
 *  release check still applies and a hold comes back as plain reasons. Without `send` nothing is sent here; any failure
 *  is picked up by the 15-minute tick. */
async function prepareQuoteFromPortal(jobId: string, userId: string, send = false): Promise<PriceSendOutcome> {
  try {
    await (await import("./mitti.server")).syncMittiAssessment(jobId, userId);
  } catch {
    /* tick */
  }
  try {
    const { data: m } = await admin
      .from("ceiling_measurements")
      .select("external_source, external_id, status")
      .eq("job_id", jobId)
      .eq("is_current", true)
      .maybeSingle();
    const state = await readInstallerPriceState(jobId);
    if (m?.external_source === "mitti" && m.external_id && (m.status === "complete" || state.stored?.sendToQuote)) {
      const { mittiApi, parseAudit, validateStoredMittiAudit } = await import("./mitti.core");
      const a = await mittiApi((await import("./mitti.server")).realMittiCall).getAudit(
        String(m.external_id),
      );
      const parsed = parseAudit(a, { installerSourced: true });
      const entries = parsed.snapshot as { label: string; value: string | null }[];
      if (state.stored?.sendToQuote) {
        const [{ data: identity, error: ie }, { data: config, error: ce }] = await Promise.all([
          admin.from('jobs').select('job_number').eq('id', jobId).maybeSingle(),
          admin.from('workflow_settings').select('mitti_ready_check_priced_template_id').eq('id', 1).maybeSingle(),
        ]);
        if (ie || ce || !identity || !config?.mitti_ready_check_priced_template_id) throw new WorkflowError('The job’s Mitti form could not be verified.');
        validateStoredMittiAudit(a, { storedAuditId: String(m.external_id), jobNumber: identity.job_number ?? '', templateId: config.mitti_ready_check_priced_template_id, installerSourced: true });
        const core = partialA1QuoteCore({ areaM2: parsed.patch.measured_area_m2 ?? null, areas: parsed.areas, entries });
        if (!core.ready) {
          await (await import("./ready-check-quote.server")).recordNeedsOffice(jobId, userId, null, core.missing);
          return { sent: false, reasons: core.missing };
        }
      }
      await (
        await import("./installer-quote.server")
      ).draftInstallerQuoteFromReadyCheck(jobId, userId, entries, String(m.external_id));
      // Office preparation only: never claim a partial audit is Complete or dispatch an owner message.
      if (state.stored?.sendToQuote) return { sent: false, reasons: [] };
      const r = await (
        await import("./auto-quote-send.server")
      ).maybeAutoSendInstallerQuote(jobId, {
        formCompleted: true,
        formModifiedAt: a?.modified_at ?? a?.audit_data?.date_modified ?? null,
        entries,
        ...(send ? { enabled: true } : {}),
      });
      return { sent: r.sent, reasons: r.reasons };
    }
    return NOT_COMPLETE;
  } catch (e) {
    if ((await readInstallerPriceState(jobId)).stored?.sendToQuote) {
      const reason = e instanceof Error ? e.message : 'Quote could not be prepared';
      await (await import('./ready-check-quote.server')).recordNeedsOffice(jobId, userId, null, [reason]);
    }
    // Without `send` the tick retries; with it the screen is told plainly (the price is saved either way).
    return { sent: false, reasons: [send ? `Couldn't prepare the quote: ${(e as Error).message}` : NOT_COMPLETE.reasons[0]!] };
  }
}

/** Boss or Office. Append-only; the latest event is the price. Then the guarded paths prepare the draft quote — and, with
 *  `opts.send` while OWN_CUSTOMER_SEND_ON_PRESS_ENABLED, ask the guarded auto-send to release it now (`sendOnPressEnabled`
 *  is a test seam only; it defaults to the constant). */
export async function setInstallerPrice(
  jobId: string,
  userId: string,
  input: InstallerPriceInput & { layout?: LayoutPriceInput | null | undefined },
  opts: { send?: boolean; sendOnPressEnabled?: boolean; sendToQuote?: boolean } = {},
): Promise<{ stored: StoredInstallerPrice; sent: boolean; reasons: string[] }> {
  const j = await a1JobOrThrow(jobId);
  await requireCanEnterPrice(userId, j.originating_installer_business_id);
  // Jo 31 Oct 2026: once the quote has gone to the owner the card is locked (the office reopens it with a new-quote request). Checked before any write.
  const [state, quoteSentAt] = await Promise.all([
    readInstallerPriceState(jobId),
    latestQuoteSentAt(jobId),
  ]);
  if (priceCardLocked({ quoteSentAt, newQuoteRequestedAt: state.newQuoteRequestedAt }))
    throw new WorkflowError(PRICE_LOCKED);
  // Jo 27 Oct 2026: the server refuses the removal tick when the current Ready Check says there is no removal.
  const rc = await currentReadyCheck(jobId).catch(() => ({
    entries: [] as { label: string; value: string | null }[],
    removalRequired: null,
    hasReadyCheck: false,
    installAreaM2: null,
    removalM2: null,
    layout: null,
  }));
  const { removalRequired } = rc;
  if (opts.sendToQuote) {
    const core = "quoteCore" in rc ? rc.quoteCore : null;
    if (!core?.ready) throw new WorkflowError(`Add the Ready Check details first: ${core?.missing.join(", ") ?? "Ready Check could not be read"}.`);
  }
  const v = validateInstallerPrice({ ...input, removalRequired });
  if (!v.ok || !v.record) throw new WorkflowError(v.issues.join(" "));
  // Jo 4 Nov 2026: on a new-wording Ready Check the boss picks brand + batts per area from approved products only, with
  // ONE main total (the price above) and a thicker total only when the owner asked for it. Never a rate card or retail price.
  const layoutNow = rc.layout;
  let layout: (LayoutPriceInput & { thicker: 6 | 7 | null }) | null = null;
  if (layoutNow && (!opts.sendToQuote || input.layout?.mainPicks?.some(Boolean))) {
    const { validateA1Price } = await import("./ceiling-layout.core");
    const wf = await admin.from("workflow_settings").select("*").eq("id", 1).maybeSingle();
    if (wf.error) throw new WorkflowError("Settings could not be read.");
    const topupCountsExisting = (wf.data as Record<string, unknown> | null)?.["topups_count_existing_insulation"] !== false;
    const issues = validateA1Price({ areas: layoutNow.areas, thicker: layoutNow.thicker, mainPicks: input.layout?.mainPicks ?? [], mainTotal: v.record.price_inc_gst, thickerPicks: input.layout?.thickerPicks ?? [], thickerTotal: input.layout?.thickerTotalIncGst ?? null, topupCountsExisting });
    if (issues.length) throw new WorkflowError(issues.join(" "));
    if (!input.layout) throw new WorkflowError("Choose the brand and batts for each area.");
    layout = { mainPicks: input.layout.mainPicks, thickerPicks: layoutNow.thicker ? input.layout.thickerPicks ?? [] : [], thickerTotalIncGst: layoutNow.thicker ? input.layout.thickerTotalIncGst ?? null : null, thicker: layoutNow.thicker };
  }
  // Product in force before this save: the boss's previous pick, else Mitti's own product, else none.
  const { resolveMittiProduct } = await import("./insulation-product.core");
  const { contactAnswersFromEntries } = await import("./mitti.core");
  const previousProduct =
    state.stored?.record.product_option ??
    resolveMittiProduct(contactAnswersFromEntries(rc.entries).productOption).product?.option ??
    null;
  await logEvent(
    jobId,
    userId,
    INSTALLER_PRICE_EVENT,
    priceEventSummary({ record: v.record, previousProduct }),
    {
      ...v.record,
      ...(layout ? { layout } : {}),
      business_id: j.originating_installer_business_id,
      set_by: userId,
      declared_not_verified: true,
      ...(opts.sendToQuote ? { send_to_quote: true } : {}),
    },
    { internal: true },
  );
  const stored = (await readInstallerPriceState(jobId)).stored;
  if (!stored) throw new WorkflowError("The price was not saved.");
  const { OWN_CUSTOMER_SEND_ON_PRESS_ENABLED } = await import("./auto-quote-send.core");
  if (!opts.sendToQuote && opts.send && (opts.sendOnPressEnabled ?? OWN_CUSTOMER_SEND_ON_PRESS_ENABLED)) {
    // Jo 4 Nov 2026: no PIESA rate on the business → the quote can't be sent (never a default $349). The price is saved
    // and the draft is still prepared (held) in the background; the screen gets the one plain reason.
    const { PIESA_PRICE_NOT_SET, PIESA_PRICE_CHECK_FAILED } = await import("./own-customer-price.core");
    // J1 (2): a rate READ failure holds with its own line (try again in a minute) and never reads as "not set".
    const piesaCheck = await readPiesaRate(j.originating_installer_business_id);
    if (piesaCheck.kind !== "set") {
      const { runAfterResponse } = await import("./background.server");
      runAfterResponse(() => prepareQuoteFromPortal(jobId, userId));
      return { stored, sent: false, reasons: [piesaCheck.kind === "failed" ? PIESA_PRICE_CHECK_FAILED : PIESA_PRICE_NOT_SET] };
    }
    // Task 4: "Send quote to owner" — prepared and released inline through the one guarded auto-send; a hold's plain
    // reasons go back to the screen with the saved price (the office's "no PIESA rate" hold reads as the installer line).
    const r = await prepareQuoteFromPortal(jobId, userId, true);
    return { stored, sent: r.sent, reasons: r.reasons.map((x) => (x === IN_HOUSE_PIESA_HOLD_REASON ? PIESA_PRICE_NOT_SET : x)) };
  }
  // Tom 31 Oct 2026: Save answers as soon as the price is stored. The quote (two Mitti reads + draft) is prepared after
  // the reply; if that is cut short the 15-minute tick prepares it, as it always has.
  const { runAfterResponse } = await import("./background.server");
  runAfterResponse(() => prepareQuoteFromPortal(jobId, userId));
  return { stored, sent: false, reasons: [] };
}

/** Jo 28 Oct 2026: the installer's own ONE-WAY switch to HIV's electrician, only while the job is held for a not-onboarded
 *  electrician. Business admin only; writes the existing electrician_choice_set event, then re-prepares the quote. */
export async function switchToHivElectrician(jobId: string, userId: string): Promise<{ ok: true }> {
  const j = await a1JobOrThrow(jobId);
  const { requireMember } = await import("./pilot.server");
  await requireMember(userId, j.originating_installer_business_id, true);
  throw new WorkflowError("Use one of your own electricians.");
}

/** The business's own PIESA rate (rate card PIESA line, inc GST): set / not set / could not be read (J1 (2): a read failure is never "not set"). */
async function readPiesaRate(businessId: string | null | undefined): Promise<{ kind: "set"; rate: number } | { kind: "not_set" } | { kind: "failed" }> {
  try {
    const rate = await (await import("./installer-paid-electricians.server")).installerSafetyCheckPrice(businessId);
    return rate == null ? { kind: "not_set" } : { kind: "set", rate };
  } catch (e) {
    console.error("installer PIESA rate could not be read", (e as Error).message);
    return { kind: "failed" };
  }
}
