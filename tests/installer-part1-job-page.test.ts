import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { HIV_SWITCH, hivSwitchOffered } from "../src/lib/installer-price.core";
import { PIESA_FULL } from "../src/lib/job-wording";
import { STAFF_LINKS_LABEL, jobNext, mittiLinkPlace, thirtyDayLine } from "../src/lib/installer-screens.core";
import { OWNER_PIESA_CONFIRM_WAITING } from "../src/lib/piesa-owner-confirm.core";
import { SAFETY_CHECK_DOC_TITLE, contactVisible } from "../src/lib/trade-view.core";
const read = (p: string) => readFileSync(p, "utf8");
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ROUTE = "src/routes/_authenticated/field.$jobId.tsx";

describe("C1 one PIESA name on the Job page", () => {
  test("no 'safety check' wording in Job page sources", () => {
    const core = read("src/lib/installer-screens.core.ts").split("// ---------- M4 · Today's job")[0]!;
    for (const src of [core, read(ROUTE), read("src/components/trade/InstallerPriceCard.tsx"), read("src/components/portal/piesa-times-electrician.tsx"), read("src/components/trade/FixesTimesCard.tsx"), read("src/components/trade/FixesFormCard.tsx"), read("src/components/portal/mitti.tsx")])
      expect(code(src).split(PIESA_FULL).join("").replace(/Pre Insulation Electrical Safety Assessment/g, "")).not.toMatch(/safety (check|assessment)|electrical assessment/i); // the standard name itself is allowed
  });
  test("shared constants use the standard name", () => {
    expect(OWNER_PIESA_CONFIRM_WAITING).toBe(`Waiting for the owner to confirm the ${PIESA_FULL}`);
    expect(SAFETY_CHECK_DOC_TITLE).toBe(PIESA_FULL);
    expect(thirtyDayLine("2026-11-21")).toBe(`Install within 30 days of the ${PIESA_FULL} (by 21 Nov) or a new PIESA is needed, and whoever's move it was pays for it.`);
    expect(code(read("src/components/portal/mitti.tsx"))).toContain("`Mitti · ${PIESA_FULL}`");
  });
  test("PIESA booked title", () => {
    const n = jobNext({ channel: "hivic_sourced", stage: "piesa_scheduled", ownerFirstName: "Helen", formLinked: true, formCompleted: true, quoteLine: null, piesaBooking: { electrician: "Sam Lee", start: "2026-10-28T22:00:00Z" } } as never);
    expect(n.title).toBe(`Nothing for you — ${PIESA_FULL} booked`);
  });
});

test("C8: install booked without a deadline says the 6:30am sentence once", () => {
  const n = jobNext({ channel: "hivic_sourced", stage: "installation_booked", ownerFirstName: "Helen", formLinked: true, formCompleted: true, quoteLine: null, installTurn: "booked", installBookedAt: "2026-10-26T21:00:00Z", installDeadline: null } as never);
  expect([n.title, n.sub, n.note].join(" | ").match(/6:30am/g)?.length).toBe(1);
  expect(n.sub).toBeNull();
});

test("C6: Open Mitti form has exactly one place", () => {
  const f = { auditId: "a1", mittiInvited: true, formLinked: true };
  expect(mittiLinkPlace({ ...f, panel: "mitti_form", yours: true })).toBe("next");
  expect(mittiLinkPlace({ ...f, panel: "quote_status", yours: true })).toBe("next");
  expect(mittiLinkPlace({ ...f, panel: "quote_status", yours: false })).toBe("ready_check");
  expect(mittiLinkPlace({ ...f, panel: "waiting", yours: false })).toBe("ready_check");
  expect(mittiLinkPlace({ ...f, mittiInvited: false, panel: "mitti_form", yours: true })).toBeNull();
  const r = read(ROUTE);
  expect(r).toMatch(/mittiLink === "next" && [^<]*<MittiFormLink/); expect(r).toMatch(/mittiLink === "ready_check" && [^<]*<MittiFormLink/);
  expect(r).not.toContain('next.panel === "mitti_form" || (next.panel === "quote_status" && next.yours)'); // old inline rule gone
});
test("C7: plain staff-links label", () => {
  expect(STAFF_LINKS_LABEL).toBe("Send this job to a staff member");
  expect(read(ROUTE)).not.toContain("More · staff job links");
  expect(read(ROUTE)).toContain("{STAFF_LINKS_LABEL}");
});

test("C3: electrician Call/Text follow their own visits", () => {
  expect(contactVisible([{ status: "confirmed" }])).toBe(true);
  expect(contactVisible([{ status: "completed" }, { status: "confirmed" }])).toBe(true);
  expect(contactVisible([{ status: "completed" }, { status: "cancelled" }])).toBe(false);
  expect(read("src/lib/job-status.server.ts")).toContain("ownerContactVisible: mineErr ? false : contactVisible(");
  const elec = read(ROUTE).split("function FieldJobBody")[1]!.split("function A1ReadyCheckTimeCard")[0]!;
  expect(elec).toContain("showOwnerContact && job.owner_phone && <a href={`tel:");
  expect(elec).toContain("showOwnerContact && job.owner_phone && <a href={`sms:");
});
test("C3: contact hidden while status loads, on read error, and in the overview once visits are done", () => {
  expect(read(ROUTE)).toContain("status.data?.ownerContactVisible === true");
  expect(read(ROUTE)).not.toContain("ownerContactVisible !== false");
  const srv = read("src/lib/job-status.server.ts");
  expect(srv).toContain("mineErr ? false : contactVisible(");
  expect(srv).toContain("mineErr.code");
  expect(srv).not.toContain("console.error(\"tradeJobStatus: own bookings read failed\", mineErr)");
  const ov = read("src/lib/job-overview.server.ts");
  expect(ov).toContain("contactVisible(mine ?? [])");
  expect(ov).toContain("owner_phone: null } };");
  // the originating installer's own customer skips the visit check, whatever has_contact_release says
  expect(ov).toContain('if (row.channel === "installer_sourced") {');
  expect(ov).not.toContain('if (!rel && row.channel === "installer_sourced")');
  expect(ov).toContain("if (rel && !own) {");
  // trade callers only: the check sits inside the electrician/installer branch, before the admin branch
  expect(ov.indexOf("contactVisible(mine")).toBeLessThan(ov.indexOf('role === "admin" && row.stage'));
  expect(ov.indexOf("contactVisible(mine")).toBeGreaterThan(ov.indexOf('role === "electrician" || role === "installer"'));
});
test("C5: electricians don't see the install deadline", () => {
  const elec = read(ROUTE).split("function FieldJobBody")[1]!.split("function A1ReadyCheckTimeCard")[0]!;
  expect(elec).not.toContain("Install must start by");
  expect(elec).not.toContain("days left");
});

test("C2: one-way switch only on a job held for a not-onboarded electrician", () => {
  expect(hivSwitchOffered({ quoteHeldNotOnboarded: true, choice: "usual" })).toBe(true);
  expect(hivSwitchOffered({ quoteHeldNotOnboarded: true, choice: "hivic" })).toBe(false); // already switched: no way back
  expect(hivSwitchOffered({ quoteHeldNotOnboarded: false, choice: "usual" })).toBe(false);
  expect(HIV_SWITCH.button(349)).toBe("Use Home Insulation Victoria's electrician ($349)");
  const srv = read("src/lib/installer-price-set.server.ts");
  const fn = srv.slice(srv.indexOf("export async function switchToHivElectrician"));
  expect(fn).toMatch(/requireMember\(userId, [^,]+, true\)/);
  expect(fn).toContain('recordElectricianChoice(jobId, ');
  expect(fn).toContain('"hivic", "installer_switch")');
  const card = read("src/components/trade/InstallerPriceCard.tsx");
  expect(card).toContain("confirm={HIV_SWITCH.confirm}");
  for (const f of readdirSync("src/routes/_authenticated").filter((n: string) => n.startsWith("admin"))) expect(read(`src/routes/_authenticated/${f}`)).not.toContain("switchToHivElectrician");
});
