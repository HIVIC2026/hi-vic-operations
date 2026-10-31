// Decision 278 (Jo 25 Oct 2026): the price stays with the boss, out of Mitti. Decision 289: the card asks price + what is
// included only (the electrician is chosen once at Add a job). Decision 290 (corrected): the card shows the Ready Check's
// access rating as the flag, no fee question. Pure rules + the wiring facts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ELECTRICIAN_CHOICE_LABEL, INSTALLER_PRICE_EVENT, NOT_ON_READY_CHECK, PRICE_FORM_LABELS, PRICE_ISSUES, PRICE_LOCKED, PRICE_NOT_ENTERED, accessFlagLine, priceEventSummary, formHasPrice, installerPriceFromEvent, installerPriceState, priceCardLines, priceCardLocked, priceFromPortal, priceEntriesFromRecord, readyCheckDetailLines, validateInstallerPrice, withInstallerPrice,
} from "../src/lib/installer-price.core";
import { quotedPriceFromEntries } from "../src/lib/installer-led.core";
import { contactAnswersFromEntries } from "../src/lib/mitti.core";
import { resolveMittiElectrician } from "../src/lib/usual-electrician.core";
import { accessFlagFromEntries, readyCheckRemovalRequired } from "../src/lib/ready-check-answers.core";
import { PRICE_NEXT_ACTION, formHasInstallerAnswers, isPriceNextAction, needsFinishingFromMissing, readyCheckBasics } from "../src/lib/ready-check-basics.core";
import { installerStatusLine, needsFinishingList } from "../src/lib/installer-screens.core";
import { needsFinishingItems } from "../src/lib/installer-home.core";
import { needsFinishingTask } from "../src/lib/trade-view.core";
import { FORMS, mittiAiPrompt, validateTemplate } from "../src/lib/mitti-forms.core";
import { A1_QUOTE_QUESTIONS, LEAN_Q } from "../src/lib/ready-check-lean.core";

const ok = { priceIncGst: "2,400", included: ["Ceiling insulation - supply & install"] };

describe("validateInstallerPrice (pure, fails closed) — price + what is included only (decision 289)", () => {
  test("price inc GST > 0, included from the Mitti options; no electrician on the record", () => {
    const r = validateInstallerPrice(ok);
    expect(r).toEqual({ ok: true, issues: [], record: { price_inc_gst: 2400, included: ["Ceiling insulation - supply & install"], included_other: null, electrician: null, product_option: null, notes: null } });
  });
  test("every branch has its own plain issue; there is no electrician issue any more", () => {
    expect(validateInstallerPrice({ ...ok, priceIncGst: "0" }).issues).toEqual([PRICE_ISSUES.price]);
    expect(validateInstallerPrice({ ...ok, priceIncGst: "abc" }).issues).toEqual([PRICE_ISSUES.price]);
    expect(validateInstallerPrice({ ...ok, included: [] }).issues).toEqual([PRICE_ISSUES.included]);
    expect(validateInstallerPrice({ ...ok, included: ["Removal of existing insulation"] }).issues).toEqual([PRICE_ISSUES.base]);
    expect(validateInstallerPrice({ ...ok, included: ["Ceiling insulation - supply & install", "Other"] }).issues).toEqual([PRICE_ISSUES.other]);
    expect(validateInstallerPrice({ ...ok, included: ["Ceiling insulation - supply & install", "Not an option"] }).ok).toBe(true); // unknown ticks are dropped, never invented
    expect(Object.keys(PRICE_ISSUES)).toEqual(["price", "included", "base", "other", "noRemoval", "product", "notes"]);
    expect(validateInstallerPrice({ ...ok, included: ["Ceiling insulation - supply & install", "Other"], includedOther: "Whirlybird" }).record?.included_other).toBe("Whirlybird");
  });
  test("the stored event reads back; malformed events are never a price; a legacy electrician block is kept, a bad one dropped", () => {
    const rec = validateInstallerPrice(ok).record!;
    expect(installerPriceFromEvent({ ...rec, business_id: "b", set_by: "u" })).toEqual(rec);
    expect(installerPriceFromEvent(null)).toBeNull();
    expect(installerPriceFromEvent({ price_inc_gst: "nope", included: [] })).toBeNull();
    // Records saved before decision 289 carry the electrician the boss picked on the card; they still read.
    const legacy = { price_inc_gst: 3100, included: ["Ceiling insulation - supply & install"], included_other: null, electrician: { choice: "usual", name: "Sam Lee", licence: "A12345", price_inc_gst: 300 } };
    expect(installerPriceFromEvent(legacy)?.electrician).toEqual({ choice: "usual", name: "Sam Lee", licence: "A12345", price_inc_gst: 300 });
    expect(installerPriceFromEvent({ ...legacy, electrician: { choice: "someone" } })?.electrician).toBeNull();
    expect(INSTALLER_PRICE_EVENT).toBe("installer_price_set");
  });
});

describe("portal price FIRST, old-form answers as the fallback", () => {
  const rec = validateInstallerPrice({ priceIncGst: 3100, included: ["Ceiling insulation - supply & install", "Removal of existing insulation"] }).record!;
  const legacyRec = { ...rec, electrician: { choice: "different" as const, name: "Jo Volt", licence: "B99", price_inc_gst: 250 } };
  const oldForm = [{ label: "Length (m)", value: "10" }, { label: LEAN_Q.totalPrice, value: "999" }, { label: LEAN_Q.included, value: "Ceiling insulation - supply & install" }, { label: LEAN_Q.electrician, value: "Home Insulation Victoria electrician" }];
  test("the record becomes the Mitti-labelled answers every reader already understands; the form's electrician answer is left alone", () => {
    const merged = withInstallerPrice(oldForm, rec);
    expect(merged.filter((e) => e.label === LEAN_Q.totalPrice)).toEqual([{ label: LEAN_Q.totalPrice, value: "3100" }]);
    expect(merged.find((e) => e.label === "Length (m)")).toEqual({ label: "Length (m)", value: "10" });
    const q = quotedPriceFromEntries(merged as { label: string; value: string | null }[], true);
    expect(q.ok).toBe(true);
    expect(q.price).toMatchObject({ totalIncGst: 3100, included: ["R5.0 supply and install", "Removal of existing insulation"] });
    // Decision 289: a new record says nothing about the electrician — an old form's own answer still reads (legacy), the
    // job's recorded choice decides otherwise (electrician-choice.core).
    expect(contactAnswersFromEntries(merged as { label: string; value: string | null }[]).electricianChoice).toBe("hivic");
    expect(contactAnswersFromEntries(withInstallerPrice([{ label: "Length (m)", value: "10" }], rec) as { label: string; value: string | null }[]).electricianChoice).toBeNull();
  });
  test("a legacy record (before decision 289) still replaces the form's electrician answers with the card's", () => {
    const merged = withInstallerPrice(oldForm, legacyRec);
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
    expect(priceEntriesFromRecord(rec).map((e) => e.label)).toEqual([LEAN_Q.included, LEAN_Q.includedOther, LEAN_Q.totalPrice]);
    expect(priceEntriesFromRecord(legacyRec).map((e) => e.label)).toEqual([LEAN_Q.included, LEAN_Q.includedOther, LEAN_Q.totalPrice, LEAN_Q.electrician, LEAN_Q.electricianName, LEAN_Q.electricianLicence, LEAN_Q.electricianPrice]);
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
  test("card lines never guess: price + includes only; no electrician line", () => {
    expect(priceCardLines(rec)).toEqual({ price: "$3,100 inc GST", included: "Ceiling insulation - supply & install · Removal of existing insulation", product: null, notes: null });
    expect(Object.keys(priceCardLines(legacyRec))).toEqual(["price", "included", "product", "notes"]);
  });
});

describe("decision 290 (corrected): the access flag on the price card = the Ready Check rating + issue notes, never a fee", () => {
  test("new form: rating + per-area issue notes; no rating yet → nothing shown", () => {
    const entries = [{ label: LEAN_Q.access, value: "Difficult" }, { label: LEAN_Q.issueNote, value: "Tight manhole in the hallway" }, { label: LEAN_Q.issueNote, value: "Exposed wiring over the kitchen" }, { label: LEAN_Q.issueNote, value: "Tight manhole in the hallway" }];
    expect(accessFlagFromEntries(entries)).toEqual({ rating: "Difficult", issues: ["Tight manhole in the hallway", "Exposed wiring over the kitchen"] });
    expect(accessFlagLine(accessFlagFromEntries(entries))).toBe("Ceiling access: Difficult · Issues: Tight manhole in the hallway; Exposed wiring over the kitchen");
    expect(accessFlagLine(accessFlagFromEntries([{ label: LEAN_Q.access, value: "Easy" }]))).toBe("Ceiling access: Easy");
    expect(accessFlagLine(accessFlagFromEntries([{ label: "Length (m)", value: "10" }]))).toBeNull();
  });
  test("old forms: the 22–24 Oct wording still reads; a legacy fee answer is never part of the flag", () => {
    expect(accessFlagFromEntries([{ label: "How easy is the ceiling access?", value: "Difficult" }, { label: "Please explain", value: "Low pitch" }, { label: "Is there a difficult access charge?", value: "Yes" }, { label: "Difficult access fee ($ inc GST)", value: "250" }]))
      .toEqual({ rating: "Difficult", issues: ["Low pitch"] });
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
    // Decision 289: the card never validates an electrician; the view shows the job's recorded choice read-only.
    // Jo 27 Oct 2026: the same pure check also receives the current Ready Check's removal flag.
    expect(s).toContain("const v = validateInstallerPrice({ ...input, removalRequired });");
    expect(s).toContain("readElectricianChoice(jobId)");
    expect(s).toContain("const access = accessFlagFromEntries(entries)");
    // The READ module is on the autoAdvance graph: never Mitti, never a sender (tests/comms.test.ts).
    const r = read("src/lib/installer-price.server.ts");
    expect(r).not.toMatch(/mitti\.server|auto-quote-send|installer-quote\.server|pilot\.server|logEvent/);
  });
  test("functions: literal createServerFn chains, no react-start/server import, no electrician fields", () => {
    const s = read("src/lib/installer-price.functions.ts");
    expect(s.match(/createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)/g)?.length).toBe(3);
    expect(s).not.toContain("@tanstack/react-start/server");
    expect(s).not.toMatch(/electrician: z\.enum|different: z\.object/);
  });
  test("quote pipeline reads the portal price first: draft, basics, chase, auto-send hold, completion", () => {
    expect(read("src/lib/installer-quote.server.ts")).toContain("entriesWithInstallerPrice(jobId, formEntries)");
    // Batch 3a: basics read through entriesWithInstallerPrice (portal price first; old form price dropped after a new-quote request).
    expect(read("src/lib/ready-check-basics.server.ts")).toContain("entriesWithInstallerPrice(jobId, formEntries)");
    expect(read("src/lib/ready-check-chase.server.ts")).toContain("entriesWithInstallerPrice(p.jobId, p.entries)");
    expect(read("src/lib/auto-quote-send.server.ts")).toContain("await held(jobId, `price:${jobId}`, [PRICE_NOT_ENTERED]);");
    expect(read("src/lib/mitti-complete.server.ts")).toContain("enabled: sendEnabled, entries: i.entries");
  });
  test("job page: the card renders for the boss on their own jobs only; staff see nothing about price; no electrician question on the card", () => {
    const page = read("src/routes/_authenticated/field.$jobId.tsx");
    expect(page).toContain('{page.boss && page.channel === "installer_sourced" && <InstallerPriceCard jobId={jobId} />}');
    expect(page).not.toContain("Your price goes in the Mitti form");
    expect(read("src/lib/trade-view.server.ts")).toContain("pay: { amount: c.boss ? pay : null");
    // The owner's quote (with the boss's figures) is status-only for team members on installer jobs.
    // (Speed, decision 280: the read body lives in my-owner-quote.server.ts so the installer job bundle shares it.)
    expect(read("src/lib/installer-quote-status.functions.ts")).toContain("myOwnerQuoteFor(");
    expect(read("src/lib/my-owner-quote.server.ts")).toContain("if (!ctx?.boss) return { applies: true as const, priceHidden: true as const");
    const card = read("src/components/trade/InstallerPriceCard.tsx");
    expect(card).toContain("if (!view?.canSet) return null;");
    expect(card).not.toMatch(/Who is doing the electrical safety check\?|ip-electrician|setElectrician|Electrician licence number/);
    expect(card).toContain("accessFlagLine(view.access)");
    expect(card).toContain("id={PRICE_CARD_ANCHOR}"); // the decision-288 text deep-links here
    // Decision 289: the installer job page's "enter your price" line no longer asks about the electrician.
    expect(read("src/lib/installer-screens.core.ts")).not.toContain("who does the electrical safety check");
  });
  test("the price prompt file exists and the A1 build sheet title no longer says 'with quoted price'", () => {
    expect(read("docs/MITTI_READY_CHECK_PRICE_PROMPT.md")).toContain("Your quote to the homeowner");
    expect(FORMS.ready_check_priced.title).not.toContain("with quoted price");
  });
  test("decision 290: the A2 quote never reads an access fee from the form; A1 keeps reading a legacy fee answer only", () => {
    const a2 = read("src/lib/quotes.server.ts");
    expect(a2).not.toContain("difficultAccessFee(");
    // Decision 341: the only access line is the installer's agreed DIFFICULT_ACCESS rate on a "Difficult" rating.
    expect(a2).toContain('installerDifficultAccessExGst: rate("DIFFICULT_ACCESS")');
    expect(read("src/lib/ready-check-answers.core.ts")).toContain("vals(entries, [LEAN_REMOVE.accessCharge])");
  });
  test("A9: the price box, price step and price save are for installers' own jobs only; the HIV quote builder refuses them and prices from the installer's agreed rates", () => {
    expect(priceFromPortal("installer_sourced")).toBe(true);
    expect(priceFromPortal("hivic_sourced")).toBe(false);
    expect(installerPriceState({ channel: "hivic_sourced", record: null, entries: [] })).toEqual({ required: false, present: true, source: null });
    expect(installerStatusLine({ channel: "hivic_sourced", formLinked: true, formCompleted: true, formHasAnswers: true, priceEntered: false, boss: true, quoteLine: null }).kind).not.toBe("price");
    expect(read("src/routes/_authenticated/field.$jobId.tsx")).toContain('page.boss && page.channel === "installer_sourced" && <InstallerPriceCard');
    const set = read("src/lib/installer-price-set.server.ts");
    expect(set).toContain("if (!priceFromPortal(j.channel) || !j.originating_installer_business_id) throw new WorkflowError(\"Only your own customers' jobs take your price here.\");");
    expect(set).toContain("if (!j || !priceFromPortal(j.channel) || !j.originating_installer_business_id) return null;");
    const q = read("src/lib/quotes.server.ts");
    expect(q).toContain('if (jobRow.channel === "installer_sourced" || jobRow.installer_led) throw new WorkflowError(');
    expect(q).toContain("if (!inst?.business_id) throw new WorkflowError(\"Assign the installer before quoting – the quote uses that installer's agreed rates.\");");
    expect(q).toContain('const card = await activeRateCard("installer", inst.business_id, false);');
  });
});

// Jo 27 Oct 2026: when the job's current Ready Check says there is no removal, the installer can't tick "Removal of
// existing insulation" — the screen refuses the tap (with the reason under it) and the server check refuses it too.
describe("removal tick refused when the Ready Check says no removal (Jo 27 Oct 2026)", () => {
  const withRemoval = { ...ok, included: ["Ceiling insulation - supply & install", "Removal of existing insulation"] };
  test("Ready Check positively says no removal → removal tick refused, with Jo's exact wording", () => {
    const r = validateInstallerPrice({ ...withRemoval, removalRequired: false });
    expect(r.ok).toBe(false);
    expect(r.record).toBeNull();
    expect(r.issues).toEqual([PRICE_ISSUES.noRemoval]);
    expect(PRICE_ISSUES.noRemoval).toBe("Your Ready Check in Mitti says there's no removal on this job. If there is, add the removal area to the Mitti form first, then you can include it here.");
  });
  test("removal on the Ready Check → nothing changes; unknown (no Ready Check / old callers) → nothing changes", () => {
    expect(validateInstallerPrice({ ...withRemoval, removalRequired: true }).ok).toBe(true);
    expect(validateInstallerPrice({ ...withRemoval, removalRequired: null }).ok).toBe(true);
    expect(validateInstallerPrice(withRemoval).ok).toBe(true); // field absent: never blocked, never guessed
    expect(validateInstallerPrice({ ...ok, removalRequired: false }).ok).toBe(true); // no removal tick anyway
  });
  test("readyCheckRemovalRequired: current measurement + per-area removal m², null when no current Ready Check", () => {
    const removalEntry = { label: "How much existing insulation needs to be removed? (m²)", value: "40" };
    expect(readyCheckRemovalRequired([], null)).toBeNull(); // no current Ready Check → unknown
    expect(readyCheckRemovalRequired([], undefined)).toBeNull();
    expect(readyCheckRemovalRequired([], { removal_required: false })).toBe(false);
    expect(readyCheckRemovalRequired([removalEntry], { removal_required: false })).toBe(true); // form m² wins over the flag
    expect(readyCheckRemovalRequired([], { removal_required: true })).toBe(true);
    expect(readyCheckRemovalRequired([{ label: "How much existing insulation needs to be removed? (m²)", value: "0" }], { removal_required: false })).toBe(false);
  });
  test("wiring: the card blocks the tap and shows the note under the tickbox; the server passes the flag into the same check", () => {
    const read = (f: string) => readFileSync(f, "utf8");
    const card = read("src/components/trade/InstallerPriceCard.tsx");
    expect(card).toContain("view?.removalRequired === false");
    expect(card).toContain("setRemovalNote(true)");
    expect(card).toContain("data-removal-note");
    expect(card).toContain("removalRequired: view.removalRequired");
    const server = read("src/lib/installer-price-set.server.ts");
    expect(server).toContain("removal_required");
    expect(server).toContain("validateInstallerPrice({ ...input, removalRequired })");
  });
});

describe("Ready Check detail rows above the price box (Jo 27 Oct 2026, redone after the 06:07 push)", () => {
  test("install m² from the current measurement; removal 'None' when the Ready Check says no removal", () => {
    expect(readyCheckDetailLines({ hasReadyCheck: true, installAreaM2: 75, removalRequired: false, removalM2: null })).toEqual({ install: "75 m²", removal: "None" });
  });
  test("removal m² shown when there is removal; missing values read 'Not on the Ready Check yet'", () => {
    expect(readyCheckDetailLines({ hasReadyCheck: true, installAreaM2: 140, removalRequired: true, removalM2: 32 })).toEqual({ install: "140 m²", removal: "32 m²" });
    expect(readyCheckDetailLines({ hasReadyCheck: true, installAreaM2: null, removalRequired: true, removalM2: null })).toEqual({ install: NOT_ON_READY_CHECK, removal: NOT_ON_READY_CHECK });
  });
  test("no current Ready Check at all = both rows 'Not on the Ready Check yet'", () => {
    expect(readyCheckDetailLines({ hasReadyCheck: false, installAreaM2: null, removalRequired: null, removalM2: null })).toEqual({ install: NOT_ON_READY_CHECK, removal: NOT_ON_READY_CHECK });
  });
  test("the card shows the three rows above the price, from the server's readyCheck view", () => {
    const read = (f: string) => readFileSync(f, "utf8");
    const card = read("src/components/trade/InstallerPriceCard.tsx");
    expect(card).toContain('label="Install m²"');
    expect(card).toContain('label="Removal m²"');
    expect(card).toContain('label="Access"');
    const server = read("src/lib/installer-price-set.server.ts");
    expect(server).toContain("measured_area_m2");
    expect(server).toContain("readyCheckDetailLines");
    expect(server).toContain("removalTotalM2");
  });
});

describe("product + notes (Jo 31 Oct 2026)", () => {
  const rec = validateInstallerPrice(ok).record!;
  const form = (e: { label: string; value: string | null }[]) => contactAnswersFromEntries(e);
  test("product is canonicalised, notes trimmed; bad product / long notes refused; blank notes null; no product null", () => {
    const r = validateInstallerPrice({ ...ok, productOption: "bradford gold r6", notes: "  side access only " }).record;
    expect(r).toMatchObject({ product_option: "Bradford Gold R6", notes: "side access only" });
    expect(validateInstallerPrice({ ...ok, productOption: "Mystery R9" }).issues).toEqual([PRICE_ISSUES.product]);
    expect(validateInstallerPrice({ ...ok, notes: "x".repeat(1001) }).issues).toEqual([PRICE_ISSUES.notes]);
    expect(validateInstallerPrice({ ...ok, notes: "x".repeat(1000) }).ok).toBe(true);
    expect(validateInstallerPrice({ ...ok, notes: "   " }).record?.notes).toBeNull();
    expect(validateInstallerPrice({ ...ok, notes: "" }).record?.notes).toBeNull();
    expect(validateInstallerPrice(ok).record?.product_option).toBeNull();
    expect(PRICE_ISSUES.product).toBe("Pick a product from the list.");
    expect(PRICE_ISSUES.notes).toBe("Keep notes under 1,000 characters.");
  });
  test("old events read product_option/notes as null; a stored bad product reads null; good values read back", () => {
    const old = { price_inc_gst: 2400, included: ["Ceiling insulation - supply & install"], included_other: null, electrician: null };
    expect(installerPriceFromEvent(old)).toMatchObject({ product_option: null, notes: null });
    expect(installerPriceFromEvent({ ...old, product_option: "Mystery R9", notes: "hi" })).toMatchObject({ product_option: null, notes: "hi" });
    expect(installerPriceFromEvent({ ...old, product_option: "Earthwool R5", notes: "  " })).toMatchObject({ product_option: "Earthwool R5", notes: null });
  });
  test("withInstallerPrice swaps the form's product for the portal's (one entry), adds it when absent, keeps the form's when null", () => {
    const withProd = { ...rec, product_option: "Fletchers Pink Batts R7" };
    const out = withInstallerPrice([{ label: LEAN_Q.product, value: "Bradford Gold R5" }, { label: "Insulation product", value: "Earthwool R5" }], withProd) as { label: string; value: string | null }[];
    expect(form(out).productOption).toBe("Fletchers Pink Batts R7");
    expect(out.filter((e) => e.label === LEAN_Q.product || e.label === "Insulation product")).toHaveLength(1);
    expect(form(withInstallerPrice([{ label: "Length (m)", value: "10" }], withProd) as { label: string; value: string | null }[]).productOption).toBe("Fletchers Pink Batts R7");
    const kept = withInstallerPrice([{ label: LEAN_Q.product, value: "Bradford Gold R5" }], rec) as { label: string; value: string | null }[];
    expect(form(kept).productOption).toBe("Bradford Gold R5");
  });
  test("notes are office-only: never emitted as an entry; product only when set", () => {
    const e = priceEntriesFromRecord({ ...rec, notes: "secret", product_option: "Earthwool R5" });
    expect(e.some((x) => String(x.value).includes("secret"))).toBe(false);
    expect(e).toContainEqual({ label: LEAN_Q.product, value: "Earthwool R5" });
    expect(priceEntriesFromRecord(rec).some((x) => x.label === LEAN_Q.product)).toBe(false);
    expect(priceCardLines({ ...rec, notes: "n", product_option: "Earthwool R5" })).toMatchObject({ product: "Earthwool R5", notes: "n" });
    expect(priceCardLines(rec)).toMatchObject({ product: null, notes: null });
  });
  test("priceCardLocked: locked once a quote is sent unless a newer new-quote request exists", () => {
    const sent = "2026-10-31T01:00:00Z";
    expect(priceCardLocked({ quoteSentAt: null, newQuoteRequestedAt: null })).toBe(false);
    expect(priceCardLocked({ quoteSentAt: null, newQuoteRequestedAt: sent })).toBe(false);
    expect(priceCardLocked({ quoteSentAt: sent, newQuoteRequestedAt: null })).toBe(true);
    expect(priceCardLocked({ quoteSentAt: sent, newQuoteRequestedAt: "2026-10-31T02:00:00Z" })).toBe(false);
    expect(priceCardLocked({ quoteSentAt: sent, newQuoteRequestedAt: "2026-10-31T00:30:00Z" })).toBe(true);
    expect(PRICE_LOCKED).toBe("Quote sent — call the office to change this.");
  });
  test("priceEventSummary: product changed / unchanged / none chosen / notes", () => {
    const base = "Price entered by the business owner: $2,400 inc GST";
    expect(priceEventSummary({ record: rec, previousProduct: null })).toBe(base);
    expect(priceEventSummary({ record: { ...rec, product_option: "Earthwool R5" }, previousProduct: "Bradford Gold R5" })).toBe(`${base} · Product changed from Bradford Gold R5 to Earthwool R5`);
    expect(priceEventSummary({ record: { ...rec, product_option: "Earthwool R5" }, previousProduct: null })).toBe(`${base} · Product changed from none to Earthwool R5`);
    expect(priceEventSummary({ record: { ...rec, product_option: "Earthwool R5" }, previousProduct: "Earthwool R5" })).toBe(base);
    expect(priceEventSummary({ record: { ...rec, notes: "side access only" }, previousProduct: "Earthwool R5" })).toBe(`${base} · Notes: side access only`);
    expect(priceEventSummary({ record: { ...rec, product_option: "Earthwool R5", notes: "n" }, previousProduct: "Bradford Gold R5" })).toBe(`${base} · Product changed from Bradford Gold R5 to Earthwool R5 · Notes: n`);
  });
  test("wiring: lock checked in the view and before writing; product/notes pass through; function validator", () => {
    const set = readFileSync("src/lib/installer-price-set.server.ts", "utf8");
    const view = set.slice(set.indexOf("export async function installerPriceView"), set.indexOf("async function prepareQuoteFromPortal"));
    const save = set.slice(set.indexOf("export async function setInstallerPrice"), set.indexOf("export async function switchToHivElectrician"));
    expect(view).toContain("priceCardLocked(");
    expect(view).toContain("locked");
    expect(view).toContain("productOptions");
    expect(view).toContain("mittiProduct");
    expect(save).toContain("priceCardLocked(");
    expect(save).toContain("throw new WorkflowError(PRICE_LOCKED)");
    expect(save.indexOf("priceCardLocked(")).toBeLessThan(save.indexOf("logEvent("));
    expect(save).toContain("priceEventSummary(");
    expect(save).toContain("internal: true");
    const fns = readFileSync("src/lib/installer-price.functions.ts", "utf8");
    expect(fns).toContain("productOption: z.string().max(80).optional().nullable()");
    expect(fns).toContain("notes: z.string().max(1000).optional().nullable()");
    expect(readFileSync("src/lib/installer-price.server.ts", "utf8")).toContain("export async function readInstallerPriceState");
  });
});
