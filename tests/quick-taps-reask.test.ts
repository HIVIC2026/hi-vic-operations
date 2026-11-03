// Jo 3 Nov 2026 (Mia HV-1405): the one-off re-ask — pure helpers.
import { describe, expect, test } from "bun:test";
import { answersToSetAside, linkFromQuickTapsText, reaskText } from "../src/lib/quick-taps.core";

describe("quick taps re-ask", () => {
  test("reaskText is Jo's wording, verbatim", () => {
    expect(reaskText("Mia", "https://estimate.homeinsulationvictoria.com.au/my-job/abc")).toBe(
      "Hi Mia, it's Home Insulation Victoria. Sorry, we think you may have tapped \"flat roof\" by mistake. We've fixed it – if you'd still like your free Ready Check, tap here to carry on: https://estimate.homeinsulationvictoria.com.au/my-job/abc",
    );
  });
  test("answersToSetAside: only this batch's quick_taps_answered rows", () => {
    const ev = [
      { id: "1", event_type: "quick_taps_answered", details: { batch_id: "b1" } },
      { id: "2", event_type: "quick_taps_answered", details: { batch_id: "b0" } },
      { id: "3", event_type: "area_batch_sent", details: { batch_id: "b1" } },
      { id: "4", event_type: "quick_taps_answered_replaced", details: { batch_id: "b1" } },
    ];
    expect(answersToSetAside(ev, "b1").map((e) => e.id)).toEqual(["1"]);
    expect(answersToSetAside(ev, null)).toEqual([]);
  });
  test("linkFromQuickTapsText pulls the my-job link out of the batch text", () => {
    expect(linkFromQuickTapsText("Hi Mia, great news - ... quote: https://estimate.homeinsulationvictoria.com.au/my-job/auoVQYAXIuKNYdPkcBWmVPN68qPf44"))
      .toBe("https://estimate.homeinsulationvictoria.com.au/my-job/auoVQYAXIuKNYdPkcBWmVPN68qPf44");
    expect(linkFromQuickTapsText("no link here")).toBeNull();
  });
});
