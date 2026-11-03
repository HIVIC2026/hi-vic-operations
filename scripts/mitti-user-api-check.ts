// Jo 3 Nov 8:11pm — Step 1, TEST-only check of the real Mitti user API (find / create / deactivate).
// Hard limits: find only for the TEST Bravo Lead email; create / deactivate only for Jo's TEST inbox. Any other email is
// refused before any network call. No portal data is read or written, no portal message is sent.
// Usage:
//   bun scripts/mitti-user-api-check.ts find
//   bun scripts/mitti-user-api-check.ts create --apply        (one Lite user at jolowexo@hotmail.com; Mitti emails that inbox)
//   bun scripts/mitti-user-api-check.ts deactivate <mittiUserId> --apply
import { createUserBody, createdUserId, MITTI_USER_API, userPath, userStatusBody } from "../src/lib/mitti-invite.core";
import { findMittiUserByEmail } from "../src/lib/mitti.server";
import type { MittiCall } from "../src/lib/mitti.core";

const BRAVO_LEAD = "qa.installer.bravo@hivic-test.example";
const JO_TEST = "jolowexo@hotmail.com";
const BASE = "https://api.mitti.com";
const apply = process.argv.includes("--apply");
const [step, arg] = process.argv.slice(2).filter((a) => a !== "--apply");

// Direct call (bypasses the portal's TEST simulator routing on purpose: this check must reach the real API).
const raw: MittiCall = async (method, path, body) => {
  const token = process.env["MITTI_API_TOKEN"];
  if (!token) throw new Error("MITTI_API_TOKEN missing");
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await res.text();
  if (!res.ok) throw new Error(`Mitti ${method} ${path.split("/").slice(0, 2).join("/")} → HTTP ${res.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
};

if (step === "find") {
  for (const email of [BRAVO_LEAD, JO_TEST]) { try { console.log(`find ${email}: ${(await findMittiUserByEmail(email, raw)) ?? "not found"}`); } catch (e) { console.log(`find ${email}: ${(e as Error).message}`); } }
} else if (step === "create") {
  const existing = await findMittiUserByEmail(JO_TEST, raw);
  if (existing) { console.log(`STOP: a Mitti user already exists for ${JO_TEST} (${existing}) — not creating another.`); process.exit(0); }
  const body = createUserBody({ fullName: "TEST Mitti Check", email: JO_TEST, seat: "lite", password: `${crypto.randomUUID()}Aa1!` });
  if (!apply) { console.log(`Dry run — would ${MITTI_USER_API.create.method} ${MITTI_USER_API.create.path} for ${body.email} (${body.seat_type} seat). Add --apply.`); process.exit(0); }
  const res = await raw(MITTI_USER_API.create.method, MITTI_USER_API.create.path, body);
  console.log(`created: user id ${createdUserId(res) ?? "(none in response)"}; response keys: ${Object.keys(res as object).join(", ")}`);
  console.log(`find after create: ${(await findMittiUserByEmail(JO_TEST, raw)) ?? "not found"}`);
} else if (step === "deactivate") {
  if (!arg) throw new Error("Give the Mitti user id.");
  const found = await findMittiUserByEmail(JO_TEST, raw);
  if (found !== arg) { console.log(`STOP: ${arg} is not the Mitti user for ${JO_TEST} (found ${found ?? "none"}).`); process.exit(1); }
  if (!apply) { console.log(`Dry run — would PUT ${userPath(arg)} status inactive. Add --apply.`); process.exit(0); }
  const res = await raw("PUT", userPath(arg), userStatusBody("inactive"));
  console.log(`deactivated ${arg}; response keys: ${Object.keys(res as object).join(", ") || "(empty)"}`);
} else {
  console.log("Steps: find | create [--apply] | deactivate <id> [--apply]");
}
