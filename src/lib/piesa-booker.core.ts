/** Who books the safety check (PIESA) for an installer's own jobs. Pure; no I/O.
 *  Join 4 Nov 2026: the setting itself is Part 5's `businesses.piesa_booked_by` (business-screen.core `whoBooksOf`,
 *  installer-business-settings.sql, My business "Who books…"); this file keeps only the Part 2 notice rule until Part 6 joins. */
import { whoBooksOf, type WhoBooks } from "./business-screen.core";

export type PiesaBooker = WhoBooks;
export const piesaBookerOf = (raw: unknown): PiesaBooker => whoBooksOf(raw);
// The reader is who-books.server whoBooksFor (one implementation for every side).

/** The office is always emailed so it knows the job moved; only electrician/either text the electrician. */
export function bookerNotices(b: PiesaBooker): { textElectrician: boolean; emailOffice: boolean } {
  return { textElectrician: b !== "office", emailOffice: true };
}
