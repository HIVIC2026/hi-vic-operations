// Part 4 Task 15 (Jo 2 Nov 2026, answer 7): when the home is rented and someone OTHER than the owner lets the trades in
// (the tenant or the property manager, from the owner's quick-taps answers), that person gets the PIESA and install
// "You're booked" texts and the day-before texts — visit-time texts only. Never the owner's quote, price, consent,
// payment or compliance messages. The owner still gets every job message. DRAFT wording (the owner's approved texts with
// the access person's first name), so everything stays behind ACCESS_PERSON_TEXTS_APPROVED = false.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ACCESS_PERSON_BOOKED_SMS_TYPE, ACCESS_PERSON_TEXTS_APPROVED, ACCESS_PERSON_TOMORROW_SMS_TYPE, ACCESS_TEXT_HELD_EVENT, accessPersonBookedText,
  accessPersonKey, accessPersonNeedsTexts, accessPersonTomorrowText,
} from "../src/lib/access-person-texts.core";
import { textAccessPersonBooked, textAccessPersonTomorrow, type AccessPersonTextDeps } from "../src/lib/access-person-texts.server";
import type { AccessPerson } from "../src/lib/rental-answers.core";
import type { BookedFacts } from "../src/lib/owner-booked-notice.core";
import { SMS_DO_NOT_CONTACT, SMS_FRESHNESS, SMS_MESSAGE_TYPES, SMS_REPLIED_STOP, smsBlocker } from "../src/lib/sms.core";
import { TEMPLATE_ENTRIES } from "../src/lib/template-hub.core";

const viking = { name: "Viking Electrical", tradingName: null, officePhone: "03 9111 1111", email: null };
const rapid = { name: "Rapid Insulation Pty Ltd", tradingName: "Rapid Insulation", officePhone: "03 9000 0000", email: "office@rapid.test" };
const tina: AccessPerson = { who: "tenant", name: "Tina Lee", mobile: "+61400111222" };
const pm: AccessPerson = { who: "property_manager", name: "Paul Manager", mobile: "+61400333444" };
// 2026-11-04 is a Wednesday; 22:00Z on the 3rd = 9:00am Melbourne on Wednesday 4 November.
const PIESA: BookedFacts = { kind: "piesa", firstName: "Sarah", startIso: "2026-11-03T22:00:00Z", whoName: "Vic Sparks", business: viking, changed: false, installerName: "Rapid Insulation" };
const INSTALL: BookedFacts = { kind: "install", firstName: "Sarah", startIso: "2026-11-11T21:00:00Z", whoName: "John Smith", business: rapid, changed: false, balanceCents: 141200 };

describe("access person texts — pure rules (DRAFT wording)", () => {
  test("ships switched off; its own two text types are unapproved owner-side texts with quiet hours", () => {
    expect(ACCESS_PERSON_TEXTS_APPROVED).toBe(false);
    for (const t of [ACCESS_PERSON_BOOKED_SMS_TYPE, ACCESS_PERSON_TOMORROW_SMS_TYPE] as const) {
      expect({ t, audience: SMS_MESSAGE_TYPES[t].audience, approved: SMS_MESSAGE_TYPES[t].wordingApproved, quiet: SMS_MESSAGE_TYPES[t].quietHours, side: SMS_MESSAGE_TYPES[t].ownerSideContact })
        .toEqual({ t, audience: "owner", approved: false, quiet: true, side: true });
    }
    expect(SMS_FRESHNESS.access_person_booked).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
    expect(SMS_FRESHNESS.access_person_tomorrow).toEqual({ kind: "window" });
  });
  test("only a tenant or property manager with a mobile that is not the owner's needs texts", () => {
    expect(accessPersonNeedsTexts(null, "0400 000 000")).toBe(false);
    expect(accessPersonNeedsTexts({ who: "owner", name: "Sarah", mobile: "+61400000000" }, "0400 000 000")).toBe(false);
    expect(accessPersonNeedsTexts(tina, "0400 000 000")).toBe(true);
    expect(accessPersonNeedsTexts(pm, "0400 000 000")).toBe(true);
    expect(accessPersonNeedsTexts({ ...tina, mobile: "0400 000 000" }, "+61400000000")).toBe(false); // the owner's own number
    expect(accessPersonNeedsTexts({ ...tina, mobile: "03 9000 0000" }, "0400 000 000")).toBe(false); // not a mobile
    expect(accessPersonNeedsTexts(tina, null)).toBe(true);
  });
  test("booked texts: the owner's approved wording with the access person's first name, the day, time and office phone", () => {
    expect(accessPersonBookedText(PIESA, tina)).toBe("Home Insulation Victoria: Hi Tina, you're booked for your electrical safety check (PIESA): Wed 4 Nov, 9:00am. Vic Sparks from Viking Electrical is coming. Need to change it? Call Viking Electrical on 03 9111 1111.");
    expect(accessPersonBookedText(INSTALL, pm)).toBe("Home Insulation Victoria: Hi Paul, you're booked for your insulation install: Thu 12 Nov, 8:00am. John Smith from Rapid Insulation is coming. Need to change it? Call Rapid Insulation on 03 9000 0000.");
    // Never the owner's money, consent or paperwork; never a worker's mobile; never "HIV".
    const s = accessPersonBookedText(INSTALL, pm) as string;
    expect(s).not.toMatch(/\$|balance|deposit|pay|consent|rebate|30-day|HIV\b|0411/);
  });
  test("day-before texts: the owner's approved wording with the access person's first name", () => {
    expect(accessPersonTomorrowText({ kind: "piesa", time: "9:00am", business: viking }, tina)).toBe("Home Insulation Victoria: Hi Tina, see you tomorrow at 9:00am for your electrical safety check (PIESA) (Viking Electrical, 03 9111 1111).");
    expect(accessPersonTomorrowText({ kind: "install", time: "8:00am", business: rapid }, pm)).toBe("Home Insulation Victoria: Hi Paul, see you tomorrow at 8:00am for your insulation install (Rapid Insulation, 03 9000 0000). Reminder: power will be off while they work in the ceiling.");
  });
  test("a missing office phone holds exactly like the owner's text; a Ready Check is never an access-person text", () => {
    expect(accessPersonBookedText({ ...PIESA, business: { ...viking, officePhone: " " } }, tina)).toEqual({ held: "No office phone for Viking Electrical" });
    expect(accessPersonTomorrowText({ kind: "install", time: "8:00am", business: { ...rapid, officePhone: null } }, pm)).toEqual({ held: "No office phone for Rapid Insulation" });
    expect(accessPersonBookedText({ ...PIESA, kind: "ready_check" }, tina)).toEqual({ held: "Not an access-person visit" });
    expect(accessPersonTomorrowText({ kind: "ready_check", time: "9:00am", business: rapid }, tina)).toEqual({ held: "Not an access-person visit" });
    // A business email is not needed for a text (the owner's email needs it; the text does not).
    expect(typeof accessPersonBookedText({ ...INSTALL, business: { ...rapid, email: null } }, pm)).toBe("string");
  });
  test("keys: one text per person per visit; a changed time is a new booking, so a new key", () => {
    expect(accessPersonKey.booked("b1", "+61400111222")).toBe("access-booked:v1:b1:+61400111222");
    expect(accessPersonKey.tomorrow("b1", "+61400111222")).toBe("access-tomorrow:v1:b1:+61400111222");
    expect(accessPersonKey.booked("b2", "+61400111222")).not.toBe(accessPersonKey.booked("b1", "+61400111222"));
  });
  test("the real sender: a STOP from the access person's number blocks their text; the owner's Do not contact does not (it is about the owner)", () => {
    const base = { to: "+61400111222", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-11-03T03:00:00Z" };
    // DRAFT: while the wording is unapproved the real sender refuses both types before anything else.
    for (const type of [ACCESS_PERSON_BOOKED_SMS_TYPE, ACCESS_PERSON_TOMORROW_SMS_TYPE]) expect(smsBlocker({ ...base, type })).toBe("Wording not approved yet");
    // Same inputs with the wording approved: the owner's Do not contact still does not hold an access-person text, while it holds the owner's.
    const approved = { ...SMS_MESSAGE_TYPES.access_person_booked, wordingApproved: true };
    const types = SMS_MESSAGE_TYPES as unknown as Record<string, unknown>;
    const saved = types["access_person_booked"];
    types["access_person_booked"] = approved;
    try {
      expect(smsBlocker({ ...base, type: "access_person_booked", doNotContact: true })).toBeNull();
      expect(smsBlocker({ ...base, type: "access_person_booked", optedOut: true })).toBe(SMS_REPLIED_STOP);
    } finally { types["access_person_booked"] = saved; }
    expect(smsBlocker({ ...base, type: "in_house_booked_owner", doNotContact: true })).toBe(SMS_DO_NOT_CONTACT);
  });
  test("template hub lists both drafts under Waiting, pointing at the live builder and sender", () => {
    for (const id of ["owner:sms-access_person_booked", "owner:sms-access_person_tomorrow"]) {
      const e = TEMPLATE_ENTRIES.find((x) => x.id === id);
      expect({ id, section: e?.section, approval: e?.approval, gate: e?.gate }).toEqual({ id, section: "waiting", approval: "waiting", gate: { kind: "code_off", flag: "ACCESS_PERSON_TEXTS_APPROVED" } });
      expect(e?.source.sender).toBe("src/lib/access-person-texts.server.ts");
      const p = e!.render();
      expect(p.kind).toBe("texts");
      if (p.kind === "texts") for (const v of p.variants) expect(v.body.startsWith("Home Insulation Victoria: Hi ")).toBe(true);
    }
  });
});

/* ---------------------------------------------------------------- the senders (deps injected) */
type Job = { id: string; source: string | null; stage: string; deleted_at: string | null; owners: { full_name: string | null; phone: string | null } | null };
type Booking = { id: string; job_id: string; kind: string; status: string; scheduled_start: string; created_at: string };
const JOB: Job = { id: "j1", source: "website", stage: "piesa_scheduled", deleted_at: null, owners: { full_name: "Sarah Jones", phone: "0400 000 000" } };
const PIESA_BOOKING: Booking = { id: "b-piesa", job_id: "j1", kind: "assessment", status: "confirmed", scheduled_start: "2026-11-03T22:00:00Z", created_at: "2026-11-01T01:00:00Z" };
const INSTALL_BOOKING: Booking = { id: "b-install", job_id: "j1", kind: "installation", status: "confirmed", scheduled_start: "2026-11-11T21:00:00Z", created_at: "2026-11-01T02:00:00Z" };
const RC_BOOKING: Booking = { id: "b-rc", job_id: "j1", kind: "ready_check", status: "confirmed", scheduled_start: "2026-11-03T22:00:00Z", created_at: "2026-11-01T00:00:00Z" };
const NOW = new Date("2026-11-01T03:00:00Z"); // 2pm Melbourne, 1 Nov
const DAY_BEFORE_PIESA = new Date("2026-11-03T06:00:00Z"); // 5pm Melbourne, 3 Nov
const DAY_BEFORE_INSTALL = new Date("2026-11-11T06:00:00Z"); // 5pm Melbourne, 11 Nov

function deps(over: Partial<AccessPersonTextDeps> & { job?: Job | null; access?: AccessPerson | null; bookings?: Booking[]; optedOut?: string[] } = {}) {
  const sent: { type: string; key: string; to: string | null | undefined; body: string; event?: unknown }[] = [];
  const testSent: { to: string; body: string }[] = [];
  const held: { reason: string; details: Record<string, unknown> }[] = [];
  const claimed = new Set<string>();
  const bookings = over.bookings ?? [PIESA_BOOKING, INSTALL_BOOKING, RC_BOOKING];
  const d: AccessPersonTextDeps = {
    approved: true,
    readJob: async () => (over.job === undefined ? JOB : over.job),
    readBooking: async (bookingId) => bookings.find((b) => b.id === bookingId) ?? null,
    accessPerson: async () => (over.access === undefined ? tina : over.access),
    businessContact: async (_jobId, role) => (role === "electrician" ? viking : rapid),
    whoName: async (_jobId, bookingId) => (bookingId === "b-piesa" ? "Vic Sparks" : "John Smith"),
    quiet: () => false,
    recordHeld: async (_jobId, reason, details) => { held.push({ reason, details }); },
    sendSms: async (i) => {
      if ((over.optedOut ?? []).includes(String(i.to))) return { status: "blocked", detail: SMS_REPLIED_STOP, sid: null };
      if (claimed.has(i.idempotencyKey)) return { status: "already", detail: "Already handled", sid: null };
      claimed.add(i.idempotencyKey); sent.push({ type: i.type, key: i.idempotencyKey, to: i.to, body: i.body, event: i.event }); return { status: "sent", detail: "ok", sid: "s" };
    },
    sendTestSms: async (to, body) => { testSent.push({ to, body }); return { status: "sent", detail: "ok" }; },
    ...over,
  };
  return { d, sent, testSent, held };
}

describe("textAccessPersonBooked", () => {
  test("rental, tenant Tina lets us in: PIESA booked → ONE access_person_booked text to Tina with the day, time and office phone", async () => {
    const { d, sent } = deps();
    expect(await textAccessPersonBooked("j1", "b-piesa", NOW, d)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "access_person_booked", key: "access-booked:v1:b-piesa:+61400111222", to: "+61400111222", event: { at: PIESA_BOOKING.created_at, current: true } });
    expect(sent[0]!.body).toBe("Home Insulation Victoria: Hi Tina, you're booked for your electrical safety check (PIESA): Wed 4 Nov, 9:00am. Vic Sparks from Viking Electrical is coming. Need to change it? Call Viking Electrical on 03 9111 1111.");
    // Once per person per visit.
    expect(await textAccessPersonBooked("j1", "b-piesa", NOW, d)).toBe("already handled");
    expect(sent).toHaveLength(1);
  });
  test("install booked → the same, naming the installer's office", async () => {
    const { d, sent } = deps();
    expect(await textAccessPersonBooked("j1", "b-install", NOW, d)).toBe("sent");
    expect(sent[0]).toMatchObject({ type: "access_person_booked", key: "access-booked:v1:b-install:+61400111222" });
    expect(sent[0]!.body).toBe("Home Insulation Victoria: Hi Tina, you're booked for your insulation install: Thu 12 Nov, 8:00am. John Smith from Rapid Insulation is coming. Need to change it? Call Rapid Insulation on 03 9000 0000.");
    expect(sent[0]!.body).not.toMatch(/\$|balance|deposit/);
  });
  test("Ready Check booking → nothing to Tina (access starts with the PIESA)", async () => {
    const { d, sent } = deps();
    expect(await textAccessPersonBooked("j1", "b-rc", NOW, d)).toBe("not applicable");
    expect(sent).toHaveLength(0);
  });
  test("a changed time is a new booking → a new key sends again", async () => {
    const moved: Booking = { ...PIESA_BOOKING, id: "b-piesa-2", scheduled_start: "2026-11-05T03:30:00Z", created_at: "2026-11-02T00:00:00Z" };
    const { d, sent } = deps({ bookings: [PIESA_BOOKING, moved] });
    expect(await textAccessPersonBooked("j1", "b-piesa", NOW, d)).toBe("sent");
    expect(await textAccessPersonBooked("j1", "b-piesa-2", NOW, d)).toBe("sent");
    expect(sent.map((s) => s.key)).toEqual(["access-booked:v1:b-piesa:+61400111222", "access-booked:v1:b-piesa-2:+61400111222"]);
    expect(sent[1]!.body).toContain("Thu 5 Nov, 2:30pm");
  });
  test("owner-occupied (null), the owner lets us in, or the access mobile is the owner's → nothing extra", async () => {
    for (const access of [null, { who: "owner" as const, name: "Sarah Jones", mobile: "+61400000000" }, { ...tina, mobile: "+61400000000" }]) {
      const { d, sent, testSent } = deps({ access });
      expect(await textAccessPersonBooked("j1", "b-piesa", NOW, d)).toBe("no access person");
      expect(sent).toHaveLength(0); expect(testSent).toHaveLength(0);
    }
  });
  test("flag off → \"awaiting approval\", nothing read or sent", async () => {
    let read = false;
    const { d, sent } = deps({ approved: false, readBooking: async () => { read = true; return PIESA_BOOKING; } });
    expect(await textAccessPersonBooked("j1", "b-piesa", NOW, d)).toBe("awaiting approval");
    expect(sent).toHaveLength(0); expect(read).toBe(false);
  });
  test("TEST job → test-send only, never the real sender", async () => {
    const { d, sent, testSent } = deps({ job: { ...JOB, source: "qa_test" } });
    expect(await textAccessPersonBooked("j1", "b-piesa", NOW, d)).toBe("sent");
    expect(sent).toHaveLength(0);
    expect(testSent).toEqual([{ to: "+61400111222", body: expect.stringContaining("Hi Tina, you're booked") }]);
  });
  test("a STOP from Tina's number holds her text only (reported, not thrown)", async () => {
    const { d, sent } = deps({ optedOut: ["+61400111222"] });
    expect(await textAccessPersonBooked("j1", "b-piesa", NOW, d)).toBe(`held: ${SMS_REPLIED_STOP}`);
    expect(sent).toHaveLength(0);
  });
  test("the owner's Do not contact is not read here: the access person's text does not depend on it", () => {
    const s = readFileSync("src/lib/access-person-texts.server.ts", "utf8");
    expect(s).not.toMatch(/do-not-contact|doNotContact/);
    // The real sender skips the owner's Do not contact for owner-side contact types (sms.core smsBlocker).
    expect(readFileSync("src/lib/sms.core.ts", "utf8")).toMatch(/ownerSideContact/);
  });
  test("no office phone → held with ONE office note, nothing sent; cancelled, past or missing booking → not current", async () => {
    const { d, sent, held } = deps({ businessContact: async () => ({ ...viking, officePhone: null }) });
    expect(await textAccessPersonBooked("j1", "b-piesa", NOW, d)).toBe("held — No office phone for Viking Electrical");
    expect(sent).toHaveLength(0);
    expect(held).toEqual([{ reason: "No office phone for Viking Electrical", details: expect.objectContaining({ booking_id: "b-piesa", text: "access_person_booked" }) }]);
    const s = deps({ bookings: [{ ...PIESA_BOOKING, status: "cancelled" }] });
    expect(await textAccessPersonBooked("j1", "b-piesa", NOW, s.d)).toBe("not current");
    expect(await textAccessPersonBooked("j1", "b-piesa", new Date("2026-11-04T00:00:00Z"), deps().d)).toBe("not current");
    expect(await textAccessPersonBooked("j1", "nope", NOW, deps().d)).toBe("not current");
    expect(await textAccessPersonBooked("j1", "b-piesa", NOW, deps({ job: { ...JOB, stage: "cancelled" } }).d)).toBe("not applicable");
    expect(await textAccessPersonBooked("j1", "b-piesa", NOW, deps({ job: null }).d)).toBe("not applicable");
  });
  test("quiet hours → waits (the booked sweep retries); no business on file → missing facts", async () => {
    expect(await textAccessPersonBooked("j1", "b-piesa", NOW, deps({ quiet: () => true }).d)).toMatch(/quiet hours/);
    expect(await textAccessPersonBooked("j1", "b-piesa", NOW, deps({ businessContact: async () => null }).d)).toBe("missing facts");
  });
});

describe("textAccessPersonTomorrow", () => {
  test("the afternoon before the PIESA → ONE access_person_tomorrow text to Tina; the install day likewise", async () => {
    const { d, sent } = deps();
    expect(await textAccessPersonTomorrow("j1", "b-piesa", DAY_BEFORE_PIESA, d)).toBe("sent");
    expect(sent[0]).toMatchObject({ type: "access_person_tomorrow", key: "access-tomorrow:v1:b-piesa:+61400111222", to: "+61400111222" });
    expect(sent[0]!.body).toBe("Home Insulation Victoria: Hi Tina, see you tomorrow at 9am for your electrical safety check (PIESA) (Viking Electrical, 03 9111 1111).");
    expect(sent[0]!.event).toBeUndefined(); // window type
    expect(await textAccessPersonTomorrow("j1", "b-piesa", DAY_BEFORE_PIESA, d)).toBe("already handled");
    expect(await textAccessPersonTomorrow("j1", "b-install", DAY_BEFORE_INSTALL, d)).toBe("sent");
    expect(sent[1]!.body).toBe("Home Insulation Victoria: Hi Tina, see you tomorrow at 8am for your insulation install (Rapid Insulation, 03 9000 0000). Reminder: power will be off while they work in the ceiling.");
    expect(sent).toHaveLength(2);
  });
  test("not the day before → not due; Ready Check → not applicable; nobody to text → no access person; flag off → awaiting approval", async () => {
    expect(await textAccessPersonTomorrow("j1", "b-piesa", NOW, deps().d)).toBe("not due");
    expect(await textAccessPersonTomorrow("j1", "b-rc", DAY_BEFORE_PIESA, deps().d)).toBe("not applicable");
    expect(await textAccessPersonTomorrow("j1", "b-piesa", DAY_BEFORE_PIESA, deps({ access: null }).d)).toBe("no access person");
    expect(await textAccessPersonTomorrow("j1", "b-piesa", DAY_BEFORE_PIESA, deps({ approved: false }).d)).toBe("awaiting approval");
  });
  test("TEST job → test-send; STOP from Tina → held; no office phone → held with an office note", async () => {
    let s = deps({ job: { ...JOB, source: "qa_test" } });
    expect(await textAccessPersonTomorrow("j1", "b-piesa", DAY_BEFORE_PIESA, s.d)).toBe("sent");
    expect(s.sent).toHaveLength(0); expect(s.testSent).toHaveLength(1);
    s = deps({ optedOut: ["+61400111222"] });
    expect(await textAccessPersonTomorrow("j1", "b-piesa", DAY_BEFORE_PIESA, s.d)).toBe(`held: ${SMS_REPLIED_STOP}`);
    s = deps({ businessContact: async () => ({ ...rapid, officePhone: "" }) });
    expect(await textAccessPersonTomorrow("j1", "b-install", DAY_BEFORE_INSTALL, s.d)).toBe("held — No office phone for Rapid Insulation");
    expect(s.held[0]).toMatchObject({ reason: "No office phone for Rapid Insulation", details: { booking_id: "b-install", text: "access_person_tomorrow" } });
    expect(ACCESS_TEXT_HELD_EVENT).toBe("access_person_text_held");
  });
});

describe("wiring", () => {
  test("the in-house booked notice calls the access person text for PIESA/install, after the owner's; the day-before sweep calls the tomorrow text for safety check + install visits", () => {
    const booking = readFileSync("src/lib/in-house-booking.server.ts", "utf8");
    const fn = booking.split("export async function notifyOwnerBooked")[1]!.split("\nexport async function")[0]!;
    expect(fn).toContain("textAccessPersonBooked");
    expect(fn.indexOf("textAccessPersonBooked")).toBeGreaterThan(fn.indexOf("sendRealSms"));
    const approved = readFileSync("src/lib/approved-texts.server.ts", "utf8");
    const sweep = approved.split("export async function sweepApprovedTexts")[1]!;
    expect(sweep).toContain("textAccessPersonTomorrow");
    // The access person never gets the owner's money/consent/compliance messages: no other sender names them.
    for (const f of ["src/lib/owner-email-send.server.ts", "src/lib/deposit-request.server.ts", "src/lib/consent-copy-email.server.ts", "src/lib/completion-pack.server.ts", "src/lib/owner-quote-email.core.ts"]) {
      let s = ""; try { s = readFileSync(f, "utf8"); } catch { continue; }
      expect({ f, mentions: /accessPerson|access-person/.test(s) }).toEqual({ f, mentions: false });
    }
  });
});
