// Mints a magic-link session for a TEST account only (no sends) and writes it to /tmp/browser/gb/session-<persona>.json.
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
const email = process.argv[2]!; const out = process.argv[3]!;
if (!/@(hivic-test\.example|hivic\.test)$/i.test(email)) throw new Error("SAFETY STOP: TEST accounts only");
const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
const sb = createClient(process.env["SUPABASE_URL"]!, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
if (error) throw error;
const v = await sb.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
if (v.error) throw v.error;
writeFileSync(out, JSON.stringify(v.data.session));
console.log("ok", email, "storage key sb-" + new URL(process.env["SUPABASE_URL"]!).hostname.split(".")[0] + "-auth-token");
