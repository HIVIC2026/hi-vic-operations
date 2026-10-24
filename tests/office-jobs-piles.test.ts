import { expect, test } from "bun:test";
import { closedWhy, enquiryPile, ENQUIRY_PILES, jobsStage, JOBS_STAGES, reopenBlocker, waitingOnLine } from "../src/lib/office-jobs.core";
import { JOB_STAGES } from "../src/lib/job-list-page.core";

// Decision 239 + Jo's firm rule (21 Oct): one pile per job.
test("Jobs: every open stage maps to exactly one of the six stages; spot saved without installer is Choose installer", () => {
  expect(JOBS_STAGES.map((s) => s.label)).toEqual(["Choose installer", "Ready Check", "Quote", "PIESA", "Install", "Final check"]);
  for (const stage of JOB_STAGES) {
    const s = jobsStage({ stage, hasInstaller: true, priorStage: "ready_check_scheduled" });
    if (stage === "complete" || stage === "cancelled") expect(s).toBeNull();
    else expect(s).not.toBeNull();
  }
  expect(jobsStage({ stage: "preliminary_estimate_ready", hasInstaller: false })).toBe("choose_installer");
  expect(jobsStage({ stage: "ready_check_ready_to_schedule", hasInstaller: false })).toBe("choose_installer");
  expect(jobsStage({ stage: "ready_check_ready_to_schedule", hasInstaller: true })).toBe("ready_check");
  expect(jobsStage({ stage: "ready_check_complete", hasInstaller: true })).toBe("quote");
  expect(jobsStage({ stage: "measured_quote_accepted", hasInstaller: true })).toBe("piesa");
  expect(jobsStage({ stage: "piesa_complete", hasInstaller: true })).toBe("install");
  expect(jobsStage({ stage: "evidence_outstanding", hasInstaller: true })).toBe("install");
  expect(jobsStage({ stage: "ap_review", hasInstaller: true })).toBe("final_check");
  expect(jobsStage({ stage: "on_hold", priorStage: "installation_booked", hasInstaller: true })).toBe("install");
});

test("Enquiries: exactly two piles, every enquiry in one of them", () => {
  expect(ENQUIRY_PILES.map((p) => p.label)).toEqual(["Fix details", "Waiting on owner"]);
  const samples = [
    { fullName: "jo", addressLine: "12 wattle st clayton", suburb: null, postcode: null },
    { fullName: "MARGARET DOYLE", addressLine: "8 Carrington Rd, Box Hill 3128", suburb: null, postcode: null },
    { fullName: "asdf", addressLine: "15 Lum Road Wheelers Hill 3150", suburb: null, postcode: null },
    { fullName: "Nadia Petrova", addressLine: "3 Lakeview Drive", suburb: "Lilydale", postcode: "3140" },
    { fullName: "Aisha Karim", addressLine: "unit 3/22 High Street Road", suburb: null, postcode: null },
  ];
  const piles = samples.map(enquiryPile);
  expect(piles).toEqual(["fix_details", "waiting_owner", "fix_details", "waiting_owner", "fix_details"]);
  for (const p of piles) expect(ENQUIRY_PILES.filter((x) => x.key === p)).toHaveLength(1);
});

test("Waiting on column", () => {
  const base = { enquiryStatus: "offered_spot", needsFirstResponse: false, reminders: 0, answeredQuestions: false, latestFailed: false };
  expect(waitingOnLine({ ...base, latestSend: { purpose: "existing_leads_launch_v1", at: "2026-10-23T23:00:00Z", status: "sent" } })).toBe("Spot offered 24 Oct");
  expect(waitingOnLine({ ...base, reminders: 1, latestSend: { purpose: "save_spot_reminder", at: "2026-10-21T00:00:00Z", status: "sent" } })).toBe("Spot offered 21 Oct · reminder 1 sent");
  expect(waitingOnLine({ ...base, enquiryStatus: "insulation_requested", latestSend: { purpose: "x", at: "2026-10-20T00:00:00Z", status: "sent" } })).toBe("Asked the 3 questions 20 Oct · no answer");
  expect(waitingOnLine({ ...base, needsFirstResponse: true, latestSend: null })).toBe("Estimate goes out automatically");
  expect(waitingOnLine({ ...base, latestFailed: true, latestSend: null })).toBe("Estimate email failed · on Needs me");
});

test("Closed: why + reopen rules (decision 227)", () => {
  expect(closedWhy({ stage: "cancelled", cancelledReason: "Owner changed mind · selling the house", installedAt: null, veecSubmittedAt: null, source: "base44", removed: false })).toBe("Owner changed mind · selling the house");
  expect(closedWhy({ stage: "complete", cancelledReason: null, installedAt: "2026-10-16T00:00:00Z", veecSubmittedAt: "2026-10-20T00:00:00Z", source: "base44", removed: false })).toBe("Install complete 16 Oct · VEEC lodged 20 Oct");
  expect(closedWhy({ stage: "cancelled", cancelledReason: null, installedAt: null, veecSubmittedAt: null, source: "qa_test", removed: false })).toBe("Marked as test");
  const retired = (s: string) => (s === "assessment_booking" ? "retired" : null);
  expect(reopenBlocker({ stage: "cancelled", priorStage: "measured_estimate_ready", retired })).toBeNull();
  expect(reopenBlocker({ stage: "cancelled", priorStage: null, retired })).toMatch(/no earlier stage/);
  expect(reopenBlocker({ stage: "cancelled", priorStage: "assessment_booking", retired })).toMatch(/retired/);
  expect(reopenBlocker({ stage: "complete", priorStage: "ready_for_veec", retired })).toMatch(/final/);
});
