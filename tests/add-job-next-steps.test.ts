import { describe, expect, test } from "bun:test";
import { FORM_WITHIN_15, VISIT_FIELD_NOTE, outcomeFor } from "../src/lib/add-job-flow.core";

describe("Add job next steps (decisions 115/116, Jo 24 Oct)", () => {
  test("the promise to the installer is the email's: form within about 15 minutes, no booking needed", () => {
    expect(FORM_WITHIN_15).toContain("within about 15 minutes");
    expect(VISIT_FIELD_NOTE).toContain("Leave it blank and nothing is booked");
  });
  test("only an open form is success; saving alone is waiting, not success", () => {
    expect(outcomeFor({ booking: "none", state: { kind: "open", url: "x" } }).tone).toBe("success");
    expect(outcomeFor({ booking: "none", state: { kind: "preparing", message: "" } }).tone).toBe("waiting");
    const b = outcomeFor({ booking: "none", state: { kind: "office", message: "Office must set up the form." } });
    expect(b.tone).toBe("blocked");
    expect(b.heading).toContain("not ready");
    expect(outcomeFor({ booking: "none", state: { kind: "owner_paperwork", message: "x" } }).waitingOn).toBe("The owner");
  });
  test("a visit is only claimed when the server confirmed the booking", () => {
    expect(outcomeFor({ booking: "none", state: undefined }).visit).toBeNull();
    expect(outcomeFor({ booking: "confirmed", state: undefined }).visit).toContain("saved");
    expect(outcomeFor({ booking: "blocked", state: undefined }).visit).toContain("couldn't be saved");
  });
});
