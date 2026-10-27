// Jo 28 Oct 2026 (spec rule 3): the installer's switch from an electrician who hasn't finished signing up to Home
// Insulation Victoria's electrician ($349). Only the business owner of the job's installer business (the same check as
// Save price: `requireJobBusinessOwner`). Final: recorded once as a new `electrician_choice_set` event (source
// `installer_switch`), never switched back. The owner's quote is then rebuilt in the same request through the existing
// draft-only path (`redraftFromMitti` → `draftInstallerQuoteFromReadyCheck`), so the preview shows straight away.
// Never sends anything, and never touches a sent or accepted quote. Kept OFF the autoAdvance graph (it reads Mitti).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";

export const SWITCH_REFUSED = {
  quoteSent: "The owner's quote has already been sent, so the electrician can't be changed.",
  alreadyOurs: "This job already uses Home Insulation Victoria's electrician.",
  notStuck: "You can only switch when the job's electrician hasn't finished signing up with us.",
} as const;

export type SwitchResult = { ok: true } | { ok: false; reason: string };

export async function switchToHivicElectricianFor(jobId: string, userId: string): Promise<SwitchResult> {
  let businessId: string;
  try {
    businessId = (await (await import("./installer-price-set.server")).requireJobBusinessOwner(jobId, userId)).originating_installer_business_id;
  } catch (e) {
    if (e instanceof WorkflowError) return { ok: false, reason: e.message };
    throw e;
  }
  const { data: sentQuotes, error } = await admin.from("quotes").select("id").eq("job_id", jobId).eq("kind", "installation").in("status", ["issued", "accepted"]).limit(1);
  if (error) throw new Error("The job's quotes could not be checked.");
  const { loadInstallerQuote } = await import("./installer-quote-status.server");
  const status = await loadInstallerQuote(jobId);
  if ((sentQuotes ?? []).length || status.sent || status.accepted) return { ok: false, reason: SWITCH_REFUSED.quoteSent };
  const { readElectricianChoice, recordElectricianChoice } = await import("./electrician-choice.server");
  if ((await readElectricianChoice(jobId)) === "hivic") return { ok: false, reason: SWITCH_REFUSED.alreadyOurs };
  if (!status.electricianNotOnboarded) return { ok: false, reason: SWITCH_REFUSED.notStuck };
  await recordElectricianChoice(jobId, businessId, userId, "hivic", "installer_switch");
  // Draft only (no auto-send): a failed Mitti read leaves the rebuild to the 15-minute tick.
  await (await import("./rec-auto-link.server")).redraftFromMitti(jobId, userId);
  return { ok: true };
}
