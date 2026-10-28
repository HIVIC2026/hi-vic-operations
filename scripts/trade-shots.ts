// Screenshots of every trade page at 390/1280 as the TEST business owner and TEST staff (look only; no writes).
import { writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
const BIZ = "17793408-bf5c-4ddd-9bec-64199f64f9fb";
const TEST = /@(hivic-test\.example|hivic\.test)$/i;
async function sessionFor(email: string) {
  if (!TEST.test(email)) throw new Error("TEST only");
  const { createClient } = await import("@supabase/supabase-js");
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const sb = createClient(process.env["SUPABASE_URL"]!, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (i, init) => { const h = new Headers(init?.headers); if (h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization"); h.set("apikey", key); return fetch(i, { ...init, headers: h }); } } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  return (await sb.auth.verifyOtp({ token_hash: link!.properties!.hashed_token, type: "magiclink" })).data.session;
}
const { data: offers } = await admin.from("partner_offers").select("id,status").eq("business_id", BIZ).order("offered_at", { ascending: false }).limit(20);
const { data: jobs } = await admin.from("job_assignments").select("job_id").eq("business_id", BIZ).eq("active", true).limit(1);
const offer = (offers as { id: string; status: string }[] | null) ?? [];
const pend = offer.find((o) => o.status === "pending"), acc = offer.find((o) => o.status === "accepted"), gone = offer.find((o) => !["pending", "accepted"].includes(o.status));
const job = (jobs as { job_id: string }[] | null)?.[0]?.job_id;
const pages: [string, string][] = [["my-work", "/field"], ["welcome", "/field/welcome"], ["money", "/field/money"], ["business", "/field/business"], ["business-details", "/field/business/details"], ["business-rates", "/field/business/rates"], ["business-bank", "/field/business/bank"], ["business-insurance", "/field/business/insurance"], ["business-agreement", "/field/business/agreement"], ["business-team", "/field/business/team"], ["staff-and-invites", "/partner/workers"], ["customers", "/partner/import"], ["add-one-job", "/partner/add"]];
if (job) pages.push(["job-page", `/field/${job}`], ["todays-job", `/field/day/${job}`]);
if (pend) pages.push(["offer-new", `/field/offer/${pend.id}`]); if (acc) pages.push(["offer-accepted", `/field/offer/${acc.id}`]); if (gone) pages.push(["offer-closed", `/field/offer/${gone.id}`]);
const screens = [] as { step: string; persona: string; path: string }[];
for (const persona of ["owner", "staff"]) for (const [n, p] of pages) screens.push({ step: n, persona, path: p });
for (const [n, p] of [["sign-in", "/auth"], ["portal-sign-in", "/portal"], ["reset-password", "/reset-password"], ["rate-offer-link", "/rate-offer/expired-example"], ["staff-job-link", "/w/expired-example"], ["staff-join-link", "/join/expired-example"], ["installer-application", "/installer-onboarding"], ["electrician-application", "/electrician-onboarding"]]) screens.push({ step: n, persona: "public", path: p });
const outDir = "/tmp/tradeshots"; mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/.manifest.json`, JSON.stringify({ base: "http://localhost:8080", outDir, storageKey: "sb-wvuffpykgnqliikhodzl-auth-token", screens, sessions: { owner: await sessionFor("deep-test@hivic.test"), staff: await sessionFor("qa.staff.reinsulate@hivic-test.example") } }));
console.log("pages", pages.length, "job", job, "offers", !!pend, !!acc, !!gone);
const r = spawnSync("python3", ["e2e/journey/shoot.py", `${outDir}/.manifest.json`], { encoding: "utf8", timeout: 590_000 });
writeFileSync(`${outDir}/.manifest.json`, "{}"); console.log(r.stdout.slice(-3000), r.stderr.slice(-1000));
