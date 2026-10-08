import { describe, expect, test } from "bun:test";
import { MODE_CHOICES, nextStepText, outcomeFor } from "../src/lib/add-job-flow.core";

describe("Add job next steps (Jo 8 Oct)", () => {
  test("each choice carries Jo's exact next-step wording", () => {
    expect(MODE_CHOICES.map((c) => c.title)).toEqual(["I'm at the property now", "A job for later", "A job I’ve already visited"]);
    expect(nextStepText("later")).toContain("Upcoming visits under My work");
    expect(nextStepText("existing")).toContain("let you know when they accept");
  });
  test("onsite: only an open form is success; saving alone is not", () => {
    expect(outcomeFor("onsite", { state: { kind: "open", url: "x" } as never }).tone).toBe("success");
    const b = outcomeFor("onsite", { state: { kind: "office", message: "Office must set up the form." } as never });
    expect(b.tone).toBe("blocked");
    expect(b.heading).toContain("not ready");
    expect(outcomeFor("onsite", { state: { kind: "preparing" } as never }).tone).toBe("waiting");
  });
  test("later: only a confirmed booking claims Upcoming visits", () => {
    expect(outcomeFor("later", { booking: "confirmed" }).body).toContain("Upcoming visits");
    const b = outcomeFor("later", { booking: "blocked" });
    expect(b.tone).toBe("blocked");
    expect(b.heading).toContain("not confirmed");
    expect(outcomeFor("later", { booking: "waiting_paperwork" }).waitingOn).toBe("The owner");
  });
  test("existing: never claims the owner was contacted", () => {
    const o = outcomeFor("existing", {});
    expect(o.body).toContain("Nobody has been contacted yet");
    expect(o.waitingOn).toBe("Home Insulation Victoria");
  });
  test("onsite preparing wording is Jo 90-second copy", () => {
    expect(nextStepText("onsite")).toContain("about 90 seconds");
    expect(outcomeFor("onsite", { state: { kind: "preparing", message: "" } }).heading).toBe("Job saved — preparing your Ready Check form…");
  });
});
