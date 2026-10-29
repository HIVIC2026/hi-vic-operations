// Registers the portal's instant-notice address with Mitti. DRY RUN by default; sends nothing.
// Usage: bun scripts/register-mitti-webhook.ts [--apply]
import { buildRegistration, maskToken, missingEnv } from "./register-mitti-webhook.core";

const apply = process.argv.includes("--apply");
const missing = missingEnv(process.env);
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}
const apiToken = process.env["MITTI_API_TOKEN"]!;
const hookToken = process.env["MITTI_WEBHOOK_TOKEN"]!;
const { endpoint, body, maskedBody } = buildRegistration(process.env["PORTAL_PUBLIC_URL"]!, hookToken);

console.log(`${apply ? "APPLY" : "DRY RUN (nothing sent)"}: POST ${endpoint}`);
console.log("Authorization: Bearer <MITTI_API_TOKEN hidden>");
console.log(`Webhook token: ${maskToken(hookToken)}`);
console.log(JSON.stringify(maskedBody, null, 2));

if (!apply) {
  console.log("Add --apply to send. First confirm body and event names against developer.mitti.com -> Webhooks.");
  process.exit(0);
}
const res = await fetch(endpoint, {
  method: "POST",
  headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
console.log("Response status:", res.status);
const text = await res.text();
let id: unknown;
try { const j = JSON.parse(text); id = j?.webhook_id ?? j?.id; } catch { /* not JSON */ }
if (id) console.log("Webhook id:", String(id));
else console.log("No webhook id in response.");
process.exit(res.ok ? 0 : 1);
