import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { DAILY_TEXT_WORDING_VERSION, arrivalTime, dailySendDue, dailyText, diffDay, melbourneHm, mittiFormSource, skipReason, snap, timeWindow, updateText, type DayJob } from "../src/lib/daily-mitti-text.core";
import { brandSmsBody } from "../src/lib/sms.core";

describe("which Mitti form each booking links (Jo 24 Oct 2026)", () => {
  test("install days link the installer's PIISA form; electrician visits keep the PIESA audit; Ready Checks their form", () => {
    expect(mittiFormSource("installation")).toBe("piisa_event");
    expect(mittiFormSource("assessment")).toBe("assessments");
    expect(mittiFormSource("rectification")).toBe("assessments");
    expect(mittiFormSource("ready_check")).toBe("ready_checks");
  });
  test("server reads the latest mitti_piisa_audit_created audit_id; none = form not ready yet", () => {
    const src = readFileSync(new URL("../src/lib/daily-mitti-text.server.ts", import.meta.url), "utf8");
    expect(src).toContain('.eq("event_type", "mitti_piisa_audit_created").order("created_at", { ascending: false }).limit(1)');
    expect(src).toContain("return id ? String(id) : null;");
    expect(src).toContain("bookingFormAuditId(b.job_id, b.kind)");
  });
});

const job = (id: string, start: string, end: string, street: string, suburb: string, status = "confirmed"): DayJob => ({ jobId: id, bookingId: `b${id}`, start, end, street, suburb, status, link: `https://app.au.mitti.com/inspections/${id}` });

describe("daily Mitti text timing (Melbourne)", () => {
  test("6:30 in daylight saving (AEDT, UTC+11)", () => {
    expect(melbourneHm(new Date("2026-10-07T19:29:00Z"))).toBe("06:29");
    expect(dailySendDue(new Date("2026-10-07T19:29:00Z"), "06:30")).toBe(false);
    expect(dailySendDue(new Date("2026-10-07T19:30:00Z"), "06:30")).toBe(true);
  });
  test("6:30 in standard time (AEST, UTC+10)", () => {
    expect(dailySendDue(new Date("2026-06-15T20:29:00Z"), "06:30")).toBe(false);
    expect(dailySendDue(new Date("2026-06-15T20:30:00Z"), "06:30")).toBe(true);
  });
  test("time is a setting", () => { expect(dailySendDue(new Date("2026-06-15T20:30:00Z"), "07:00")).toBe(false); });
});

describe("who gets it", () => {
  const ok = { businessId: "x", approved: true, linked: true, mittiInvited: true, phone: "+61477511901" };
  test("skips trades without the Mitti flag, unlinked or unapproved", () => {
    expect(skipReason(ok)).toBeNull();
    expect(skipReason({ ...ok, mittiInvited: false })).toBe("Mitti account invited is not ticked");
    expect(skipReason({ ...ok, linked: false })).toBe("Trade not linked to the job");
    expect(skipReason({ ...ok, approved: false })).toBe("Trade not approved");
  });
});

describe("wording", () => {
  const a = job("1", "2026-10-07T21:00:00Z", "2026-10-07T23:00:00Z", "12 Smith St", "Frankston");
  const b = job("2", "2026-10-08T00:00:00Z", "2026-10-08T02:00:00Z", "5 Hill Rd", "Werribee");
  test("decision 83 morning text verbatim: time order, arrival time (no window), short address, link; brand prefix from the sender", () => {
    const t = dailyText([b, a], "https://x/field");
    expect(t).toBe("Good morning! Your jobs today: 1) 8am, 12 Smith St Frankston: https://app.au.mitti.com/inspections/1 2) 11am, 5 Hill Rd Werribee: https://app.au.mitti.com/inspections/2 Tap a link to open its Mitti form.");
    expect(brandSmsBody(t).startsWith("Home Insulation Victoria: Good morning! Your jobs today: 1) 8am, ")).toBe(true);
    expect(t).not.toMatch(/\bHIV\b/);
    expect(arrivalTime("2026-10-08T03:30:00Z")).toBe("2:30pm");
    expect(timeWindow("2026-10-08T03:00:00Z", "2026-10-08T05:00:00Z")).toBe("2–4pm");
    expect(DAILY_TEXT_WORDING_VERSION).toBe("APPROVED-2026-10-24-decision-83");
  });
  test("too many jobs -> My work link (fallback allowed by decision 83)", () => {
    const many = Array.from({ length: 8 }, (_, i) => job(String(i), `2026-10-07T2${i % 3}:00:00Z`, `2026-10-07T23:00:00Z`, `${i} Long Street Name`, "Frankston South"));
    const t = dailyText(many, "https://x/field");
    expect(t).toContain("https://x/field");
    expect(t.startsWith("Good morning! You have 8 jobs today.")).toBe(true);
  });
  test("update text: added, moved, cancelled", () => {
    const prev = [snap(a), snap(b)];
    const moved = { ...a, start: "2026-10-07T22:00:00Z" };
    const c = job("3", "2026-10-08T03:00:00Z", "2026-10-08T05:00:00Z", "9 Bay St", "Altona");
    const ch = diffDay(prev, [moved, { ...b, status: "cancelled" }, c]);
    expect(ch.map((x) => x.kind).sort()).toEqual(["added", "cancelled", "moved"]);
    expect(updateText(ch, "https://x")).toContain("Moved: 9–10am, 12 Smith St Frankston");
    expect(diffDay(prev, [a, b])).toEqual([]);
  });
});

describe("0140 migration (practice database)", () => {
  test("switch defaults OFF, 06:30, unique send key", async () => {
    const db = new PGlite();
    await db.exec(`create role authenticated; create role service_role; create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
      create type public.app_role as enum ('admin'); create function public.has_role(u uuid, r public.app_role) returns boolean language sql as $$ select false $$;
      create table public.businesses (id uuid primary key); create table public.workflow_settings (id int primary key); insert into public.workflow_settings values (1);
      insert into public.businesses values ('00000000-0000-0000-0000-000000000001');`);
    const sql = readFileSync("docs/pending-migrations/0140_daily_mitti_text.sql", "utf8");
    await db.exec(sql); await db.exec(sql);
    const r = (await db.query<{ e: boolean; t: string }>("select daily_mitti_text_enabled e, daily_mitti_text_time t from public.workflow_settings")).rows[0]!;
    expect(r).toEqual({ e: false, t: "06:30" });
    await expect(db.exec("update public.workflow_settings set daily_mitti_text_time='6:30'")).rejects.toThrow();
    const ins = "insert into public.trade_text_log (business_id, melbourne_date, kind, send_key, status) values ('00000000-0000-0000-0000-000000000001','2026-10-07','daily','daily:x','sending')";
    await db.exec(ins);
    await expect(db.exec(ins)).rejects.toThrow();
  });
});

describe("switch OFF = nothing sent", () => {
  test("sweep returns before collecting or sending when the switch is off", () => {
    const src = readFileSync("src/lib/daily-mitti-text.server.ts", "utf8");
    const sweep = src.slice(src.indexOf("export async function sweepDailyMittiTexts"));
    expect(sweep.indexOf('if (!s.enabled) return { skipped: "switch_off" }')).toBeLessThan(sweep.indexOf("collectDay("));
    expect(sweep.indexOf('if (s.missing.length) return')).toBeLessThan(sweep.indexOf("collectDay("));
  });
});
