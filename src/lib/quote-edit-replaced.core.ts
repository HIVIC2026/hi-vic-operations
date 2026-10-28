// Jo 28 Oct 2026: the installer's price always rebuilds the owner quote (INSTALLER_A1). When the draft that rebuild
// replaces had been edited by the office (adjustQuote → quotes.manually_adjusted), the office gets ONE alert per replaced
// draft. The alert never blocks Send, never locks the price card and is never shown to the installer.
export const QUOTE_EDIT_REPLACED_EVENT = "installer_quote_edit_replaced";
export const QUOTE_EDIT_REPLACED_NOTICE = "The quote your office edited was rebuilt with new figures. Check it before sending.";

/** Puts the alert in front of an office line when the current quote is a rebuild of an office-edited draft. */
export function withEditReplacedNotice(text: string | null, flagged: boolean): string | null {
  if (!flagged) return text;
  return text ? `${QUOTE_EDIT_REPLACED_NOTICE} ${text}` : QUOTE_EDIT_REPLACED_NOTICE;
}

/** Jo 28 Oct 2026: an office hand-edit is kept until something real changes — the installer's price or the Mitti form.
 *  The 15-minute check never undoes it otherwise. The draft records what it was built from as this key: the form's
 *  answers (label + value, so the same form read by any path gives the same key; the portal price is merged in by
 *  `withInstallerPrice`) and the audit, plus an intake price when there is one. FNV-1a, 32-bit hex. */
export function draftInputsKey(auditId: string, entries: { label: string; value: unknown }[], intakePrice?: unknown): string {
  const basis = JSON.stringify([auditId, entries.map((e) => [e.label, e.value == null ? null : String(e.value)]), intakePrice ?? null]);
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) { h ^= basis.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
/** Event that records the inputs an office-edited draft is kept against (drafts made before keys were stored). */
export const QUOTE_EDIT_KEPT_EVENT = "installer_quote_edit_kept";

/** Replace an office-edited draft only when its inputs changed since the edit. With a stored key: the key changed. With
 *  none (a draft made before keys were stored): the installer's price was saved after the edit. */
export function officeEditInputsChanged(i: { storedKey: string | null; currentKey: string; editedAt: string | null; priceSetAt: string | null }): boolean {
  if (i.storedKey) return i.storedKey !== i.currentKey;
  return !!(i.priceSetAt && (!i.editedAt || Date.parse(i.priceSetAt) > Date.parse(i.editedAt)));
}
