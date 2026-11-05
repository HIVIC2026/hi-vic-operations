// Plan 2026-11-02 (Jo): ONE email to the installer's office per Give tap, listing every job given. Wording in
// in-house-give-email.core.ts. Order: business → TEST partner (test-send only) → approval switch → office email on file
// → "Pause all trade messages" (before the claim, so a later try can still send) → claimed once per Give
// (`deliverOnce`, key in-house-give:v1:{batchId}) → the guarded partner sender. Called only from Jo's Give tap.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { IN_HOUSE_GIVE_EMAIL_APPROVED, inHouseGiveEmailKey, renderInHouseGiveEmail, type GiveEmailJob, type GiveEmailOutcome } from "./in-house-give-email.core";
import { displayName } from "./display-name.core";
import { isTestPartner } from "./test-send.core";
import { deliverOnce } from "./in-house-booking-notices.server";

type Biz = { id: string; name: string | null; email: string | null; onboarding_notes: string | null; trading_name?: string | null };

export async function sendInHouseGiveEmail(p: { batchId: string; businessId: string; jobs: GiveEmailJob[]; actorId: string | null; approved?: boolean }): Promise<GiveEmailOutcome> {
  const first = p.jobs[0];
  if (!first) return { status: "not_sent", detail: "No jobs were given." };
  const { data, error } = await admin.from("businesses").select("id, name, email, onboarding_notes, trading_name").eq("id", p.businessId).maybeSingle();
  if (error) throw new Error(`Installer could not be read: ${error.message}`);
  const biz = data as Biz | null;
  if (!biz) return { status: "not_sent", detail: "Installer not found." };
  const to = (biz.email ?? "").trim().toLowerCase();
  const key = inHouseGiveEmailKey(p.batchId);
  const contactName = displayName(biz.name) || null;
  const partnerIsTest = isTestPartner(biz);
  if (partnerIsTest) {
    if (!to) return { status: "no_email" };
    const mail = { to, ...renderInHouseGiveEmail({ jobs: p.jobs, contactName: (biz.trading_name ?? "").trim() || displayName(biz.name) || null, test: true }) };
    let r: { status: string; detail?: string } | null = null;
    const sent = await deliverOnce(first.jobId, key, mail, async (frozen) => {
      const { sendTestEmail } = await import("./test-send.server");
      r = await sendTestEmail({ jobId: first.jobId, jobSource: null, partnerIsTest, label: key, actorId: p.actorId }, frozen.to, frozen.subject, frozen.html, frozen.text);
      return r;
    });
    return sent ? { status: "test_sent" } : { status: "not_sent", detail: (r as { detail?: string } | null)?.detail ?? "Already tried for this Give." };
  }
  // Real installers: nothing recorded or sent until Jo approves the wording in Templates.
  if (!(p.approved ?? IN_HOUSE_GIVE_EMAIL_APPROVED)) return { status: "not_approved" };
  if (!to) return { status: "no_email" };
  const paused = await (await import("./trade-pause.server")).tradeMessagesPausedNow({ businessId: biz.id });
  if (paused) return { status: "held", detail: paused };
  const mail = { to, ...renderInHouseGiveEmail({ jobs: p.jobs, contactName: (biz.trading_name ?? "").trim() || displayName(biz.name) || null }) };
  let r: { status: string; detail?: string } | null = null;
  const sent = await deliverOnce(first.jobId, key, mail, async (frozen) => {
    const { sendOfficeEmail } = await import("./office-email.server");
    r = await sendOfficeEmail({ actorId: p.actorId, recipient: "partner", to: frozen.to, contactName, subject: frozen.subject, message: frozen.text, html: frozen.html, text: frozen.text, label: key, record: { businessId: biz.id }, idempotencyKey: key });
    return r;
  });
  return sent ? { status: "sent" } : { status: "not_sent", detail: (r as { detail?: string } | null)?.detail ?? "Already tried for this Give." };
}
