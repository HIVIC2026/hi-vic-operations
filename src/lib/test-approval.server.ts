// TEST approvals only: pre-make the TEST business, then after approval create the login and send the welcome to Jo.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { TEST_PARTNER_MARK } from "./test-send.core";
import { TEST_APP_BASE, sendTestEmail, simpleEmail, type SendResult } from "./test-send.server";
import { testAbn, testBusinessName, testLoginEmail, testWelcomeCopy } from "./test-approval.core";
import { TEST_ALLOWLIST } from "./test-send.core";
import { setPasswordLink } from "./set-password-link.core";

/** Business row the approval will reconcile into: TEST-marked from the very first write, fake 12-digit ABN. */
export async function prepareTestBusiness(appId: string, name: string, type: string) {
  const abn = testAbn(appId);
  const { data: ex } = await admin.from("businesses").select("id").eq("abn", abn).maybeSingle();
  if (ex) return abn;
  const { error } = await admin.from("businesses").insert({ name: testBusinessName(name), abn, business_type: type as never, onboarding_status: "draft", is_active: false, onboarding_notes: `${TEST_PARTNER_MARK} Jo's own test application ${appId}. Not a real partner.` } as never);
  if (error) throw new WorkflowError(`Could not prepare the TEST business: ${error.message}`);
  return abn;
}

export async function sendTestWelcome(p: { businessId: string; name: string | null; role: "installer" | "electrician"; actorId: string; appId: string }): Promise<SendResult & { link?: string }> {
  const { data: biz } = await admin.from("businesses").select("name, onboarding_notes").eq("id", p.businessId).single();
  if (!biz?.onboarding_notes?.includes(TEST_PARTNER_MARK)) throw new WorkflowError("Not a TEST partner; nothing sent.");
  const email = testLoginEmail(p.appId);
  const { data: existing } = await admin.from("profiles").select("id, business_id").eq("email", email).maybeSingle();
  let uid = existing?.id;
  if (!uid) {
    const { data: cu, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: crypto.randomUUID() + "Aa1!", user_metadata: { full_name: p.name, qa_test: true } });
    if (error || !cu.user) throw new WorkflowError(`Could not create the TEST login: ${error?.message}`);
    uid = cu.user.id;
  }
  const steps = [
    await admin.from("profiles").upsert({ id: uid, email, full_name: p.name, business_id: p.businessId }),
    await admin.from("user_roles").upsert({ user_id: uid, role: p.role }, { onConflict: "user_id,role" }),
    await admin.from("business_members").upsert({ business_id: p.businessId, user_id: uid, member_role: "business_admin", active: true, added_by: p.actorId }, { onConflict: "business_id,user_id" }),
  ];
  const bad = steps.find((s) => s.error);
  if (bad?.error) throw new WorkflowError(`TEST login linking failed: ${bad.error.message}`);
  const { data: gl, error: ge } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (ge || !gl.properties?.hashed_token) throw new WorkflowError(`The set-password link failed: ${ge?.message ?? "no token"}`);
  const link = setPasswordLink(gl.properties.hashed_token, "/field/welcome", TEST_APP_BASE);
  const { partnerWelcomeEmail } = await import("./partner-email.core");
  const c = partnerWelcomeEmail({ firstName: p.name?.trim().split(/\s+/)[0] ?? null, businessName: biz.name.replace(TEST_PARTNER_MARK, "").trim(), trade: p.role, email, link, test: true });
  const mail = c;
  const r = await sendTestEmail({ jobId: null, jobSource: null, label: "partner_welcome", actorId: p.actorId, partnerIsTest: true } as never, TEST_ALLOWLIST.email[0], c.subject, mail.html, mail.text);
  await admin.from("businesses").update({ approval_message_status: r.status === "sent" ? "sent" : null, approval_message_queued_at: new Date().toISOString() } as never).eq("id", p.businessId);
  await admin.from("admin_config_events").insert({ actor_id: p.actorId, event_type: "test_partner_welcome", summary: `TEST partner welcome to ${TEST_ALLOWLIST.email[0]} (login ${email}): ${r.status}`, details: { business_id: p.businessId, application_id: p.appId, status: r.status, detail: r.detail } as never });
  return { ...r, link };
}
