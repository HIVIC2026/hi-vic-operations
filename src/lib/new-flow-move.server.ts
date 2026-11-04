// Part 3 Task 18: move ONE installer onto "installer calls and books" (businesses.in_house) through the existing
// save_in_house_partner RPC, only when nothing old is in flight for them. Office only. Never moves anyone by itself:
// it runs when the office presses the button or when scripts/move-installer-to-new-flow.ts is run with --apply.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { newFlowMoveBlockers, type NewFlowMoveFacts } from "./new-flow-move.core";
import { inHouseEnableBlockers } from "./in-house.core";
import { melbourneToday } from "./melbourne-time.core";

async function readFacts(businessId: string) {
  const { data: b, error } = await admin.from("businesses").select("id, name, in_house, phone, email").eq("id", businessId).maybeSingle();
  if (error) throw new Error(`Could not read the business: ${error.message}`);
  if (!b) throw new WorkflowError("Business not found");
  const { inHouseFactsFor } = await import("./installer-paid-electricians.server");
  const { oldStepJobs } = await import("./old-flow-inflight.server");
  const setup = await inHouseFactsFor(businessId);
  // PIESA rate (inc GST) from the active rate card, read whether or not the installer is in-house yet.
  const cards: { id: string }[] = [];
  for (let a = 0; ; a += 200) {
    const r = await admin.from("rate_cards").select("id").eq("business_id", businessId).eq("is_active", true).lte("effective_from", melbourneToday()).order("id").range(a, a + 199);
    if (r.error) throw new Error(`Could not read the rate cards: ${r.error.message}`);
    cards.push(...(r.data ?? [])); if ((r.data ?? []).length < 200) break;
  }
  let rate: number | null = null;
  if (cards.length) {
    const r = await admin.from("rate_card_items").select("unit_price_ex_gst").in("rate_card_id", cards.map((c) => c.id)).ilike("code", "piesa").order("id").range(0, 199);
    if (r.error) throw new Error(`Could not read the PIESA rate: ${r.error.message}`);
    const ex = (r.data ?? []).map((l) => Number(l.unit_price_ex_gst)).find((n) => n > 0);
    rate = ex ? Math.round(ex * 110) / 100 : null;
  }
  const old = await oldStepJobs(businessId);
  const facts: NewFlowMoveFacts = {
    inHouse: (b as { in_house?: boolean }).in_house === true, officePhone: b.phone ?? null, email: b.email ?? null,
    electricians: setup.approvedElectricianWorkers, piesaRateIncGst: rate, oldStepJobs: old.map((s) => ({ step: s.step, count: s.count })),
  };
  // The checks saveBusiness already makes before enabling in-house; the electrician and PIESA ones are covered above.
  const extra = inHouseEnableBlockers(setup).filter((x) => /Mitti/.test(x));
  return { name: b.name as string, facts, blockers: [...newFlowMoveBlockers(facts), ...(facts.inHouse ? [] : extra)] };
}

/** Dry run: what would stop the move, and the facts behind it. Writes nothing. */
export async function previewNewFlowMove(businessId: string) {
  const r = await readFacts(businessId);
  return { name: r.name, facts: r.facts, blockers: r.blockers };
}

export async function moveInstallerToNewFlow(businessId: string, actorId: string): Promise<{ moved: true } | { moved: false; blockers: string[] }> {
  const { data: isAdmin, error } = await admin.rpc("has_role", { _user_id: actorId, _role: "admin" });
  if (error || isAdmin !== true) throw new WorkflowError("Only the office can change this.");
  const { name, facts, blockers } = await readFacts(businessId);
  if (blockers.length) return { moved: false, blockers };
  const db = admin as unknown as { rpc: (n: "save_in_house_partner", a: { p_business_id: string; p_in_house: boolean | null; p_rectification_billed_by: string | null; p_actor_id: string }) => PromiseLike<{ error: { message: string } | null }> };
  const { error: rpcError } = await db.rpc("save_in_house_partner", { p_business_id: businessId, p_in_house: true, p_rectification_billed_by: null, p_actor_id: actorId });
  if (rpcError) throw new WorkflowError(rpcError.message);
  const { error: evError } = await admin.from("admin_config_events").insert({
    actor_id: actorId, event_type: "new_flow_moved", summary: `${name} moved onto the new flow (installer calls and books)`,
    details: { business_id: businessId, piesa_rate_inc_gst: facts.piesaRateIncGst, electricians: facts.electricians },
  });
  if (evError) console.error("new_flow_moved history row not written", evError.message);
  return { moved: true };
}
