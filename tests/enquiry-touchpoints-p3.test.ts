// Part 3 Task 15: enquiry / spot-saved touchpoints #1, #12, #13, #19, #20 (decisions file 2 Nov 2026).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { O10_NEXT_STEP_2, renderSpotSavedEmail, renderSpotSavedSms, spotSavedBasedOn, spotSavedText } from "../src/lib/spot-saved-messages.core";
import { PRE_RELEASE_FORBIDDEN, SPOT_INSTALLER_CALLS, preReleaseViolations, preReleaseViolationsAllowing } from "../src/lib/spot-only-copy.core";
import { HOMEOWNER_URL } from "../src/lib/interest.core";
import { oneTapSaveUrl, shouldAutoSaveSpot, shouldFireOneTapSave } from "../src/lib/one-tap-save.core";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("#20 Spot saved text", () => {
  test("approved wording, no link", () => {
    // Jo 5 Nov 2026 09:50 (verbatim): the text stands on its own for an owner who never saw the email.
    expect(spotSavedText("Sarah", "$2,380")).toBe("Home Insulation Victoria: Spot saved, Sarah! 🎉 Your $2,380 rebate is locked in — it comes off your price. Nothing to do now — spots are released in order. When an EEC-certified installer is available, they'll call you to book your free Ready Check. We've emailed the details (check Spam if it's not there).");
    expect(spotSavedText(null, "$2,380")).toContain("Spot saved! 🎉");
    expect(spotSavedText("Sarah", "$2,380")).not.toMatch(/https?:|Your job/);
  });
  test("renderSpotSavedSms is that text (whole dollars)", () => {
    const i = { firstName: "Sarah", rebate: 2380.4, suburb: null, shortAddress: null, myJobUrl: "https://x/my-job/t", optOutUrl: "https://x/u" };
    expect(renderSpotSavedSms(i)).toBe(spotSavedText("Sarah", "$2,380"));
  });
});

describe("#19 O10 Spot saved email", () => {
  const i = { firstName: "Sarah", rebate: 2380, suburb: null, shortAddress: null, myJobUrl: "https://x/my-job/t", optOutUrl: "https://x/u",
    estimate: { gross: 3798, customer: 2188, areaM2: 137, address: null, calculatorUrl: "https://x/calculator" } };
  test("step 2 is the installer-will-call step", () => {
    expect(O10_NEXT_STEP_2).toEqual({ title: "A certified installer will call you", body: "When an EEC-certified installer is available, they'll call you to book your free Ready Check. They'll measure up and confirm your quote." });
    const e = renderSpotSavedEmail(i);
    expect(e.text).toContain("A certified installer will call you");
    expect(e.text).toContain("They'll measure up and confirm your quote.");
    expect(e.text).not.toContain("we'll tell you your next step");
  });
  test("rebate box and not-included line use approved words", () => {
    const e = renderSpotSavedEmail(i);
    expect(e.text).not.toMatch(/VEU rebate|needs fixing/);
    expect(e.text).toContain("Your estimated rebate");
    expect(e.text).toContain("electrical safety check (PIESA) finds electrical upgrades are needed");
  });
  test("the pre-release check is opened for the O10 step 2 and spot saved text only", () => {
    const e = renderSpotSavedEmail(i);
    const allowed = [O10_NEXT_STEP_2.body, O10_NEXT_STEP_2.title, SPOT_INSTALLER_CALLS];
    expect(preReleaseViolationsAllowing(e.text, allowed)).toEqual([]);
    expect(preReleaseViolationsAllowing(spotSavedText("Sarah", "$2,380"), [SPOT_INSTALLER_CALLS])).toEqual([]);
    // The ordinary scanner is not widened.
    expect(preReleaseViolations(O10_NEXT_STEP_2.body).length).toBeGreaterThan(0);
    expect(PRE_RELEASE_FORBIDDEN.test("They'll call you to book your free Ready Check.")).toBe(true);
    expect(preReleaseViolationsAllowing(`${O10_NEXT_STEP_2.body} We'll call shortly.`, [O10_NEXT_STEP_2.body]).length).toBeGreaterThan(0);
  });
});

describe("#12 Spot saved screen + one-tap save", () => {
  test("based-on line", () => {
    expect(spotSavedBasedOn({ areaM2: 120, insulation: "no insulation" })).toBe("Based on what you told us: 120 m² ceiling, no insulation.");
  });
  test("email links save in one tap; redirects/plain visits do not", () => {
    expect(oneTapSaveUrl("https://e.x/estimate/tok/campaign")).toBe("https://e.x/estimate/tok/campaign?save=1");
    expect(oneTapSaveUrl("https://e.x/estimate/tok/campaign?a=b")).toBe("https://e.x/estimate/tok/campaign?a=b&save=1");
    expect(shouldAutoSaveSpot({ save: "1", saveAllowed: true, spotSavedAt: null, optedOutAt: null })).toBe(true);
    expect(shouldAutoSaveSpot({ save: undefined, saveAllowed: true, spotSavedAt: null, optedOutAt: null })).toBe(false);
    expect(shouldAutoSaveSpot({ save: "1", saveAllowed: false, spotSavedAt: null, optedOutAt: null })).toBe(false);
    expect(shouldAutoSaveSpot({ save: "1", saveAllowed: true, spotSavedAt: "2026-11-01", optedOutAt: null })).toBe(false);
    expect(shouldAutoSaveSpot({ save: "1", saveAllowed: true, spotSavedAt: null, optedOutAt: "2026-11-01" })).toBe(false);
  });
  test("campaign route auto-saves via the canonical save and shows the based-on line", () => {
    const s = src("src/routes/estimate_.$token.campaign.tsx");
    expect(s).toContain("shouldAutoSaveSpot");
    expect(s).toContain("spotSavedBasedOn");
    expect(s).not.toMatch(/lower power bills/);
  });
  test("one-tap save waits for a trusted tap or key press outside buttons, links and the opt-out", () => {
    const ok = { armed: true, alreadyFired: false, eventIsTrusted: true, eventType: "pointerdown", target: { closest: () => null } };
    expect(shouldFireOneTapSave(ok)).toBe(true);
    for (const eventType of ["touchstart", "keydown"]) expect(shouldFireOneTapSave({ ...ok, eventType })).toBe(true);
    expect(shouldFireOneTapSave({ ...ok, eventIsTrusted: false })).toBe(false);
    expect(shouldFireOneTapSave({ ...ok, armed: false })).toBe(false);
    expect(shouldFireOneTapSave({ ...ok, alreadyFired: true })).toBe(false);
    for (const eventType of ["scroll", "wheel"]) expect(shouldFireOneTapSave({ ...ok, eventType })).toBe(false);
    let asked = "";
    expect(shouldFireOneTapSave({ ...ok, target: { closest: (sel: string) => { asked = sel; return {}; } } })).toBe(false);
    expect(asked).toBe("button,a,[data-no-autosave]");
  });
  test("campaign effect no longer saves on mount", () => {
    const s = src("src/routes/estimate_.$token.campaign.tsx");
    expect(s).toContain("shouldFireOneTapSave");
    expect(s).toContain("isTrusted");
    expect(s).not.toMatch(/autoSaved\.current = true; void act\("save"\)/);
    const effect = s.slice(s.indexOf("useEffect("), s.indexOf("return <div className=\"estimate-brand"));
    expect(effect.match(/act\("save"\)/g)?.length).toBe(1);
    expect(effect.indexOf("isTrusted")).toBeGreaterThan(-1);
    expect(effect).not.toMatch(/"scroll"|"wheel"/);
    expect(s).toContain("data-no-autosave");
    expect(effect.indexOf('act("save")')).toBeGreaterThan(effect.indexOf("isTrusted"));
  });
  test("saved-estimate emails use the one-tap link", () => {
    expect(src("src/lib/jo-outcome-email.core.ts")).toContain("oneTapSaveUrl(");
    expect(src("src/lib/estimate-followup.core.ts")).toContain("oneTapSaveUrl(");
  });
});

describe("#13 3 quick questions page", () => {
  // Reversed by the photo-quote installers spec (Jo 5 Nov 2026, decision 10): the optional box is back.
  test("the optional photos / video box is back; the asks elsewhere stay", () => {
    const s = src("src/routes/estimate_.$token.video.tsx");
    expect(s).toMatch(/Got photos or a video\? \(optional\)/);
    expect(src("src/lib/owner-pages.core.ts")).not.toMatch(/addPhotos|addVideo/);
    expect(src("src/lib/jo-outcome-email.core.ts")).toContain("Got photos or a video?");
  });
});

describe("#1 Register my interest", () => {
  test("button goes to /homeowner and creates no enquiry", () => {
    expect(HOMEOWNER_URL).toBe("https://homeinsulationvictoria.com.au/homeowner");
    const s = src("src/components/portal/register-interest.tsx");
    expect(s).toContain("HOMEOWNER_URL");
    expect(s).not.toMatch(/registerInterest|useServerFn/);
  });
});
