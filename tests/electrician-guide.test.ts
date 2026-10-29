// Task 9: short "How it works" for electricians (copy approved by Jo 29 Oct 2026, word for word).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ELECTRICIAN_GUIDE_STEPS, ELECTRICIAN_GUIDE_WORDS, GUIDE_STEPS } from "../src/lib/trade-view.core";

test("electrician guide copy is the approved copy", () => {
  expect(ELECTRICIAN_GUIDE_STEPS).toEqual([
    { title: "Take the job", body: "We text and email you each offer. Accept it in My work if you can do it." },
    { title: "Book the PIESA", body: "Offer the owner 3 times for the Pre Insulation Electrical Safety Assessment (PIESA). It's booked once they pick one." },
    { title: "Do the PIESA in Mitti", body: "Fill in the PIESA form on site and take the photos in Mitti. If fixes are needed, add your price for them on the form. Press Complete when it's finished." },
    { title: "Fixes, if needed", body: "If the owner says yes to the fixes, book a time with them, do the work and fill in the fixes form in Mitti. Press Complete when done." },
  ]);
  expect(ELECTRICIAN_GUIDE_WORDS).toEqual({
    eyebrow: "Electrician guide",
    title: "How every job works",
    sub: "One minute. Four steps and getting paid.",
    paidTitle: "Getting paid",
    paidBody: "We pay your agreed rate 7 days after we approve your completed form. A form that isn't finished can't be paid.",
    back: "Back to My work",
  });
});

test("installer guide steps are unchanged", () => {
  expect(GUIDE_STEPS.map((s) => s.title)).toEqual(["Get the job", "Ready Check", "PIESA", "Install days", "Install day"]);
});

test("guide page loads the business and shows the electrician guide only for electricians", () => {
  const page = readFileSync("src/routes/_authenticated/field.guide.tsx", "utf8");
  expect(page).toContain("getTradeBusiness");
  expect(page).toContain('kind === "electrician"');
  expect(page).toContain("ELECTRICIAN_GUIDE_STEPS");
  expect(page).toContain("GUIDE_STEPS.map");
  const elec = page.slice(page.indexOf("function ElectricianGuide"), page.indexOf("function InstallerGuide"));
  expect(elec).toContain("<TradeShell installer={false}>");
  for (const gone of ["NoFormNoPay", "GUIDE_WORDS.photos", "GUIDE_WORDS.pay"]) expect(elec).not.toContain(gone);
});

test("business page guide row sub differs for electricians only", () => {
  const page = readFileSync("src/routes/_authenticated/field.business.tsx", "utf8");
  expect(page).toContain('"One minute: every job and getting paid"');
  expect(page).toContain('"The 2-minute guide: every job, the 30 days, getting paid"');
  expect(page).toMatch(/installer \? "The 2-minute guide: every job, the 30 days, getting paid" : "One minute: every job and getting paid"/);
});

import { guideTabTitle } from "../src/lib/trade-view.core";
test("browser tab says Electrician guide for electricians; installers unchanged", () => {
  expect(guideTabTitle("electrician")).toBe("Electrician guide – Home Insulation Victoria");
  expect(guideTabTitle("installer")).toBe("Installer guide – Home Insulation Victoria");
  const page = readFileSync("src/routes/_authenticated/field.guide.tsx", "utf8");
  expect(page).toContain('{ title: "Installer guide – Home Insulation Victoria" }');
  const elec = page.slice(page.indexOf("function ElectricianGuide"), page.indexOf("function InstallerGuide"));
  expect(elec).toContain('useEffect(() => { document.title = guideTabTitle("electrician"); }, []);');
  const inst = page.slice(page.indexOf("function InstallerGuide"));
  expect(inst).not.toContain("document.title");
});
