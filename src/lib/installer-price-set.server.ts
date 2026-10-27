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

/** The current Ready Check snapshot's entries (empty when no Mitti form yet). Read-only. */
async function currentFormEntries(jobId: string): Promise<{ label: string; value: string | null }[]> {
  const { data: m } = await admin.from("ceiling_measurements").select("raw_snapshot").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  const raw = (m as { raw_snapshot?: unknown } | null)?.raw_snapshot;
  const list = Array.isArray(raw) ? raw : [];
  return (list as { label?: unknown; value?: unknown }[]).filter((e) => e && typeof e.label === "string").map((e) => ({ label: String(e.label), value: e.value == null ? null : String(e.value) }));
}

/** The current Ready Check measurement's figures — the same ones the owner's quote prices from (the office-verified area
 *  when there is one, else the installer's). A figure that isn't recorded stays null; nothing is guessed. */
async function currentMeasurementNumbers(jobId: string): Promise<{ measuredM2: number | null; removalRequired: boolean | null; removalM2: number | null }> {
  const { data: m } = await admin.from("ceiling_measurements").select("measured_area_m2, verified_area_m2, removal_required, removal_m2").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  const row = m as { measured_area_m2: unknown; verified_area_m2: unknown; removal_required: boolean | null; removal_m2: unknown } | null;
  const area = (v: unknown) => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) || n <= 0 ? null : n; };
  const amount = (v: unknown) => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) || n < 0 ? null : n; };
  return {
    measuredM2: row ? area(row.verified_area_m2 ?? row.measured_area_m2) : null,
    removalRequired: row?.removal_required ?? null,
    removalM2: row ? amount(row.removal_m2) : null,
  };
}

/** The boss's "Your price" card: the saved price, the job's electrician choice (read-only) and the access flag. Team members: null (nothing shown). */
export async function installerPriceView(jobId: string, userId: string) {
  const { data: j } = await admin.from("jobs").select("channel, originating_installer_business_id").eq("id", jobId).maybeSingle();
  if (!j || !priceFromPortal(j.channel) || !j.originating_installer_business_id) return null;
  const { myBusinesses } = await import("./pilot.server");
  if ((await myBusinesses(userId)).get(j.originating_installer_business_id) !== "business_admin") return null;
  const [stored, usual, recorded, entries] = await Promise.all([
    readInstallerPrice(jobId),
    (await import("./usual-electrician.server")).readUsualElectrician(j.originating_installer_business_id).catch(() => ({ electrician: null })),
    (await import("./electrician-choice.server")).readElectricianChoice(jobId).catch(() => null),
    currentFormEntries(jobId).catch(() => [] as { label: string; value: string | null }[]),
  ]);
  const { resolveElectricianChoice, electricianChoiceLine } = await import("./electrician-choice.core");
  const { contactAnswersFromEntries } = await import("./mitti.core");
  const { accessFlagFromEntries } = await import("./ready-check-answers.core");
  const legacy = stored?.record.electrician?.choice ?? contactAnswersFromEntries(entries).electricianChoice;
  const choice = resolveElectricianChoice({ recorded, legacy, usual: usual.electrician });
  return {
    canSet: true as const, current: stored,
    electrician: electricianChoiceLine(choice, usual.electrician, stored?.record.electrician?.name ?? contactAnswersFromEntries(entries).electricianName),
    access: accessFlagFromEntries(entries),
  };
}

/** Business admin only. Append-only; the latest event is the price. Then the guarded paths prepare the draft quote. */
export async function setInstallerPrice(jobId: string, userId: string, input: InstallerPriceInput): Promise<StoredInstallerPrice> {
  const j = await a1JobOrThrow(jobId);
  const { requireMember } = await import("./pilot.server");
  await requireMember(userId, j.originating_installer_business_id, true);
  const v = validateInstallerPrice(input);
  if (!v.ok || !v.record) throw new WorkflowError(v.issues.join(" "));
  await logEvent(jobId, userId, INSTALLER_PRICE_EVENT, `Price entered by the business owner: $${v.record.price_inc_gst.toLocaleString("en-AU")} inc GST`, { ...v.record, business_id: j.originating_installer_business_id, set_by: userId, declared_not_verified: true }, { internal: true });
  const stored = await readInstallerPrice(jobId);
  if (!stored) throw new WorkflowError("The price was not saved.");
  // Prepare (never send) the owner's quote from the portal price through the existing guarded Ready Check paths: the
  // regular sync while the form is open; the completed-form draft + the auto-send decision once it is Complete. Any
  // failure here is picked up by the 15-minute tick.
  try { await (await import("./mitti.server")).syncMittiAssessment(jobId, userId); } catch { /* tick */ }
  try {
    const { data: m } = await admin.from("ceiling_measurements").select("external_source, external_id, status").eq("job_id", jobId).eq("is_current", true).maybeSingle();
    if (m?.external_source === "mitti" && m.external_id && m.status === "complete") {
      const { mittiApi, parseAudit } = await import("./mitti.core");
      const a = await mittiApi((await import("./mitti.server")).realMittiCall).getAudit(String(m.external_id));
      const entries = parseAudit(a).snapshot as { label: string; value: string | null }[];
      await (await import("./installer-quote.server")).draftInstallerQuoteFromReadyCheck(jobId, userId, entries, String(m.external_id));
      await (await import("./auto-quote-send.server")).maybeAutoSendInstallerQuote(jobId, { formCompleted: true, formModifiedAt: a?.modified_at ?? a?.audit_data?.date_modified ?? null, entries });
    }
  } catch { /* tick */ }
  return stored;
}
