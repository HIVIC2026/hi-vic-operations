// READ-ONLY browser check of the installer app cache (Jo, 3 Nov 2026): signs in as the TEST business owner, opens My work
// once online (the service worker installs), once more online (what a repeat visit still downloads) and once with the
// network off (is the shell served from the phone). Needs a published build with SERVICE_WORKER_ENABLED on, and
// SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and the server key (runs in Lovable). No inserts, updates, sends, Mitti or Xero.
//   bun scripts/installer-app-cache-check.ts --base https://portal.homeinsulationvictoria.com.au
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const OWNER_EMAIL = "deep-test@hivic.test";
const TEST_EMAIL = /@(hivic-test\.example|hivic\.test)$/i;
const baseArg = process.argv.indexOf("--base");
const base = baseArg > 0 ? process.argv[baseArg + 1] : undefined;
if (!base) { console.error("Usage: bun scripts/installer-app-cache-check.ts --base <url>"); process.exit(2); }
for (const k of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]) if (!process.env[k]) { console.error(`STOP: ${k} is not set. Nothing was run.`); process.exit(2); }

const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

/** Same TEST-only magic-link sign-in as scripts/installer-speed.ts. */
async function sessionFor(email: string) {
  if (!TEST_EMAIL.test(email)) throw new Error("SAFETY STOP: TEST accounts only.");
  const { createClient } = await import("@supabase/supabase-js");
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const sb = createClient(process.env["SUPABASE_URL"]!, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (i, init) => { const h = new Headers(init?.headers); if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization"); h.set("apikey", key); return fetch(i, { ...init, headers: h }); } } });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) throw new Error(`TEST sign-in ${email}: ${error?.message}`);
  const v = await sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (v.error) throw new Error(`TEST sign-in ${email}: ${v.error.message}`);
  return v.data.session;
}

const date = new Date().toISOString().slice(0, 10);
const work = `/tmp/installer-app-cache/${date}`;
mkdirSync(work, { recursive: true });
const manifest = `${work}/manifest.json`;
const resultPath = `${work}/result.json`;
writeFileSync(manifest, JSON.stringify({ base, resultPath, storageKey: `sb-${process.env["SUPABASE_PROJECT_ID"] ?? "wvuffpykgnqliikhodzl"}-auth-token`, session: await sessionFor(OWNER_EMAIL) }), { mode: 0o600 });
console.log(`Checking the installer app cache on ${base} as the TEST owner...`);
let py;
try {
  py = spawnSync("python3", [new URL("../e2e/installer-app-cache/offline.py", import.meta.url).pathname, manifest], { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"], timeout: 10 * 60_000 });
} finally {
  writeFileSync(manifest, "{}"); // do not leave the sign-in token on disk
}
const result = JSON.parse(readFileSync(resultPath, "utf8")) as { first?: { controlled?: boolean; cached?: number }; repeat?: { assetsFromNetwork: string[]; assetsFromWorker: number }; offline?: { shellFromServiceWorker: boolean; landed?: string; myWorkShown?: boolean; error?: string } };
const lines = [
  `# Installer app cache check (${date})`, "",
  `Base: ${base}. TEST owner. Read-only.`, "",
  `- First visit: worker in control: ${result.first?.controlled ? "yes" : "no"}; files kept on the phone: ${result.first?.cached ?? "?"}.`,
  `- Repeat visit online: ${result.repeat?.assetsFromWorker ?? "?"} static files from the phone, ${result.repeat?.assetsFromNetwork.length ?? "?"} from the network${result.repeat?.assetsFromNetwork.length ? ` (${result.repeat.assetsFromNetwork.join(", ")})` : ""}.`,
  `- Network off: shell from the phone: ${result.offline?.shellFromServiceWorker ? "yes" : "no"}${result.offline?.error ? ` (${result.offline.error})` : ""}; landed on ${result.offline?.landed ?? "?"}; My work shown: ${result.offline?.myWorkShown ? "yes" : "no"}.`,
];
mkdirSync("qa/installer-speed", { recursive: true });
writeFileSync(`qa/installer-speed/${date}-app-cache.md`, lines.join("\n") + "\n");
console.log("\n" + lines.join("\n"));
process.exit(py.status === 0 ? 0 : 1);
