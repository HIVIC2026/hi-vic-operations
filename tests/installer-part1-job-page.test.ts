import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PIESA_FULL } from "../src/lib/job-wording";
import { jobNext, thirtyDayLine } from "../src/lib/installer-screens.core";
import { OWNER_PIESA_CONFIRM_WAITING } from "../src/lib/piesa-owner-confirm.core";
import { SAFETY_CHECK_DOC_TITLE } from "../src/lib/trade-view.core";
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
