// Decision 278 (Jo 25 Oct 2026): the price stays with the boss, out of Mitti. Pure rules + the wiring facts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ELECTRICIAN_CHOICE_LABEL, INSTALLER_PRICE_EVENT, PRICE_FORM_LABELS, PRICE_ISSUES, PRICE_NOT_ENTERED, formHasPrice, installerPriceFromEvent, installerPriceState, priceCardLines, priceEntriesFromRecord, validateInstallerPrice, withInstallerPrice,
} from "../src/lib/installer-price.core";
import { quotedPriceFromEntries } from "../src/lib/installer-led.core";
import { contactAnswersFromEntries } from "../src/lib/mitti.core";
import { resolveMittiElectrician } from "../src/lib/usual-electrician.core";
import { PRICE_NEXT_ACTION, formHasInstallerAnswers, isPriceNextAction, needsFinishingFromMissing, readyCheckBasics } from "../src/lib/ready-check-basics.core";
import { needsFinishingList } from "../src/lib/installer-screens.core";
import { needsFinishingItems } from "../src/lib/installer-home.core";
import { needsFinishingTask } from "../src/lib/trade-view.core";
import { FORMS, mittiAiPrompt, validateTemplate } from "../src/lib/mitti-forms.core";
import { A1_QUOTE_QUESTIONS, LEAN_Q } from "../src/lib/ready-check-lean.core";

const usual = { name: "Sam Lee", licence: "A12345", priceIncGst: 300 };
const ok = { priceIncGst: "2,400", included: ["Ceiling insulation - supply & install"], electrician: "hivic" as const };

describe("validateInstallerPrice (pure, fails closed)", () => {
  test("price inc GST > 0, included from the Mitti options, one of three electrician choices", () => {
    const r = validateInstallerPrice(ok, { usualElectrician: null });
    expect(r).toEqual({ ok: true, issues: [], record: { price_inc_gst: 2400, included: ["Ceiling insulation - supply & install"], included_other: null, electrician: { choice: "hivic", name: null, licence: null, price_inc_gst: null } } });
  });
  test("every branch has its own plain issue", () => {
    expect(validateInstallerPrice({ ...ok, priceIncGst: "0" }, { usualElectrician: null }).issues).toEqual([PRICE_ISSUES.price]);
    expect(validateInstallerPrice({ ...ok, priceIncGst: "abc" }, { usualElectrician: null }).issues).toEqual([PRICE_ISSUES.price]);
    expect(validateInstallerPrice({ ...ok, included: [] }, { usualElectrician: null }).issues).toEqual([PRICE_ISSUES.included]);
    expect(validateInstallerPrice({ ...ok, included: ["Removal of existing insulation"] }, { usualElectrician: null }).issues).toEqual([PRICE_ISSUES.base]);
    expect(validateInstallerPrice({ ...ok, included: ["Ceiling insulation - supply & install", "Other"] }, { usualElectrician: null }).issues).toEqual([PRICE_ISSUES.other]);
    expect(validateInstallerPrice({ ...ok, included: ["Ceiling insulation - supply & install", "Not an option"] }, { usualElectrician: null }).ok).toBe(true); // unknown ticks are dropped, never invented
    expect(validateInstallerPrice({ ...ok, electrician: null }, { usualElectrician: null }).issues).toEqual([PRICE_ISSUES.electrician]);
    expect(validateInstallerPrice({ ...ok, electrician: "usual" }, { usualElectrician: null }).issues).toEqual([PRICE_ISSUES.usual]);
    expect(validateInstallerPrice({ ...ok, electrician: "different", different: { name: "X", licence: "", priceIncGst: "100" } }, { usualElectrician: null }).issues).toEqual([PRICE_ISSUES.different]);
  });
  test("my usual electrician comes from My business; a different electrician from the card", () => {
    expect(validateInstallerPrice({ ...ok, electrician: "usual" }, { usualElectrician: usual }).record?.electrician).toEqual({ choice: "usual", name: "Sam Lee", licence: "A12345", price_inc_gst: 300 });
    expect(validateInstallerPrice({ ...ok, electrician: "different", different: { name: "Jo Volt", licence: "B99", priceIncGst: "$250.50" } }, { usualElectrician: null }).record?.electrician).toEqual({ choice: "different", name: "Jo Volt", licence: "B99", price_inc_gst: 250.5 });
    expect(validateInstallerPrice({ ...ok, included: ["Ceiling insulation - supply & install", "Other"], includedOther: "Whirlybird" }, { usualElectrician: null }).record?.included_other).toBe("Whirlybird");
  });
  test("the stored event reads back; malformed events are never a price", () => {
    const rec = validateInstallerPrice({ ...ok, electrician: "usual" }, { usualElectrician: usual }).record!;
    expect(installerPriceFromEvent({ ...rec, business_id: "b", set_by: "u" })).toEqual(rec);
    expect(installerPriceFromEvent(null)).toBeNull();
    expect(installerPriceFromEvent({ price_inc_gst: "nope", included: [], electrician: { choice: "hivic" } })).toBeNull();
    expect(installerPriceFromEvent({ price_inc_gst: 100, included: [], electrician: { choice: "someone" } })).toBeNull();
    expect(INSTALLER_PRICE_EVENT).toBe("installer_price_set");
  });
});

describe("portal price FIRST, old-form answers as the fallback", () => {
  const rec = validateInstallerPrice({ priceIncGst: 3100, included: ["Ceiling insulation - supply & install", "Removal of existing insulation"], electrician: "different", different: { name: "Jo Volt", licence: "B99", priceIncGst: 250 } }, { usualElectrician: null }).record!;
  const oldForm = [{ label: "Length (m)", value: "10" }, { label: LEAN_Q.totalPrice, value: "999" }, { label: LEAN_Q.included, value: "Ceiling insulation - supply & install" }, { label: LEAN_Q.electrician, value: "Home Insulation Victoria electrician" }];
  test("the record becomes the Mitti-labelled answers every reader already understands", () => {
    const merged = withInstallerPrice(oldForm, rec);
    expect(merged.filter((e) => e.label === LEAN_Q.totalPrice)).toEqual([{ label: LEAN_Q.totalPrice, value: "3100" }]);
    expect(merged.find((e) => e.label === "Length (m)")).toEqual({ label: "Length (m)", value: "10" });
    const q = quotedPriceFromEntries(merged as { label: string; value: string | null }[], true);
    expect(q.ok).toBe(true);
    expect(q.price).toMatchObject({ totalIncGst: 3100, included: ["R5.0 supply and install", "Removal of existing insulation"] });
    const a = contactAnswersFromEntries(merged as { label: string; value: string | null }[]);
    expect(a).toMatchObject({ electricianChoice: "different", electricianName: "Jo Volt", electricianLicence: "B99", electricianPriceIncGst: "250" });
    expect(resolveMittiElectrician({ choice: a.electricianChoice as "different", usual: null, different: { name: a.electricianName, licence: a.electricianLicence, priceIncGst: a.electricianPriceIncGst } })).toMatchObject({ ready: true, priceIncGst: 250, name: "Jo Volt" });
  });
  test("no record → the form answers stand untouched (old forms keep working)", () => {
    expect(withInstallerPrice(oldForm, null)).toBe(oldForm);
    expect(quotedPriceFromEntries(oldForm as { label: string; value: string | null }[], false).price?.totalIncGst).toBe(999);
  });
  test("the labels the portal replaces are exactly the old A1 quote page's", () => {
    for (const q of A1_QUOTE_QUESTIONS) expect(PRICE_FORM_LABELS).toContain(q);
    expect(priceEntriesFromRecord(rec).map((e) => e.label)).toEqual([LEAN_Q.included, LEAN_Q.includedOther, LEAN_Q.totalPrice, LEAN_Q.electrician, LEAN_Q.electricianName, LEAN_Q.electricianLicence, LEAN_Q.electricianPrice]);
    expect(priceEntriesFromRecord({ ...rec, electrician: { choice: "usual", name: "Sam", licence: "A1", price_inc_gst: 300 } }).map((e) => e.label)).toEqual([LEAN_Q.included, LEAN_Q.includedOther, LEAN_Q.totalPrice, LEAN_Q.electrician]);
    expect(ELECTRICIAN_CHOICE_LABEL).toEqual({ hivic: "Home Insulation Victoria electrician", usual: "My usual electrician", different: "A different electrician" });
  });
  test("installerPriceState: A1 needs one (portal, else old form, else missing); A2 never", () => {
    expect(installerPriceState({ channel: "installer_sourced", record: rec, entries: [] })).toEqual({ required: true, present: true, source: "portal" });
    expect(installerPriceState({ channel: "installer_sourced", record: null, entries: oldForm })).toEqual({ required: true, present: true, source: "form" });
    expect(installerPriceState({ channel: "installer_sourced", record: null, entries: [{ label: "Length (m)", value: "10" }] })).toEqual({ required: true, present: false, source: null });
    expect(installerPriceState({ channel: "hivic_sourced", record: null, entries: [] })).toEqual({ required: false, present: true, source: null });
    expect(formHasPrice([{ label: LEAN_Q.totalPrice, value: "$0" }])).toBe(false);
    expect(PRICE_NOT_ENTERED).toBe("Price not entered by the business owner");
  });
  test("card lines never guess", () => {
    expect(priceCardLines(rec)).toEqual({ price: "$3,100 inc GST", included: "Ceiling insulation - supply & install · Removal of existing insulation", electrician: "A different electrician · Jo Volt · B99 · $250 inc GST" });
  });
});

describe("ready-check-basics: the price is a PORTAL basic, not a form item", () => {
  const full = { installerSourced: true, areaM2: 120, productReady: true, installerPriceIncGst: null, ownerMobile: "0400000000", ownerEmail: "a@b.co", contactPermission: true, stops: [], formCompleted: false };
  test("price missing alone → the job-page wording, never 'on the Mitti form'", () => {
    const r = readyCheckBasics(full);
    expect(r.missing).toEqual(["price"]);
    expect(needsFinishingFromMissing(r.missing)).toBe(PRICE_NEXT_ACTION);
    expect(PRICE_NEXT_ACTION).toBe("Needs finishing: your price on the job page");
  });
  test("form items + price missing → only the form items are Mitti work; the price follows once they are in", () => {
    expect(needsFinishingFromMissing(["ceiling area", "price", "owner mobile"])).toBe("Needs finishing: ceiling area, owner mobile on the Mitti form");
    expect(needsFinishingFromMissing([])).toBeNull();
  });
  test("every parser treats the price next step as not-a-Mitti-task", () => {
    expect(isPriceNextAction(PRICE_NEXT_ACTION)).toBe(true);
    expect(needsFinishingList(PRICE_NEXT_ACTION)).toEqual([]);
    expect(needsFinishingItems(PRICE_NEXT_ACTION)).toBeNull();
    expect(needsFinishingTask(PRICE_NEXT_ACTION)).toBeNull();
    // Legacy stored text still parses as before.
    expect(needsFinishingItems("Needs finishing: price, owner mobile/email/permission on the Mitti form")).toBe("price and owner details");
  });
  test("formHasInstallerAnswers ignores the portal pre-fill", () => {
    const prefill = [{ label: "Portal Job Number", value: "HV-1" }, { label: "Site address", value: "1 St" }, { label: "Homeowner name", value: "A" }, { label: "Homeowner phone", value: "04" }, { label: "Homeowner email", value: "a@b" }, { label: "Property type", value: "House" }, { label: "Life support equipment at property?", value: "No" }, { label: "Was the ceiling or roof built or replaced in the last 5 years?", value: "No" }, { label: "Length (m)", value: null }, { label: "Width (m)", value: "" }];
    expect(formHasInstallerAnswers(prefill)).toBe(false);
    expect(formHasInstallerAnswers([...prefill, { label: "Length (m)", value: "12" }])).toBe(true);
    expect(formHasInstallerAnswers([])).toBe(false);
  });
});

describe("Mitti template contract: A1 without 'Your quote to the homeowner' validates clean", () => {
  test("A1 spec carries none of the seven questions; the build prompt forbids them; A2 unchanged", () => {
    const a1 = FORMS.ready_check_priced.fields.map((f) => f.label);
    for (const q of A1_QUOTE_QUESTIONS) expect(a1).not.toContain(q);
    expect(a1.length).toBe(FORMS.ready_check.fields.length - 1); // A2 = A1 + the no-pricing tick
    expect(mittiAiPrompt("ready_check_priced")).toContain("Do NOT add a price, quote or electrician section");
    const items = FORMS.ready_check_priced.fields.map((f) => ({ label: f.label, type: f.type === "choice" || f.type === "yesno" ? "question" : f.type === "multichoice" || f.type === "tick" ? "checkbox" : f.type }));
    expect(validateTemplate("ready_check_priced", items)).toEqual({ ok: true, issues: [] });
  });
});

describe("wiring (source facts)", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  test("server: business admin only, append-only event, prepares through the existing guarded paths, never sends", () => {
    const s = read("src/lib/installer-price-set.server.ts");
    expect(s).toContain("await requireMember(userId, j.originating_installer_business_id, true);");
    expect(s).toContain('!== "business_admin") return null');
    expect(s).toContain("logEvent(jobId, userId, INSTALLER_PRICE_EVENT");
    expect(s).not.toMatch(/sendRealSms|sendGuardedOwnerEmail|releaseQuoteToOwner|\.update\(\{ *price/);
    // The READ module is on the autoAdvance graph: never Mitti, never a sender (tests/comms.test.ts).
    const r = read("src/lib/installer-price.server.ts");
    expect(r).not.toMatch(/mitti\.server|auto-quote-send|installer-quote\.server|pilot\.server|logEvent/);
  });
  test("functions: literal createServerFn chains, no react-start/server import", () => {
    const s = read("src/lib/installer-price.functions.ts");
    expect(s.match(/createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)/g)?.length).toBe(2);
    expect(s).not.toContain("@tanstack/react-start/server");
  });
  test("quote pipeline reads the portal price first: draft, basics, chase, auto-send hold, completion", () => {
    expect(read("src/lib/installer-quote.server.ts")).toContain("entriesWithInstallerPrice(jobId, formEntries)");
    expect(read("src/lib/ready-check-basics.server.ts")).toContain("withInstallerPrice(formEntries, priceRecord?.record ?? null)");
    expect(read("src/lib/ready-check-chase.server.ts")).toContain("entriesWithInstallerPrice(p.jobId, p.entries)");
    expect(read("src/lib/auto-quote-send.server.ts")).toContain("await held(jobId, `price:${jobId}`, [PRICE_NOT_ENTERED]);");
    expect(read("src/lib/mitti-complete.server.ts")).toContain("enabled: sendEnabled, entries: i.entries");
  });
  test("job page: the card renders for the boss on their own jobs only; staff see nothing about price", () => {
    const page = read("src/routes/_authenticated/field.$jobId.tsx");
    expect(page).toContain('{page.boss && page.channel === "installer_sourced" && <InstallerPriceCard jobId={jobId} />}');
    expect(page).not.toContain("Your price goes in the Mitti form");
    expect(read("src/lib/trade-view.server.ts")).toContain("pay: { amount: c.boss ? pay : null");
    // The owner's quote (with the boss's figures) is status-only for team members on installer jobs.
    expect(read("src/lib/installer-quote-status.functions.ts")).toContain("if (!ctx?.boss) return { applies: true as const, priceHidden: true as const");
    expect(read("src/components/trade/InstallerPriceCard.tsx")).toContain("if (!view?.canSet) return null;");
  });
  test("the price prompt file exists and the A1 build sheet title no longer says 'with quoted price'", () => {
    expect(read("docs/MITTI_READY_CHECK_PRICE_PROMPT.md")).toContain("Your quote to the homeowner");
    expect(FORMS.ready_check_priced.title).not.toContain("with quoted price");
  });
});
