// Photo-quote installers (No Gap), Task 1: the pure rules — quote method, owner photos/videos, the photo quote form checks
// and the 2-business-day time limit.
import { describe, expect, test } from "bun:test";
import { hasOwnerMedia, photoQuoteDueBy, photoQuoteOverdue, photoQuoteProblems, PHOTO_QUOTE_WORDS, quoteMethodOf } from "../src/lib/photo-quote.core";

describe("quoteMethodOf", () => {
  test("only 'photos' is photos; anything else, missing or null is Ready Check", () => {
    expect(quoteMethodOf({ quote_method: "photos" })).toBe("photos");
    expect(quoteMethodOf({ quote_method: "ready_check" })).toBe("ready_check");
    expect(quoteMethodOf({ quote_method: "desk" })).toBe("ready_check");
    expect(quoteMethodOf({})).toBe("ready_check");
    expect(quoteMethodOf(null)).toBe("ready_check");
  });
});

describe("hasOwnerMedia", () => {
  test("intake_media photo or video counts; other kinds and non-media files don't", () => {
    expect(hasOwnerMedia([{ kind: "intake_media", mime_type: "image/jpeg", storage_path: "a.jpg" }])).toBe(true);
    expect(hasOwnerMedia([{ kind: "intake_media", mime_type: "video/mp4", storage_path: "a.mp4" }])).toBe(true);
    expect(hasOwnerMedia([{ kind: "intake_media", mime_type: null, storage_path: "roof.MOV" }])).toBe(true);
    expect(hasOwnerMedia([{ kind: "intake_media", mime_type: "application/pdf", storage_path: "a.pdf" }])).toBe(false);
    expect(hasOwnerMedia([{ kind: "signed_quote", mime_type: "image/jpeg", storage_path: "a.jpg" }])).toBe(false);
    expect(hasOwnerMedia([{ kind: "intake_media", mime_type: null, storage_path: null }])).toBe(false);
    expect(hasOwnerMedia([])).toBe(false);
  });
});

describe("photoQuoteProblems", () => {
  const ok = { underR2: true, removeM2: 0, installM2: 84.5, product: "Bradford Gold R5" };
  test("a complete quote has no problems", () => {
    expect(photoQuoteProblems(ok)).toEqual([]);
    expect(photoQuoteProblems({ ...ok, removeM2: 84.5 })).toEqual([]);
  });
  test("over R2 can't be sent", () => {
    expect(photoQuoteProblems({ ...ok, underR2: false })).toContain("Over R2 isn't eligible. Use Can't do this one.");
  });
  test("everything missing lists each field in form order", () => {
    expect(photoQuoteProblems({ underR2: null, removeM2: null, installM2: null, product: null })).toEqual([
      "Say if the existing insulation is under R2", "Enter the sqm to remove (0 if none)", "Enter the sqm to install", "Pick the product",
    ]);
  });
  test("remove can't be more than install", () => {
    expect(photoQuoteProblems({ ...ok, removeM2: 90, installM2: 80 })).toContain("Sqm to remove can't be more than sqm to install");
  });
  test("negative remove and zero install are two problems", () => {
    expect(photoQuoteProblems({ ...ok, removeM2: -1, installM2: 0 }).length).toBe(2);
  });
  test("decimals are kept to 1 place before comparing", () => {
    expect(photoQuoteProblems({ ...ok, removeM2: 80.04, installM2: 80 })).toEqual([]);
    expect(photoQuoteProblems({ ...ok, installM2: 0.04 })).toContain("Enter the sqm to install");
  });
  test("not a number or not finite is missing", () => {
    expect(photoQuoteProblems({ ...ok, installM2: Number.NaN })).toContain("Enter the sqm to install");
  });
  test("product must be on the approved list", () => {
    expect(photoQuoteProblems({ ...ok, product: "R5.0 batts" })).toContain("Pick the product");
    expect(photoQuoteProblems({ ...ok, product: "  " })).toContain("Pick the product");
  });
});

describe("photoQuoteDueBy / photoQuoteOverdue", () => {
  test("2 Victorian business days after the Melbourne day the job was given", () => {
    expect(photoQuoteDueBy("2026-11-06T01:00:00Z")).toBe("2026-11-10"); // Fri → Tue
    expect(photoQuoteDueBy("2026-11-02T01:00:00Z")).toBe("2026-11-05"); // Mon → Thu (Tue 3 Nov is Melbourne Cup)
  });
  test("overdue only once the Melbourne day is after the due day", () => {
    expect(photoQuoteOverdue("2026-11-05T23:00:00Z", new Date("2026-11-10T12:00:00Z"))).toBe(false); // Fri 10am given, Tue
    expect(photoQuoteOverdue("2026-11-05T23:00:00Z", new Date("2026-11-10T23:30:00Z"))).toBe(true); // Wed 10:30am Melbourne
  });
});

describe("PHOTO_QUOTE_WORDS", () => {
  test("exact labels and reasons", () => {
    expect(PHOTO_QUOTE_WORDS.noPhotos("No Gap Insulation")).toBe("No Gap Insulation quotes from photos. This owner hasn't sent any.");
    expect(PHOTO_QUOTE_WORDS.methodLabel.ready_check).toBe("Ready Check");
    expect(PHOTO_QUOTE_WORDS.methodLabel.photos).toBe("From photos");
    expect(PHOTO_QUOTE_WORDS.footnote("No Gap Insulation")).toBe("Your quote uses what No Gap Insulation worked out from your photos.");
    expect(PHOTO_QUOTE_WORDS.fields).toEqual({ underR2: "Existing insulation under R2?", removeM2: "Sqm to remove", installM2: "Sqm to install", product: "Product" });
    expect(PHOTO_QUOTE_WORDS.send).toBe("Send for quote");
    for (const s of Object.values(PHOTO_QUOTE_WORDS).flatMap((v) => typeof v === "string" ? [v] : [])) expect(s).not.toMatch(/\bHIV\b|\babout\b|\bfixes\b/);
  });
});

describe("isMissingQuoteMethodColumn", () => {
  test("only the missing-column error reads as Ready Check", async () => {
    const { isMissingQuoteMethodColumn } = await import("../src/lib/photo-quote.core");
    expect(isMissingQuoteMethodColumn({ code: "42703", message: "column businesses.quote_method does not exist" })).toBe(true);
    expect(isMissingQuoteMethodColumn({ message: "column businesses.quote_method does not exist" })).toBe(true);
    expect(isMissingQuoteMethodColumn({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isMissingQuoteMethodColumn(null)).toBe(false);
  });
});

// Task 3/4: which give a job is under (pure match of the method record to the allocation by batch id).
import { photoGiveFrom } from "../src/lib/photo-quote.core";
test("photoGiveFrom matches the photo record to the current give by batch id and business", () => {
  const sent = (b: string, biz: string, at: string) => ({ event_type: "in_house_batch_sent", created_at: at, details: { batch_id: b, business_id: biz } });
  const rec = (b: string, biz: string) => ({ event_type: "in_house_quote_method", created_at: "2026-11-06T00:59:00Z", details: { batch_id: b, business_id: biz, quote_method: "photos" } });
  expect(photoGiveFrom([sent("B1", "nogap", "2026-11-06T01:00:00Z"), rec("B1", "nogap")], ["nogap"])).toEqual({ batchId: "B1", businessId: "nogap", givenAt: "2026-11-06T01:00:00Z" });
  expect(photoGiveFrom([sent("B1", "rapid", "2026-11-06T01:00:00Z")], ["rapid"])).toBeNull();
  // handed back: the business is no longer the active installer
  expect(photoGiveFrom([sent("B1", "nogap", "2026-11-06T01:00:00Z"), rec("B1", "nogap")], [])).toBeNull();
  // re-given as Ready Check: an older photo record never applies to the newer batch
  expect(photoGiveFrom([sent("B1", "nogap", "2026-11-06T01:00:00Z"), rec("B1", "nogap"), sent("B2", "nogap", "2026-11-09T01:00:00Z")], ["nogap"])).toBeNull();
  expect(photoGiveFrom([], ["nogap"])).toBeNull();
});

// Review fix round (minor): the installer's "Send for quote" response on an HIV lead carries no hold reasons.
import { readFileSync } from "node:fs";
import { photoQuoteResponse } from "../src/lib/photo-quote.core";
test("Send for quote response: only {ok, sent}; refusals keep their plain message", () => {
  expect(photoQuoteResponse({ ok: true, sent: false, held: ["Quote is more than 15% off the estimate"] })).toEqual({ ok: true, sent: false });
  expect(photoQuoteResponse({ ok: true, sent: true, held: [] })).toEqual({ ok: true, sent: true });
  expect(photoQuoteResponse({ ok: false, message: "This job isn't quoted from photos." })).toEqual({ ok: false, message: "This job isn't quoted from photos." });
  const fn = readFileSync("src/lib/trade-view.functions.ts", "utf8");
  expect(fn.slice(fn.indexOf("export const tradeSubmitPhotoQuote"), fn.indexOf("export const getPhotoQuoteMedia"))).toContain("photoQuoteResponse(");
});
