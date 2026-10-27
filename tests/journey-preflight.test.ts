import { expect, test } from "bun:test";
import { probeRunningPreview } from "../scripts/journey-preflight";
test("missing signed TEST pass refuses intake and all provider probes", async () => {
  const original = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => { methods.push(init?.method ?? "GET"); return new Response(null, { status: 405 }); }) as typeof fetch;
  try {
    const rows = await probeRunningPreview("http://localhost:8080", false);
    expect(methods).toEqual(["GET"]);
    expect(rows.map(r => r.status)).toEqual(["fail", "blocked", "blocked", "blocked"]);
    expect(rows[0]?.detail).toContain("No enquiry submitted");
  } finally { globalThis.fetch = original; }
});