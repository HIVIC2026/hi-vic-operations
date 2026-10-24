// Jo 23 Oct 2026: office job page safety — global switches and other job types' controls never sit on a job.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(f, "utf8");

test("the global owner Ready Check booking switch is on Settings, not on job pages", () => {
  const job = read("src/components/portal/ready-check-booking-access.tsx");
  const perJob = job.slice(job.indexOf("export function OfficeReadyCheckBooking"), job.indexOf("export function OwnerReadyCheckBookingSetting"));
  expect(perJob).not.toContain("setOwnerReadyCheckBookingEnabled");
  expect(perJob).not.toContain("<Switch");
  expect(read("src/routes/_authenticated/admin.save-my-spot-rules.tsx")).toContain("<OwnerReadyCheckBookingSetting />");
});

test("installer jobs never show HIV rate-card generation or the HIV margin table", () => {
  const page = read("src/routes/_authenticated/admin.jobs.$jobId.tsx");
  expect(page).toContain("<AdminQuotes jobId={jobId} installerJob={installerJob} />");
  expect(page).toContain('{!installerJob && <Button onClick={() => gen({ jobId }, "Installer quotes generated")}>');
  expect(page).toContain('{!installerJob && <Section title="Internal pricing (admin only)">');
});
test("no dead buttons: ESC adapter submit (no adapter exists) and owner rows that went nowhere are gone", () => {
  expect(read("src/components/portal/intelligence.tsx")).not.toContain("Submit via ESC adapter");
  expect(read("src/routes/my-job.$token.tsx")).not.toContain("function BottomList");
});
