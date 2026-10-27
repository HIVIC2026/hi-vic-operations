// Decision 317 (Jo, 25 Oct 2026): the electrician also gets the final official PIESA.
// Pure rules only: when the assigned electrician's copy is due, its idempotency key, the approved wording and the PDF
// text of the current official PIESA (the signed copy in official_form_signed_copies, rendered in the form's own order).
// Sending: electrician-piesa-copy.server.ts. PDF bytes: official-piesa-pdf.server.ts (shared with the /field download).
// The owner/installer O28 copy (piesa-delivery.*) is a separate path and is not changed by this.
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { OFFICIAL_TEMPLATES, type SignedSnapshot, type Value } from "./official-forms.core";

/** Approved by Jo 25 Oct 2026 (decision 317). Real sends still pause with the partner-email master switch. */
export const ELECTRICIAN_PIESA_EMAIL_APPROVED = true as boolean;
export const ELECTRICIAN_PIESA_EVENT = "electrician_piesa_copy_sent";
export const ELECTRICIAN_PIESA_NOT_SENT_EVENT = "electrician_piesa_copy_not_sent";
export const ELECTRICIAN_PIESA_LABEL = "electrician_piesa_copy";
/** The sweep looks at current official PIESA copies signed in this many days (a new copy is sent within one tick). */
export const ELECTRICIAN_PIESA_SWEEP_DAYS = 14;
export const ELECTRICIAN_PIESA_MAX_PER_TICK = 50;

export type ElectricianPiesaVersion = "initial" | "after_fixes";

export type ElectricianPiesaFacts = {
  closed: boolean;
  /** The current official PIESA signed copy; `signedAt` = its server timestamp. */
  copy: { id: string; signedAt: string | null } | null;
  /** The current piesa_records row (one email per row). */
  record: { id: string; kind: string; createdAt: string | null } | null;
  /** The active electrician assignment on the job. */
  electrician: { email: string | null } | null;
  /** A claim event with this record's key already exists. */
  alreadySent: boolean;
};

export type ElectricianPiesaPlan =
  | { send: true; key: string; version: ElectricianPiesaVersion; recordId: string; copyId: string }
  | { send: false; reason: string };

/** One email per PIESA record: the first official PIESA, then once more for the post-fixes (post_rectification) record. */
export const electricianPiesaKey = (piesaRecordId: string) => `electrician-piesa:v1:${piesaRecordId}`;

export const electricianPiesaVersion = (recordKind: string): ElectricianPiesaVersion => (recordKind === "post_rectification" ? "after_fixes" : "initial");

/** When the electrician's copy is due. A post-fixes record waits until the official PIESA was regenerated after it. */
export function electricianPiesaPlan(f: ElectricianPiesaFacts): ElectricianPiesaPlan {
  const no = (reason: string): ElectricianPiesaPlan => ({ send: false, reason });
  if (f.closed) return no("job closed or archived");
  if (!f.copy) return no("no official PIESA on this job yet");
  if (!f.record) return no("no current PIESA record");
  const version = electricianPiesaVersion(f.record.kind);
  if (version === "after_fixes") {
    const copyAt = f.copy.signedAt ? Date.parse(f.copy.signedAt) : NaN;
    const recAt = f.record.createdAt ? Date.parse(f.record.createdAt) : NaN;
    if (!Number.isFinite(copyAt) || !Number.isFinite(recAt) || copyAt < recAt) return no("official PIESA not regenerated after the fixes yet");
  }
  if (!f.electrician) return no("no electrician on the job");
  if (f.alreadySent) return no("already sent for this PIESA record");
  if (!f.electrician.email?.trim()) return no("no email address for the electrician");
  return { send: true, key: electricianPiesaKey(f.record.id), version, recordId: f.record.id, copyId: f.copy.id };
}

export type ElectricianPiesaEmailInput = { address: string | null; jobNumber: string; version: ElectricianPiesaVersion; test?: boolean };

/** Decision 317 wording (MJML refresh, Jo 26 Oct 2026: docs/templates/mjml/electrician_piesa-copy.mjml — a heading and the
 *  standard PIESA name). The PDF is attached; no links, prices or other parties' details. */
export function renderElectricianPiesaEmail(i: ElectricianPiesaEmailInput) {
  const where = i.address?.trim() || "the property";
  const subject = `Your safety check for ${where} (${i.jobNumber})`;
  const lead = `Here's the official Pre Insulation Electrical Safety Assessment (PIESA) for ${where}, as filed for this job.`;
  const keep = "Keep it with your records.";
  const fixes = i.version === "after_fixes" ? "This version includes your electrical fixes and Certificate of Electrical Safety." : null;
  const body = `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">Your safety check for <span style="white-space:nowrap;">${esc(i.jobNumber)}</span></mj-text><mj-text>${esc(lead)}</mj-text>${fixes ? `<mj-text>${esc(fixes)}</mj-text>` : ""}<mj-text>${esc(keep)}</mj-text></mj-column></mj-section>`;
  const html = mjEmail({ subject, preview: "The official PIESA as filed for this job. Keep it with your records.", body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([`Your safety check for ${i.jobNumber}`, "", lead, ...(fixes ? ["", fixes] : []), "", keep], { testLabel: i.test === true });
  return { subject, html, text };
}

// ---------- the official PIESA as a PDF (same bytes for the /field download and the attachment) ----------

export const officialPiesaPdfFilename = (jobNumber: string) => `PIESA-${(jobNumber || "job").replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
export const officialPiesaPdfHeader = (jobNumber: string) => `${OFFICIAL_TEMPLATES.piesa.title} - ${jobNumber}`;

const show = (v: Value): string => {
  if (v == null || v === "") return "-";
  if (v === true) return "Yes (ticked)";
  if (v === false) return "No";
  if (Array.isArray(v)) return v.length ? v.join("; ") : "-";
  return String(v);
};

/** Decision 336: a line `[[image:<slot>]]` in the PDF text is where textToPdf draws that signature picture. */
export const pdfImageMarker = (slot: string) => `[[image:${slot}]]`;
/** Decision 336: what the PDF prints for a signature captured in Mitti (`signedOn` YYYY-MM-DD) — the picture (marker line)
 *  and "Signed in Mitti on DD/MM/YYYY" under it. Absent = no Mitti signature image on file (the typed answer stays). */
export type PdfSignatureMarks = Partial<Record<"b3.signature" | "c.signature", { signedOn: string }>>;
const ddmmyyyy = (d: string) => d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1");

/** The signed official document in the form's own order: headings and statements verbatim, each item with its answer. */
export function officialPiesaPdfText(snap: SignedSnapshot, signatures: PdfSignatureMarks = {}): string {
  const doc = Array.isArray(snap?.document) ? snap.document : [];
  const lines: string[] = [];
  for (const d of doc) {
    if (d.kind === "heading") lines.push("", d.label);
    else if (d.kind === "statement") lines.push(d.label);
    else {
      // Decision 329: a table cell (id#row) prints only when answered, with its row number; a label that already ends in ":"
      // (or "?") gets no second colon.
      const row = /#(\d+)$/.exec(d.id ?? "");
      if (row && (d.value == null || d.value === "")) continue;
      const label = `${d.letter ? `${d.letter} ` : ""}${d.label}${row ? ` (row ${Number(row[1]) + 1})` : ""}`;
      lines.push(`${label}${/[:?]$/.test(label.trim()) ? "" : ":"} ${show(d.value)}`);
      // Decision 336: the electrician's Mitti signature picture after the B3 declaration and in the Section C signature.
      const slot = d.id === "b3.declaration" ? "b3.signature" : d.id === "c.signature" ? "c.signature" : null;
      const mark = slot ? signatures[slot] : undefined;
      if (slot && mark && (slot === "b3.signature" || (d.value != null && d.value !== ""))) {
        lines.push(slot === "b3.signature" ? "Electrician signature:" : "Signature (Mitti):", pdfImageMarker(slot), `Signed in Mitti on ${ddmmyyyy(mark.signedOn)}`);
      }
    }
  }
  const t = OFFICIAL_TEMPLATES.piesa;
  lines.push("", `Signed by ${snap?.signer?.name || "-"} (${snap?.signer?.role ?? "-"}) on ${snap?.enteredDate ?? "-"}.`,
    `${t.publication} · mapping ${snap?.mappingVersion ?? t.mappingVersion} · document SHA-256 ${snap?.documentSha256 ?? "-"}`);
  return lines.join("\n");
}
