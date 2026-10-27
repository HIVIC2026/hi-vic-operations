// Decision 278 (Jo 25 Oct 2026): the business owner's "Your price" card — reading it and saving it. Kept apart from the
// read-only `installer-price.server.ts` (which sits on the autoAdvance graph) because saving re-runs the guarded Mitti
// sync to prepare the owner's quote. Business admin only (`requireMember(userId, businessId, true)`); team members are
// refused and the card returns null for them. Append-only event; never sends anything.
// Decision 289: price + what is included only; the electrician was chosen at Add a job and is shown read-only.
// Decision 290 (corrected): the card shows the Ready Check's access rating and issue notes as the flag (no fee question).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { INSTALLER_PRICE_EVENT, priceFromPortal, validateInstallerPrice, type InstallerPriceInput } from "./installer-price.core";
import { readInstallerPrice, type StoredInstallerPrice } from "./installer-price.server";

async function a1JobOrThrow(jobId: string) {
  const { data: j, error } = await admin.from("jobs").select("id, channel, originating_installer_business_id, stage, deleted_at").eq("id", jobId).maybeSingle();
  if (error || !j) throw new WorkflowError("Job not found.");
  if (!priceFromPortal(j.channel) || !j.originating_installer_business_id) throw new WorkflowError("Only your own customers' jobs take your price here.");
  if (j.deleted_at) throw new WorkflowError("This job is closed.");
  return j as { id: string; channel: string; originating_installer_business_id: string; stage: string | null };
}

/** The current Ready Check snapshot's entries (empty when no Mitti form yet) and whether it says removal is needed
 *  (null when there is no current Ready Check at all). Read-only. */
async function currentReadyCheck(jobId: string): Promise<{ entries: { label: string; value: string | null }[]; removalRequired: boolean | null; hasReadyCheck: boolean; installAreaM2: number | null; removalM2: number | null }> {
  const { data: m } = await admin.from("ceiling_measurements").select("raw_snapshot, removal_required, measured_area_m2").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  const raw = (m as { raw_snapshot?: unknown } | null)?.raw_snapshot;
  const list = Array.isArray(raw) ? raw : [];
  const entries = (list as { label?: unknown; value?: unknown }[]).filter((e) => e && typeof e.label === "string").map((e) => ({ label: String(e.label), value: e.value == null ? null : String(e.value) }));
  const { readyCheckRemovalRequired, removalTotalM2 } = await import("./ready-check-answers.core");
  const removalRequired = readyCheckRemovalRequired(entries, m as { removal_required?: boolean | null } | null);
  const measured = (m as { measured_area_m2?: number | null } | null)?.measured_area_m2 ?? null;
  return { entries, removalRequired, hasReadyCheck: !!m, installAreaM2: measured == null ? null : Number(measured), removalM2: removalTotalM2(entries) };
}

/** The boss's "Your price" card: the saved price, the job's electrician choice (read-only) and the access flag. Team members: null (nothing shown). */
export async function installerPriceView(jobId: string, userId: string) {
  const { data: j } = await admin.from("jobs").select("channel, originating_installer_business_id, properties(address_line,suburb,state,postcode)").eq("id", jobId).maybeSingle();
  if (!j || !priceFromPortal(j.channel) || !j.originating_installer_business_id) return null;
  const { myBusinesses } = await import("./pilot.server");
  if ((await myBusinesses(userId)).get(j.originating_installer_business_id) !== "business_admin") return null;
  const [stored, usual, recorded, readyCheck] = await Promise.all([
    readInstallerPrice(jobId),
    (await import("./usual-electrician.server")).readUsualElectrician(j.originating_installer_business_id).catch(() => ({ electrician: null })),
    (await import("./electrician-choice.server")).readElectricianChoice(jobId).catch(() => null),
    currentReadyCheck(jobId).catch(() => ({ entries: [] as { label: string; value: string | null }[], removalRequired: null, hasReadyCheck: false, installAreaM2: null, removalM2: null })),
  ]);
  const { entries, removalRequired } = readyCheck;
  const { resolveElectricianChoice, electricianChoiceLine } = await import("./electrician-choice.core");
  const { contactAnswersFromEntries } = await import("./mitti.core");
  const { accessFlagFromEntries } = await import("./ready-check-answers.core");
  // Jo 27 Oct 2026 (redone): the card's Ready Check rows — same source the quote uses (current measurement + form removal m²).
  const { readyCheckDetailLines, accessFlagLine, NOT_ON_READY_CHECK } = await import("./installer-price.core");
  const legacy = stored?.record.electrician?.choice ?? contactAnswersFromEntries(entries).electricianChoice;
  const choice = resolveElectricianChoice({ recorded, legacy, usual: usual.electrician });
  const access = accessFlagFromEntries(entries);
  const rc = readyCheckDetailLines({ hasReadyCheck: readyCheck.hasReadyCheck, installAreaM2: readyCheck.installAreaM2, removalRequired, removalM2: readyCheck.removalM2 });
  const { resolveMittiProduct } = await import("./insulation-product.core");
  const { formatPropertyAddress } = await import("./address");
  const product = resolveMittiProduct(contactAnswersFromEntries(entries).productOption).product;
  const address = formatPropertyAddress(j.properties);
  return {
    canSet: true as const, current: stored,
    electrician: electricianChoiceLine(choice, usual.electrician, stored?.record.electrician?.name ?? contactAnswersFromEntries(entries).electricianName),
    access,
    removalRequired,
    readyCheck: { address: address || NOT_ON_READY_CHECK, install: rc.install, removal: rc.removal, access: accessFlagLine(access) ?? NOT_ON_READY_CHECK, product: product?.option ?? NOT_ON_READY_CHECK },
  };
}

/** Business admin only. Append-only; the latest event is the price. Then the guarded paths prepare the draft quote. */
export async function setInstallerPrice(jobId: string, userId: string, input: InstallerPriceInput): Promise<StoredInstallerPrice> {
  const j = await a1JobOrThrow(jobId);
  const { requireMember } = await import("./pilot.server");
  await requireMember(userId, j.originating_installer_business_id, true);
  // Jo 27 Oct 2026: the server refuses the removal tick when the current Ready Check says there is no removal.
  const { removalRequired } = await currentReadyCheck(jobId).catch(() => ({ entries: [] as { label: string; value: string | null }[], removalRequired: null, hasReadyCheck: false, installAreaM2: null, removalM2: null }));
  const v = validateInstallerPrice({ ...input, removalRequired });
  if (!v.ok || !v.record) throw new WorkflowError(v.issues.join(" "));
  await logEvent(jobId, userId, INSTALLER_PRICE_EVENT, `Price entered by the business owner: $${v.record.price_inc_gst.toLocaleString("en-AU")} inc GST`, { ...v.record, business_id: j.originating_installer_business_id, set_by: userId, declared_not_verified: true }, { internal: true });
  const stored = await readInstallerPrice(jobId);
  if (!stored) throw new WorkflowError("The price was not saved.");
  // Speed (Jo 28 Oct 2026): prepare (never send) the owner's quote ONCE from the Ready Check already stored, then reply.
  // The Mitti sync, and on a Complete form the fresh-form auto-send decision, run after the reply; any failure in either is
  // picked up by the 15-minute tick.
  try { await draftFromStoredReadyCheck(jobId, userId); } catch { /* tick */ }
  (await import("./background.server")).runAfterResponse(() => mittiAfterPriceSaved(jobId, userId));
  return stored;
}

/** The same guarded draft the Mitti sync makes (open form: only once the basics are in; Complete form: always), from the
 *  Ready Check answers the last sync stored. No Mitti call. Nothing stored yet = nothing to draft (the sync does it). */
async function draftFromStoredReadyCheck(jobId: string, userId: string) {
  const { data: m } = await admin.from("ceiling_measurements").select("external_source, external_id, status, raw_snapshot").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  if (m?.external_source !== "mitti" || !m.external_id) return;
  const raw = (m as { raw_snapshot?: unknown }).raw_snapshot;
  const entries = (Array.isArray(raw) ? raw as { label?: unknown; value?: unknown }[] : []).filter((e) => e && typeof e.label === "string").map((e) => ({ label: String(e.label), value: e.value == null ? null : String(e.value) }));
  if (!entries.length) return;
  const auditId = String(m.external_id);
  const completed = m.status === "complete";
  if (!completed && !(await (await import("./ready-check-basics.server")).checkReadyCheckBasics(jobId, userId, entries, false, auditId))?.ready) return;
  const d = await (await import("./installer-quote.server")).draftInstallerQuoteFromReadyCheck(jobId, userId, entries, auditId);
  if (!completed && d?.ready) await (await import("./pilot.server")).applyCobrand(jobId);
}

/** After the reply: the regular guarded Mitti sync; on a Complete form, the auto-send decision from the fresh form. Never throws. */
async function mittiAfterPriceSaved(jobId: string, userId: string) {
  try { await (await import("./mitti.server")).syncMittiAssessment(jobId, userId); } catch { /* tick */ }
  try {
    const { data: m } = await admin.from("ceiling_measurements").select("external_source, external_id, status").eq("job_id", jobId).eq("is_current", true).maybeSingle();
    if (m?.external_source === "mitti" && m.external_id && m.status === "complete") {
      const { mittiApi, parseAudit } = await import("./mitti.core");
      const a = await mittiApi((await import("./mitti.server")).realMittiCall).getAudit(String(m.external_id));
      const entries = parseAudit(a).snapshot as { label: string; value: string | null }[];
      await (await import("./auto-quote-send.server")).maybeAutoSendInstallerQuote(jobId, { formCompleted: true, formModifiedAt: a?.modified_at ?? a?.audit_data?.date_modified ?? null, entries });
    }
  } catch { /* tick */ }
}
