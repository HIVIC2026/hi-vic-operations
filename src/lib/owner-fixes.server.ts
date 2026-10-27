// Decision 366 (Jo 25 Oct 2026, audit F03): the owner's electrical fixes on My job — read the latest fixes quote, the
// fixes payment step and the electrician's offered times; record the owner's pick and turn it into the booking once the
// fixes are paid. Approval itself goes through the existing acceptance helper (portal.functions respondToQuoteImpl,
// `pickLater`), which stays in the fixes flow and never regenerates installer quotes. No senders here.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, getStage, logEvent } from "./workflow.server";
import { ownerFixesPickRefusal, ownerFixesStep, type OwnerFixesStep } from "./owner-fixes.core";
import { heldWindowAction, pickableRectWindows } from "./rectification.core";

type QuoteRow = { id: string; status: string; version: number | null; customer_total_inc_gst: number | string | null; created_at: string; quote_items: { description: string | null; line_total_inc_gst: number | string | null; sort: number | null }[] | null };
type WindowRow = { id: string; starts_at: string; ends_at: string | null; status: string; responded_at: string | null };

export type OwnerFixesState = {
  step: OwnerFixesStep;
  quote: { id: string; version: number | null; status: string; total: number; lines: { description: string; amount: number }[] } | null;
  windows: { id: string; startsAt: string; endsAt: string | null }[];
  pickedAt: string | null;
  bookedAt: string | null;
};

export async function ownerFixesState(jobId: string, now = new Date()): Promise<OwnerFixesState> {
  const [{ data: qs, error: qe }, { data: ws, error: we }, { data: bk, error: be }] = await Promise.all([
    admin.from("quotes").select("id, status, version, customer_total_inc_gst, created_at, quote_items(description, line_total_inc_gst, sort)").eq("job_id", jobId).eq("kind", "rectification").neq("status", "superseded").order("created_at", { ascending: false }).limit(1),
    admin.from("appointment_proposals").select("id, starts_at, ends_at, status, responded_at").eq("job_id", jobId).eq("kind", "rectification").eq("electrician_window", true),
    admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "rectification").in("status", ["confirmed", "completed"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (qe || we || be) throw new Error(`Could not read the electrical fixes: ${(qe ?? we ?? be)!.message}`);
  const latest = ((qs ?? []) as unknown as QuoteRow[])[0] ?? null;
  const q = latest && ["issued", "accepted", "declined"].includes(latest.status) ? latest : null;
  const windows = (ws ?? []) as unknown as WindowRow[];
  const pickable = pickableRectWindows(windows, now);
  const picked = windows.filter((w) => w.status === "accepted").sort((a, b) => (b.responded_at ?? "").localeCompare(a.responded_at ?? ""))[0] ?? null;
  // Paid = no fixes payment blocker (paid/waived, folded into the installation quote, or no invoice to pay against).
  const paid = q?.status === "accepted" ? !(await (await import("./payments.server")).fixesPaymentBlockerFor(jobId)) : false;
  const step = ownerFixesStep({ quoteStatus: (q?.status ?? null) as "issued" | "accepted" | "declined" | null, paid, pickable: pickable.length, pickedAt: picked?.starts_at ?? null, bookedAt: bk?.scheduled_start ?? null });
  return {
    step,
    quote: q ? { id: q.id, version: q.version, status: q.status, total: Number(q.customer_total_inc_gst ?? 0), lines: [...(q.quote_items ?? [])].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0)).map((l) => ({ description: String(l.description ?? ""), amount: Number(l.line_total_inc_gst ?? 0) })) } : null,
    windows: step === "pick" ? pickable.map((w) => ({ id: w.id, startsAt: w.starts_at, endsAt: w.ends_at })) : [],
    pickedAt: picked?.starts_at ?? null,
    bookedAt: bk?.scheduled_start ?? null,
  };
}

/** The owner picks one of the electrician's times — only once the fixes are paid. Records the pick (same rows the
 *  approve-with-window path writes) and books it straight away when fixes scheduling is open. */
export async function ownerPickFixesTime(jobId: string, proposalId: string, userId: string): Promise<{ ok: true; booked: boolean }> {
  const st = await ownerFixesState(jobId);
  const refusal = ownerFixesPickRefusal(st.step);
  if (refusal) throw new WorkflowError(refusal);
  const w = st.windows.find((x) => x.id === proposalId);
  if (!w) throw new WorkflowError("That time is no longer available. Please choose another.");
  const nowIso = new Date().toISOString();
  const { data: won, error } = await admin.from("appointment_proposals").update({ status: "accepted", responded_by: userId, responded_at: nowIso, response_note: "Owner picked this time on My job after paying for the electrical fixes" })
    .eq("id", proposalId).eq("job_id", jobId).eq("electrician_window", true).eq("status", "proposed").select("id");
  if (error) throw new Error(error.message);
  if (!won?.length) throw new WorkflowError("That time is no longer available. Please choose another.");
  await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "rectification").eq("electrician_window", true).eq("status", "proposed").neq("id", proposalId);
  await logEvent(jobId, userId, "rectification_window_picked", `Owner picked the electrical fixes time ${new Date(w.startsAt).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })} on My job (fixes paid)`, { proposal_id: proposalId, starts_at: w.startsAt });
  await (await import("./install-holds.server")).moveHoldForRectification(jobId, w.startsAt, userId).catch((e) => console.error("install hold move skipped", (e as Error).message));
  return { ok: true, booked: await bookPickedFixesTime(jobId, userId) };
}

/** The owner's picked fixes time → the confirmed booking (the ONE booking path, confirmBooking, with its fixes-paid,
 *  payment-gate and stage guards). Best-effort: false when not yet possible; the 15-minute tick
 *  (rectification.server sweepHeldRectWindows) retries. Never books twice. */
export async function bookPickedFixesTime(jobId: string, actorId: string | null, now = new Date()): Promise<boolean> {
  if ((await getStage(jobId)) !== "rectification_scheduling") return false;
  const [{ count }, { data: ws }] = await Promise.all([
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "rectification").eq("status", "confirmed"),
    admin.from("appointment_proposals").select("id, starts_at, responded_by, responded_at, status").eq("job_id", jobId).eq("kind", "rectification").eq("electrician_window", true).eq("status", "accepted"),
  ]);
  if (count) return false;
  const p = [...(ws ?? [])].sort((a, b) => (b.responded_at ?? "").localeCompare(a.responded_at ?? ""))[0];
  if (!p || heldWindowAction(p.starts_at, now) === "lapsed") return false;
  if (await (await import("./payments.server")).fixesPaymentBlockerFor(jobId)) return false;
  try {
    const { confirmBooking } = await import("./booking.server");
    await confirmBooking(jobId, "rectification", p.starts_at, (actorId ?? p.responded_by) as string, "owner", "Owner's chosen electrical fixes time");
    return true;
  } catch (e) {
    console.error("picked electrical fixes time not booked yet", (e as Error).message);
    return false;
  }
}
