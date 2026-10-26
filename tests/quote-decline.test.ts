// Jo 24 Oct: owners can say "Not for me" on their secure link; the office sees it and can reopen.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DECLINE_REASONS, declineReasonText, OWNER_DECLINED_SCREEN } from "../src/lib/quote-decline.core";
import { installerQuoteLine } from "../src/lib/installer-quote-status.core";
import { classifyNewInstallerJob, type NewJobFacts } from "../src/lib/installer-new-jobs.core";
import { renderOwnerQuoteEmail } from "../src/lib/owner-quote-email.core";

describe("decline wording and rules", () => {
  test("reason text: chosen reason plus the owner's words, both optional", () => {
    expect(DECLINE_REASONS.map((r) => r.key)).toEqual(["price", "timing", "changed_mind", "other"]);
    expect(declineReasonText("price", "Too dear for us right now")).toBe("The price: Too dear for us right now");
    expect(declineReasonText("timing", null)).toBe("Not the right time");
    expect(declineReasonText(null, "  ")).toBeNull();
  });
  test("installer card shows the decline", () =>
    expect(installerQuoteLine({ sent: true, accepted: false, held: false, declined: true })).toBe("Waiting on office: the owner declined the quote"));
  test("New from installers flags it until the office reopens", () => {
    const now = new Date("2026-10-24T08:00:00Z");
    const job = (events: NewJobFacts["events"]): NewJobFacts => ({ jobId: "j", jobNumber: "HV-3117", createdAt: "2026-10-10T00:00:00Z", source: "installer_mitti", stage: "measured_estimate_ready", owner: "Helen Yang", address: "824 High Street Road", installer: "Reinsulate", eligibility: null, hasMittiForm: true, mittiAuditId: "a", hasQuote: true, events });
    const declined = { type: "quote_declined", at: "2026-10-24T01:00:00Z", summary: null, details: { reason: "The price" } };
    expect(classifyNewInstallerJob(job([declined]), now)!.warnings).toContain("Owner declined the quote: The price");
    const reopened = { type: "quote_reopened_by_office", at: "2026-10-24T02:00:00Z", summary: null, details: null };
    expect(classifyNewInstallerJob(job([reopened, declined]), now)?.warnings ?? []).not.toContainEqual(expect.stringContaining("declined"));
  });
  test("the quote email tells owners they can say no on the same page", () => {
    const m = renderOwnerQuoteEmail({ firstName: "Helen", address: null, totalIncGst: 2148, rebateIncGst: 1850, lines: [], quoteUrl: "https://x.example/q", validUntil: null, officePhone: null, unsubscribeUrl: null });
    expect(m.text).toContain("Not ready, or not for you? You can let us know on the same page.");
  });
});

describe("wiring", () => {
  test("owner decline needs only the secure link (no code), uses the shared quote checks, and logs the reason for the office", () => {
    const fn = readFileSync("src/lib/owner-link.functions.ts", "utf8");
    const decl = fn.slice(fn.indexOf("export const ownerDeclineQuoteFn"), fn.indexOf("export const ownerBookingStateFn"));
    expect(decl).not.toContain("ownerSession");
    expect(decl).toContain("respondToQuoteImpl({ quoteId: data.quoteId, accept: false");
    expect(readFileSync("src/lib/portal.functions.ts", "utf8")).toContain('"quote_declined", `${q.option_label} declined by the owner');
  });
  test("owner page keeps showing a declined quote with a clear message", () => {
    expect(readFileSync("src/lib/owner-myjob.server.ts", "utf8")).toContain('.in("status", ["issued", "accepted", "declined"])');
    const page = readFileSync("src/routes/my-job.$token.tsx", "utf8");
    expect(page).toContain("<DeclineQuote token={token} quoteId={q.id} />");
    expect(page).toContain("OWNER_DECLINED_SCREEN");
    expect(OWNER_DECLINED_SCREEN).toContain("reply to our email");
  });
  test("office: a declined quote is a Needs me row and the Job page offers Reopen", () => {
    expect(readFileSync("src/lib/office-needs.server.ts", "utf8")).toContain("owner declined");
    expect(readFileSync("src/components/portal/office-job.tsx", "utf8")).toContain("useAction(reopenDeclinedQuote)");
    expect(readFileSync("src/lib/installer-quote-review.functions.ts", "utf8")).toContain("export const reopenDeclinedQuote = createServerFn");
  });
});

// Reopen: declined → draft (held for office review), only from declined, never sends.
let quote: Record<string, unknown> = {}; const events: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => {
  let patch: Record<string, unknown> | null = null; const conds: [string, unknown][] = [];
  const q: Record<string, unknown> = {
    update: (p: Record<string, unknown>) => { patch = p; return q; },
    eq: (k: string, v: unknown) => { conds.push([k, v]); return q; }, select: () => q,
    maybeSingle: async () => { const ok = conds.every(([k, v]) => quote[k] === v); if (ok && patch) Object.assign(quote, patch); return { data: ok ? { id: quote["id"] } : null, error: null }; },
  };
  return q;
} } }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({ ...realWorkflow, logEvent: async (_j: string, _a: string, type: string) => { events.push(type); } }));
const { reopenDeclinedQuoteImpl } = await import("../src/lib/office-quote-review.server");
test("office reopen puts a declined quote back as a draft for Send, once", async () => {
  quote = { id: "q", job_id: "j", status: "declined", sent_at: "2026-10-20T00:00:00Z" };
  expect(await reopenDeclinedQuoteImpl("j", "q", "office")).toEqual({ reopened: true });
  expect([quote["status"], quote["sent_at"], quote["release_state"]]).toEqual(["draft", null, "held"]);
  expect(events).toEqual(["quote_reopened_by_office"]);
  await expect(reopenDeclinedQuoteImpl("j", "q", "office")).rejects.toThrow(/isn't declined/);
});
