import { describe, expect, it } from "vitest";
import { notInterestedText } from "./not-interested.core";
describe("no longer interested reason", () => {
  it("stores the tapped reason", () => expect(notInterestedText("price_too_high")).toBe("Owner no longer interested: Price too high"));
  it("adds the optional note", () => expect(notInterestedText("other", " renting now ")).toBe("Owner no longer interested: Other — renting now"));
  it("old links keep opt-out wording", () => expect(notInterestedText()).toBe("Owner opted out"));
});
