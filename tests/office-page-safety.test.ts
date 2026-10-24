// Jo 23 Oct 2026: office job page safety — global switches and other job types' controls never sit on a job.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
const read = (f: string) => readFileSync(f, "utf8");

test("no Ready Check booking switch or offer button sits on a job page (decision 53, audit removal 5)", () => {
  // The Settings "Owner Ready Check booking" switch component is gone too (decision 53, audit removal 5).
  expect(existsSync("src/components/portal/ready-check-booking-access.tsx")).toBe(false);
  expect(read("src/routes/_authenticated/admin.save-my-spot-rules.tsx")).not.toMatch(/OwnerReadyCheckBookingSetting|Owner Ready Check booking/);
  for (const f of ["src/components/portal/office-job.tsx", "src/routes/_authenticated/admin.jobs.$jobId.tsx"]) expect(read(f)).not.toMatch(/OfficeReadyCheckBooking|setOwnerReadyCheckBookingEnabled/);
});

test("no job shows Generate installer quotes or the internal pricing table (quotes are prepared on Mitti Complete; audit removals 1/10)", () => {
  for (const f of ["src/components/portal/office-job.tsx", "src/components/portal/office-job-parts.tsx", "src/routes/_authenticated/admin.jobs.$jobId.tsx"]) {
    expect(read(f)).not.toContain("generateInstallerQuotes");
    expect(read(f)).not.toContain("Internal pricing (admin only)");
  }
});
test("no dead buttons: ESC adapter submit (no adapter exists) and owner rows that went nowhere are gone", () => {
  expect(read("src/components/portal/intelligence.tsx")).not.toContain("Submit via ESC adapter");
  expect(read("src/routes/my-job.$token.tsx")).not.toContain("function BottomList");
});

test("audit removals 4 and 7: no deposit-request button or owner instalment card; no separate post-install installer declaration form or owner-signs-again switch", async () => {
  expect(read("src/components/portal/panels.tsx")).not.toMatch(/Mark deposit request raised|markDepositRequestRaised/);
  expect(existsSync("src/components/portal/instalment-plan.tsx")).toBe(false);
  expect(read("src/routes/_authenticated/owner.$jobId.tsx")).not.toContain("InstalmentPlanCard");
  const { ACTIVITY_48_FORMS } = await import("../src/lib/template-catalog");
  expect(ACTIVITY_48_FORMS.map((f) => f.name)).not.toContain("Installer Declaration");
  for (const f of ["src/components/portal/compliance-versions.tsx", "src/components/portal/owner-documents.tsx", "src/routes/_authenticated/admin.settings.tsx"]) {
    expect(read(f)).not.toMatch(/<Switch[^>]*>[^<]*[Ss]igns? again/);
    expect(read(f)).not.toMatch(/ownerSignsAgain|owner_signs_again|setOwnerResign/);
  }
});

test("A10: the job coverage link opens Partners › Coverage (decision 229), not the legacy /admin/coverage redirect", () => {
  const parts = read("src/components/portal/office-job-parts.tsx");
  expect(parts).toContain(`<Link to="/admin/partners" search={{ tab: "coverage" }}>Partners › Coverage</Link>`);
  expect(parts).not.toContain(`to="/admin/coverage"`);
});
