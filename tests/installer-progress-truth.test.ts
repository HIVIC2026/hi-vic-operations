import { describe, expect, test } from "bun:test";
import { installerProgress, currentQuote, apApprovalCurrent, evidenceNext, type ProgressFacts, type EvidenceItem } from "../src/lib/installer-progress.core";

const base: ProgressFacts = { coordination: "hivic_managed", quoted: "yes", eligibility: "eligible", quoteHeld: [], quoteStatus: "none", quoteDelivery: "none", reconfirmationRequired: false, electricianPayer: "hivic", electricalCleared: false, installationCompleted: false, evidence: [], evidenceApprovedAt: null, veecStatus: null, stage: "awaiting_quote_acceptance", now: Date.parse("2026-10-08T00:00:00Z") };
const run = (f: Partial<ProgressFacts>) => installerProgress({ ...base, ...f });
const quoteNote = (f: Partial<ProgressFacts>) => run(f).steps.find((s) => s.key === "quote")!.note;

describe("quote send proof", () => {
  test("issued + queued + no sent_at waits for HIV, never 'Sent to owner'", () => {
    const q = currentQuote([{ status: "issued", created_at: "2026-10-01", release_state: "queued", sent_at: null }]);
    expect(q.delivery).toBe("queued");
    const r = run({ quoteStatus: q.status, quoteDelivery: q.delivery });
    expect(r.next.who).toBe("Home Insulation Victoria");
    expect(quoteNote({ quoteStatus: "issued", quoteDelivery: "queued" })).toBe("Waiting to be sent");
  });
  test("released without sent_at is not delivery proof", () => expect(currentQuote([{ status: "issued", created_at: "x", release_state: "released", sent_at: null }]).delivery).not.toBe("released"));
  test("recorded release shows owner action", () => {
    const q = currentQuote([{ status: "issued", created_at: "2026-10-01", release_state: "released", sent_at: "2026-10-02" }]);
    expect(run({ quoteStatus: q.status, quoteDelivery: q.delivery }).next.who).toBe("Owner");
  });
  test("held quote names hold reason for HIV", () => expect(run({ quoteStatus: "issued", quoteDelivery: "held", quoteHoldReason: "Fee confirmation missing" }).next.text).toContain("Fee confirmation missing"));
  test("withdrawn quotes are ignored", () => expect(currentQuote([{ status: "superseded", created_at: "2026-10-05" }]).status).toBe("none"));
  test("old accepted history does not win over a newer replacement", () => {
    const q = currentQuote([{ status: "accepted", created_at: "2026-10-01", release_state: "released", sent_at: "2026-10-01" }, { status: "draft", created_at: "2026-10-05", release_state: "held", sent_at: null }]);
    expect(q.status).toBe("draft");
  });
  test("reconfirmation asks owner only once replacement is released", () => {
    expect(run({ quoteStatus: "draft", reconfirmationRequired: true }).next.who).toBe("Home Insulation Victoria");
    expect(run({ quoteStatus: "issued", quoteDelivery: "queued", reconfirmationRequired: true }).next.who).toBe("Home Insulation Victoria");
    expect(run({ quoteStatus: "issued", quoteDelivery: "released", reconfirmationRequired: true }).next).toEqual({ who: "Owner", text: "Reconfirm the updated quote." });
  });
});

const after = { quoteStatus: "accepted" as const, electricalCleared: true, installationCompleted: true, stage: "evidence_outstanding" };
const item = (label: string, status: string, role: string | null, applicability: EvidenceItem["applicability"] = "current"): EvidenceItem => ({ label, status, role, applicability });
describe("evidence party", () => {
  test("electrician-owned missing item goes to electrician, not installer", () => {
    const n = run({ ...after, evidence: [item("Switchboard photo", "outstanding", "electrician")] }).next;
    expect(n.who).toBe("Electrician"); expect(n.text).toContain("Switchboard photo");
  });
  test("installer rejected item names exact item", () => expect(run({ ...after, evidence: [item("Completed installation", "rejected", "installer")] }).next).toEqual({ who: "You", text: "Replace rejected evidence: Completed installation." }));
  test("uploaded awaiting review is HIV review, not verified", () => expect(evidenceNext([item("Post-install video", "uploaded", "installer")])!.who).toBe("Home Insulation Victoria"));
  test("future-applicability item is not demanded", () => expect(evidenceNext([item("X", "outstanding", "installer", "future")])).toBeNull());
});

describe("AP approval currency", () => {
  const ok = [item("A", "verified", "installer")];
  test("current approval counts", () => expect(apApprovalCurrent({ stage: "ready_for_veec", approvedAt: "2026-10-05", evidence: ok })).toBe(true));
  test("stage moved back to ap_review → stale", () => expect(apApprovalCurrent({ stage: "ap_review", approvedAt: "2026-10-05", evidence: ok })).toBe(false));
  test("new rejection → stale", () => expect(apApprovalCurrent({ stage: "ready_for_veec", approvedAt: "2026-10-05", evidence: [item("A", "rejected", "installer")] })).toBe(false));
  test("awaiting review → stale", () => expect(apApprovalCurrent({ stage: "ready_for_veec", approvedAt: "2026-10-05", evidence: [item("A", "uploaded", "installer")] })).toBe(false));
  test("correction verified after approval → stale", () => expect(apApprovalCurrent({ stage: "ready_for_veec", approvedAt: "2026-10-05T00:00:00Z", evidence: ok, lastVerifiedAt: "2026-10-06T00:00:00Z" })).toBe(false));
  test("stale approval does not make VEEC the next action", () => expect(run({ ...after, evidenceApprovedAt: null, evidence: [item("A", "rejected", "installer")] }).next.text).not.toContain("Submit"));
});

describe("installation timing", () => {
  const cleared = { quoteStatus: "accepted" as const, electricalCleared: true, stage: "installation_scheduling" };
  test("expired 30-day PIESA cannot show install next; history kept as completed-expired", () => {
    const r = run({ ...cleared, electricalExpired: true, installBooking: { status: "confirmed", start: "2026-10-20" } });
    expect(r.next.text).toContain("expired");
    expect(r.steps.find((s) => s.key === "electrical")).toMatchObject({ state: "done", note: "Completed — 30-day window expired" });
  });
  test("fix-up required blocks install", () => expect(run({ ...cleared, rectificationOpen: true }).next.text).toContain("Electrical fixes"));
  test("no booking → book", () => expect(run(cleared).next.text).toBe("Book the installation date."));
  test("proposed → confirm", () => expect(run({ ...cleared, installBooking: { status: "proposed", start: null } }).next.text).toContain("Confirm"));
  test("ESC not sent → HIV before install", () => expect(run({ ...cleared, installBooking: { status: "confirmed", start: "2026-10-20" }, installBlockers: ["ESC notification not sent"] }).next.who).toBe("Home Insulation Victoria"));
  test("clear future booking → install on date", () => expect(run({ ...cleared, installBooking: { status: "confirmed", start: "2026-10-20T00:00:00Z" } }).next.text).toMatch(/^Install on/));
});
