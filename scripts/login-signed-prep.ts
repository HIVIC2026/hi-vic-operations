// TEST-only prep for the signed-in login test: passwords on TEST accounts, 24h partner links, recovery + magic links. Writes a private manifest in /tmp.
import { writeFileSync } from "node:fs";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { issuePartnerLoginLink } from "@/lib/set-password-link.server";
import { setPasswordLink } from "@/lib/set-password-link.core";
const TEST = /@(hivic-test\.example|hivic\.test)$/i;
const base = "http://localhost:8080";
async function uid(email: string) { if (!TEST.test(email)) throw new Error("TEST only"); const { data } = await admin.from("profiles").select("id").eq("email", email).maybeSingle(); return data?.id as string | undefined; }
async function setPw(email: string) { const id = await uid(email); const pw = "T!" + crypto.randomUUID(); const { error } = await admin.auth.admin.updateUserById(id!, { password: pw }); if (error) throw error; return pw; }
const noAccess = "qa.login.noaccess@hivic-test.example";
if (!(await uid(noAccess))) { const { data, error } = await admin.auth.admin.createUser({ email: noAccess, email_confirm: true, password: "T!" + crypto.randomUUID() }); if (error) throw error; await admin.from("profiles").upsert({ id: data.user!.id, email: noAccess, full_name: "QA No Access" }); await admin.from("user_roles").delete().eq("user_id", data.user!.id); }
const { data: own } = await admin.from("profiles").select("email").like("email", "qa.journey.%@hivic-test.example").limit(1);
const owner = own![0]!.email as string;
const { data: offers } = await admin.from("partner_offers").select("id").eq("business_id", "17793408-bf5c-4ddd-9bec-64199f64f9fb").limit(1);
const magic = async (email: string) => { const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email }); return `${base}/portal?token_hash=${data.properties!.hashed_token}&type=magiclink`; };
const recovery = async (email: string) => { const { data } = await admin.auth.admin.generateLink({ type: "recovery", email }); return setPasswordLink(data.properties!.hashed_token, "/portal", base); };
const expired = await issuePartnerLoginLink("deep-test@hivic.test", null, null, base);
await admin.from("partner_login_links").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("email", "deep-test@hivic.test").is("used_at", null);
const partner = await issuePartnerLoginLink("deep-test@hivic.test", null, null, base);
const p = {
  office: { email: "admin@hivic.test", pw: await setPw("admin@hivic.test") },
  boss: { email: "deep-test@hivic.test", pw: await setPw("deep-test@hivic.test") },
  staff: { email: "qa.staff.reinsulate@hivic-test.example", pw: await setPw("qa.staff.reinsulate@hivic-test.example") },
  owner: { email: owner, pw: await setPw(owner) },
  noaccess: { email: noAccess, pw: await setPw(noAccess) },
  magicBoss: await magic("deep-test@hivic.test"),
  recoveryStaff: await recovery("qa.staff.reinsulate@hivic-test.example"),
  partner, expired, offer: offers?.[0]?.id ?? null,
};
writeFileSync("/tmp/browser/login-signed/.m.json", JSON.stringify(p));
console.log("prepared", Object.keys(p).join(","));
