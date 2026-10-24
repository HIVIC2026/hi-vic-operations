// Jo 23 Oct 2026: office job page safety — global switches and other job types' controls never sit on a job.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(f, "utf8");

test("no Ready Check booking switch or offer button sits on a job page (decision 53, audit removal 5)", () => {
  const job = read("src/components/portal/ready-check-booking-access.tsx");
  expect(job).not.toContain("export function OfficeReadyCheckBooking");
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
