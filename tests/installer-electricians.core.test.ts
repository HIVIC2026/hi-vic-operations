// Jo 5 Nov 2026 (approved): ONE Electricians list per installer business, one Main, the licence-matched quote hold and
// "save first, then send" for an electrician change. Pure rules (installer-electricians.core.ts).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CHANGE_PIESA_DONE, HANDOVER_FAILED_WARNING, buildInstallerElectricians, changeElectricianSaveFirst, defaultPick, mainAsUsual, preferredWithMain, sameLicence,
  teamElectricianRow, usualElectricianChangedBlocker, type LinkedElectricianBusiness, type TeamElectricianRow,
} from "../src/lib/installer-electricians.core";

const ORLANDO = "00000000-0000-0000-0000-0000000000b1";
const OTHER = "00000000-0000-0000-0000-0000000000b2";
const W1 = "00000000-0000-0000-0000-0000000000c1";
// Reinsulate today: ORLANDO POWERED linked (approved, "Usual" unticked), no Team electricians, and a saved usual
// electrician event naming "Peter orlando", licence A63151.
const reinsulate = { linked: [{ businessId: ORLANDO, name: "ORLANDO POWERED", approved: true, isPrimary: false, licences: ["A63151"] }] as LinkedElectricianBusiness[], team: [] as TeamElectricianRow[], mainChoice: null, usual: { licence: "a63 151" } };

describe("one Electricians list", () => {
  test("the Reinsulate-like fixture lists ORLANDO POWERED as Approved and Main (the saved usual electrician, same licence)", () => {
    const list = buildInstallerElectricians(reinsulate);
    expect(list.map((e) => [e.name, e.status, e.main])).toEqual([["ORLANDO POWERED", "approved", true]]);
  });
  test("exactly one Main: a saved Main choice wins over the usual electrician and the legacy marker", () => {
    const linked: LinkedElectricianBusiness[] = [...reinsulate.linked, { businessId: OTHER, name: "Other Sparks", approved: true, isPrimary: true, licences: ["B1"] }];
    const team: TeamElectricianRow[] = [{ workerId: W1, name: "Tess Team", licence: "C1", approved: true, allowed: true, reason: null }];
    const count = (l: ReturnType<typeof buildInstallerElectricians>) => l.filter((e) => e.main).length;
    // Never ticked: the old usual electrician decides (same as every server read), the team-up marker only without one.
    expect(buildInstallerElectricians({ linked, team, mainChoice: null, usual: { licence: "A63151" } }).find((e) => e.main)?.name).toBe("ORLANDO POWERED");
    expect(buildInstallerElectricians({ linked, team, mainChoice: null, usual: null }).find((e) => e.main)?.name).toBe("Other Sparks");
    const chosen = buildInstallerElectricians({ linked, team, mainChoice: { workerId: W1 }, usual: { licence: "A63151" } });
    expect(count(chosen)).toBe(1);
    expect(chosen[0]!.name).toBe("Tess Team");
    // A Main that was removed from the list means no Main (never two, never a stale one).
    expect(count(buildInstallerElectricians({ linked, team, mainChoice: { electricianBusinessId: "00000000-0000-0000-0000-0000000000ff" }, usual: null }))).toBe(0);
  });
  test("the Main is the default pick only when it can be picked there", () => {
    expect(defaultPick([{ id: W1, allowed: true, main: true }, { id: OTHER, allowed: true, main: false }])).toBe(W1);
    expect(defaultPick([{ id: W1, allowed: false, main: true }])).toBeNull();
    expect(defaultPick([{ id: W1, allowed: true }])).toBeNull();
  });
  test("a pending linked business shows Pending", () => {
    const list = buildInstallerElectricians({ ...reinsulate, linked: [{ ...reinsulate.linked[0]!, approved: false }] });
    expect(list[0]!.status).toBe("pending");
  });
  test("a Team electrician with no email is Approved on the list but can't be picked (main's rule)", () => {
    const row = teamElectricianRow({ id: W1, full_legal_name: "Tess Team", approval_status: "approved", email: " ", licence_number: "C1", rec_number: "R1", licence_expires_on: "2099-01-01", licence_verified_at: "2026-01-01" });
    expect([row.approved, row.allowed, row.reason]).toEqual([true, false, "add their email on the Team page first"]);
  });
  test("the Main in the old usual-electrician shape", () => {
    const [main] = buildInstallerElectricians({ ...reinsulate, mainChoice: { electricianBusinessId: ORLANDO } });
    expect(mainAsUsual(main)).toEqual({ name: "ORLANDO POWERED", licence: "A63151" });
    expect(mainAsUsual(null)).toBeNull();
  });
  test("ranking: once a Main is ticked only that business is preferred; never ticked keeps the old flags", () => {
    const rels = [{ electrician_business_id: ORLANDO, preferred: true, is_primary: false }, { electrician_business_id: OTHER, preferred: true, is_primary: true }];
    expect(preferredWithMain(rels, { ticked: false, electricianBusinessId: null })).toEqual(rels);
    expect(preferredWithMain(rels, { ticked: true, electricianBusinessId: ORLANDO }).map((r) => [r.preferred, r.is_primary])).toEqual([[true, true], [false, false]]);
    expect(preferredWithMain(rels, { ticked: true, electricianBusinessId: null }).some((r) => r.preferred)).toBe(false); // a Team Main
  });
});

describe("quote hold compares the licence, not the name (HV-3193)", () => {
  test("same licence, different name and case/spaces/dashes: no hold", () => {
    expect(sameLicence("A63151", " a63 151 ")).toBe(true);
    expect(sameLicence("A63-151", "a63151")).toBe(true);
    expect(usualElectricianChangedBlocker({ licence: "A63151" }, { licence: "a63151" })).toBeNull();
  });
  test("a different licence, or none saved: hold", () => {
    expect(usualElectricianChangedBlocker({ licence: "A63151" }, { licence: "A99999" })).not.toBeNull();
    expect(usualElectricianChangedBlocker(null, { licence: "A63151" })).not.toBeNull();
    expect(sameLicence("", "")).toBe(false);
  });
});

describe("changing the electrician saves first, then sends", () => {
  const run = async (o: { done?: boolean; save?: "ok" | "refused" | "throws"; afterFails?: boolean }) => {
    const calls: string[] = [];
    const r = await changeElectricianSaveFirst({
      piesaDone: async () => !!o.done,
      save: async () => { calls.push("save"); if (o.save === "throws") throw new Error("Booking could not be saved."); return o.save === "refused" ? { ok: false, blockers: ["That time is taken"] } : { ok: true }; },
      after: async () => { calls.push("text + Mitti form"); if (o.afterFails) throw new Error("Mitti is down"); },
      afterFailed: async (m) => { calls.push(`Needs me: ${m}`); },
    });
    return { r, calls };
  };
  test("before the safety check: the person and time save, then the text and the form", async () => {
    const { r, calls } = await run({ save: "ok" });
    expect(r).toEqual({ ok: true, warnings: [] });
    expect(calls).toEqual(["save", "text + Mitti form"]);
  });
  test("the Mitti hand-over fails after the save: recorded for the office and a plain warning — never silent", async () => {
    const { r, calls } = await run({ save: "ok", afterFails: true });
    expect(r).toEqual({ ok: true, warnings: [HANDOVER_FAILED_WARNING] });
    expect(calls).toEqual(["save", "text + Mitti form", "Needs me: Mitti is down"]);
  });
  test("after the safety check: refused, nothing saved or sent", async () => {
    const { r, calls } = await run({ done: true, save: "ok" });
    expect(r).toEqual({ ok: false, blockers: [CHANGE_PIESA_DONE] });
    expect(calls).toEqual([]);
  });
  test("the time save fails: no electrician change and no text", async () => {
    for (const save of ["refused", "throws"] as const) {
      const { r, calls } = await run({ save });
      expect(r.ok).toBe(false);
      expect(calls).toEqual(["save"]);
    }
  });
});

test("no screen text says 'HIV electrician does the PIESAs' or 'None named'", () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|ts)$/.test(f)) files.push(p); } };
  walk("src");
  const bad = files.filter((f) => /HIV electrician does the PIESAs|None named|none named · HIV/i.test(readFileSync(f, "utf8")));
  expect(bad).toEqual([]);
});
