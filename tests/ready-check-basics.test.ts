import { describe, expect, it } from "vitest";
import { readyCheckBasics, needsFinishingFromMissing, NOTE_FORM_NOT_FINISHED } from "../src/lib/ready-check-basics.core";

const full = { installerSourced: true, areaM2: 120, productReady: true, installerPriceIncGst: 4200, ownerMobile: "0400000000", ownerEmail: "a@b.co", contactPermission: true, stops: [], formCompleted: false };

describe("Ready Check basics (Jo 23 Oct)", () => {
  it("drafts before the form is finished when the basics are in; unfinished form is only a note", () => {
    const r = readyCheckBasics(full);
    expect(r.ready).toBe(true);
    expect(r.notes).toEqual([NOTE_FORM_NOT_FINISHED]);
  });
  it("A1 needs the installer's price; A2 does not", () => {
    expect(readyCheckBasics({ ...full, installerPriceIncGst: null }).missing).toEqual(["price"]);
    expect(readyCheckBasics({ ...full, installerSourced: false, installerPriceIncGst: null }).ready).toBe(true);
  });
  it("any stop means no draft", () => {
    expect(readyCheckBasics({ ...full, stops: ["Fails: existing insulation is R2 or above"] }).ready).toBe(false);
  });
  it("permission must be an explicit yes", () => {
    expect(readyCheckBasics({ ...full, contactPermission: null }).missing).toEqual(["contact permission"]);
  });
  it("Jo's exact next-step wording", () => {
    const m = readyCheckBasics({ ...full, areaM2: null, installerPriceIncGst: null, ownerMobile: null, ownerEmail: null, contactPermission: null }).missing;
    // Decision 278: the price is never a Mitti item — it follows on the job page once the form items are in.
    expect(needsFinishingFromMissing(m)).toBe("Needs finishing: ceiling area, owner mobile/email/permission on the Mitti form");
    expect(needsFinishingFromMissing(["price", "owner mobile", "owner email", "contact permission"])).toBe("Needs finishing: owner mobile/email/permission on the Mitti form");
    expect(needsFinishingFromMissing(["price"])).toBe("Needs finishing: your price on the job page");
    expect(needsFinishingFromMissing([])).toBeNull();
  });
});
