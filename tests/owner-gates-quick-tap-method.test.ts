// Jo 2 Nov 2026: "quick_tap_link" (owner tapped their own quick-taps link, no code) may only sign the
// trade_contact_share OK, and only from a quick-taps batch. Refused before anything is read or written.
import { describe, expect, mock, test } from "bun:test";
import type { SignInput } from "../src/lib/owner-gates.server";

// The guard runs before any PDF work; stub the PDF library so this test needs no PDF dependency.
mock.module("pdf-lib", () => ({ PDFDocument: {}, StandardFonts: {}, rgb: () => ({}) }));
mock.module("@supabase/supabase-js", () => ({ createClient: () => new Proxy({}, { get: () => { throw new Error("no database in this test"); } }) }));
const { signGateDoc } = await import("../src/lib/owner-gates.server");

const input = (o: Partial<SignInput>): SignInput => ({
  jobId: "00000000-0000-4000-8000-0000000000d1",
  key: "trade_contact_share",
  signatoryName: "Wayne Wilson",
  ticked: true,
  answers: {},
  method: "quick_tap_link",
  signedBy: null,
  ip: null,
  userAgent: null,
  quickTapsBatchId: "81e531cc-1e33-48fa-a2b0-77cc4957f457",
  ...o,
});

describe("signGateDoc quick_tap_link guard", () => {
  test("refused for any document other than trade_contact_share", async () => {
    await expect(signGateDoc(input({ key: "quote_acceptance" }))).rejects.toThrow("This can only be confirmed from the owner's own link.");
  });
  test("refused for trade_contact_share without a quick-taps batch", async () => {
    await expect(signGateDoc(input({ quickTapsBatchId: undefined }))).rejects.toThrow("This can only be confirmed from the owner's own link.");
  });
});
