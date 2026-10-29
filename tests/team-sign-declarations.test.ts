import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { allocationBlocker, ALLOCATION_REASON } from "../src/lib/visit-allocation.core";
import { crewSelectionProblems } from "../src/lib/piisa-a3.core";
import { completionErrors, signLinkBlocker } from "../src/lib/worker-invite.core";
import { DECLARATIONS_DUE_MESSAGE } from "../src/lib/worker-compliance.core";
const src = (p: string) => readFileSync(p, "utf8");
const today = "2026-10-29";
const cleared = { workerId: "a", name: "Ann Lead", tradeRole: "installer", email: null, mobile: "0412345678", workerRole: "lead" as const,
  clearance: { certStatus: "verified", level: "full", expiresOn: "2027-12-31" } };

describe("unsigned people can't go on jobs", () => {
  test("allocation refuses both visits until signed", () => {
    expect(allocationBlocker("ready_check", { ...cleared, declarationsDue: true }, today)).toBe(ALLOCATION_REASON.unsigned);
    expect(allocationBlocker("install", { ...cleared, declarationsDue: true }, today)).toBe(ALLOCATION_REASON.unsigned);
    expect(allocationBlocker("ready_check", { ...cleared, declarationsDue: false }, today)).toBeNull();
    expect(ALLOCATION_REASON.unsigned).toBe(DECLARATIONS_DUE_MESSAGE);
  });
  test("picker refuses an unsigned Lead or crew member", () => {
    const s = (id: string, name: string, due: boolean) => ({ workerId: id, name, eec: "E1", eecVerified: true, cleared: true, workerRole: "lead" as const, declarationsDue: due });
    const staff = [s("a", "Ann Lead", true), s("b", "Bob Ok", false)];
    expect(crewSelectionProblems({ lead: "a", additional: [] }, staff).problems).toEqual([`Ann Lead: ${DECLARATIONS_DUE_MESSAGE}`]);
    expect(crewSelectionProblems({ lead: "b", additional: [{ workerId: "a" }] }, staff).problems).toEqual([`Ann Lead: ${DECLARATIONS_DUE_MESSAGE}`]);
    expect(crewSelectionProblems({ lead: "b", additional: [] }, staff).problems).toEqual([]);
  });
  test("no link without a mobile or email", () => {
    const w = { trade_role: "installer", declarations_due: true, email: null, mobile: null, certification_status: "unverified" };
    expect(signLinkBlocker(w)).toBe("Add their mobile or email first, then make their link.");
    expect(signLinkBlocker({ ...w, mobile: "0412345678" })).toBeNull();
    expect(signLinkBlocker({ ...w, trade_role: "electrician", email: "e@x.au", certification_status: null })).toBeNull();
    expect(signLinkBlocker({ ...w, declarations_due: false, trade_role: "electrician" })).toBe("Certificate completion links are only for installer workers.");
  });
  test("signing needs every tick and a name; certificate only when asked", () => {
    const keys = ["own_behalf", "true_info"];
    expect(completionErrors({ accepted: ["own_behalf"], signed_name: "" }, { cert: false, declarationKeys: keys })).toEqual(["Tick every box before signing.", "Type your full name to sign."]);
    expect(completionErrors({ accepted: keys, signed_name: "Ann Lead" }, { cert: false, declarationKeys: keys })).toEqual([]);
    expect(completionErrors({})).toEqual(["Upload the EEC / Certified Insulation Installer certificate."]);
  });
  test("server wiring", () => {
    const fns = src("src/lib/worker-invite.functions.ts");
    const done = fns.slice(fns.indexOf('inviteMode(inv) === "completion"'), fns.indexOf("Registration mode"));
    expect(done).toContain("declarations: { version: WORKER_DECLARATIONS_VERSION");
    expect(done).toContain("declarations_due: false");
    expect(fns).toContain("signLinkBlocker(");
    expect(src("src/lib/piisa-a3.server.ts")).toContain("declarations_due");
    expect(src("src/lib/visit-allocation.server.ts")).toContain("declarations_due");
    expect(src("src/routes/join.$token.tsx")).toContain("Sign your declarations");
  });
});
