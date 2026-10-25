// Decision 377 (Jo 25 Oct 2026): each crew member gets their OWN safety plan (SWMS) signing link by text, directly.
// PURE: wording, keys, timing and who is due. No database, no network.
//  - Who: an unsigned person on the install's safety plan who is a worker record of the installing business (`w:<id>`)
//    with an Australian mobile on My business. Name-only crew (`n:<name>`) have no mobile → the lead's text keeps
//    "<name>: <link>" for them (decision 364 fallback).
//  - When: once the install is booked (step "booked"), and again the afternoon before the install while still unsigned
//    (step "reminder", the install-tomorrow timing). Nothing once that person has signed, nothing after the start.
//  - Keys: one per job + signer + Melbourne install date + step; ONE `swms_sign_link_texted` event is recorded before
//    each send. Wording is a DRAFT (`swms_sign_link` wordingApproved:false in sms.core) until Jo approves.
import { melbourneYmd } from "./piesa-windows.core";
import { installTomorrowDue, melbourneDayDate } from "./installer-texts.core";
import { normaliseAuMobile } from "./test-send.core";

export const SWMS_SIGN_LINK_SMS_TYPE = "swms_sign_link" as const;
/** Recorded once per key BEFORE the send (details: { key, signer_key, step, route }). */
export const SWMS_SIGN_LINK_EVENT = "swms_sign_link_texted" as const;
export type SwmsSignTextStep = "booked" | "reminder";

export const swmsSignLinkKey = (jobId: string, signerKey: string, startIso: string, step: SwmsSignTextStep) =>
  `swms-sign-link:v1:${jobId}:${signerKey}:${melbourneYmd(new Date(startIso))}:${step}`;

/** The sender adds "Home Insulation Victoria: " in front (brandSmsBody). DRAFT wording — decision 377. */
export function swmsSignLinkText(f: { address: string | null; startIso: string; link: string }): string {
  return `please read and sign the safety plan for the install at ${f.address?.trim() || "the job address"} on ${melbourneDayDate(f.startIso)}: ${f.link}`;
}

/** `w:<partner_workers.id>` → the worker id; name-only crew → null. */
export const workerIdOfSignerKey = (key: string): string | null => (key.startsWith("w:") && key.length > 2 ? key.slice(2) : null);

/** Australian mobile check for My business (decision 377 (a)): empty clears; otherwise +614XXXXXXXX or an error line. */
export function crewMobileInput(raw: string | null | undefined): { ok: true; mobile: string | null } | { ok: false; error: string } {
  const t = (raw ?? "").trim();
  if (!t) return { ok: true, mobile: null };
  const m = normaliseAuMobile(t);
  return m ? { ok: true, mobile: m } : { ok: false, error: "Enter an Australian mobile, like 0412 345 678." };
}

/** Which step is due now: "reminder" from the install-tomorrow time the day before, else "booked" while the start is
 *  ahead; null once the install has started. One text per step (the caller skips keys already recorded). */
export function swmsSignStepDue(now: Date, startIso: string): SwmsSignTextStep | null {
  const start = Date.parse(startIso);
  if (!Number.isFinite(start) || start <= now.getTime()) return null;
  return installTomorrowDue(now, startIso) ? "reminder" : "booked";
}

export type SwmsSignTextDue = { signerKey: string; name: string; to: string; key: string; step: SwmsSignTextStep };
/** The texts due now: each unsigned person with their own valid mobile whose key for the due step is not yet recorded.
 *  A person who signed is never in `unsigned`, so they get nothing. If the booked text was never sent and the reminder
 *  is now due, only the reminder goes (one text, not two). */
export function swmsSignTextsDue(i: {
  jobId: string; startIso: string; now: Date;
  unsigned: readonly { key: string; name: string }[];
  /** partner_workers.id → stored mobile (the installing business's live workers only). */
  mobiles: ReadonlyMap<string, string | null>;
  /** Keys already recorded (SWMS_SIGN_LINK_EVENT details.key). */
  recorded: ReadonlySet<string>;
}): SwmsSignTextDue[] {
  const step = swmsSignStepDue(i.now, i.startIso);
  if (!step) return [];
  const out: SwmsSignTextDue[] = [];
  for (const s of i.unsigned) {
    const wid = workerIdOfSignerKey(s.key);
    const to = wid ? normaliseAuMobile(i.mobiles.get(wid) ?? null) : null;
    if (!to) continue;
    const key = swmsSignLinkKey(i.jobId, s.key, i.startIso, step);
    if (i.recorded.has(key)) continue;
    out.push({ signerKey: s.key, name: s.name, to, key, step });
  }
  return out;
}

/** Decision 377 (c): a person counts as "texted their own link" for the lead's text once a text actually went to them —
 *  a TEST-routed send recorded on the event, or a real text that claimed its key (not held, not failed). */
export const SWMS_SIGN_TEXT_WENT = ["sending", "queued", "sent", "sent_unknown", "delivered"] as const;
export function swmsTextedSignerKeys(events: readonly { signer_key?: unknown; key?: unknown; route?: unknown }[], smsRows: readonly { idempotency_key: string; status: string }[]): Set<string> {
  const claimed = new Set(smsRows.filter((r) => (SWMS_SIGN_TEXT_WENT as readonly string[]).includes(r.status)).map((r) => r.idempotency_key));
  const out = new Set<string>();
  for (const e of events) {
    if (typeof e.signer_key !== "string" || typeof e.key !== "string") continue;
    if (e.route === "test" || claimed.has(e.key)) out.add(e.signer_key);
  }
  return out;
}
