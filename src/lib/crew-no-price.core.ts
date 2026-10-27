// Jo 28 Oct 2026 (spec rule 3: "The crew shouldn't see the price!!!"): installer crew — workers who aren't the business
// owner — never see a price, on screen or in anything sent to their phone. Pure: the server knows the viewer (`boss`
// from trade-view `tradeContext`, the same membership check the price card uses) and passes it in. The business owner,
// the office and the homeowner get everything unchanged.

/** How every lapsed 30-day-window next-action line starts (thirty-day-rule.core `repeatPiesaNextAction`). */
export const REPEAT_PIESA_LAPSED = "New PIESA needed: 30-day window lapsed";
/** The crew's version of that line: same meaning, no amount, no payer. */
export const CREW_REPEAT_SAFETY_CHECK_LINE = "Repeat electrical safety check needed — the office will arrange it";
/** The crew's version of the rebate form's price fields in a "still to finish" list. */
export const CREW_FORM_PRICE_LINE = "Price details";

const MONEY = /\$|\b\d[\d,]*(?:\.\d{1,2})?\s*(?:inc|ex)\.?\s*GST\b/i;
/** A "$" or an "… inc GST" / "… ex GST" amount. */
export const hasPrice = (s: string | null | undefined): boolean => typeof s === "string" && MONEY.test(s);

/** Stored job text (jobs.next_action, hold_reason) as this viewer may see it. Crew: the repeat-PIESA line becomes the
 *  price-free line; any other text with a price is dropped (no installer screen shows it); price-free text is kept. */
export function jobTextForViewer(text: string | null | undefined, boss: boolean): string | null {
  if (text == null) return null;
  if (boss) return text;
  if (text.startsWith(REPEAT_PIESA_LAPSED)) return CREW_REPEAT_SAFETY_CHECK_LINE;
  return hasPrice(text) ? null : text;
}

/** The job overview row (job_overview view) for an installer viewer: crew get `next_action` / `hold_reason` price-free. */
export function overviewForViewer<T extends { next_action?: string | null; hold_reason?: string | null }>(row: T, boss: boolean): T {
  if (boss) return row;
  return { ...row, next_action: jobTextForViewer(row.next_action, false), hold_reason: jobTextForViewer(row.hold_reason, false) };
}

type AssignmentRow = { id: string; status: string; installer_signed_at: string | null; installed_product: string | null; installed_area_m2: number | string | null };
type PrepView = { blockers: string[]; missing: string[]; values: unknown; fields: unknown };
const crewFormLines = (lines: string[]) => [...new Set(lines.map((l) => (hasPrice(l) ? CREW_FORM_PRICE_LINE : l)))];

/**
 * The official ESC rebate form (VEEC assignment, `getAssignment`) as the installer side receives it. Every installer gets
 * no amounts (the form values, the final facts, the agreement, consent and history are not sent). Crew also get no form
 * wording (`officialForm`, whose price labels carry "$") and a price-free "still to finish" list. Kept for everyone:
 * what the lead installer needs to sign Section 3 Part B (status, signed time, installed product and area, blockers).
 */
export function assignmentForInstaller<R, A extends AssignmentRow, C extends { veecPrep: PrepView | null; officialForm: unknown }>(role: R, cur: A | null, common: C, boss: boolean) {
  type P = NonNullable<C["veecPrep"]>;
  const p = common.veecPrep;
  const veecPrep = p ? { blockers: boss ? p.blockers : crewFormLines(p.blockers), missing: boss ? p.missing : crewFormLines(p.missing), values: {} as P["values"], fields: [] as unknown as P["fields"] } : null;
  return {
    role, agreement: null, consent: null,
    current: cur ? { id: cur.id, status: cur.status, installer_signed_at: cur.installer_signed_at, installed_product: cur.installed_product, installed_area_m2: cur.installed_area_m2, final_facts: null } : null,
    history: [] as never[], variations: [] as never[],
    ...common, veecPrep, officialForm: boss ? common.officialForm : null,
  };
}
