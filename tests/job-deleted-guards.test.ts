// Deleted jobs: every real delivery, booking and secure owner link re-reads the job right before acting.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
const r = (f: string) => readFileSync(f, "utf8");

test("real SMS, Save my spot email, booking and owner link all check the job is not deleted", () => {
  for (const f of ["src/lib/sms.server.ts", "src/lib/hot-leads-send.server.ts", "src/lib/booking.server.ts", "src/lib/estimatelink.server.ts"]) expect(r(f)).toContain("jobDeletedBlocker");
});
test("SMS deleted check runs before the provider is loaded", () => {
  const s = r("src/lib/sms.server.ts"); expect(s.indexOf("jobDeletedBlocker")).toBeLessThan(s.indexOf("au1SendMessage } = await import"));
});
test("email deleted check runs before the provider call", () => {
  const s = r("src/lib/hot-leads-send.server.ts"); expect(s.indexOf("jobDeletedBlocker")).toBeLessThan(s.indexOf("await resendSend(to"));
});
test("unreadable job state fails closed", () => {
  const s = r("src/lib/job-live.server.ts"); expect(s).toContain("if (error || !data) return JOB_STATE_UNREADABLE");
});
test("cross-job booking readers drop deleted parents", () => {
  for (const f of ["src/lib/allocation.server.ts", "src/lib/readycheck-booking.server.ts", "src/lib/visit-events.server.ts", "src/lib/daily-brief.server.ts", "src/lib/trade-view.server.ts"]) expect(r(f)).toContain('.is("jobs.deleted_at", null)');
});
