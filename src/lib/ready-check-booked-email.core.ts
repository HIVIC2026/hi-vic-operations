// Shared booking-box pieces for the owner booked emails (safety check booked and friends). The O12 "Ready Check booked"
// email itself was removed (Part 3 Task 16, Jo 2 Nov 2026): the Ready Check "You're booked" is owner-booked-notice.core. Pure.
import { esc } from "./mail-mjml.core";

const DISPLAY = "Outfit, Figtree, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif";
/** Blue booking box: caps label, day, blue time, address/contact lines (O12, safety check booked). */
export function mjBookingBox(i: { label: string; day: string; time: string; lines: string[] }): string {
  const lines = i.lines.map(esc).join("<br />");
  return `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow" padding="18px 18px 6px">${esc(i.label)}</mj-text><mj-text font-family="${DISPLAY}" font-size="24px" line-height="30px" font-weight="800" padding="0 18px 2px">${esc(i.day)}</mj-text>${i.time ? `<mj-text font-family="${DISPLAY}" font-size="24px" line-height="30px" font-weight="800" color="#3C51C4" padding="0 18px ${lines ? 10 : 18}px">${esc(i.time)}</mj-text>` : ""}${lines ? `<mj-text font-size="15px" line-height="22px" padding="0 18px 18px">${lines}</mj-text>` : ""}</mj-column></mj-section>`;
}
/** "Before they arrive" tick rows (HTML with <strong>, already safe). */
export const mjBeforeRows = (rows: string[]) => rows.map((b) => `<tr><td width="32" valign="top" style="padding:2px 0 12px;"><span class="tick">&#10003;</span></td><td style="padding:0 0 12px;">${b}</td></tr>`).join("");
