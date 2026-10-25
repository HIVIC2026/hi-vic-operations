// Decisions 260–264: the "A3 – Install day" template. Wording drift against the build prompt, and the reader that turns an
// audit into the official PIISA answers (pure, run with `bun test`).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  INSTALL_DAY_AFTER_INSTALL_TEXT, INSTALL_DAY_AFTER_SIGN_TEXT, INSTALL_DAY_DECLARATION_START, INSTALL_DAY_READ_FIRST_TEXT, INSTALL_DAY_Q as Q, INSTALL_DAY_QUESTIONS, INSTALL_DAY_TEMPLATE_NAME,
  electricianPresentAnswer, installDayMedia, installDayMissingQuestions, installDayOfficialAnswers, installDayPrefillItems, isInstallDayDoc, piesaPart5Answers, readInstallDay,
  type InstallDayQuestion,
} from "../src/lib/install-day.core";
import { choiceOption } from "../src/lib/mitti.core";
import { readyCheckPart6Answers } from "../src/lib/piisa-a3.core";

const prompt = readFileSync("docs/MITTI_INSTALL_FORM_FIX_PROMPT.md", "utf8");
const TYPE: Record<string, InstallDayQuestion["type"]> = { Text: "text", Number: "number", Date: "date", "Yes/No": "yes_no", "Pick one": "pick_one", Photo: "photo", Video: "video", Checkbox: "checkbox", Signature: "signature" };

/** Parse one numbered prompt line ("Qn: `label` — Type — …") into the same shape as the code. */
function parseLine(line: string) {
  const m = line.match(/^Q(\d+): `([^`]+)` — (.+)$/);
  if (!m) return null;
  const parts = m[3]!.split(" — ");
  const typePart = parts[0]!;
  const typeName = typePart.split(/[:,]/)[0]!.trim();
  const options = typePart.includes(":") ? [...typePart.matchAll(/`([^`]+)`/g)].map((x) => x[1]!) : undefined;
  const help = parts.find((p) => p.startsWith("help text:"))?.match(/`([^`]+)`/)?.[1];
  const stopPart = parts.find((p) => p.startsWith("stop line when"));
  const stop = stopPart ? { when: stopPart.match(/when (Yes|No):/)![1], text: stopPart.match(/`([^`]+)`/)![1] } : undefined;
  const showPart = parts.find((p) => p.startsWith("only show when"));
  const show = showPart ? { n: Number(showPart.match(/when Q(\d+) =/)![1]), is: [...showPart.matchAll(/`([^`]+)`/g)].map((x) => x[1]!) } : undefined;
  return { n: Number(m[1]), label: m[2]!, type: TYPE[typeName], multiple: /several files allowed/.test(typePart), required: parts.includes("Required"), options, help, stop, show, prefill: parts.includes("portal fills this in") };
}
const promptQs = prompt.split("\n").map(parseLine).filter((x): x is NonNullable<ReturnType<typeof parseLine>> => !!x);

describe("Install day prompt equals install-day.core (drift)", () => {
  test("template name and the two text items", () => {
    expect(prompt).toContain(`**Template name:** \`${INSTALL_DAY_TEMPLATE_NAME}\``);
    expect(prompt).toContain(`\`${INSTALL_DAY_AFTER_SIGN_TEXT}\``);
    expect(prompt).toContain(`\`${INSTALL_DAY_DECLARATION_START}\``);
  });
  test("decision 328: READ FIRST tops Group 1, the Q37 stop text, AFTER THE INSTALL tops Group 8, the final tick just before the last signature", () => {
    const after = (h: string) => prompt.slice(prompt.indexOf(h)).split("\n")[1]!;
    expect(after("## Group 1: Job\n")).toContain(`\`${INSTALL_DAY_READ_FIRST_TEXT}\``);
    expect(prompt).toContain(`Q37: Text item (not a question) (decision 328): \`${INSTALL_DAY_AFTER_SIGN_TEXT}\``);
    const g8 = prompt.slice(prompt.indexOf("## Group 8:"), prompt.indexOf("Q38:"));
    expect(g8).toContain(`first item on this page, before Q38 (decision 328): \`${INSTALL_DAY_AFTER_INSTALL_TEXT}\``);
    expect(prompt).toContain(`Q47: \`${Q.allFilledIn}\` — Checkbox — Required\nQ48: \`${Q.signature}\` — Signature — Required`);
    expect(INSTALL_DAY_AFTER_SIGN_TEXT).toBe("STOP. You are only halfway. Do not leave site. When the insulation is in, come back and finish the next pages: after videos, depth photos and finishing up.");
    expect(INSTALL_DAY_READ_FIRST_TEXT).toBe('READ FIRST: The VEU will not accept this job unless every answer, photo and video on this form is filled in. Do not leave site until the whole form is done, you have pressed Complete, and the portal has texted you "All filled in". You are only paid when this form is 100% complete.');
    expect(INSTALL_DAY_AFTER_INSTALL_TEXT).toBe("AFTER THE INSTALL: do this before you pack up. Every ceiling area needs its after video and depth photo.");
    expect(Q.allFilledIn).toBe('Every answer, photo and video on this form is filled in, and I won\'t leave site until the portal texts me "All filled in".');
    const tick = INSTALL_DAY_QUESTIONS.find((q) => q.label === Q.allFilledIn)!;
    expect(tick).toMatchObject({ n: 47, type: "checkbox", required: true, group: 9 });
    expect(prompt).not.toContain("That's the before-work part done");
  });
  test("every prompt question matches the code one for one: number, label, type, files, required, options, help, stop line, logic, prefill", () => {
    expect(promptQs.map((p) => p.n)).toEqual(INSTALL_DAY_QUESTIONS.map((q) => q.n));
    for (const p of promptQs) {
      const c = INSTALL_DAY_QUESTIONS.find((q) => q.n === p.n)!;
      expect(c.label, `Q${p.n}`).toBe(p.label);
      expect(c.type, `Q${p.n} type`).toBe(p.type!);
      expect(!!c.multiple, `Q${p.n} several files`).toBe(p.multiple);
      expect(c.required, `Q${p.n} required`).toBe(p.required);
      expect(c.help, `Q${p.n} help`).toBe(p.help);
      expect(c.stop, `Q${p.n} stop`).toEqual(p.stop as never);
      expect(c.showWhen ? { n: c.showWhen.n, is: [...c.showWhen.is] } : undefined, `Q${p.n} logic`).toEqual(p.show);
      expect(!!c.prefill, `Q${p.n} prefill`).toBe(p.prefill);
      if (p.options?.length) expect([...(c.options ?? [])], `Q${p.n} options`).toEqual(p.options);
    }
    expect(INSTALL_DAY_QUESTIONS.at(-1)!.n).toBe(48);
  });
});

// ---- audit helpers -------------------------------------------------------------------------------
let i = 0;
const item = (label: string, x: Record<string, unknown> = {}) => ({ item_id: `it${i++}`, label, ...x });
const pickOne = (label: string, v: string) => item(label, { type: "question", responses: { selected: [{ label: v }] } });
const yn = (label: string, v: "Yes" | "No") => item(label, { type: "question", responses: { selected: [{ label: v }] } });
const pick = (label: string, v: string) => item(label, { type: "question", responses: { selected: [{ label: v }] } });
const txt = (label: string, v: string) => item(label, { type: "text", responses: { text: v } });
const tick = (label: string) => item(label, { type: "checkbox", responses: { value: true } });
const photo = (label: string, ...ids: string[]) => item(label, { type: "media", media: ids.map((id) => ({ media_id: id, captured_at: "2026-11-03T19:50:00Z", location: { lat: -37.8, lng: 145 } })) });
const sign = (at: string) => item(Q.signature, { type: "signature", responses: { image: { media_id: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b", name: "Bhavdeep Singh", timestamp: at } } });

export function installDayAudit(o: { crew?: 1 | 2 | 3; needed?: "Yes" | "No"; here?: "Yes" | "No"; entered?: "Yes" | "No"; done?: boolean; noFinalTick?: boolean } = {}) {
  i = 0;
  const crew = o.crew ?? 1;
  const items = [
    txt(Q.jobNumber, "HV-3100"), txt(Q.address, "1 Test St, Box Hill VIC 3128"), item(Q.installDate, { responses: { datetime: "2026-11-03" } }), txt(Q.ap, "Jo Smith"),
    txt(Q.business, "Reinsulate Pty Ltd"), txt(Q.lead, "Bhavdeep Singh"), txt(Q.leadCii, "CII-001"),
    yn(Q.anyoneElse, crew > 1 ? "Yes" : "No"),
    ...(crew > 1 ? [txt(Q.second, "Dominic Doherty"), txt(Q.secondCii, "CII-002"), yn(Q.third3, crew > 2 ? "Yes" : "No")] : []),
    ...(crew > 2 ? [txt(Q.third, "Third Person"), txt(Q.thirdCii, "CII-003")] : []),
    photo(Q.leadPhoto, "inst"), ...(crew > 1 ? [photo(Q.secondPhoto, "inst2")] : []), ...(crew > 2 ? [photo(Q.thirdPhoto, "inst3")] : []), yn(Q.powerInformed, "Yes"), yn(Q.lifeSupport, "No"), yn(Q.swmsSigned, "Yes"), yn(Q.hazardsCovered, "Yes"), yn(Q.isolated, "Yes"), photo(Q.isolationPhoto, "iso"),
    yn(Q.solar, "No"), yn(Q.piesaRead, "Yes"), yn(Q.electricianNeeded, o.needed ?? "No"), ...(o.here ? [yn(Q.electricianHere, o.here)] : []), ...(o.here === "Yes" ? [photo(Q.electricianPhoto, "elec")] : []),
    yn(Q.ceilingEntered, o.entered ?? "No"),
    photo(Q.productPhotos, "prod"), tick(Q.declaration), sign("2026-11-03T19:45:00Z"),
    ...(o.done ? [photo(Q.afterVideos, "av1", "av2"), photo(Q.depthPhotos, "dp1", "dp2"), yn(Q.multiDay, "No"), yn(Q.lockoutOff, "Yes"), pickOne(Q.lockoutBy, "Lead installer"), photo(Q.switchboardOn, "sw"), pick(Q.solarBack, "There isn't one"), tick(Q.supervised), ...(o.noFinalTick ? [] : [tick(Q.allFilledIn)]), sign("2026-11-04T04:06:00Z")]
      : [item(Q.afterVideos, { type: "media" }), item(Q.signature, { type: "signature", responses: {} })]),
  ];
  return { audit_id: "a1", items };
}

describe("reading an Install day audit", () => {
  test("recognised by its own labels; a built template lists no missing questions; the old A3 is not this form", () => {
    expect(isInstallDayDoc(installDayAudit())).toBe(true);
    expect(isInstallDayDoc({ items: [item("Job number"), item("Signature")] })).toBe(false);
    const built = { items: INSTALL_DAY_QUESTIONS.map((q) => item(q.label)) };
    expect(installDayMissingQuestions(built)).toEqual([]);
    const oneSig = { items: built.items.filter((x, idx, all) => !(x.label === Q.signature && all.findIndex((y) => y.label === Q.signature) !== idx)) };
    expect(installDayMissingQuestions(oneSig)).toEqual([`${Q.signature} (Q48)`]);
  });
  test("maps every asked answer to the official PIISA item; Part 5 lights/cables and Part 6 are never read from the form", () => {
    const { answers, crew } = installDayOfficialAnswers(installDayAudit({ crew: 3 }));
    expect(answers).toEqual({ jobRef: "HV-3100", address: "1 Test St, Box Hill VIC 3128", startDate: "2026-11-03", "p2.installDate": "2026-11-03", "p2.ap": "Jo Smith", "p2.company": "Reinsulate Pty Ltd",
      "p1.powerInformed": "Yes", lifeSupport: "No", "p3.swms": "Yes", "p3.table1": "Yes", "p3.isolated": "Yes", "p4.present": "No", "p5.reviewed": "Yes", "p5.electricianPresent": "N/A", "p5.noAccess": "Yes" });
    expect(crew).toEqual([{ name: "Bhavdeep Singh", cii: "CII-001" }, { name: "Dominic Doherty", cii: "CII-002" }, { name: "Third Person", cii: "CII-003" }]);
    expect(installDayOfficialAnswers(installDayAudit({ crew: 1 })).crew).toEqual([{ name: "Bhavdeep Singh", cii: "CII-001" }, null, null]);
  });
  test("electrician at start: not needed = N/A; needed and here = Yes; needed and not here = No", () => {
    expect(electricianPresentAnswer("No", null)).toBe("N/A");
    expect(electricianPresentAnswer("Yes", "Yes")).toBe("Yes");
    expect(electricianPresentAnswer("Yes", "No")).toBe("No");
    expect(electricianPresentAnswer("Yes", null)).toBeNull();
    expect(installDayOfficialAnswers(installDayAudit({ needed: "Yes", here: "Yes" })).answers["p5.electricianPresent"]).toBe("Yes");
    expect(installDayOfficialAnswers(installDayAudit({ needed: "Yes", here: "No" })).answers["p5.electricianPresent"]).toBe("No");
  });
  test("someone in the ceiling since the PIESA is the official 'No'", () => {
    expect(installDayOfficialAnswers(installDayAudit({ entered: "Yes" })).answers["p5.noAccess"]).toBe("No");
  });
  test("photos and multi-file items by key; the two signatures are the 1st and 2nd 'Lead installer's signature'", () => {
    const m = installDayMedia(installDayAudit({ needed: "Yes", here: "Yes", done: true }));
    expect([m.installer_photos[0]!.mediaId, m.isolation_photo[0]!.mediaId, m.product_photos[0]!.mediaId, m.electrician_photo[0]!.mediaId]).toEqual(["inst", "iso", "prod", "elec"]);
    expect(m.after_videos.map((f) => f.mediaId)).toEqual(["av1", "av2"]);
    expect(m.depth_photos.map((f) => f.mediaId)).toEqual(["dp1", "dp2"]);
    const before = readInstallDay(installDayAudit());
    expect(before.declarationSignature).toMatchObject({ present: true, signedAt: "2026-11-03T19:45:00Z" });
    expect(before.completionSignature.present).toBe(false);
    expect(readInstallDay(installDayAudit({ done: true })).completionSignature).toMatchObject({ present: true, signedAt: "2026-11-04T04:06:00Z" });
  });
});

describe("official Part 5 light and cable answers come from the PIESA", () => {
  test("no fixes needed: the PIESA found no defects, so the four confirmations are Yes; lights + count from PIESA Part 6", () => {
    const r = piesaPart5Answers({ b1: "Electrical rectification work is not required before insulation is installed or upgraded.", "p6.recessed": "Yes", "p6.count": "12" });
    expect(r).toEqual({ answers: { "p5.recessed": "Yes", "p5.count": "12", "p5.icConfirmed": "Yes", "p5.safeToCover": "Yes", "p5.rcd": "Yes", "p5.tps": "Yes", "p5.basic": "Yes" }, missing: [] });
  });
  test("fixes needed: each confirmation needs its Section C tick; a missing tick or answer is listed, never guessed", () => {
    const r = piesaPart5Answers({ b1: "Electrical rectification work is required before insulation is installed or upgraded.", "p6.recessed": "No", "c.tick2": "Ticked", "c.tick3": "Ticked", "c.tick4": "Ticked" });
    expect(r.answers).toEqual({ "p5.recessed": "No", "p5.icConfirmed": "Yes", "p5.safeToCover": "Yes", "p5.rcd": "Yes", "p5.tps": "Yes" });
    expect(r.missing).toEqual(["PIESA Section C: basic protection not confirmed by the electrician"]);
    expect(piesaPart5Answers(null).missing[0]).toContain("No signed PIESA");
    expect(piesaPart5Answers({ "p6.recessed": "Yes" }).missing).toEqual(["PIESA Part 6: number of recessed lights not recorded", "PIESA outcome (B1) not recorded"]);
  });
});

describe("official Part 6 existing insulation comes from the Ready Check record", () => {
  const none = { suitable: null, conductive: null, reason: null };
  test("no existing insulation: Part 6 is 'No' and nothing else is needed", () => {
    expect(readyCheckPart6Answers([{ present: false }, { present: false }], none)).toEqual({ answers: { "p6.present": "No" }, missing: [], conductive: null });
  });
  test("existing insulation: depth, treatment, condition, reason and foil come from the record; each gap is a pre-start blocker", () => {
    const r = readyCheckPart6Answers([{ present: true, depthMm: 40, rValue: 1.5, removal: false }], { suitable: true, conductive: false, reason: "Good condition, topped up" });
    expect(r).toEqual({ answers: { "p6.present": "Yes", "p6.height": "40", "p6.rValue": "1.5", "p6.treatment": ["Topped Up"], "p6.reason": "Good condition, topped up", "p6.suitable": "Yes" }, missing: [], conductive: false });
    const gaps = readyCheckPart6Answers([{ present: true, depthMm: null, removal: true }], none);
    expect(gaps.answers).toEqual({ "p6.present": "Yes", "p6.treatment": ["Removed"] });
    expect(gaps.missing).toEqual(["Ready Check: existing insulation depth (mm) not recorded", "Ready Check: condition of the existing insulation (suitable to lay over) not recorded", "Ready Check: whether the existing insulation is foil, metallic or conductive is not recorded"]);
    expect(readyCheckPart6Answers([], none).missing[0]).toContain("no current measure-up");
  });
});

describe("prefill (portal fills this in)", () => {
  test("text, date and Yes/No answers go to the template's own items and option ids; nothing is guessed", () => {
    const ynSet = { id: "rs-yn", responses: [{ id: "o-yes", label: "Yes" }, { id: "o-no", label: "No" }] };
    const q = (id: string, label: string, rs?: string) => ({ id, item_id: id, label, ...(rs ? { question: { response_set_id: rs } } : {}) });
    const template = { template: { items: [q("t1", Q.jobNumber), q("t2", Q.installDate), q("t3", Q.lifeSupport, "rs-yn"), q("t4", Q.electricianNeeded, "rs-yn"), q("t5", Q.lead), q("t6", Q.leadCii)], response_sets: [ynSet] } };
    const items = installDayPrefillItems(template, { jobNumber: "HV-3100", address: null, installDate: "2026-11-03", apName: null, businessName: null, leadName: "Bhavdeep Singh", leadCii: null, lifeSupport: false, solarPresent: null, electricianAtStart: true }, choiceOption);
    expect(items).toEqual([
      { item_id: "t1", type: "text", responses: { text: "HV-3100" } },
      { item_id: "t2", type: "datetime", responses: { datetime: "2026-11-03" } },
      { item_id: "t5", type: "text", responses: { text: "Bhavdeep Singh" } },
      { item_id: "t3", type: "question", responses: { selected: [{ id: "o-no", label: "No" }] } },
      { item_id: "t4", type: "question", responses: { selected: [{ id: "o-yes", label: "Yes" }] } },
    ]);
  });
});
