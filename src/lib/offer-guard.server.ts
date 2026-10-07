// Last-line guard before ANY trade offer row is written: TEST (qa_test) jobs only go to TEST partners and
// real jobs never go to TEST partners. Called immediately before every partner_offers insert. Fails closed.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { offerPairBlocker } from "./test-send.core";
import { WorkflowError } from "./workflow.server";
import { installerJobOfferBlocker } from "./installer-ready-check.core";

/** kind "ready_check"/"installation": installer-supplied customers only ever go to the installer who supplied them (Jo, 7 Oct 6pm). */
export async function assertOfferPairsAllowed(jobId: string, businessIds: string[], kind?: string) {
  if (!businessIds.length) return;
  const [{ data: job, error: je }, { data: bizs, error: be }] = await Promise.all([
    admin.from("jobs").select("source, channel, originating_installer_business_id").eq("id", jobId).maybeSingle(),
    admin.from("businesses").select("id, name, onboarding_notes").in("id", businessIds),
  ]);
  if (je || be || !job) throw new WorkflowError("Offer stopped: couldn't confirm whether this job and trade are TEST or real.");
  const byId = new Map((bizs ?? []).map((b) => [b.id, b]));
  for (const id of businessIds) {
    const b = byId.get(id);
    const why = offerPairBlocker(b ?? null, job.source);
    if (why) throw new WorkflowError(`Offer stopped for ${b?.name ?? "an unknown trade"}: ${why}`);
    const own = kind === "ready_check" || kind === "installation" ? installerJobOfferBlocker(job, id) : null;
    if (own) throw new WorkflowError(`Offer stopped for ${b?.name ?? "an unknown trade"}: ${own}`);
  }
}
