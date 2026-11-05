// Photo-quote installers Task 3 (spec decision 3): when a job goes to a "From photos" installer, the owner gets ONE email
// "Good news: no visit needed" instead of "{Installer} will call you", and no text. Held for Jo's approval.
import { expect, test } from "bun:test";
import { OWNER_PHOTO_QUOTE_NOTICE_APPROVED, OWNER_PHOTO_QUOTE_NOTICE_PURPOSE, ownerPhotoQuoteEmail, ownerPhotoQuoteNoticeKey } from "../src/lib/owner-photo-quote-notice.core";

const noGap = { name: "NO GAP INSULATION PTY LTD", tradingName: "No Gap Insulation", officePhone: "03 9000 1111", email: "office@nogap.example" };

test("held for approval", () => expect(OWNER_PHOTO_QUOTE_NOTICE_APPROVED).toBe(false));

test("exact subject and body lines in order", () => {
  const m = ownerPhotoQuoteEmail({ firstName: "Sam", installer: noGap, unsubscribeUrl: null });
  if ("held" in m) throw new Error("held");
  expect(m.subject).toBe("Good news: no visit needed");
  const lines = [
    "Hi Sam,",
    "Good news: No Gap Insulation can quote from the photos you sent, so you don't need a Ready Check visit.",
    "Your quote is on its way.",
    "No Gap Insulation · 03 9000 1111 · office@nogap.example",
    "Rebate certificates created by Home Insulation Victoria (Accredited Person A003654).",
  ];
  let at = -1;
  for (const l of lines) { const i = m.text.indexOf(l); expect(i).toBeGreaterThan(at); at = i; }
  for (const l of lines) expect(m.html).toContain(l);
  for (const s of [m.subject, m.text]) {
    expect(s).not.toMatch(/Ready Check booking|will call|\bHIV\b|\babout\b/);
  }
});

test("no first name → Hi,", () => {
  const m = ownerPhotoQuoteEmail({ firstName: null, installer: noGap, unsubscribeUrl: null });
  if ("held" in m) throw new Error("held");
  expect(m.text.startsWith("Hi,")).toBe(true);
});

test("same holds as will-call: missing office phone or business email → held", () => {
  expect(ownerPhotoQuoteEmail({ firstName: "Sam", installer: { ...noGap, officePhone: " " }, unsubscribeUrl: null })).toEqual({ held: "No office phone for No Gap Insulation" });
  expect(ownerPhotoQuoteEmail({ firstName: "Sam", installer: { ...noGap, email: null }, unsubscribeUrl: null })).toEqual({ held: "No business email for No Gap Insulation" });
});

test("key and purpose", () => {
  expect(ownerPhotoQuoteNoticeKey("job-1", "batch-9")).toBe("owner-photo-quote-notice:v1:job-1:batch-9");
  expect(OWNER_PHOTO_QUOTE_NOTICE_PURPOSE).toBe("owner_photo_quote_notice");
});
