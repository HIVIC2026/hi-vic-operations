import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { sameEventDetails } from "../src/lib/event-details-same.core";

// Execute the actual writer guard against local records only; no hosted imports,
// provider calls, quotes, prices or customer records can be reached.
function guard(path: string, marker: string) {
  const source = readFileSync(path, "utf8");
  const start = source.indexOf(marker);
  const end = source.indexOf("  return resolved;", start);
  if (start < 0 || end < 0) throw new Error("Writer guard not found");
  const body = source.slice(start, end);
  const code = ts.transpile(`exports.run = async function(admin, logEvent, jobId, actorId, details, resolved) {${body}}`, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  });
  const exported: { run?: (...args: unknown[]) => Promise<void> } = {};
  new Function("exports", "require", "sameEventDetails", code)(exported, (name: string) => {
    if (name !== "./event-details-same.core") throw new Error(`Unexpected import: ${name}`);
    return { sameEventDetails };
  }, sameEventDetails);
  if (!exported.run) throw new Error("Writer not loaded");
  return exported.run;
}

for (const type of ["product", "electrician"] as const) {
  describe(`actual Mitti ${type} history writer`, () => {
    const writer = type === "product"
      ? guard("src/lib/insulation-product.server.ts", "  const { data: prev, error: pe }")
      : guard("src/lib/usual-electrician.server.ts", "  const { data: previous, error: pe }");
    const eventType = `mitti_${type}_recorded`;
    const base = type === "product"
      ? { audit_id: "test-audit", declared_not_verified: true, product: { option: "Bradford Gold R5", rValue: "R5.0" }, ready: true, reasons: [], source: "mitti_form" }
      : { audit_id: "test-audit", name: "TEST Electrician", ready: false, reasons: ["Not onboarded"], notOnboarded: { name: "TEST Electrician", licence: "TEST-L1", email: null } };
    function fixture(failed = false) {
      const history: { job: string; type: string; details: unknown }[] = [];
      const admin = { from(table: string) {
        expect(table).toBe("workflow_events");
        const filters: Record<string, string> = {};
        const q = {
          select() { return q; }, eq(k: string, v: string) { filters[k] = v; return q; },
          order(k: string, direction: unknown) { expect(k).toBe("created_at"); expect(direction).toEqual({ ascending: false }); return q; },
          limit(n: number) { expect(n).toBe(1); return q; },
          async maybeSingle() {
            const previous = history.filter(e => e.job === filters.job_id && e.type === filters.event_type).at(-1);
            return { data: previous ? { details: previous.details } : null, error: failed ? { message: "read failed" } : null };
          },
        }; return q;
      } };
      const logEvent = async (job: string, _actor: unknown, type: string, _summary: unknown, details: unknown) => {
        // Emulate jsonb changing object key order on readback.
        const reverse = (v: unknown): unknown => Array.isArray(v) ? v.map(reverse) : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).reverse().map(([k, value]) => [k, reverse(value)])) : v;
        history.push({ job, type, details: reverse(details) });
      };
      return { history, run: (job: string, details: unknown) => writer(admin, logEvent, job, null, details, base) };
    }
    test("first event is kept; 96 unchanged quarter-hour replays add nothing", async () => {
      const f = fixture();
      for (let n = 0; n < 97; n++) await f.run("TEST-job-a", base);
      expect(f.history).toHaveLength(1);
      expect(f.history[0]?.type).toBe(eventType);
    });
    test("a real change and a return to earlier details each survive", async () => {
      const f = fixture();
      const changed = type === "product" ? { ...base, product: { option: "Earthwool R6", rValue: "R6.0" } } : { ...base, name: "Another TEST Electrician" };
      for (const details of [base, base, changed, changed, base, base]) await f.run("TEST-job-a", details);
      expect(f.history).toHaveLength(3);
    });
    test("one job's history cannot suppress another job's first event", async () => {
      const f = fixture();
      await f.run("TEST-job-a", base); await f.run("TEST-job-b", base);
      expect(f.history.map(e => e.job)).toEqual(["TEST-job-a", "TEST-job-b"]);
    });
    test("failed previous-event read writes nothing", async () => {
      const f = fixture(true);
      await expect(f.run("TEST-job-a", base)).rejects.toThrow("Could not check");
      expect(f.history).toHaveLength(0);
    });
  });
}