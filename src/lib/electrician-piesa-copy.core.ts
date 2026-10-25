// Decision 317 (Jo, 25 Oct 2026): the electrician also gets the final official PIESA.
// Pure rules only: when the assigned electrician's copy is due, its idempotency key, the approved wording and the PDF
// text of the current official PIESA (the signed copy in official_form_signed_copies, rendered in the form's own order).
// Sending: electrician-piesa-copy.server.ts. PDF bytes: official-piesa-pdf.server.ts (shared with the /field download).
// The owner/installer O28 copy (piesa-delivery.*) is a separate path and is not changed by this.
import * as K from "./email-kit.core";
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

/** Decision 317 wording, verbatim. The PDF is attached; no links, prices or other parties' details. */
export function renderElectricianPiesaEmail(i: ElectricianPiesaEmailInput) {
  const where = i.address?.trim() || "the property";
  const subject = `Your safety check for ${where} (${i.jobNumber})`;
  const lead = `Here's the official Pre-Insulation Electrical Safety Assessment for ${where}, as filed for this job. Keep it with your records.`;
  const fixes = i.version === "after_fixes" ? "This version includes your electrical fixes and Certificate of Electrical Safety." : null;
  const body = [K.p(lead, "20px 0 16px"), ...(fixes ? [K.p(fixes)] : [])].join("\n");
  const html = K.emailShell({ body, previewText: lead, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([lead, ...(fixes ? ["", fixes] : [])], { testLabel: i.test === true });
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

/** The signed official document in the form's own order: headings and statements verbatim, each item with its answer. */
export function officialPiesaPdfText(snap: SignedSnapshot): string {
  const doc = Array.isArray(snap?.document) ? snap.document : [];
  const lines: string[] = [];
  for (const d of doc) {
    if (d.kind === "heading") lines.push("", d.label);
    else if (d.kind === "statement") lines.push(d.label);
    else lines.push(`${d.letter ? `${d.letter} ` : ""}${d.label}: ${show(d.value)}`);
  }
  const t = OFFICIAL_TEMPLATES.piesa;
  lines.push("", `Signed by ${snap?.signer?.name || "-"} (${snap?.signer?.role ?? "-"}) on ${snap?.enteredDate ?? "-"}.`,
    `${t.publication} · mapping ${snap?.mappingVersion ?? t.mappingVersion} · document SHA-256 ${snap?.documentSha256 ?? "-"}`);
  return lines.join("\n");
}
