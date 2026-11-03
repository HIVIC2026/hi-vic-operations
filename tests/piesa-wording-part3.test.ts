// Part 3 Task 2 (Jo 3 Nov 2026): new A3 wording for q20/q30 (old labels stay as aliases), the Certificate of Electrical
// Safety is optional on the A3 (q45) and the A4 (number / date / file), and the A3 price questions are no longer asked.
// Pure rules + the paste-ready edit prompt for Jo (docs/MITTI_PART3_EDIT_PROMPT.md) — a drift test keeps the two in step.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  A3_REPAIR_NEEDED_LABEL, A3_REPAIR_NEEDED_LEGACY_LABEL, A3_UPGRADES_TODAY_LABEL, A3_UPGRADES_TODAY_LEGACY_LABEL, FIXES_PRICE_LABEL, FIXES_WORK_LABEL,
  NO_PRICE_TALK_LABEL, RECTIFICATION_OUTCOMES, SHORT_PIESA_FIELDS, isLiveA3Snapshot, shortAnswersFromEntries,
} from "../src/lib/official-short.core";
import {
  CERTIFICATE_LATER_HELP, PIESA_EVIDENCE_BY_ID, attachPiesaMedia, piesaCertificateToCome, piesaEvidenceBlockers, piesaEvidenceRequirements,
  piesaMediaFromSnapshot, piesaRectificationDone,
} from "../src/lib/piesa-evidence.core";
import { FIXES_DAY_Q, FIXES_DAY_QUESTIONS, fixesCompletionPlan, mergeFixesIntoPiesaSnapshot, readFixesDay } from "../src/lib/fixes-day.core";
import { FORMS, mittiAiPrompt, validateTemplate } from "../src/lib/mitti-forms.core";

const NEW_Q20 = "Are electrical upgrades needed?";
const NEW_Q30 = "Are you doing the electrical upgrades today?";
const OLD_Q20 = "Is any electrical repair work needed before insulation can be installed?";
const OLD_Q30 = "Have you completed all of the repair work listed above, and is the ceiling now safe for insulation?";
const HELP = "Don't have it yet? Leave this blank — we'll text you a link to add it.";
const CES = PIESA_EVIDENCE_BY_ID.ces_file.label;

describe("exact wording (verbatim, Jo 3 Nov 2026)", () => {
  test("constants", () => {
    expect(A3_REPAIR_NEEDED_LABEL).toBe(NEW_Q20);
    expect(A3_UPGRADES_TODAY_LABEL).toBe(NEW_Q30);
    expect(A3_REPAIR_NEEDED_LEGACY_LABEL).toBe(OLD_Q20);
    expect(A3_UPGRADES_TODAY_LEGACY_LABEL).toBe(OLD_Q30);
    expect(CERTIFICATE_LATER_HELP).toBe(HELP);
  });
  test("the A3 fields carry the new labels with the old ones as aliases", () => {
    const q20 = SHORT_PIESA_FIELDS.find((f) => f.id === "rectificationNeeded")!;
    const q30 = SHORT_PIESA_FIELDS.find((f) => f.id === "rectificationComplete")!;
    expect(q20).toMatchObject({ label: NEW_Q20, aliases: [OLD_Q20], required: true });
    expect(q30).toMatchObject({ label: NEW_Q30, aliases: [OLD_Q30] });
  });
});

// Same answers, two wordings: an old form synced after the deploy must read identically (Review Focus 3).
const answers = (q20: string, q30: string, o: { needed: "Yes" | "No"; today?: "Yes" | "No" }) => [
  { label: "Job Reference ID", value: "HV-9001" },
  { label: "Date of inspection", value: "2026-11-03" },
  { label: q20, value: o.needed },
  ...(o.needed === "Yes" ? [{ label: FIXES_WORK_LABEL, value: "Install RCD safety switches" }, { label: "How many RCD safety switches are you installing?", value: "1" }] : []),
  ...(o.today ? [{ label: `${q30}\nSome help text Mitti appended`, value: o.today }] : []),
  { label: "Electrician signature", value: "signed" },
];
describe("old and new labels read identically", () => {
  for (const c of [{ needed: "No" as const }, { needed: "Yes" as const }, { needed: "Yes" as const, today: "Yes" as const }, { needed: "Yes" as const, today: "No" as const }]) {
    test(`needed=${c.needed} today=${c.today ?? "-"}`, () => {
      const oldShort = shortAnswersFromEntries("piesa", answers(OLD_Q20, OLD_Q30, c));
      const newShort = shortAnswersFromEntries("piesa", answers(NEW_Q20, NEW_Q30, c));
      expect(newShort).toEqual(oldShort);
      expect(newShort["rectificationNeeded"]).toBe(c.needed);
      expect(newShort["rectificationOutcome"]).toBe(c.needed === "Yes" ? RECTIFICATION_OUTCOMES[1] : RECTIFICATION_OUTCOMES[0]);
      if (c.today) expect(newShort["rectificationComplete"]).toBe(c.today); else expect(newShort["rectificationComplete"]).toBeUndefined();
      expect(piesaRectificationDone(newShort)).toBe(piesaRectificationDone(oldShort));
      expect(piesaRectificationDone(newShort)).toBe(c.needed === "Yes" && c.today === "Yes");
    });
  }
  test("the old pick-one q20 answer still reads under the new label", () => {
    const s = shortAnswersFromEntries("piesa", [{ label: NEW_Q20, value: RECTIFICATION_OUTCOMES[1] }]);
    expect(s).toMatchObject({ rectificationNeeded: "Yes", rectificationOutcome: RECTIFICATION_OUTCOMES[1] });
  });
  test("isLiveA3Snapshot accepts either q20 wording (first line only)", () => {
    expect(isLiveA3Snapshot([{ label: OLD_Q20, value: "Yes" }])).toBe(true);
    expect(isLiveA3Snapshot([{ label: NEW_Q20, value: "No" }])).toBe(true);
    expect(isLiveA3Snapshot([{ label: `${NEW_Q20}\nhelp`, value: "No" }])).toBe(true);
    expect(isLiveA3Snapshot([{ label: NEW_Q20, value: null }])).toBe(false);
    expect(isLiveA3Snapshot([{ label: "B1 Assessment outcome", value: "x" }])).toBe(false);
  });
});

// ---------- A3: same-day upgrades, no certificate → Part C counts, certificate to come ----------
const geo = (id: string) => ({ media_id: id, location: { latitude: -37.8, longitude: 145.0 } });
const Q = (item_id: string, label: string, answer: string | null) => ({ item_id, label, type: "question", responses: answer == null ? {} : { selected: [{ label: answer }] } });
const M = (item_id: string, label: string, media: unknown[]) => ({ item_id, label, type: "media", media });
const SB = PIESA_EVIDENCE_BY_ID.switchboard_photo.label;
const ON = PIESA_EVIDENCE_BY_ID.onsite_photo.label;
function a3(o: { needed: "Yes" | "No"; today?: "Yes" | "No"; ces?: unknown[] }) {
  const items = [
    Q("q20", NEW_Q20, o.needed),
    ...(o.today ? [Q("q30", NEW_Q30, o.today)] : []),
    M("q42", SB, [geo("s1")]), M("q43", ON, [geo("o1")]),
    M("q45", CES, o.ces ?? []),
  ];
  const snapshot = attachPiesaMedia({ items }, items.map((i) => ({ id: i.item_id, label: i.label, value: "responses" in i && "selected" in i.responses ? i.responses.selected[0]!.label : i.media.length ? `${i.media.length} file` : null })));
  const short = shortAnswersFromEntries("piesa", snapshot);
  const media = piesaMediaFromSnapshot(snapshot);
  return { short, media, blockers: piesaEvidenceBlockers(short, media), toCome: piesaCertificateToCome(short, media) };
}
describe("A3 certificate optional (spec §2)", () => {
  test("the certificate is never a required evidence item", () => {
    const done = { rectificationOutcome: RECTIFICATION_OUTCOMES[1], rectificationComplete: "Yes" };
    expect(piesaEvidenceRequirements(done).map((r) => r.id)).not.toContain("ces_file");
    expect(FORMS.piesa.fields.find((f) => f.label === CES)).toMatchObject({ required: false, supplemental: true });
  });
  test("upgrades done today, no q45 → no blockers, certificateToCome", () => {
    const r = a3({ needed: "Yes", today: "Yes" });
    expect(r.blockers).toEqual([]);
    expect(r.toCome).toBe(true);
  });
  test("upgrades done today with q45 → no blockers, certificate in", () => {
    const r = a3({ needed: "Yes", today: "Yes", ces: [{ media_id: "c1" }] });
    expect(r.blockers).toEqual([]);
    expect(r.toCome).toBe(false);
  });
  test("no upgrades, or upgrades on a later day → not waiting for a certificate from this form", () => {
    expect(a3({ needed: "No" }).toCome).toBe(false);
    expect(a3({ needed: "Yes", today: "No" }).toCome).toBe(false);
    expect(a3({ needed: "Yes" }).toCome).toBe(false);
  });
});

// ---------- A4: Q9 Yes, work photo, signature, no certificate → done with certificate: null ----------
const FQ = FIXES_DAY_Q;
const item = (label: string, v: unknown, extra: Record<string, unknown> = {}) => ({ item_id: label.slice(0, 8), label, responses: v == null ? {} : typeof v === "string" ? { text: v } : v, ...extra });
const media = (lat?: number) => [{ media_id: "m1", ...(lat != null ? { location: { latitude: lat, longitude: 145.0 } } : {}) }];
const a4 = (cert: boolean) => ({ items: [
  item(FQ.jobNumber, "HV-3001"), item(FQ.electricianName, "Sam Sparks"), item(FQ.licence, "A1"), item(FQ.recName, "Sparks P/L"), item(FQ.recNo, "REC9"), item(FQ.phone, "0400"),
  item(FQ.done, { selected: [{ label: "Yes" }] }),
  ...(cert ? [item(FQ.coesNumber, "C123"), item(FQ.certDate, "2026-10-20"), item(FQ.coesFile, null, { media: media() })] : []),
  item(FQ.workPhoto, null, { media: media(-37.8) }),
  item(FQ.signature, { image: { media_id: "0123456789abcdef0123456789abcdef", timestamp: "2026-10-20T03:00:00Z" }, name: "Sam Sparks" }),
] });
describe("A4 certificate optional (spec §1)", () => {
  test("Q11–Q13 are not Required; the help line sits under the certificate question; Q9, the work photo and the signature stay Required", () => {
    const byLabel = Object.fromEntries(FIXES_DAY_QUESTIONS.map((q) => [q.label, q]));
    expect(byLabel[FQ.coesNumber]).toMatchObject({ required: false });
    expect(byLabel[FQ.certDate]).toMatchObject({ required: false });
    expect(byLabel[FQ.coesFile]).toMatchObject({ required: false, help: HELP });
    expect(byLabel[FQ.done]).toMatchObject({ required: true });
    expect(byLabel[FQ.workPhoto]).toMatchObject({ required: true });
    expect(byLabel[FQ.signature]).toMatchObject({ required: true });
    expect(FORMS.fixes.fields.find((f) => f.label === FQ.coesFile)).toMatchObject({ required: false });
  });
  test("no certificate → done with certificate: null; with it → the certificate", () => {
    const none = fixesCompletionPlan(readFixesDay(a4(false)), { completed: true, today: "2026-10-25" });
    expect(none).toMatchObject({ kind: "done", certificate: null, signerName: "Sam Sparks" });
    const withIt = fixesCompletionPlan(readFixesDay(a4(true)), { completed: true, today: "2026-10-25" });
    expect(withIt).toMatchObject({ kind: "done", certificate: { number: "C123", date: "2026-10-20" } });
    expect((withIt as Extract<typeof withIt, { kind: "done" }>).certificate!.files).toHaveLength(1);
  });
  test("a future certification date is still refused; the work photo and signature are still needed", () => {
    const base = a4(true);
    const swap = (label: string, replace: unknown) => ({ items: base.items.map((i) => (i.label === label ? (replace as typeof i) : i)) });
    expect(fixesCompletionPlan(readFixesDay(swap(FQ.certDate, item(FQ.certDate, "2026-12-01"))), { completed: true, today: "2026-10-25" })).toMatchObject({ kind: "missing", missing: [`${FQ.certDate} (cannot be in the future)`] });
    expect(fixesCompletionPlan(readFixesDay(swap(FQ.workPhoto, item(FQ.workPhoto, null))), { completed: true, today: "2026-10-25" })).toMatchObject({ kind: "missing", missing: [FQ.workPhoto] });
    expect(fixesCompletionPlan(readFixesDay(swap(FQ.signature, item(FQ.signature, null))), { completed: true, today: "2026-10-25" })).toMatchObject({ kind: "missing", missing: [FQ.signature] });
  });
  test("merge without a certificate records Part C done and leaves the certificate fields blank", () => {
    const L = (id: string) => SHORT_PIESA_FIELDS.find((f) => f.id === id)!.label;
    const snapshot = [
      { label: NEW_Q20, value: "Yes" }, { label: SB, value: "1 file", media: [{ mediaId: "s1", capturedAt: null, lat: -37.8, lng: 145 }] }, { label: ON, value: "1 file", media: [{ mediaId: "o1", capturedAt: null, lat: -37.8, lng: 145 }] },
      { label: L("rectificationComplete"), value: null }, { label: L("coesNumber"), value: null }, { label: L("certDate"), value: null }, { label: CES, value: null },
    ];
    const r = readFixesDay(a4(false));
    const plan = fixesCompletionPlan(r, { completed: true, today: "2026-10-25" }) as Extract<ReturnType<typeof fixesCompletionPlan>, { kind: "done" }>;
    const merged = mergeFixesIntoPiesaSnapshot(snapshot, r, plan);
    const short = shortAnswersFromEntries("piesa", merged as { label: string; value: string | null }[]);
    expect(short["rectificationComplete"]).toBe("Yes");
    expect(short["coesNumber"]).toBeUndefined();
    expect(short["certDate"]).toBeUndefined();
    expect(short["fixesSignedOn"]).toBe("2026-10-20");
    expect(piesaRectificationDone(short)).toBe(true);
    expect(piesaCertificateToCome(short, piesaMediaFromSnapshot(merged))).toBe(true);
    expect(piesaEvidenceBlockers(short, piesaMediaFromSnapshot(merged))).toEqual([]);
  });
});

// ---------- A3 price questions dropped ----------
describe("A3 price questions are no longer asked (Task 1: electricians bill upgrades directly)", () => {
  test("the price is legacy: read from old forms, never asked, never required", () => {
    expect(SHORT_PIESA_FIELDS.find((f) => f.id === "fixesPriceIncGst")).toMatchObject({ required: false, portalOnly: true });
    expect(mittiAiPrompt("piesa")).not.toContain(FIXES_PRICE_LABEL);
    expect(shortAnswersFromEntries("piesa", [{ label: OLD_Q20, value: "Yes" }, { label: FIXES_PRICE_LABEL, value: "880" }])["fixesPriceIncGst"]).toBe("880");
  });
  test("validateTemplate(\"piesa\") passes a template without q22", () => {
    const items = FORMS.piesa.fields.filter((f) => f.label !== FIXES_PRICE_LABEL).map((f) => ({ label: f.label, type: f.type === "yesno" ? "question" : f.type === "choice" || f.type === "multichoice" || f.type === "tick" ? "list" : f.type === "date" ? "datetime" : f.type === "text" || f.type === "number" ? "textsingle" : f.type }));
    const r = validateTemplate("piesa", items);
    expect(r.issues).not.toContain(`Missing: ${FIXES_PRICE_LABEL}`);
    expect(r.ok).toBe(true);
  });
});

// ---------- the paste-ready edit prompt for Jo ----------
describe("drift: docs/MITTI_PART3_EDIT_PROMPT.md carries the code's exact wording", () => {
  const doc = readFileSync("docs/MITTI_PART3_EDIT_PROMPT.md", "utf8");
  test("q20 / q30 new wording and the old wording to find", () => {
    for (const s of [`\`${NEW_Q20}\``, `\`${NEW_Q30}\``, `\`${OLD_Q20}\``, `\`${OLD_Q30}\``]) expect(doc, s).toContain(s);
  });
  test("the certificate questions on both forms, not Required, with the help text", () => {
    for (const s of [`\`${CES}\``, `\`${FQ.coesNumber}\``, `\`${FQ.certDate}\``, `\`${FQ.coesFile}\``, `\`${HELP}\``]) expect(doc, s).toContain(s);
    expect(doc.split(HELP).length - 1).toBeGreaterThanOrEqual(2);
    for (const s of [`\`${FQ.done}\``, `\`${FQ.workPhoto}\``, `\`${FQ.signature}\``]) expect(doc, s).toContain(s);
  });
  test("the price questions to delete, and both template names", () => {
    expect(doc).toContain(`\`${FIXES_PRICE_LABEL}\``);
    expect(doc).toContain(`\`${NO_PRICE_TALK_LABEL}\``);
    expect(doc).toContain("PIESA – Electrician safety assessment");
    expect(doc).toContain("A4 – Electrical fixes");
  });
});
