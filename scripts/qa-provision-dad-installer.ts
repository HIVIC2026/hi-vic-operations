// Jo-approved (20 Oct 2026): ONE dedicated TEST ONLY installer business + login for the signed-in Add Job check.
// Idempotent (exact-purpose lookup first). Reserved non-deliverable domain; no password is ever printed; no email is sent
// (createUser with email_confirm sends nothing). Never touches any existing person's account.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { TEST_PARTNER_MARK } from "@/lib/test-send.core";

export const QA_EMAIL = "installer-qa-dad-20261021@hivic-test.example";
export const QA_BIZ = "TEST ONLY Dad QA Installer";
const notes = `${TEST_PARTNER_MARK} TEST ONLY dummy-job QA identity approved by Jo 20 Oct 2026. Not a real partner. No customer messages.`;

const { data: existing, error: be } = await admin.from("businesses").select("id").eq("name", QA_BIZ);
if (be) throw be;
if ((existing ?? []).length > 1) throw new Error("SAFETY STOP: duplicate QA businesses");
let bizId = existing?.[0]?.id as string | undefined;
const fields = {
  name: QA_BIZ, legal_name: QA_BIZ, trading_name: QA_BIZ, business_type: "eec_installer" as const, email: QA_EMAIL, phone: "0400000199",
  is_active: true, onboarding_status: "approved", onboarding_notes: notes, commercial_route: "hivic_full_invoice", default_comms_owner: "hivic",
  gst_registered: true, service_postcodes: ["3199"], approved_at: new Date().toISOString(), xero_contact_status: "not_ready",
};
if (!bizId) {
  const { data, error } = await admin.from("businesses").insert(fields as never).select("id").single();
  if (error) throw error; bizId = data.id;
}
const { data: prof, error: pe } = await admin.from("profiles").select("id").eq("email", QA_EMAIL);
if (pe) throw pe;
let uid = prof?.[0]?.id as string | undefined;
if (!uid) {
  const { data, error } = await admin.auth.admin.createUser({ email: QA_EMAIL, email_confirm: true, password: crypto.randomUUID() + "Aa1!", user_metadata: { full_name: "TEST Dad QA Installer", qa_test: true } });
  if (error || !data.user) throw error ?? new Error("no user"); uid = data.user.id;
}
const { data: au } = await admin.auth.admin.getUserById(uid);
if (au.user?.email !== QA_EMAIL || au.user?.user_metadata?.["qa_test"] !== true) throw new Error("SAFETY STOP: identity mismatch");
const chk = (r: { error: { message: string } | null }, w: string) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); };
chk(await admin.from("profiles").upsert({ id: uid, email: QA_EMAIL, full_name: "TEST Dad QA Installer", business_id: bizId }), "profile");
chk(await admin.from("user_roles").upsert({ user_id: uid, role: "installer" }, { onConflict: "user_id,role" }), "role");
chk(await admin.from("business_members").upsert({ business_id: bizId, user_id: uid, member_role: "business_admin", active: true }, { onConflict: "business_id,user_id" }), "member");
console.log(JSON.stringify({ businessId: bizId, userId: uid, email: QA_EMAIL }));
