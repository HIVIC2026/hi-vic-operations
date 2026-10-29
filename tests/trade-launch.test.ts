import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { evaluatePaymentGate } from "../src/lib/payment-gate.core";
import { tradeTask } from "../src/lib/trade-work.core";
import { addCustomerProblems, areaTotal, type A1Area } from "../src/lib/add-customer.core";
import { grantedRole, memberRoleFor, renderTradeInviteEmail, TRADE_INVITE_EMAIL_APPROVED, tradeAccessBlocker } from "../src/lib/trade-access.core";

const quote = { id: "q1", customer_total_inc_gst: 5000 };
const base = { enabled: false, route: "hiv_lead" as const, currentQuote: quote, invoice: null, plan: null, overrideCount: 0 };

describe("TEST-only payment simulation", () => {
  test("clears only a qa_test job for the current quote", () => {
    expect(evaluatePaymentGate({ ...base, qaSimulated: { jobSource: "qa_test", quoteId: "q1" } })).toEqual({ cleared: true, option: "qa_test_simulated" });
  });
  test("never clears a real job, an old quote, or with no accepted quote", () => {
    expect(evaluatePaymentGate({ ...base, qaSimulated: { jobSource: "base44", quoteId: "q1" } }).cleared).toBe(false);
    expect(evaluatePaymentGate({ ...base, qaSimulated: { jobSource: "qa_test", quoteId: "old" } }).cleared).toBe(false);
    expect(evaluatePaymentGate({ ...base, currentQuote: null, qaSimulated: { jobSource: "qa_test", quoteId: "q1" } }).cleared).toBe(false);
  });
  test("server only reads the simulation for active qa_test jobs and the action is TEST-admin guarded", () => {
    const wf = readFileSync("src/lib/workflow.server.ts", "utf8");
    expect(wf).toContain('job?.source === "qa_test" && !job.qa_archived_at');
    const acc = readFileSync("src/lib/test-accounts.functions.ts", "utf8");
    const body = acc.slice(acc.indexOf("export const simulateQaPayment"));
    expect(body).toContain("requireTestAdmin(context)");
    expect(body).toContain("testJob(admin, data.jobId)");
    expect(body).not.toContain("xero");
  });
});

describe("My work task wording", () => {
  test("trade tasks are plain words and booked visits move to Coming up", () => {
    expect(tradeTask({ stage: "installation_scheduling", bookings: [], blockers: ["Install must start by Thu"] })).toEqual({ bucket: "needs_you", label: "Book the install with the owner", reason: "Install must start by Thu" });
    const soon = new Date(Date.now() + 86_400_000).toISOString();
    expect(tradeTask({ stage: "installation_booked", bookings: [{ kind: "installation", scheduled_start: soon }], blockers: [] }).bucket).toBe("coming_up");
    expect(tradeTask({ stage: "ap_review", bookings: [], blockers: [] }).bucket).toBe("waiting");
    expect(tradeTask({ stage: "installation_scheduling", bookings: [], blockers: [], trade: "electrician" }).label).toBe("Waiting for the installer");
    expect(tradeTask({ stage: "piesa_scheduled", bookings: [], blockers: [], trade: "electrician" }).bucket).toBe("needs_you");
  });
  test("trade screens no longer show stage codes, SLA or deposit badges", () => {
    const page = readFileSync("src/routes/_authenticated/field.index.tsx", "utf8") + readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
    for (const bad of ["StageBadge", "SlaPill", "UrgencyBadge", "Deposit cleared", "Mitti record ID"]) expect(page).not.toContain(bad);
  });
  test("worker link page uses the approved contact rule, not portal-only wording", () => {
    const w = readFileSync("src/routes/w.$token.tsx", "utf8");
    expect(w).not.toContain("no calls or outside texts");
    expect(w).not.toContain("hidden automatically");
    expect(w).toContain("Use these contact details only to arrange and complete this Home Insulation Victoria job.");
  });
});

describe("Add your own customer", () => {
  const area = (p: Partial<A1Area> = {}): A1Area => ({ name: "Main", length: "10", width: "8", existing: false, type: "", depth: "", depthPhoto: null, action: null, downlights: "4", hazards: "", hazardPhoto: null, ...p });
  const owner = { full_name: "Sam Owner", email: "sam@example.com", phone: "0400 000 000", address_line: "1 Test St", rough: "" };
  test("not visited needs only owner details and a rough size", () => {
    expect(addCustomerProblems({ owner: { ...owner, rough: "90" }, progress: "not_visited", areas: [], how: "", roof5: null, sketch: false, access: false, lines: [], agreed: null })).toEqual([]);
  });
  test("measured needs sketch, R5 line and removal line when removing", () => {
    const p = addCustomerProblems({ owner, progress: "measured", areas: [area({ existing: true, type: "batts", depth: "50", depthPhoto: "d.jpg", action: "remove" })], how: "tape", roof5: false, sketch: false, access: true, lines: [{ code: "R5_BATTS", qty: 80 }], agreed: null });
    expect(p).toContain("Area sketch or floor plan");
    expect(p).toContain("A removal price line");
    expect(areaTotal([area(), area({ length: "2", width: "3" })])).toBe(86);
  });
});

describe("Trade sign-in", () => {
  test("invite email approved by Jo 27 Oct 2026 (decision 406); only approved workers get access", () => {
    expect(TRADE_INVITE_EMAIL_APPROVED).toBe(true);
    const w = { email: "a@b.com", approval_status: "approved", removed_at: null, trade_role: "installer", certification_status: "verified" };
    expect(tradeAccessBlocker(w, true)).toBeNull();
    expect(tradeAccessBlocker({ ...w, approval_status: "pending" }, true)).not.toBeNull();
    expect(tradeAccessBlocker({ ...w, certification_status: "unverified" }, true)).not.toBeNull();
    expect(tradeAccessBlocker(w, false)).not.toBeNull();
    expect(memberRoleFor("Boss@Biz.com", "boss@biz.com")).toBe("business_admin");
    expect(grantedRole("electrician")).toBe("electrician");
  });
  test("invite email (approved design): greeting once, set-password button, sign-in link, no unsubscribe", () => {
    const m = renderTradeInviteEmail({ firstName: "Sam", business: "Sample <Co>", setPasswordUrl: "https://x/reset-password?token_hash=T", signInUrl: "https://x/auth" });
    expect(m.subject).toBe("Set up your Home Insulation Victoria sign-in");
    expect(m.html.match(/Hi Sam,/g)?.length).toBe(1);
    expect(m.html).toContain('href="https://x/reset-password?token_hash=T"');
    expect(m.html).toContain('href="https://x/auth"');
    expect(m.html).toContain("Sample &lt;Co&gt;");
    expect(m.html).not.toMatch(/unsubscribe/i);
    expect(m.text).toContain("Set my password: https://x/reset-password?token_hash=T");
    expect(m.text).toContain("After that, sign in at https://x/auth with this email to see your jobs.");
  });
  test("sign-in page offers reset and email link, without the Operations label", () => {
    const a = readFileSync("src/components/portal/SignInCard.tsx", "utf8");
    expect(a).toContain("Forgot password?");
    expect(a).toContain("Email me a sign-in link");
    expect(a).toContain("shouldCreateUser: false");
    expect(a).not.toContain(">Operations<");
  });
  test("TEST sign-ins and TEST businesses always create qa_test jobs", () => {
    const s = readFileSync("src/lib/pilot.server.ts", "utf8");
    expect(s).toContain('testUser || testBiz ? "qa_test" : fallback');
    for (const f of ["src/lib/portal.functions.ts", "src/lib/partner-import.server.ts"]) expect(readFileSync(f, "utf8")).toContain("intakeSourceFor(");
  });
});
