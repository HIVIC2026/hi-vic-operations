import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { certOrFilter, sameWorkerEmail, workerEmailKey } from "../src/lib/worker-role.core";
import { tradeAccessBlocker } from "../src/lib/trade-access.core";
const src = (p: string) => readFileSync(p, "utf8");
test("blank emails never match", () => {
  expect(sameWorkerEmail(null, null)).toBe(false);
  expect(sameWorkerEmail("", " ")).toBe(false);
  expect(workerEmailKey(null)).toBe("");
  expect(certOrFilter([{ id: "a", email: null }, { id: "b", email: "" }])).toBe("worker_id.in.(a,b)");
});
test("types follow 0229 and 0230; login invite still refuses a blank email", () => {
  const t = src("src/integrations/supabase/types.ts");
  const pw = t.slice(t.indexOf("partner_workers: {"), t.indexOf("Relationships", t.indexOf("partner_workers: {")));
  expect(pw.match(/email: string \| null/g)?.length).toBeGreaterThanOrEqual(1);
  expect(pw).toContain("declarations_due: boolean");
  const w = { removed_at: null, approval_status: "approved", email: null, trade_role: "electrician", certification_status: null };
  expect(tradeAccessBlocker(w as never, true)).toBe("This person needs a valid email.");
});
