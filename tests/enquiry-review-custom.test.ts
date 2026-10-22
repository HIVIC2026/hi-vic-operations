import { describe, expect, test } from "bun:test";
import { qualifiesOutcome, customReviewMail } from "../src/lib/enquiry-review-custom.core";

// Jo 22 Oct 2026: one Qualifies button records the existing outcomes (reports unchanged).
describe("qualifiesOutcome", () => {
  test("declared no insulation records no_insulation", () => {
    expect(qualifiesOutcome("none")).toBe("no_insulation");
  });
  test("has insulation or not sure records below_r2", () => {
    expect(qualifiesOutcome("present")).toBe("below_r2");
    expect(qualifiesOutcome("unknown")).toBe("below_r2");
    expect(qualifiesOutcome(null)).toBe("below_r2");
  });
});

describe("customReviewMail", () => {
  test("keeps the office's edited text and appends the automatic link", () => {
    const m = customReviewMail({
      subject: "About your enquiry",
      text: "Can you get a photo of the back bedroom ceiling?",
      link: { label: "Upload photos/video", url: "https://example.com/upload/abc" },
    });
    expect(m.plainText).toContain("Can you get a photo of the back bedroom ceiling?");
    expect(m.plainText).toContain("https://example.com/upload/abc");
    expect(m.html).toContain("https://example.com/upload/abc");
  });

  test("added paragraphs are preserved and text is HTML-escaped", () => {
    const m = customReviewMail({
      subject: "S",
      text: "Hi there,\n\nIs your insulation R2 & above or below R2 < 3.5?",
      link: null,
    });
    expect(m.plainText).toContain("Is your insulation R2 & above or below R2 < 3.5?");
    expect(m.html).toContain("&amp;");
    expect(m.html).toContain("&lt;");
    expect(m.html).not.toContain("R2 & above");
  });

  test("blank paragraphs are dropped and no link means no link section", () => {
    const m = customReviewMail({ subject: "S", text: "\n\nJust one line\n\n\n", link: null });
    expect(m.plainText).toBe("Just one line");
    expect(m.html).not.toContain("<a ");
  });
});
