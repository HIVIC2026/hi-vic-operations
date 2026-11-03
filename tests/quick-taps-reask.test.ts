// Jo 3 Nov 2026 (Mia HV-1405): the one-off re-ask — wording.
import { describe, expect, test } from "bun:test";
import { reaskText } from "../src/lib/quick-taps.core";
import { brandSmsBody } from "../src/lib/sms.core";

describe("quick taps re-ask", () => {
  const t = reaskText("Mia", "https://estimate.homeinsulationvictoria.com.au/my-job/abc?screen=taps");
  test("reaskText is Jo's wording, verbatim", () => {
    expect(t).toBe("Hi Mia, it's Home Insulation Victoria. Sorry, we think you may have tapped \"flat roof\" by mistake. We've fixed it – if you'd still like your free Ready Check, tap here to carry on: https://estimate.homeinsulationvictoria.com.au/my-job/abc?screen=taps");
  });
  test("the sender doesn't add a second brand to a text that opens \"it's Home Insulation Victoria\"", () => {
    expect(brandSmsBody(t)).toBe(t);
    expect(brandSmsBody("Hi Mia, your job is booked")).toBe("Home Insulation Victoria: Hi Mia, your job is booked");
  });
});
