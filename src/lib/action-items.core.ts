// Installer redesign — Action items home (spec v2 §4.2). Pure rules; the page draws them.
import { cardAddress, type MyWorkRow } from "./my-work.core";
import { displayName } from "./display-name.core";

export type ActionRow = MyWorkRow & { stop: string | null; waitingOn: string | null; ownerFirst: string | null; installAt?: string | null; electricianName?: string | null; piesaAt?: string | null };
/** `button` null: nothing to tap (e.g. PIESA booked: their own electrician does it). Not counted as needing them today. */
export type ActionCard = { jobId: string; action: string; address: string; meta: string; due: string | null; button: string | null; stop: boolean; overdue: boolean };
export type WaitingCard = { jobId: string; address: string; status: string; waitingOn: string };
export type WeekItem = { day: string; date: number; kind: "Install" | "PIESA" | "Ready Check"; time: string; place: string; who: string; flag: string | null; flagTone: "red" | "amber" | null };

const TZ = "Australia/Melbourne";
type Parts = { weekday: string; day: string; month: string; hour: string; minute: string };
const parts = (at: Date): Parts => Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: false }).formatToParts(at).map((p) => [p.type, p.value])) as unknown as Parts;
const dayLabel = (at: Date) => { const p = parts(at); return `${p.weekday} ${p.day} ${p.month}`; };
/** A date the box gives as ISO becomes "Fri 6 Nov"; a ready-made label is kept. */
const niceDate = (v: string): string => (/^\d{4}-\d{2}-\d{2}/.test(v) && Number.isFinite(new Date(v).getTime()) ? dayLabel(new Date(v.length === 10 ? `${v}T12:00:00+11:00` : v)) : v);

export function greetingLine(firstName: string | null, business: string, now: Date): string {
  const name = (firstName ?? "").trim();
  if (!name) return `Hi, ${business.replace(/^\s*(?:\[TEST PARTNER\]\s*|TEST\b\s*)+/i, "").trim() || business} team`;
  const h = Number(parts(now).hour) % 24;
  return `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}, ${displayName(name)}`;
}

const firstName = (full: string | null | undefined): string => { const f = (displayName(full).split(/\s+/)[0] ?? ""); return f ? f[0]!.toUpperCase() + f.slice(1) : ""; };
/** Jo 6 Nov 2026: the electrician is on the installer's own team, so these are THEIR jobs (Your turn), not "waiting on someone else". */
function ownTeamCard(r: ActionRow, address: string): ActionCard | null {
  const who = firstName(r.electricianName) || "your electrician";
  if (r.box.kind === "waiting_electrician_book") return { jobId: r.jobId, action: `Get ${who} to book the PIESA`, address, meta: metaFor(r), due: r.box.bookBy ? `By ${niceDate(r.box.bookBy)}` : null, button: "Open", stop: false, overdue: r.box.overdue && !!r.box.bookBy };
  return null;
}

const metaFor = (r: ActionRow) => [displayName(r.owner) || "Owner", r.jobNumber, r.channel === "installer_sourced" ? "Your customer" : "Our lead"].join(" · ");

export function actionItems(rows: ActionRow[]): { count: number; sub: string; fix: ActionCard[]; turn: ActionCard[]; waiting: WaitingCard[] } {
  const fix: ActionCard[] = [], turn: ActionCard[] = [], waiting: WaitingCard[] = [];
  for (const r of rows) {
    const address = cardAddress(r.street, r.suburb);
    if (r.stop) fix.push({ jobId: r.jobId, action: r.stop, address, meta: metaFor(r), due: r.installAt ? `Install ${dayLabel(new Date(r.installAt))}` : null, button: r.box.button ?? "Open", stop: true, overdue: false });
    // Jo 7 Nov: PIESA booked is the electrician's step (nothing to tap), so it waits rather than sits under Your turn, and the count matches the list.
    else if (r.box.kind === "piesa_booked") waiting.push({ jobId: r.jobId, address, status: `PIESA booked${r.piesaAt ? ` ${dayLabel(new Date(r.piesaAt))}` : ""}`, waitingOn: firstName(r.electricianName) || "your electrician" });
    else if (ownTeamCard(r, address)) turn.push(ownTeamCard(r, address)!);
    else if (r.box.yours) turn.push({ jobId: r.jobId, action: r.box.title, address, meta: metaFor(r), due: r.box.bookBy ? `By ${niceDate(r.box.bookBy)}` : null, button: r.box.button ?? "Open", stop: false, overdue: r.box.overdue && !!r.box.bookBy });
    else if (r.box.kind !== "closed") waiting.push({ jobId: r.jobId, address, status: r.box.title, waitingOn: r.waitingOn ?? "Home Insulation Victoria" });
  }
  const count = fix.length + turn.filter((c) => c.button).length;
  const k = fix.length;
  const sub = count === 0 ? "Nothing needs you today." : count === 1 ? "1 job needs you today." : `${count} jobs need you today.${k >= 1 ? ` ${k} must be fixed before work starts.` : ""}`;
  return { count, sub, fix, turn, waiting };
}

/** Monday–Sunday of the Melbourne week containing `now`, as YYYY-MM-DD keys. */
function weekKeys(now: Date): Set<string> {
  const key = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts(now).weekday);
  const out = new Set<string>();
  for (let i = 0; i < 7; i++) out.add(key(new Date(now.getTime() + (i - dow) * 86_400_000)));
  return out;
}

const KIND: Record<string, WeekItem["kind"]> = { installation: "Install", install: "Install", assessment: "PIESA", piesa: "PIESA", ready_check: "Ready Check" };

export function thisWeek(bookings: { kind: string; scheduled_start: string; suburb: string | null; who: string | null; flag: string | null; flagTone: "red" | "amber" | null }[], now: Date): WeekItem[] {
  const keys = weekKeys(now);
  const key = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  return bookings
    .map((b) => ({ b, at: new Date(b.scheduled_start) }))
    .filter(({ b, at }) => Number.isFinite(at.getTime()) && keys.has(key(at)) && KIND[b.kind])
    .sort((x, y) => x.at.getTime() - y.at.getTime())
    .map(({ b, at }) => {
      const p = parts(at); const h = Number(p.hour) % 24;
      return { day: p.weekday, date: Number(p.day), kind: KIND[b.kind]!, time: `${h % 12 || 12}:${p.minute}${h < 12 ? "am" : "pm"}`, place: b.suburb ?? "", who: b.who ?? "", flag: b.flag, flagTone: b.flagTone };
    });
}

/** Who a waiting job is waiting on (spec v2 §4.2), by the box kind. Unknown → Home Insulation Victoria. */
export function waitingOnFor(i: { kind: string; title: string; channel: string | null; ownerFirst: string | null; electricianName: string | null }): string {
  const owner = displayName(i.ownerFirst);
  const ownerTag = owner ? `${owner} (owner)` : "the owner";
  const hiv = "Home Insulation Victoria";
  switch (i.kind) {
    case "waiting_quote": return i.title.startsWith("Quote being prepared") ? hiv : ownerTag;
    case "waiting_deposit": return ownerTag;
    case "after_install": return i.channel === "installer_sourced" ? ownerTag : hiv;
    default: return hiv;
  }
}
