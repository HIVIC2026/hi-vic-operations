import { describe, it, expect } from "bun:test";
import { jobCardLine, needsFinishingTask } from "../src/lib/trade-view.core";
import { installerTab } from "../src/lib/installer-progress.core";
describe("Jo 23 Oct: installer job card line", () => {
  it("missing Mitti info becomes the installer's task", () => {
    expect(needsFinishingTask("Needs finishing: price, owner mobile/email/permission on the Mitti form")).toBe("You: add your price and the owner's phone, email and permission in Mitti");
    expect(needsFinishingTask("Needs finishing: ceiling area, insulation product on the Mitti form")).toBe("You: add the ceiling area and the insulation product in Mitti");
    expect(needsFinishingTask("Owner to book Ready Check")).toBeNull();
  });
  it("prefixes who it's waiting on", () => {
    expect(jobCardLine({ who: "Home Insulation Victoria", text: "Checking your quote." })).toBe("Waiting on office: checking the quote");
    expect(jobCardLine({ who: "Owner", text: "Review and accept the quote." })).toBe("Waiting on owner: review and accept the quote");
    expect(jobCardLine({ who: "Electrician", text: "Electrician to upload missing evidence: X." })).toBe("Waiting on electrician: upload missing evidence: X");
    expect(jobCardLine({ who: "You", text: "Install on 4 Nov" })).toBe("You: install on 4 Nov");
  });
  it("installer-led jobs with missing form info land in Action needed", () => {
    expect(installerTab("moving", "preliminary_estimate_ready", true)).toBe("action");
    expect(installerTab("moving", "preliminary_estimate_ready", false)).toBe("progress");
    expect(installerTab("needs_me", "complete", true)).toBe("done");
  });
});
