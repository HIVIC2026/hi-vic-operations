/* eslint-disable @typescript-eslint/no-explicit-any */
// "A5 – Electrical fixes" Mitti template (decision 293, Jo 25 Oct 2026). PURE: no database, no network.
// When the PIESA said repair work is needed (q20) and it was NOT fixed on the same visit (q30 not Yes), the fixes are done
// on a later visit. The portal creates this short form for the electrician when that visit is booked, and reads it when
// the electrician presses Complete: Q9 Yes with the CoES number, certification date, CoES file and finished-work photo
// becomes PIESA Part C (the same facts the portal's "record fixes done" page writes), the files are kept with the job and
// the O28 copies follow. Fixed on the same visit stays on the PIESA form (q30–q37, q45).
// The exact wording of every question is fixed here; docs/MITTI_FIXES_FORM_PROMPT.md is the ChatGPT build prompt and
// tests/fixes-day.test.ts fails if the two drift apart (same pattern as the Install day form, install-day.core.ts).
import { norm } from "./mitti.core";
import { mittiMediaFile, PIESA_EVIDENCE_BY_ID, type MittiMediaFile } from "./piesa-evidence.core";
import { RECTIFICATION_OUTCOMES, SHORT_PIESA_FIELDS, repairWorkBesidesOnsite } from "./official-short.core";
import { B2_OPTIONS } from "./official-forms.core";

export const FIXES_DAY_TEMPLATE_NAME = "A5 – Electrical fixes";
export const FIXES_DAY_RULE = "fixes-day-2026-10-25";
/** workflow_settings column holding the connected template id (pending migration docs/pending-migrations/mitti-fixes-template.sql). */
export const FIXES_TEMPLATE_COLUMN = "mitti_fixes_template_id";
export const FIXES_TEMPLATE_MIGRATION = "docs/pending-migrations/mitti-fixes-template.sql";
export const FIXES_TEMPLATE_MISSING = "Electrical fixes Mitti form is not set up. Connect the \"A5 – Electrical fixes\" form in Compliance → Mitti forms; until then the electrician records the fixes on the portal job page.";
export const FIXES_TEMPLATE_PENDING_DB = `Electrical fixes Mitti form: waiting for the database change (${FIXES_TEMPLATE_MIGRATION}). The electrician records the fixes on the portal job page until then.`;
/** Workflow events (append-only history; the latest per audit wins). */
export const FIXES_FORM_CREATED_EVENT = "fixes_form_created";
export const FIXES_FORM_HELD_EVENT = "fixes_form_held";
export const FIXES_FORM_COMPLETED_EVENT = "fixes_form_completed";
export const FIXES_FORM_NOT_DONE_EVENT = "fixes_form_not_done";
/** Office item title when the form could not be created (template missing, electrician not in Mitti, Mitti error). */
export const FIXES_FORM_NOT_SET_UP = "Fixes form not set up";
/** Job-file title of the CoES file(s) kept from the A5 form (documents kind piesa_evidence, source mitti). Decision 322:
 *  the completion pack finds the CoES to attach by this exact title, so keep the two in step. */
export const FIXES_COES_DOC_TITLE = "PIESA evidence – Certificate of Electrical Safety (photo or PDF)";
export const FIXES_COES_DOC_KIND = "piesa_evidence";

/** Every label, by key. Q8 is a read-only list the portal fills in; Q15 the electrician's signature. */
export const FIXES_DAY_Q = {
  jobNumber: "Job number",
  address: "Address",
  electricianName: "Electrician name",
  licence: "Licence number",
  recName: "REC name",
  recNo: "REC registration number",
  phone: "Phone",
  repairList: "The repair work listed on the safety assessment:",
  done: "Have you completed all of the repair work listed, and is the ceiling now safe for insulation?",
  notDone: "Anything not done or changed?",
  coesNumber: "Certificate of Electrical Safety number",
  certDate: "Date of certification",
  coesFile: "Certificate of Electrical Safety (photo or PDF)",
  workPhoto: "Photo of the finished work at the switchboard / in the ceiling",
  signature: "Electrician signature",
} as const;

export type FixesDayType = "text" | "date" | "yes_no" | "photo" | "signature";
export type FixesDayPrefillKey = "jobNumber" | "address" | "electricianName" | "licence" | "recName" | "recNo" | "phone" | "repairList";
export type FixesDayQuestion = {
  n: number; label: string; type: FixesDayType; required: boolean; group: number;
  help?: string;
  /** Only show when question `n` has one of these answers. */
  showWhen?: { n: number; is: readonly string[] };
  prefill?: FixesDayPrefillKey;
  /** Several files allowed. */
  multiple?: boolean;
  /** Photo question with location (GPS) on. */
  geotagged?: boolean;
  /** PDF files allowed as well as photos. */
  pdf?: boolean;
};

const Q = FIXES_DAY_Q;
/** Every question in form order (Q1–15). */
export const FIXES_DAY_QUESTIONS: readonly FixesDayQuestion[] = (() => {
  const out: FixesDayQuestion[] = [];
  let n = 0;
  const q = (group: number, label: string, type: FixesDayType, required: boolean, x: Partial<FixesDayQuestion> = {}) => { n++; out.push({ n, label, type, required, group, ...x }); return n; };
  q(1, Q.jobNumber, "text", true, { prefill: "jobNumber" });
  q(1, Q.address, "text", true, { prefill: "address" });
  q(2, Q.electricianName, "text", true, { prefill: "electricianName" });
  q(2, Q.licence, "text", true, { prefill: "licence" });
  q(2, Q.recName, "text", true, { prefill: "recName" });
  q(2, Q.recNo, "text", true, { prefill: "recNo" });
  q(2, Q.phone, "text", true, { prefill: "phone" });
  q(3, Q.repairList, "text", false, { prefill: "repairList", help: "Filled in by the portal from the safety assessment. Don't retype it." });
  const done = q(3, Q.done, "yes_no", true);
  q(3, Q.notDone, "text", true, { showWhen: { n: done, is: ["No"] }, help: "Say what is still outstanding or what changed, so the office can follow it up." });
  q(4, Q.coesNumber, "text", true, { showWhen: { n: done, is: ["Yes"] } });
  q(4, Q.certDate, "date", true, { showWhen: { n: done, is: ["Yes"] } });
  q(4, Q.coesFile, "photo", true, { showWhen: { n: done, is: ["Yes"] }, pdf: true, help: "A photo or the PDF of the certificate." });
  q(4, Q.workPhoto, "photo", true, { showWhen: { n: done, is: ["Yes"] }, multiple: true, geotagged: true, help: "Show the finished work. More than one photo is fine." });
  q(5, Q.signature, "signature", true);
  return out;
})();

// ======================================================================================================
// Reading an audit / template by label (same shape as install-day.core)
// ======================================================================================================
const labelKey = (label: unknown) => norm(String(label ?? "").split("\n")[0]);
type ReadSignature = { present: boolean; name: string | null; signedAt: string | null; mediaId: string | null };
type Labelled = { id: string | null; label: string; value: string | null; media: MittiMediaFile[]; signature: ReadSignature };
const NO_SIGNATURE: ReadSignature = { present: false, name: null, signedAt: null, mediaId: null };

function signatureOf(r: Record<string, any>): ReadSignature {
  const m = r["image"] ?? r["media"] ?? r["media_id"] ?? r["signature"];
  const pick = (x: any): string | null => typeof x === "string" ? (/^[0-9a-f-]{16,}$/i.test(x.trim()) || /^https:\/\//.test(x.trim()) ? x.trim() : null) : x && typeof x === "object" ? pick(Array.isArray(x) ? x[0] : (x.media_id ?? x.id ?? x.href)) : null;
  const mediaId = pick(m);
  const captured = m && typeof m === "object" && !Array.isArray(m) ? m : {};
  const ts = [r["timestamp"], r["signed_at"], r["datetime"], captured.timestamp, captured.signed_at, captured.metadata?.signed_at].find((t) => typeof t === "string" && !Number.isNaN(Date.parse(t))) as string | undefined;
  const name = r["name"] ?? captured.name ?? captured.metadata?.signer_name;
  return { present: !!mediaId, name: typeof name === "string" && name.trim() ? name.trim() : null, signedAt: ts ?? null, mediaId };
}
function labelledItems(doc: unknown): Labelled[] {
  const out: Labelled[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, any>;
    if (typeof o["label"] === "string") {
      const r = (o["responses"] ?? {}) as Record<string, any>;
      const selected: string[] = Array.isArray(r["selected"]) ? r["selected"].map((s: any) => String(s?.label ?? s)) : [];
      const sel = selected.length ? selected.join(", ") : null;
      const txt = [sel, r["text"], r["value"], r["number"], r["numeric"], r["datetime"], r["date"], o["value"]].map((v) => (typeof v === "number" ? String(v) : v)).find((v) => typeof v === "string" && v.trim()) as string | undefined;
      const media = o["media"] ?? r["media"] ?? r["attachments"] ?? [];
      const id = o["item_id"] ?? o["id"];
      out.push({ id: id == null ? null : String(id), label: o["label"], value: txt ?? null, media: Array.isArray(media) ? media.map(mittiMediaFile) : [], signature: signatureOf(r) });
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  walk((doc as any)?.template ?? doc);
  return out;
}
const allWithLabel = (items: Labelled[], label: string) => items.filter((i) => labelKey(i.label) === labelKey(label));

/** Is this template / audit the "A5 – Electrical fixes" form? (Two labels no other form carries together.) */
export function isFixesDayDoc(doc: unknown): boolean {
  const items = labelledItems(doc);
  return allWithLabel(items, Q.done).length > 0 && allWithLabel(items, Q.repairList).length > 0;
}
/** Question labels the template does not carry (exact wording). Empty = built. */
export function fixesDayMissingQuestions(template: unknown): string[] {
  const items = labelledItems(template);
  return FIXES_DAY_QUESTIONS.filter((q) => allWithLabel(items, q.label).length === 0).map((q) => q.label);
}

const yesNo = (v: string | null | undefined): "Yes" | "No" | null => (v == null ? null : /^\s*yes\b/i.test(v) ? "Yes" : /^\s*no\b/i.test(v) ? "No" : null);
const ymd = (v: string | null): string | null => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? "").trim()); return m ? m[1]! : null; };

export type FixesDayRead = {
  jobNumber: string | null;
  electricianName: string | null; licence: string | null; recName: string | null; recNo: string | null; phone: string | null;
  done: "Yes" | "No" | null; notDone: string | null;
  coesNumber: string | null; certDate: string | null;
  coesFiles: MittiMediaFile[]; workPhotos: MittiMediaFile[];
  signature: ReadSignature;
};
/** Every answer the portal reads, by exact wording; a question that isn't on the form reads as null / []. */
export function readFixesDay(audit: unknown): FixesDayRead {
  const items = labelledItems(audit);
  const one = (label: string) => allWithLabel(items, label)[0];
  const text = (label: string) => { const v = one(label)?.value; return v && v.trim() ? v.trim() : null; };
  return {
    jobNumber: text(Q.jobNumber),
    electricianName: text(Q.electricianName), licence: text(Q.licence), recName: text(Q.recName), recNo: text(Q.recNo), phone: text(Q.phone),
    done: yesNo(text(Q.done)), notDone: text(Q.notDone),
    coesNumber: text(Q.coesNumber), certDate: ymd(text(Q.certDate)),
    coesFiles: one(Q.coesFile)?.media ?? [], workPhotos: one(Q.workPhoto)?.media ?? [],
    signature: one(Q.signature)?.signature ?? NO_SIGNATURE,
  };
}

// ======================================================================================================
// Decisions
// ======================================================================================================
const REPAIR_NEEDED = RECTIFICATION_OUTCOMES[1];
/** Does this job need the fixes form? PIESA q20 = repair work needed and q30 (fixed on the same visit) not Yes.
 *  Reads the PIESA short answers (official-short.core `shortAnswersFromEntries("piesa", …)`). */
export function fixesFormNeeded(short: Record<string, string | null | undefined>): boolean {
  const outcome = String(short["rectificationOutcome"] ?? "").trim();
  if (yesNo(short["rectificationComplete"] ?? null) === "Yes") return false;
  if (outcome === REPAIR_NEEDED) return true;
  // Decision 314: "Be on site at the start of the install day" ALONE needs no fixes visit; other ticks still do.
  return outcome === RECTIFICATION_OUTCOMES[2] && repairWorkBesidesOnsite(short);
}
/** The repair work the PIESA listed (q21 ticks in the official wording, plus the q22 "Other" text), one line each. */
export function repairWorkList(short: Record<string, string | null | undefined>): string[] {
  const raw = String(short["rectificationWork"] ?? "");
  const out = (B2_OPTIONS as readonly string[]).filter((o) => raw.includes(o)).map((o) => (o === B2_OPTIONS[5] ? `Other: ${String(short["rectificationOther"] ?? "").trim() || "(not described)"}` : o));
  return out;
}

export type FixesCompletionPlan =
  | { kind: "waiting"; reason: string }
  | { kind: "not_done"; text: string }
  | { kind: "missing"; missing: string[] }
  | { kind: "done"; coesNumber: string; certDate: string; coesFiles: MittiMediaFile[]; workPhotos: MittiMediaFile[]; signedAt: string | null; signerName: string | null };
/**
 * What a Complete press means. `today` is the Melbourne date: a certification date in the future is never accepted.
 * Q9 No → office item with the Q10 text, nothing else. Q9 Yes needs Q11–Q14 (and the signature); anything missing is
 * listed, never guessed. Not completed in Mitti → waiting.
 */
export function fixesCompletionPlan(r: FixesDayRead, i: { completed: boolean; today: string }): FixesCompletionPlan {
  if (!i.completed) return { kind: "waiting", reason: "not marked Complete in Mitti" };
  if (r.done === "No") return { kind: "not_done", text: r.notDone ?? "(no detail given)" };
  if (r.done !== "Yes") return { kind: "missing", missing: [Q.done] };
  const missing: string[] = [];
  if (!r.coesNumber) missing.push(Q.coesNumber);
  if (!r.certDate) missing.push(Q.certDate);
  else if (r.certDate > i.today) missing.push(`${Q.certDate} (cannot be in the future)`);
  if (!r.coesFiles.length) missing.push(Q.coesFile);
  if (!r.workPhotos.length) missing.push(Q.workPhoto);
  else if (!r.workPhotos.some((f) => f.lat != null && f.lng != null)) missing.push(`${Q.workPhoto} (must be geotagged)`);
  if (!r.signature.present) missing.push(Q.signature);
  if (missing.length) return { kind: "missing", missing };
  return { kind: "done", coesNumber: r.coesNumber!, certDate: r.certDate!, coesFiles: r.coesFiles, workPhotos: r.workPhotos, signedAt: r.signature.signedAt, signerName: r.signature.name };
}

// ======================================================================================================
// PIESA Part C facts → the stored PIESA short answers (assessments.mitti_raw_snapshot entries)
// ======================================================================================================
export type SnapshotEntry = { id?: string; label: string; value: string | null; section?: string; media?: MittiMediaFile[] };
const shortLabel = (id: string) => SHORT_PIESA_FIELDS.find((f) => f.id === id)!.label;
const CES_LABEL = PIESA_EVIDENCE_BY_ID.ces_file.label;
/**
 * Writes the fixes-day facts into the stored PIESA short answers exactly where the same-visit answers (q30–q37, q45)
 * would sit, so `shortAnswersFromEntries("piesa", …)` → `expandPiesa` fills Part C (c.tick1–7, c.coes, c.certDate,
 * c.* derived from Part B3 by expandPiesa — the same person) and the evidence rule sees the CES file. The electrician
 * details from the fixes form fill any blank Part B3 field; a missing label is appended. Other entries are untouched. Pure.
 */
export function mergeFixesIntoPiesaSnapshot(snapshot: SnapshotEntry[], r: FixesDayRead, done: Extract<FixesCompletionPlan, { kind: "done" }>): SnapshotEntry[] {
  const out = snapshot.map((e) => ({ ...e }));
  const key = (l: string) => norm(l);
  const setNth = (label: string, nth: number, value: string | null, media?: MittiMediaFile[]) => {
    const hits = out.filter((e) => key(e.label) === key(label));
    const hit = hits[nth];
    if (hit) { if (value != null) hit.value = value; if (media) hit.media = media; }
    else out.push({ label, value, section: "fixes day (A5)", ...(media ? { media } : {}) });
  };
  // Unique labels on the PIESA: set the one occurrence (or append).
  setNth(shortLabel("rectificationComplete"), 0, "Yes");
  setNth(shortLabel("coesNumber"), 0, done.coesNumber);
  setNth(shortLabel("certDate"), 0, done.certDate);
  // Electrician details: Part B3 (Section C is copied from it by expandPiesa). Only blanks are filled — the PIESA's own
  // pre-filled answers win over the fixes form.
  const b3: [string, string | null][] = [["b3.licence", r.licence], ["b3.name", r.electricianName], ["b3.recName", r.recName], ["b3.recNo", r.recNo], ["b3.phone", r.phone]];
  for (const [id, v] of b3) { if (!v) continue; const hit = out.find((e) => key(e.label) === key(shortLabel(id))); if (!hit) out.push({ label: shortLabel(id), value: v, section: "fixes day (A5)" }); else if (!hit.value) hit.value = v; }
  // q45: the CES file, read by piesa-evidence.core from the same label.
  setNth(CES_LABEL, 0, `${done.coesFiles.length} file${done.coesFiles.length === 1 ? "" : "s"}`, done.coesFiles);
  return out;
}

// ======================================================================================================
// Prefill ("portal fills this in")
// ======================================================================================================
export type FixesDayPrefillFacts = {
  jobNumber: string | null; address: string | null; electricianName: string | null; licence: string | null; recName: string | null; recNo: string | null; phone: string | null;
  /** One line per repair item (repairWorkList); joined with line breaks on the form. */ repairList: string[];
};
type PrefillItem = { item_id: string; type: string; responses: Record<string, unknown> };
/** Prefill items for the template's own item IDs, matched by exact wording. A question the template lacks, or an empty fact, is skipped. */
export function fixesDayPrefillItems(template: unknown, f: FixesDayPrefillFacts): PrefillItem[] {
  const items = labelledItems(template);
  const out: PrefillItem[] = [];
  for (const q of FIXES_DAY_QUESTIONS) {
    if (!q.prefill) continue;
    const raw: string | null = q.prefill === "repairList" ? (f.repairList.length ? f.repairList.map((l, i) => `${i + 1}. ${l}`).join("\n") : null) : f[q.prefill];
    if (raw == null || !String(raw).trim()) continue;
    const it = allWithLabel(items, q.label)[0];
    if (!it?.id) continue;
    out.push({ item_id: it.id, type: "text", responses: { text: raw } });
  }
  return out;
}

/** The short lines the electrician's job page and the office item show. */
export const FIXES_FORM_LINK_LABEL = "Fixes form in Mitti";
