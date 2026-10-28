import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { effectiveWorkerRole, hasMittiAccessToday, mittiEmailFor, certMatchesWorker, certOrFilter, canChangeWorkerRole } from "../src/lib/worker-role.core";
import { mittiInviteStep, mittiRemovalStep, CREW_SKIP } from "../src/lib/mitti-invite.core";
import { crewReminderDue, crewReminderEmail, crewReminderKey, CREW_REMINDER_EMAIL_APPROVED } from "../src/lib/crew-reminder.core";

describe("people without an email (PGlite)", () => {
  test("nullable email, unique when given, role check", async () => {
    const db = new PGlite();
    await db.exec(`CREATE TABLE public.partner_workers (id serial primary key, business_id int not null, email text not null, worker_role text, UNIQUE (business_id, email));`);
    await db.exec(readFileSync("docs/pending-migrations/0160_worker_email_optional_role.sql", "utf8"));
    await db.exec(`INSERT INTO partner_workers (business_id, email) VALUES (1, NULL), (1, NULL), (1, 'a@x.au');`);
    await expect(db.exec(`INSERT INTO partner_workers (business_id, email) VALUES (1, 'a@x.au')`)).rejects.toThrow();
    await expect(db.exec(`INSERT INTO partner_workers (business_id, email, worker_role) VALUES (2, NULL, 'boss')`)).rejects.toThrow();
    await db.exec(`INSERT INTO partner_workers (business_id, email, worker_role) VALUES (2, NULL, 'crew'), (2, NULL, 'lead')`);
  });
  test("cert matching ignores blank emails", () => {
    expect(certMatchesWorker({ worker_id: null, worker_email: "" }, { id: "w", email: null })).toBe(false);
    expect(certMatchesWorker({ worker_id: "w", worker_email: null }, { id: "w", email: null })).toBe(true);
    expect(certOrFilter(["w"], [null])).toBe("worker_id.in.(w)");
  });
});

describe("Lead / Crew", () => {
  test("blank = crew unless Mitti access today", () => {
    expect(effectiveWorkerRole({ trade_role: "installer", worker_role: null }, false)).toBe("crew");
    expect(effectiveWorkerRole({ trade_role: "installer", worker_role: null }, true)).toBe("lead");
    expect(hasMittiAccessToday({ prior: { type: "mitti_user_deactivated", mittiUserId: "u" } })).toBe(false);
    expect(hasMittiAccessToday({ profileMittiUserId: "u" })).toBe(true);
  });
  test("lead with no email uses business email", () => expect(mittiEmailFor(null, " Biz@X.au ")).toBe("biz@x.au"));
  test("only admins or business_admin can switch", () => {
    expect(canChangeWorkerRole({ isAdmin: false, memberRole: "member" })).toBe(false);
    expect(canChangeWorkerRole({ isAdmin: false, memberRole: "business_admin" })).toBe(true);
  });
  test("crew is never invited to Mitti", () => {
    const p = { workerId: "w", tradeRole: "installer", approvalStatus: "approved", removedAt: null, email: "a@x.au", ciiCleared: true, mittiAccess: null, isTest: false, workerRole: "crew" as const };
    expect(mittiInviteStep(p, null, { enabled: true })).toEqual({ action: "skip", reason: CREW_SKIP });
  });
  test("switch to crew deactivates unless another active Lead shares the email", () => {
    const base = { workerId: "w", email: "a@x.au", isTest: false, removedAt: null, approvalStatus: "approved", demoted: true };
    const prior = { type: "mitti_user_invited" as never, at: "x", mittiUserId: "u1", email: "a@x.au" };
    expect(mittiRemovalStep({ ...base, stillActiveElsewhere: false }, prior, { enabled: true, apiVerified: true }).action).toBe("deactivate");
    expect(mittiRemovalStep({ ...base, stillActiveElsewhere: true }, prior, { enabled: true, apiVerified: true }).action).toBe("skip");
  });
});

describe("crew reminder", () => {
  const start = "2026-11-05T22:00:00Z"; // 6 Nov 9am Melbourne
  test("due from 2pm Melbourne the day before", () => {
    expect(crewReminderDue(start, new Date("2026-11-05T02:59:00Z"))).toBe(false); // 1:59pm 5 Nov
    expect(crewReminderDue(start, new Date("2026-11-05T03:00:00Z"))).toBe(true); // 2pm 5 Nov
    expect(crewReminderDue(start, new Date("2026-11-04T05:00:00Z"))).toBe(false);
  });
  test("one key per job and install date; wording; held until approved", () => {
    expect(crewReminderKey("j", "2026-11-06")).toBe("crew-reminder:j:2026-11-06");
    const e = crewReminderEmail({ shortAddress: "1 Main St", address: "1 Main St, Frankston VIC 3199", jobLink: "L" });
    expect(e.subject).toBe("Pick the crew for tomorrow's install – 1 Main St");
    expect(e.body).toBe("Tomorrow's install at 1 Main St, Frankston VIC 3199 has no Lead installer or crew picked yet. Please pick them on the job page so everyone gets their safety plan and the Mitti form is ready: L");
    expect(CREW_REMINDER_EMAIL_APPROVED).toBe(false);
  });
});
