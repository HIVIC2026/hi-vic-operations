// New-electrician invite email (manual partner email rule). Kept apart from job-electrician.server so the
// auto-progression path (allocation -> jobChosenElectrician) can never reach a sender.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { electricianInviteEmail } from "./job-electrician.core";
import { SET_PASSWORD_BASE } from "./set-password-link.core";

const isTestBiz = (b: { name?: string | null; onboarding_notes?: string | null } | null) =>
  /^\s*(\[TEST PARTNER\]|TEST\b)/i.test(b?.name ?? "") || (b?.onboarding_notes ?? "").includes("[TEST PARTNER]");

/** Emails the electrician the onboarding link. A one-off partner email typed on the installer's behalf: follows the
 *  manual-email rule (really sends), TEST businesses only reach Jo's test inbox. `dryRun` builds it without sending. */
export async function sendElectricianInvite(p: { actorId: string | null; nominationId: string; installerBusinessId: string; inviteToken: string; to: string; name: string; dryRun?: boolean }) {
  const { data: b } = await admin.from("businesses").select("name, trading_name, onboarding_notes").eq("id", p.installerBusinessId).maybeSingle();
  const test = isTestBiz(b);
  const installerName = ((b?.trading_name || b?.name) ?? "Your installer").replace(/^\[TEST PARTNER\]\s*/, "");
  const link = `${SET_PASSWORD_BASE}/electrician-onboarding?invite=${p.inviteToken}`;
  const mail = electricianInviteEmail({ electricianName: p.name, installerName, link });
  const { officeEmailTo } = await import("./office-email.core");
  const to = officeEmailTo(p.to, test);
  if (p.dryRun) return { status: "dry_run" as const, to, subject: mail.subject, message: mail.message, test };
  const { sendOfficeEmail } = await import("./office-email.server");
  const { electricianInviteLayout } = await import("./office-email.core");
  const laid = electricianInviteLayout({ electricianName: p.name, installerName, link, test: false });
  const r = await sendOfficeEmail({ actorId: p.actorId, recipient: "partner", to, contactName: p.name, subject: mail.subject, message: mail.message, html: laid.html, text: laid.text, label: "electrician_invite", record: { nominationId: p.nominationId, businessId: p.installerBusinessId, test } as never });
  if (r.status === "sent") {
    const now = new Date().toISOString();
    await admin.from("electrician_nominations").update({ status: "invited", invite_sent_at: now, invite_link_issued_at: now, updated_at: now }).eq("id", p.nominationId);
  }
  return { status: r.status, to, detail: r.detail, test };
}

