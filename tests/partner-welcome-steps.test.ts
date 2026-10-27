import { expect, test } from "bun:test";
import { partnerWelcomeEmail, MITTI_APP_STORE_URL, MITTI_GOOGLE_PLAY_URL } from "../src/lib/partner-email.core";
const make = (trade: "installer" | "electrician") => partnerWelcomeEmail({ firstName: "Sam", businessName: "Co", trade, email: "s@x.test", link: "https://example.test/l", test: false });
// Jo 27 Oct 2026: both welcome emails carry the official Mitti app links and the trade's own forms.
test("both versions link the official Mitti apps", () => {
  for (const t of ["installer", "electrician"] as const) { const m = make(t); expect(m.html).toContain(MITTI_APP_STORE_URL); expect(m.html).toContain(MITTI_GOOGLE_PLAY_URL); expect(m.text).toContain("No complete form, no payment"); }
  expect(MITTI_APP_STORE_URL).toBe("https://apps.apple.com/au/app/mitti-by-safetyculture/id499999532");
  expect(MITTI_GOOGLE_PLAY_URL).toBe("https://play.google.com/store/apps/details?id=com.safetyculture.iauditor");
});
test("electrician: A3 at the safety check, A4 for fixes", () => {
  const t = make("electrician").text;
  expect(t).toContain("A3 PIESA form at the safety check, and the A4 fixes form");
});
test("installer: Ready Check form at the measure, install form on install day, guide link kept", () => {
  const t = make("installer").text;
  expect(t).toContain("Ready Check form when you measure, and the install form on install day");
  expect(t).toContain("/field/guide");
});
test("no office phone number in either version", () => {
  for (const t of ["installer", "electrician"] as const) expect(make(t).text).not.toMatch(/1300|\(0\d\)|call us/i);
});
