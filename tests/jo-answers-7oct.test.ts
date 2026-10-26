import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { changesEmail, declineEmail, reviewInputError, APPLICATION_REVIEW_WORDING_APPROVED } from "../src/lib/application-review.core";
import { customerDetailsGaps, customerDetailsReason, effectiveSiteCheck, leadStage, reviewRowNotes, CUSTOMER_DETAILS_NEEDED } from "../src/lib/bulk-import.core";
import { confirmBlockers } from "../src/lib/pilot.core";

const full = { full_name: "Carol Test", email: "carol@example.com", phone: "0412 345 678", address_line: "1 Test St", suburb: "Ballarat", postcode: "3350" };

describe("application send back / decline emails (DRAFT)", () => {
  test("send-back email carries the office message and the update button", () => {
    const m = changesEmail({ contactName: "Deep Singh", message: "Please check your batts removal rate.", link: "https://estimate.homeinsulationvictoria.com.au/installer-onboarding?resume=abc" });
    expect(m.subject).toBe("Your Home Insulation Victoria application – a quick change needed");
    expect(m.text).toContain("Hi Deep, thanks for applying to work with Home Insulation Victoria.");
    expect(m.text).toContain("we need you to check the following: Please check your batts removal rate.");
    expect(m.text).toContain("Update my application: https://estimate.homeinsulationvictoria.com.au/installer-onboarding?resume=abc");
  });
  test("decline email: reason included when given, cleanly left out when blank", () => {
    const withR = declineEmail({ contactName: "Deep", reason: "Your insurance has expired" });
    expect(withR.subject).toBe("Your Home Insulation Victoria application");
    expect(withR.text).toContain("Unfortunately we're unable to approve your application at this time. Your insurance has expired.");
    const without = declineEmail({ contactName: "Deep", reason: "" });
    expect(without.text).toContain("Unfortunately we're unable to approve your application at this time.\n");
    expect(without.text).toContain("Kind regards,\nJo");
    expect(`${withR.text}${without.html}`.toLowerCase()).not.toContain("optional");
  });
  test("send back needs a message; real send-backs are Jo's own office email (7 Oct)", () => {
    expect(reviewInputError("changes_requested", " ")).toBeTruthy();
    expect(reviewInputError("declined", "")).toBeNull();
    expect(APPLICATION_REVIEW_WORDING_APPROVED).toBe(true);
    const src = readFileSync("src/lib/application-review.server.ts", "utf8");
    expect(src).toContain('sendOfficeEmail({ actorId, recipient: "applicant"');
    expect(src).toContain("sendTestEmail");
  });
  test("office page never says optional", () => {
    expect(readFileSync("src/components/portal/partner-application.tsx", "utf8").match(/ReviewDecision[\s\S]*?Office CII/)![0].toLowerCase()).not.toContain("optional");
  });
});

describe("every customer needs name, address, email, phone + permission", () => {
  test("gaps listed; complete customer passes", () => {
    expect(customerDetailsGaps(full)).toEqual([]);
    expect(customerDetailsGaps({ ...full, email: "" })).toEqual(["email"]);
    expect(customerDetailsGaps({ ...full, phone: null, suburb: null })).toEqual(["full address (street, suburb, postcode)", "phone number"]);
    expect(customerDetailsGaps({})).toHaveLength(4);
  });
  test("photos-only row shows Customer details needed", () => {
    const reason = customerDetailsReason({})!;
    expect(reason.startsWith(CUSTOMER_DETAILS_NEEDED)).toBe(true);
    expect(reviewRowNotes("needs_visit", [reason], "yes").tag).toBe(CUSTOMER_DETAILS_NEEDED);
  });
  test("Add one job: phone, suburb and postcode now required", () => {
    const b = confirmBlockers({ full_name: "Carol", email: "c@example.com", address_line: "1 Test St" } as never);
    expect(b.join(" ")).toMatch(/phone/i);
    expect(b.join(" ")).toMatch(/Suburb/);
    expect(b.join(" ")).toMatch(/Postcode/);
  });
  test("Add one job: server refuses without the contact-permission tick", () => {
    expect(readFileSync("src/lib/partner-import.server.ts", "utf8")).toContain('if (data.installer?.contact_permission !== true) blockers.push(');
  });
  test("bulk Confirm refuses rows with customer gaps", () => {
    expect(readFileSync("src/lib/bulk-import.server.ts", "utf8")).toMatch(/const gap = customerDetailsReason\(e\);\s*if \(gap\) \{\s*failed\+\+;/);
  });
});

describe("Visited rule: photos, measurements or a quote", () => {
  test("photos, area or price mean Visited; sentences only mean Not visited; explicit No stays No", () => {
    expect(leadStage({ ...full }, 2)).toBe("not_visited"); // superseded by Jo 20 Oct: photos alone never mean a visit
    expect(leadStage({ ...full, area_m2: 120 })).toBe("not_visited"); // Jo 20 Oct: area/price alone never mean a visit
    expect(leadStage({ ...full, price_inc_gst: 3450 })).toBe("not_visited");
    expect(leadStage({ ...full, site_check: "yes", price_inc_gst: 3450 })).toBe("quoted");
    expect(leadStage({ ...full, notes: "Customer keen, call next week" })).toBe("not_visited");
    expect(effectiveSiteCheck({ ...full, site_check: "no", area_m2: 120 }).check).toBe("no");
  });
});
