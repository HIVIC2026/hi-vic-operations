// Decision 378 (Jo 25 Oct 2026): Jobs › Choose installer — one table, headings sort AND filter, one search box,
// Coverage column (installer / electrician), Needs me folds its rows into one link (one pile per job).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  INSTALLER_WAITING_COLUMNS, activeWaitingFilters, chooseInstallersLinkLabel, coverageLookup, foldChooseInstaller, installerWaiting,
  matchesWaitingFilters, matchesWaitingSearch, partnerCoversJob, sortWaiting, suburbLabel, waitingAge, waitingSinceLabel, waitingSize, waitingView,
  type InstallerWaitingRow, type WaitingPartner,
} from "../src/lib/installer-waiting-columns.core";
import { buildNeedsRows, type NeedsFacts } from "../src/lib/office-needs.core";

const NOW = Date.parse("2026-10-25T02:00:00Z");
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const row = (o: Partial<InstallerWaitingRow> = {}): InstallerWaitingRow => ({
  id: o.id ?? "a", jobNumber: "HV-3001", ownerName: "Nadia Petrova", suburb: "Lilydale", postcode: "3140", areaM2: 140, areaKind: "website",
  insulation: "no", estimateDollars: 3980, spotSavedAt: iso(3 * DAY), waitingFrom: iso(3 * DAY), coverage: { installer: true, electrician: true }, lastOffer: null, isTest: false, ...o,
});

test("eight columns in Jo's order, each sorts and filters", () => {
  expect(INSTALLER_WAITING_COLUMNS.map((c) => [c.key, c.label, c.filter])).toEqual([
    ["job", "Job", "text"], ["owner", "Owner", "text"], ["suburb", "Suburb (postcode)", "text"], ["size", "Size (m²)", "range"],
    ["insulation", "Insulation", "pick"], ["estimate", "Estimate", "range"], ["waiting", "Waiting since", "pick"], ["coverage", "Coverage", "pick"],
  ]);
  const cov = INSTALLER_WAITING_COLUMNS.find((c) => c.key === "coverage")!;
  expect(cov.filter === "pick" && cov.options.map((o) => cov.labels[o])).toEqual(["No installer", "No electrician", "Both covered"]);
  const ins = INSTALLER_WAITING_COLUMNS.find((c) => c.key === "insulation")!;
  expect(ins.filter === "pick" && ins.options.map((o) => ins.labels[o])).toEqual(["No", "Some", "Not sure"]);
});

test("filters: text, ranges, picks, waiting age and coverage", () => {
  const r = row();
  expect(matchesWaitingFilters(r, {}, NOW)).toBe(true);
  expect(matchesWaitingFilters(r, { suburb: "3140" }, NOW)).toBe(true);
  expect(matchesWaitingFilters(r, { suburb: "clayton" }, NOW)).toBe(false);
  expect(matchesWaitingFilters(r, { size: { min: 150 } }, NOW)).toBe(false);
  expect(matchesWaitingFilters(r, { estimate: { max: 4000 } }, NOW)).toBe(true);
  expect(matchesWaitingFilters(r, { insulation: ["some"] }, NOW)).toBe(false);
  expect(matchesWaitingFilters(r, { waiting: ["week"] }, NOW)).toBe(true);
  expect(matchesWaitingFilters(r, { waiting: ["today", "older"] }, NOW)).toBe(false);
  expect(matchesWaitingFilters(r, { coverage: ["both"] }, NOW)).toBe(true);
  expect(matchesWaitingFilters(r, { coverage: ["no_installer"] }, NOW)).toBe(false);
  const gap = row({ coverage: { installer: false, electrician: true } });
  expect(matchesWaitingFilters(gap, { coverage: ["no_installer"] }, NOW)).toBe(true);
  expect(matchesWaitingFilters(gap, { coverage: ["no_electrician", "both"] }, NOW)).toBe(false);
  expect(activeWaitingFilters({ owner: " ", size: {}, coverage: ["both"], waiting: ["today"] })).toEqual(["waiting", "coverage"]);
});

test("one search box: owner, suburb, postcode, job number", () => {
  const r = row();
  for (const q of ["petrova", "LILYDALE", "3140", "hv-3001", ""]) expect(matchesWaitingSearch(r, q)).toBe(true);
  expect(matchesWaitingSearch(r, "doyle")).toBe(false);
});

test("default sort is waiting longest first; blanks last; ties keep the longest wait", () => {
  const a = row({ id: "a", waitingFrom: iso(1 * DAY), estimateDollars: null });
  const b = row({ id: "b", waitingFrom: iso(9 * DAY), estimateDollars: 5000 });
  const c = row({ id: "c", waitingFrom: iso(4 * DAY), estimateDollars: 2000, coverage: { installer: false, electrician: false } });
  expect(waitingView([a, b, c], { search: "", filters: {}, sort: "", dir: "desc" }, NOW).map((r) => r.id)).toEqual(["b", "c", "a"]);
  expect(sortWaiting([a, b, c], "waiting", "desc").map((r) => r.id)).toEqual(["a", "c", "b"]);
  expect(sortWaiting([a, b, c], "estimate", "asc").map((r) => r.id)).toEqual(["c", "b", "a"]);
  expect(sortWaiting([a, b, c], "estimate", "desc").map((r) => r.id)).toEqual(["b", "c", "a"]);
  expect(sortWaiting([a, b, c], "coverage", "asc").map((r) => r.id)).toEqual(["c", "b", "a"]);
  expect(sortWaiting([a, b, c], "nonsense", "asc").map((r) => r.id)).toEqual(["b", "c", "a"]);
});

test("labels: waiting since relative + date, suburb (postcode), size measured beats website", () => {
  expect(waitingSinceLabel(iso(3 * DAY + 3_600_000), NOW)).toEqual({ relative: "3 days", date: "22 Oct" });
  expect(waitingSinceLabel(iso(5 * 3_600_000), NOW).relative).toBe("5 hours");
  expect(waitingSinceLabel(iso(60_000), NOW).relative).toBe("just now");
  expect(waitingAge(iso(2 * 3_600_000), NOW)).toBe("today");
  expect(waitingAge(iso(10 * DAY), NOW)).toBe("older");
  expect(suburbLabel({ suburb: "Clayton", postcode: "3168" })).toBe("Clayton (3168)");
  expect(suburbLabel({ suburb: "", postcode: "3168" })).toBe("(3168)");
  expect(suburbLabel({ suburb: "", postcode: "" })).toBe("—");
  expect(waitingSize({ measuredM2: 132, savedM2: 140, estimatedM2: 150 })).toEqual({ areaM2: 132, areaKind: "measured" });
  expect(waitingSize({ measuredM2: null, savedM2: null, estimatedM2: 150 })).toEqual({ areaM2: 150, areaKind: "website" });
  expect(waitingSize({ measuredM2: 0, savedM2: null, estimatedM2: null })).toEqual({ areaM2: null, areaKind: null });
});

test("membership = the Needs me Choose installer rule (our lead, ready to schedule, no installer, nothing open)", () => {
  const base = { channel: "hivic_sourced", stage: "ready_check_ready_to_schedule", deleted: false, archived: false, hasInstaller: false, offers: [] };
  expect(installerWaiting(base)).toEqual({ lastOffer: null });
  expect(installerWaiting({ ...base, channel: "installer_sourced" })).toBeNull();
  expect(installerWaiting({ ...base, stage: "ready_check_scheduled" })).toBeNull();
  expect(installerWaiting({ ...base, hasInstaller: true })).toBeNull();
  expect(installerWaiting({ ...base, deleted: true })).toBeNull();
  expect(installerWaiting({ ...base, offers: [{ status: "pending", offered_at: iso(DAY) }] })).toBeNull();
  expect(installerWaiting({ ...base, offers: [{ status: "declined", offered_at: iso(DAY), business_name: "Acme" }] })).toEqual({ lastOffer: { status: "declined", name: "Acme" } });
});

const cred = (kind: string) => ({ kind, label: kind, expires_at: "2030-01-01", critical: true, verification: "verified" });
const installer = (o: Partial<WaitingPartner> = {}): WaitingPartner => ({
  id: "i1", name: "Acme Insulation", business_type: "eec_installer", capabilities: ["installer"], onboarding_status: "approved", is_active: true,
  service_postcodes: ["3140", "316*"], coverage_verified_at: "2026-10-01", free_measureups_for_hivic_quote_leads: true, accepting_new_jobs: true, receives_hivic_leads: true,
  onboarding_notes: null, credentials: [cred("public_liability_insurance"), cred("installer_certification")], ...o,
});
const rec = (o: Partial<WaitingPartner> = {}): WaitingPartner => ({
  id: "r1", name: "Sparky REC", business_type: "rec", capabilities: ["electrician"], onboarding_status: "approved", is_active: true,
  service_postcodes: ["3140"], coverage_verified_at: "2026-10-01", accepting_new_jobs: true, receives_hivic_leads: true, onboarding_notes: null,
  credentials: [cred("public_liability_insurance"), cred("electrical_licence"), cred("rec_registration")], piesaRate: true, approvedElectricians: 1, ...o,
});
const at = new Date(NOW);

test("installer coverage: approved, verified area incl. wildcard, takes our leads, not paused, documents current", () => {
  const live = { postcode: "3140", isTest: false };
  expect(partnerCoversJob(installer(), "installer", live, at)).toBe(true);
  expect(partnerCoversJob(installer(), "installer", { postcode: "3168", isTest: false }, at)).toBe(true);
  expect(partnerCoversJob(installer(), "installer", { postcode: "3000", isTest: false }, at)).toBe(false);
  expect(partnerCoversJob(installer({ coverage_verified_at: null }), "installer", live, at)).toBe(false);
  expect(partnerCoversJob(installer({ onboarding_status: "pending" }), "installer", live, at)).toBe(false);
  expect(partnerCoversJob(installer({ accepting_new_jobs: false }), "installer", live, at)).toBe(false);
  expect(partnerCoversJob(installer({ receives_hivic_leads: false }), "installer", live, at)).toBe(false);
  expect(partnerCoversJob(installer({ free_measureups_for_hivic_quote_leads: false }), "installer", live, at)).toBe(false);
  expect(partnerCoversJob(installer({ credentials: [cred("installer_certification")] }), "installer", live, at)).toBe(false);
  expect(partnerCoversJob(installer(), "electrician", live, at)).toBe(false);
});

test("electrician coverage: approved REC with an active PIESA rate and an approved electrician", () => {
  const live = { postcode: "3140", isTest: false };
  expect(partnerCoversJob(rec(), "electrician", live, at)).toBe(true);
  expect(partnerCoversJob(rec({ piesaRate: false }), "electrician", live, at)).toBe(false);
  expect(partnerCoversJob(rec({ approvedElectricians: 0 }), "electrician", live, at)).toBe(false);
  expect(partnerCoversJob(rec(), "electrician", { postcode: null, isTest: false }, at)).toBe(false);
});

test("TEST partners only count for TEST jobs, and real partners never for TEST jobs", () => {
  const t = { onboarding_notes: "[TEST PARTNER] practice" };
  const look = coverageLookup([installer(t), rec()], at);
  expect(look("3140", false)).toEqual({ installer: false, electrician: true });
  expect(look("3140", true)).toEqual({ installer: true, electrician: false });
  expect(coverageLookup([], at)("3140", false)).toEqual({ installer: false, electrician: false });
});

test("Needs me folds Choose installer rows into ONE link and keeps every other row (one pile per job)", () => {
  const f = (id: string, extra: Partial<NeedsFacts>): NeedsFacts => ({ jobId: id, jobNumber: id, surname: "X", suburb: null, ...extra });
  const groups = buildNeedsRows({ now: NOW, jobs: [
    f("HV-1", { spotSaved: { at: iso(2 * DAY) } }),
    f("HV-2", { spotSaved: { at: iso(DAY) } }),
    f("HV-3", { electricianToChoose: { at: iso(DAY), usual: null } }),
    f("HV-4", { spotSaved: { at: iso(DAY) }, sendFailed: { at: iso(DAY), text: "email bounced" } }),
  ] });
  const week = foldChooseInstaller(groups.week);
  expect(week.chooseInstaller.map((r) => r.jobId)).toEqual(["HV-1", "HV-2"]);
  expect(week.rows.map((r) => r.jobId)).toEqual(["HV-3"]);
  expect(groups.today.map((r) => r.jobId)).toEqual(["HV-4"]);
  const seen = [...groups.today, ...week.rows, ...week.chooseInstaller, ...groups.watch].map((r) => r.jobId);
  expect(new Set(seen).size).toBe(seen.length);
  expect(chooseInstallersLinkLabel(2)).toBe("Choose installers (2)");
});

test("the screen uses the shared heading popover, one search box, and the existing Choose installer panel", () => {
  const src = readFileSync("src/components/portal/InstallerWaitingScreen.tsx", "utf8");
  expect(src).toContain("ColumnHead");
  expect(src).toContain("ChooseInstallerPanel");
  expect(src).not.toContain("ChipGroup");
  expect(src).not.toContain("FilterPanel");
  expect(src.match(/type="search"/g)?.length).toBe(1);
  const needs = readFileSync("src/routes/_authenticated/admin.needs-me.tsx", "utf8");
  expect(needs).toContain("foldChooseInstaller");
  expect(needs).toContain("INSTALLER_WAITING_PATH");
});
