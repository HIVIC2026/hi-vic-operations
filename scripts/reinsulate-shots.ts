// Builds the screen list + a TEST-only sign-in for "[TEST PARTNER] Reinsulate" (deep-test@hivic.test). Nothing is sent.
import { writeFileSync } from "node:fs";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
const BIZ = "17793408-bf5c-4ddd-9bec-64199f64f9fb"; const EMAIL = "deep-test@hivic.test";
const { createClient } = await import("@supabase/supabase-js");
const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
const sb = createClient(process.env["SUPABASE_URL"]!, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (i, init) => { const h = new Headers(init?.headers); if (h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization"); h.set("apikey", key); return fetch(i, { ...init, headers: h }); } } });
const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
if (error) throw error;
const v = await sb.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
if (v.error) throw v.error;
const { data: job } = await admin.from("jobs").select("id").eq("originating_installer_business_id", BIZ).eq("source", "qa_test").is("qa_archived_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
const { data: offers } = await admin.from("partner_offers").select("id, status").eq("business_id", BIZ).order("offered_at", { ascending: false });
const pending = (offers ?? []).find((o) => o.status !== "accepted"); const accepted = (offers ?? []).find((o) => o.status === "accepted");
const pages: [string, string][] = [["01-welcome", "/field/welcome"], ["02-my-work", "/field"], ["03-money", "/field/money"], ["04-my-business", "/field/business"],
  ["05-details", "/field/business/details"], ["06-rates", "/field/business/rates"], ["07-bank", "/field/business/bank"], ["08-insurance", "/field/business/insurance"],
  ["09-agreement", "/field/business/agreement"], ["10-team", "/field/business/team"], ["12-add-one-job", "/partner/import"]];
if (pending) pages.push(["13-offer", `/field/offer/${pending.id}`]);
if (accepted) pages.push(["14-offer-accepted", `/field/offer/${accepted.id}`]);
if (job) pages.push(["15-job", `/field/${job.id}`], ["16-job-day", `/field/day/${job.id}`]);
const ref = new URL(process.env["SUPABASE_URL"]!).hostname.split(".")[0];
writeFileSync("/tmp/dry/manifest.json", JSON.stringify({ storageKey: `sb-${ref}-auth-token`, session: v.data.session, pages }));
console.log("pages", pages.length, "job", !!job, "offer", !!pending, !!accepted);
process.exit(0);
