import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { appointmentSla, directBookingBlocker, electricianReassignmentRoute, manualVisitKind, proposalResponse } from "../src/lib/pilot.core";

const now = new Date("2026-09-28T12:00:00Z");
const at = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const fnBody = (file: string, name: string) => { const s = src(file); const i = s.indexOf(`export const ${name} =`); return s.slice(i, s.indexOf("export const", i + 10)); };

describe("assessment scheduling has one normal path", () => {
  test("owner and field views do not expose a direct assessment booking form", () => {
    expect(src("src/routes/_authenticated/field.$jobId.tsx")).not.toMatch(/BookingPanel[^>]*kind="assessment"/);
    const owner = src("src/routes/_authenticated/owner.$jobId.tsx");
    expect(owner).toContain(': null; // legacy assessment bookings retired');
    expect(owner).not.toContain("<AppointmentPanel"); // legacy assessment appointments retired
  });
  test("admin assessment BookingPanel is read-only; override is separately labelled", () => {
    const a = src("src/routes/_authenticated/admin.jobs.$jobId.tsx");
    expect(a).not.toMatch(/kind="assessment" canBook isAdmin/);
    expect(src("src/components/portal/partner.tsx")).toContain("Admin override / set booking directly");
  });
  test("direct assessment booking: non-admin rejected, admin needs reason", () => {
    expect(directBookingBlocker("assessment", "owner", "x".repeat(10))).toMatch(/proposing a time/);
    expect(directBookingBlocker("assessment", "electrician")).toMatch(/proposing a time/);
    expect(directBookingBlocker("assessment", "admin")).toMatch(/reason/);
    expect(directBookingBlocker("assessment", "admin", "Owner phoned, electrician confirmed")).toBeNull();
    expect(directBookingBlocker("installation", "installer")).toBeNull();
    expect(directBookingBlocker("rectification", "electrician")).toBeNull();
  });
  test("createBooking enforces the blocker and audits the override", () => {
    const b = fnBody("src/lib/portal.functions.ts", "createBooking");
    expect(b).toContain("directBookingBlocker(");
    expect(b).toContain('"admin_booking_override"');
    expect(b).toContain("confirmBooking(");
  });
  test("decision 220: the hidden by-hand visit time also covers the Ready Check (admin only, reason required, logged)", () => {
    expect(directBookingBlocker("ready_check", "installer", "x".repeat(10))).toMatch(/agreed between the owner and the installer/);
    expect(directBookingBlocker("ready_check", "owner", "x".repeat(10))).toMatch(/agreed/);
    expect(directBookingBlocker("ready_check", "admin")).toMatch(/reason/);
    expect(directBookingBlocker("ready_check", "admin", "Owner phoned, installer agreed Tue 9am")).toBeNull();
    expect(manualVisitKind("ready_check_ready_to_schedule")).toBe("ready_check");
    expect(manualVisitKind("ready_check_scheduled")).toBe("ready_check");
    expect(manualVisitKind("piesa_and_install_window_pending")).toBe("assessment");
    expect(manualVisitKind("piesa_scheduled")).toBe("assessment");
    expect(manualVisitKind("quote_ready")).toBeNull();
    expect(manualVisitKind("cancelled")).toBeNull();
    const b = fnBody("src/lib/portal.functions.ts", "createBooking");
    expect(b).toContain('"ready_check"');
    expect(b).toMatch(/override = data\.kind === "assessment" \|\| data\.kind === "ready_check"/);
    expect(b).toContain("onReadyCheckBooked(");
    const ui = src("src/components/portal/office-job.tsx");
    expect(ui).toContain("manualVisitKind(h.stage)");
    expect(ui).toContain("<AdminBookingOverride jobId={h.jobId} kind={visitKind} />");
  });
  test("accepting a proposal goes through central confirmBooking (which sets booking_confirmed_at)", () => {
    expect(fnBody("src/lib/pilot.functions.ts", "respondToProposal")).toContain("confirmBooking(");
    expect(src("src/lib/booking.server.ts")).toContain("booking_confirmed_at");
    expect(proposalResponse({ id: "1", status: "proposed", proposer_role: "electrician", starts_at: "2026-10-01T00:00:00Z" }, "owner", "accept", now)).toBeNull();
    expect(proposalResponse({ id: "1", status: "superseded", proposer_role: "electrician", starts_at: "2026-10-01T00:00:00Z" }, "owner", "accept", now)).toMatch(/no longer open/);
  });
  test("new proposal supersedes open proposals", () => {
    expect(fnBody("src/lib/pilot.functions.ts", "proposeTime")).toContain('status: "superseded"');
  });
});

describe("24/48h responsiveness", () => {
  test("24h without response = monitoring, no reassignment", () => {
    const s = appointmentSla({ assigned_at: at(25) }, now);
    expect(s.state).toBe("attention");
    expect(s.canRequestAnother).toBe(false);
    expect(s.message).toBe("No response for 24 hours — Home Insulation Victoria is monitoring this");
  });
  test("48h without meaningful contact = exception, reassignment allowed", () => {
    const s = appointmentSla({ assigned_at: at(49) }, now);
    expect(s.canRequestAnother).toBe(true);
    expect(s.message).toBe("No meaningful contact after 48 hours — request another electrician");
  });
  test("a reply alone does not stop the 48h clock: no confirmed booking = exception", () => {
    const s = appointmentSla({ assigned_at: at(49), first_response_at: at(40) }, now);
    expect(s.state).toBe("exception");
    expect(s.canRequestAnother).toBe(true);
    expect(s.message).toBe("No booking confirmed after 48 hours — request another electrician");
  });
  test("a reply still clears the 24h monitoring message", () => {
    expect(appointmentSla({ assigned_at: at(30), first_response_at: at(20) }, now).message).toBe("Electrician made contact");
  });
  test("cannot attend = immediate eligibility", () => {
    const s = appointmentSla({ assigned_at: at(2), cannot_attend_at: at(1) }, now);
    expect(s.canRequestAnother).toBe(true);
    expect(s.message).toBe("Electrician can't attend in time — request another electrician");
  });
  test("confirmed booking stops the clock", () => {
    expect(appointmentSla({ assigned_at: at(100), first_response_at: at(90), booking_confirmed_at: at(1) }, now).state).toBe("booked");
  });
  test("an office-entered confirmed booking clears the 48h flag", () => {
    const s = appointmentSla({ assigned_at: at(49), booking_confirmed_at: at(1) }, now);
    expect(s.state).toBe("booked");
    expect(s.canRequestAnother).toBe(false);
  });
});

describe("reassignment", () => {
  test("early can't-agree request is review only", () => {
    expect(electricianReassignmentRoute("owner", appointmentSla({ assigned_at: at(10) }, now))).toBe("review");
    const body = fnBody("src/lib/portal.functions.ts", "requestReassignment");
    expect(body).toContain("cantAgreeTime");
    expect(body).not.toContain('from("job_assignments")');
  });
  test("release only after 48h/cannot-attend for non-admins; server enforces it", () => {
    expect(electricianReassignmentRoute("owner", appointmentSla({ assigned_at: at(50) }, now))).toBe("release");
    expect(electricianReassignmentRoute("admin", appointmentSla({ assigned_at: at(1) }, now))).toBe("release");
    const body = fnBody("src/lib/pilot.functions.ts", "requestAnotherElectrician");
    expect(body).toContain("sla.canRequestAnother");
    expect(body).toContain('status: "superseded"');
    expect(body).toContain("active: false"); // history kept: assignment ended, not deleted
    expect(body).not.toContain(".delete(");
  });
  test("owner generic control is installer-only", () => {
    const owner = src("src/routes/_authenticated/owner.$jobId.tsx");
    expect(owner).toContain('role: "installer"');
    expect(owner).not.toContain('["electrician", "installer"] as const');
  });
  test("existing deposit/PIESA/ESC booking gates untouched", () => {
    const b = src("src/lib/booking.server.ts");
    expect(b).toContain("installationDateBlocker(");
    expect(b).toContain("bookingLeadBlocker(");
    expect(b).toContain("paymentGate(");
    expect(b).toContain("commercialBlocker(");
  });
});
