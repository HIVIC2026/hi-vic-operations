// Part 2b Task 4 (fix round 1): installer-added electricians are never Home Insulation Victoria lead candidates on the
// team-up / office "choose an electrician" path (teaming.server electricianCandidates). Fake admin: canned rows only.
import { describe, expect, mock, test } from "bun:test";

let channel: string | null = "web";
const INST = "00000000-0000-0000-0000-000000000001";
const bizRows = [
  { id: "a", name: "Open Sparks", trading_name: null, business_type: "rec", capabilities: ["electrician"], added_by_installer_business_id: null },
  { id: "b", name: "Installer's Own", trading_name: null, business_type: "rec", capabilities: ["electrician"], added_by_installer_business_id: INST },
  { id: "c", name: "Legacy REC", trading_name: null, business_type: "rec", capabilities: ["electrician"] }, // column not applied yet
];
const canned = (table: string) => table === "jobs" ? [{ channel, originating_installer_business_id: INST, properties: { postcode: "3000", suburb: "Melbourne" } }] : table === "businesses" ? bizRows : [];
function fake(table: string) {
  const rows = canned(table);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "or", "is", "not", "order", "limit"]) b[m] = () => b;
  b["single"] = async () => ({ data: rows[0] ?? null, error: null });
  b["maybeSingle"] = async () => ({ data: rows[0] ?? null, error: null });
  b["then"] = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: fake } }));
const { electricianCandidates } = await import("../src/lib/teaming.server");

describe("teaming electricianCandidates", () => {
  test("our lead: the installer-added electrician is not a candidate", async () => {
    channel = "web";
    expect((await electricianCandidates("job")).cands.map((c) => c.id)).toEqual(["a", "c"]);
  });
  test("installer's own job: everyone stays (Task 5 decides who is pickable)", async () => {
    channel = "installer_sourced";
    expect((await electricianCandidates("job")).cands.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});
