import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chaseMode, forViewer, jobStatusLine, jobTimeline, needsChasing, reminderRequestMessage, toneFor, type StatusFacts } from "../src/lib/job-status.core";

const now = new Date("2026-10-08T02:00:00Z"); // Thu 8 Oct, Melbourne noon-ish
const base = (p: Partial<StatusFacts>): StatusFacts => ({ stage: "new_enquiry", stageSince: null, now, staff: false, bookings: [], quoteSentAt: null, quoteAcceptedAt: null, safetyPaidAt: null, ownerTimesChosenAt: null, rectQuoteSentAt: null, paidInFullAt: null, apApprovedAt: null, safetyPay: { kind: "unknown" }, payout: null, ...p });
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe("trade job status line (Jo 7 Oct)", () => {
  test("owner payment: date, waiting, who; rose after 3 days", () => {
    const l = jobStatusLine(base({ stage: "measured_quote_accepted", quoteAcceptedAt: "2026-10-04T23:00:00Z" }));
    expect(l.text).toBe("Quote accepted – waiting for owner's payment · sent Mon 5 Oct · waiting 3 days · Owner");
    expect(l.tone).toBe("rose");
    expect(needsChasing(l)).toBe(true);
  });
  test("amber when longer than usual, ok when fresh", () => {
    expect(toneFor("Owner", daysAgo(2.5), now)).toBe("amber");
    expect(toneFor("Owner", daysAgo(1), now)).toBe("ok");
    expect(toneFor("Electrician", daysAgo(1.5), now)).toBe("amber");
    expect(toneFor("Electrician", daysAgo(3), now)).toBe("rose");
    expect(toneFor("Home Insulation Victoria", daysAgo(6), now)).toBe("rose");
  });
  test("staff never see amounts", () => {
    const l = jobStatusLine(base({ stage: "measured_quote_accepted", quoteAcceptedAt: daysAgo(1), staff: true, safetyPaidAt: null }));
    expect(l.text).not.toContain("$");
    const s = jobStatusLine(base({ stage: "installation_scheduling", staff: true, safetyPaidAt: daysAgo(5) }));
    expect(s.money).toBeNull();
    expect(jobTimeline(base({ staff: true })).map((x) => x.label).join(" ")).not.toMatch(/\$|50%/);
  });
  test("owner choosing times, and booked safety check names the business", () => {
    expect(jobStatusLine(base({ stage: "piesa_and_install_window_pending", safetyPaidAt: daysAgo(1) })).text).toBe("Owner choosing PIESA times · since Wed 7 Oct · waiting 1 day · Owner");
    const b = jobStatusLine(base({ stage: "piesa_scheduled", bookings: [{ kind: "assessment", status: "confirmed", start: "2026-10-12T21:00:00Z", end: "2026-10-12T23:00:00Z", business: "Example Electrical", mine: false }] }));
    expect(b.text).toBe("PIESA booked · Tue 13 Oct, 8–10am · Example Electrical");
    expect(b.tone).toBe("ok");
  });
  test("install booked shows You for the viewer's own booking, and the balance line", () => {
    const f = base({ stage: "installation_booked", safetyPaidAt: daysAgo(4), bookings: [{ kind: "installation", status: "confirmed", start: "2026-10-15T21:00:00Z", end: null, business: "Reinsulate", mine: true }] });
    const l = jobStatusLine(f);
    expect(l.text).toBe("Install booked · Fri 16 Oct, 8am · You");
    expect(l.money).toBe("Owner payment — office checks the agreed payment option");
    expect(jobStatusLine(base({ stage: "installation_scheduling", safetyPaidAt: daysAgo(1) })).money).toBe("Owner payment — office checks the agreed payment option");
    expect(forViewer(jobStatusLine(base({ stage: "installation_scheduling", stageSince: daysAgo(1) })), "installer").who).toBe("You");
  });
  test("fix quote, office check, payment coming", () => {
    expect(jobStatusLine(base({ stage: "awaiting_owner_rectification_approval", rectQuoteSentAt: "2026-10-04T01:00:00Z" })).text).toBe("Electrical fixes quote waiting for owner · sent Sun 4 Oct · waiting 4 days · Owner");
    expect(jobStatusLine(base({ stage: "ap_review", stageSince: "2026-10-07T01:00:00Z" })).text).toBe("Being checked by Home Insulation Victoria · since Wed 7 Oct");
    expect(jobStatusLine(base({ stage: "ready_for_veec", payout: { kind: "coming", on: "2026-10-24T01:00:00Z" } })).text).toBe("Payment coming Sat 24 Oct");
  });
  test("timeline: 10 steps, done dates, expected dates, fixes skipped when not needed", () => {
    const t = jobTimeline(base({ stage: "installation_booked", quoteAcceptedAt: daysAgo(6), safetyPaidAt: daysAgo(5), bookings: [
      { kind: "ready_check", status: "completed", start: daysAgo(9), end: null, business: null, mine: true },
      { kind: "assessment", status: "completed", start: daysAgo(3), end: null, business: "X", mine: false },
      { kind: "installation", status: "confirmed", start: "2026-10-15T21:00:00Z", end: null, business: null, mine: true }], payout: null }));
    expect(t.map((s) => s.key)).toEqual(["ready_check", "quote", "safety_paid", "safety_check", "fixes", "fixes_paid", "first_half", "install", "final_half", "checked", "paid"]);
    expect(t.find((s) => s.key === "fixes")!.dateLabel).toBe("Not needed");
    expect(t.find((s) => s.key === "safety_check")!.state).toBe("done");
    expect(t.find((s) => s.key === "install")!.dateLabel).toBe("Expected Fri 16 Oct");
  });
  test("contact rules: own customers vs Home Insulation Victoria leads", () => {
    expect(chaseMode({ channel: "installer_sourced", originatingBusinessId: "b1" }, "b1")).toBe("own_customer");
    expect(chaseMode({ channel: "hivic_sourced", originatingBusinessId: null }, "b1")).toBe("ask_office");
    expect(chaseMode({ channel: "installer_sourced", originatingBusinessId: "b2" }, "b1")).toBe("ask_office");
    expect(reminderRequestMessage({ jobNumber: "HV-1", status: "x", by: "Jo" })).toContain("HV-1");
  });
  test("wired: reminder goes to office Needs me (not a send); owner contacts only for own customers", () => {
    const s = readFileSync("src/lib/job-status.server.ts", "utf8");
    expect(s).toContain('from("partner_change_requests").insert');
    expect(s).not.toMatch(/sendEmail|sendSms|enqueue_external_action/);
    expect(s).toContain('if (mode === "own_customer")');
    expect(readFileSync("src/routes/_authenticated/field.index.tsx", "utf8")).toContain("Needs chasing");
  });
});
