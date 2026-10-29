/**
 * Guide fix 7 (Jo, 29 Oct 2026, decision 426): safety check (PIESA) offers go to ONE electrician at a time,
 * nearest first, 24 hours each, back to the office after 2 misses. Installers' own jobs: the installer's chosen
 * electrician first; if they don't take it, back to the office (never another electrician). Offers already out finish.
 * Would fail if the batch path ("many electricians at once") came back for new safety check offers.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { autoOfferReturnedSummary, autoOfferStep, type AutoOfferCandidate, type AutoOfferFacts, type AutoOfferRow } from "../src/lib/auto-offer.core";

const cand = (id: string, o: Partial<AutoOfferCandidate> = {}): AutoOfferCandidate => ({
  business_id: id, name: id.toUpperCase(), coversPostcode: true, paused: false, credentialsOk: true, workersCleared: true, blocker: null, activeJobs: 0, distanceKm: 10, testPartner: false, ...o,
});
const base = (rows: AutoOfferRow[] = []): AutoOfferFacts => ({ kind: "piesa", switchOn: true, jobReady: true, hasTrade: false, returned: false, rows });
const miss = (id: string, status = "expired"): AutoOfferRow => ({ business_id: id, status, offered_at: "2026-10-29T00:00:00Z", auto: true });

describe("guide fix 7 — safety check offers one at a time", () => {
  test("our jobs: nearest electrician first, then the next nearest after a miss", () => {
    const cs = [cand("far", { distanceKm: 40 }), cand("near", { distanceKm: 3 }), cand("mid", { distanceKm: 12 })];
    expect(autoOfferStep({ ...base(), candidates: cs })).toMatchObject({ action: "offer", businessId: "near", attempt: 1 });
    expect(autoOfferStep({ ...base([miss("near")]), candidates: cs })).toMatchObject({ action: "offer", businessId: "mid", attempt: 2 });
    expect(autoOfferStep({ ...base([miss("near"), miss("mid", "declined")]), candidates: cs })).toMatchObject({ action: "return_to_office", reason: "two_misses" });
  });
  test("installers' own jobs: their chosen electrician first; if they don't take it, back to the office", () => {
    const cs = [cand("near", { distanceKm: 1 }), cand("theirs", { distanceKm: 30 })];
    expect(autoOfferStep({ ...base(), candidates: cs, usualBusinessId: "theirs" })).toMatchObject({ action: "offer", businessId: "theirs", basis: "usual_electrician" });
    expect(autoOfferStep({ ...base([miss("theirs")]), candidates: cs, usualBusinessId: "theirs" })).toMatchObject({ action: "return_to_office", reason: "preferred_missed" });
    expect(autoOfferReturnedSummary("piesa", "preferred_missed", 1)).toBe("Automatic electrician offers: the installer's electrician didn't take it — choose again");
  });
  test("automatic dispatch mode no longer sends safety check offers to a batch", () => {
    const auto = readFileSync("src/lib/auto-offer.server.ts", "utf8");
    expect(auto).not.toContain('mode !== "automatic"');
    const alloc = readFileSync("src/lib/allocation.server.ts", "utf8");
    const start = alloc.slice(alloc.indexOf("async function autoStartPiesaOffers"), alloc.indexOf("async function flagUnapprovedElectricians"));
    expect(start).toContain("autoOfferForJob");
    expect(start).not.toContain("startPiesaAllocation(");
    const refill = alloc.slice(alloc.indexOf("async function refillIfNeeded"), alloc.indexOf("export async function respondToRecOffer"));
    expect(refill.indexOf('if (kind === "piesa") return;')).toBeGreaterThan(-1);
    expect(refill.indexOf('if (kind === "piesa") return;')).toBeLessThan(refill.indexOf("claimRecOfferBatch"));
  });
});
