// Jobs › Choose installer: the card's "Installer ✓", the header count and the pop-up must say the same thing as the
// places they point to (HV-1509: card said Installer ✓, pop-up said "No approved installers cover 3184").
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CHOOSE_LOAD_FAILED, choosePanelState, coverageLookup, installerCanBeOffered, waitingCounts, waitingCountLine,
  type InstallerWaitingRow, type WaitingInstaller,
} from "../src/lib/installer-waiting-columns.core";
import { installerOfferable } from "../src/lib/readycheck-booking.core";

const at = new Date("2026-10-25T02:00:00Z");
const inst = (o: Partial<WaitingInstaller> = {}): WaitingInstaller => ({
  id: "i1", name: "Acme Insulation", is_active: true, onboarding_status: "approved", accepting_new_jobs: true, receives_hivic_leads: true,
  coverage_verified_at: "2026-10-01", service_postcodes: ["3184"], free_measureups_for_hivic_quote_leads: true, onboarding_notes: null,
  credentialsOk: true, fullCertifiedInstallers: 1, ...o,
});
const site = { postcode: "3184", isTest: false };

test("HV-1509: a business that covers 3184 but has no Full-certified installer is NOT a tick (the pop-up can't release it)", () => {
  expect(installerCanBeOffered(inst(), site)).toBe(true);
  expect(installerCanBeOffered(inst({ fullCertifiedInstallers: 0 }), site)).toBe(false);
  expect(installerCanBeOffered(inst({ credentialsOk: false }), site)).toBe(false);
  expect(installerCanBeOffered(inst({ free_measureups_for_hivic_quote_leads: null }), site)).toBe(false);
  expect(installerCanBeOffered(inst({ accepting_new_jobs: false }), site)).toBe(false);
  expect(installerCanBeOffered(inst({ coverage_verified_at: null }), site)).toBe(false);
  expect(installerCanBeOffered(inst(), { postcode: "3000", isTest: false })).toBe(false);
  expect(installerCanBeOffered(inst({ onboarding_notes: "[TEST PARTNER]" }), site)).toBe(false);
  expect(coverageLookup([], at, [inst({ fullCertifiedInstallers: 0 })])("3184", false).installer).toBe(false);
  expect(coverageLookup([], at, [inst()])("3184", false).installer).toBe(true);
});

test("one rule: the pop-up's nearby list uses installerOfferable too", () => {
  const src = readFileSync("src/lib/offer-dispatch.functions.ts", "utf8");
  expect(src).toContain("installerOfferable(");
  const base = { business_id: "b", name: "B", is_active: true, onboarding_status: "approved", accepting_new_jobs: true, receives_hivic_leads: true,
    coverage_verified: true, covers_postcode: true, exact_postcode: true, has_valid_licence: true, approved_workers: 1, weekly_capacity: null,
    open_jobs: 0, recent_offers_30d: 0, acceptance_rate: null, freeMeasureUps: true };
  expect(installerOfferable(base)).toBe(true);
  expect(installerOfferable({ ...base, approved_workers: 0 })).toBe(false);
  expect(installerOfferable({ ...base, covers_postcode: false, exact_postcode: false })).toBe(false);
});

const row = (o: Partial<InstallerWaitingRow>): InstallerWaitingRow => ({
  id: "x", jobNumber: "HV-1", ownerName: "A", suburb: "Brighton", postcode: "3186", areaM2: null, areaKind: null, insulation: "no",
  estimateDollars: null, spotSavedAt: null, waitingFrom: "2026-10-20T00:00:00Z", coverage: { installer: true, electrician: false }, lastOffer: null, isTest: false, ...o,
});

test("header count: the 'to choose' part is the Needs me 'Choose installers' rule; released and came-back jobs are named", () => {
  const rows = [
    row({}), row({}),
    row({ release: { state: "pending", line: "Released", releasable: false } }),
    row({ release: { state: "lapsed", line: "Didn't confirm", releasable: true } }),
    row({ lastOffer: { status: "declined", name: "Acme" } }),
    row({ release: { state: "confirmed", line: "Owner confirmed", releasable: true } }),
  ];
  expect(waitingCounts(rows)).toEqual({ all: 6, toChoose: 3, released: 1, cameBack: 2 });
  expect(waitingCountLine(waitingCounts(rows))).toBe("6 waiting for an installer · 3 to choose (the Needs me count) · 1 released, waiting for the owner · 2 came back");
  expect(waitingCountLine(waitingCounts([row({})]))).toBe("1 waiting for an installer · 1 to choose (the Needs me count)");
});

test("pop-up: a failed installer list says so with Try again, never a blank box", () => {
  expect(choosePanelState({ isError: true, hasData: false })).toBe("error");
  expect(choosePanelState({ isError: false, hasData: false })).toBe("loading");
  expect(choosePanelState({ isError: false, hasData: true })).toBe("ready");
  expect(CHOOSE_LOAD_FAILED).toBe("Couldn't load installers");
  const src = readFileSync("src/components/portal/choose-installer.tsx", "utf8");
  expect(src).toContain("CHOOSE_LOAD_FAILED");
  expect(src).toContain('btnClass("secondary")');
  expect(src).toContain("Try again");
});
