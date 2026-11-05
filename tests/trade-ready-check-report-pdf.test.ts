// Jo 5 Nov 2026 (HV-3117): the installer opens the saved Mitti Ready Check report PDF from the job page — installers only,
// business-scoped; electricians and other businesses are refused; no report saved → a plain message.
import { describe, expect, test, mock } from "bun:test";

const JOB = "11111111-1111-4111-8111-111111111111";
let kind: "installer" | "electrician" = "installer";
let doc: { storage_path: string; title: string; created_at: string } | null = { storage_path: `${JOB}/mitti/audit_x-1.pdf`, title: "Mitti Ready Check report", created_at: "2026-10-23T20:30:20Z" };
const downloads: string[] = [];
const table = (name: string) => {
  const q: any = {};
  for (const k of ["select", "eq", "ilike", "order", "limit"]) q[k] = () => q;
  q.maybeSingle = async () => name === "documents" ? { data: doc, error: null } : name === "jobs" ? { data: { job_number: "HV-3117" }, error: null } : { data: null, error: null };
  return q;
};
mock.module("./job-facts.server", () => ({ jobAdmin: { from: table, storage: { from: () => ({ download: async (p: string) => { downloads.push(p); return { data: new Blob([new Uint8Array([37, 80, 68, 70])]), error: null }; } }) } } }));
mock.module("../src/lib/job-facts.server", () => ({ jobAdmin: { from: table, storage: { from: () => ({ download: async (p: string) => { downloads.push(p); return { data: new Blob([new Uint8Array([37, 80, 68, 70])]), error: null }; } }) } } }));

describe("tradeReadyCheckReportPdf", () => {
  test("installer on the job gets the saved report as bytes, named after the job", async () => {
    const tv = await import("../src/lib/trade-view.server");
    const deps = { access: async () => ({ kind }) as any };
    const r = await tv.tradeReadyCheckReportPdf(JOB, "u", deps);
    expect(r.fileName).toBe("HV-3117-ready-check-report.pdf");
    expect(atob(r.base64)).toBe("%PDF");
    expect(downloads).toEqual([`${JOB}/mitti/audit_x-1.pdf`]);
    kind = "electrician";
    await expect(tv.tradeReadyCheckReportPdf(JOB, "u", deps)).rejects.toThrow("Only the installing business");
    kind = "installer"; doc = null;
    await expect(tv.tradeReadyCheckReportPdf(JOB, "u", deps)).rejects.toThrow("Ready Check report not in yet. It comes through within 15 minutes of pressing Complete in Mitti.");
  });
});
