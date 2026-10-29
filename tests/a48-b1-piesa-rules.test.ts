import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { B1_OPTIONS, PIESA_RULE_NOT_BLOCKING, PIESA_RULE_REASON, piesaRuleBlockers, type OfficialAnswers } from "../src/lib/official-forms.core";

const R = {
  p2p3: "a switchboard or solar answer is No, so repairs are needed (or you must be on site at the start)",
  rect: "wiring, safety switch (RCD) or downlight problems must be repaired before the install",
  sw: "the main switch answer must be No when any switchboard item is No",
  scope: "\"not possible\" was chosen but no switchboard or solar answer is No",
  list: "the repairs list doesn't match the repairs answer",
  life: "life support is ticked but no consent or medical plan is attached",
  p7: "an appliance or hazard row is incomplete",
  blank: "some required answers are blank",
};
const clear = (): OfficialAnswers => {
  const a: OfficialAnswers = { jobRef: "HV-1", address: "1 Test St VIC 3000", inspectionDate: "2026-10-01", lifeSupport: "No",
    "p2.mains": "Yes", "p2.switch": "Yes", "p2.switchAccessible": "Yes", "p2.switchIsolates": "Yes", "p2.switchSecured": "Yes", "p2.tested": "Yes", "p2.rcdPresent": "Yes", "p2.rcdTested": "Yes",
    "p3.present": "No", "p4.conduit": "Yes", "p4.supported": "Yes", "p4.treatment": "Yes", "p4.tps": "N/A", "p4.terminations": "Yes", "p4.plugBases": "Yes", "p4.foil": "Yes",
    "p5.nonTps": "No", "p5.splitConduit": "No", "p5.damaged": "No", "p6.recessed": "No", "p7.appliances": "No", "p7.flues": "No", b1: B1_OPTIONS[0],
    "b3.licence": "L1", "b3.name": "E One", "b3.recName": "Spark", "b3.recNo": "R1", "b3.phone": "0400", "b3.declaration": true,
    "o.signature": "O Owner", "o.name": "O Owner", "o.date": "2026-10-01" };
  for (let i = 1; i <= 4; i++) a[`o.tick${i}`] = true;
  return a;
};
const LS = { lifeSupport: "Yes", lifeSupportConsent: "Yes – received Consent" };
const swNo = { "p2.switch": "No", "p2.switchSecured": "No" };

describe("piesaRuleBlockers", () => {
  test("all clear + not required -> none", () => expect(piesaRuleBlockers(clear())).toEqual([]));
  test("switchboard No + not required -> P2P3-NO", () =>
    expect(piesaRuleBlockers({ ...clear(), ...swNo })).toEqual([{ rule: "P2P3-NO", reason: R.p2p3 }]));
  test("Part 2 No only + not possible -> allowed", () =>
    expect(piesaRuleBlockers({ ...clear(), ...swNo, b1: B1_OPTIONS[2] })).toEqual([]));
  test("non-IC downlight + not possible (with Part 2 No) -> repair reason", () => {
    const r = piesaRuleBlockers({ ...clear(), ...swNo, "p6.recessed": "Yes", "p6.count": 4, "p6.prohibited": "Yes", b1: B1_OPTIONS[2] });
    expect(r.map((x) => x.reason)).toEqual([R.rect]);
    expect(r[0]!.rule).toMatch(/^RECT-REQUIRED:/);
  });
  test("downlight + not possible, no switchboard No -> repair then scope reason", () => {
    const r = piesaRuleBlockers({ ...clear(), "p6.recessed": "Yes", "p6.count": 4, "p6.prohibited": "Yes", b1: B1_OPTIONS[2] });
    expect(r.map((x) => x.reason)).toEqual([R.rect, R.scope]);
  });
  test("main switch Yes while a sub-item is No -> overall reason", () =>
    expect(piesaRuleBlockers({ ...clear(), "p2.switchSecured": "No", b1: B1_OPTIONS[1], b2: [] }).map((x) => x.reason)).toContain(R.sw));
  test("repairs chosen but nothing listed -> list reason (list is also a blank required answer)", () =>
    expect(piesaRuleBlockers({ ...clear(), b1: B1_OPTIONS[1] })).toEqual([{ rule: "B1-B2", reason: R.list }, { rule: "REQ:b2", reason: R.blank }]));
  test("life support yes without attachment -> life support reason (attachment is also a blank required answer)", () =>
    expect(piesaRuleBlockers({ ...clear(), ...LS })).toEqual([{ rule: "P1-LIFE-SUPPORT", reason: R.life }, { rule: "REQ:lifeSupportAttachment", reason: R.blank }]));
  test("life support yes with consent and attachment -> clear", () =>
    expect(piesaRuleBlockers({ ...clear(), ...LS, lifeSupportAttachment: "plan.pdf" })).toEqual([]));
  test("incomplete appliance row", () =>
    expect(piesaRuleBlockers({ ...clear(), "p7.flues": "Yes" })).toEqual([{ rule: "P7-DESCRIBE", reason: R.p7 }]));
  test("blank required answer", () => {
    const a = clear(); delete a["b3.name"];
    expect(piesaRuleBlockers(a)).toEqual([{ rule: "REQ:b3.name", reason: R.blank }]);
  });
  test("empty answers -> only the blank reason, once", () => expect(piesaRuleBlockers({}).map((x) => x.reason)).toEqual([R.blank]));
  test("reasons come out in table order, one per reason", () => {
    const r = piesaRuleBlockers({ ...clear(), ...swNo, ...LS, "p7.flues": "Yes" }).map((x) => x.reason);
    expect(r).toEqual([R.p2p3, R.life, R.p7, R.blank]);
  });
  test("COPY-24H and P7-NOT-EFFECTIVE are never returned", () => {
    const ok = { ...clear(), "p7.flues": "Yes", "p7.appliance#0": "Fan", "p7.location#0": "Bath", "p7.hazard#0": "Heat", "p7.actions": "x", "p7.effective": "No" };
    expect(piesaRuleBlockers(ok)).toEqual([]);
    expect(PIESA_RULE_NOT_BLOCKING).toEqual(["COPY-24H", "P7-NOT-EFFECTIVE"]);
  });
  test("reason strings are exactly the approved table", () => {
    expect(new Set(Object.values(PIESA_RULE_REASON))).toEqual(new Set(Object.values(R)));
  });
  test("every rule evaluatePiesa can emit is mapped or explicitly excluded", () => {
    const src = readFileSync("src/lib/official-forms.core.ts", "utf8");
    const body = src.slice(src.indexOf("export function evaluatePiesa"), src.indexOf("function evaluatePiisa") > 0 ? src.indexOf("function evaluatePiisa") : undefined);
    const ids = new Set<string>();
    for (const m of body.matchAll(/blockers\.push\(\{ rule: ["`]([A-Z0-9-]+)/g)) ids.add(m[1]!);
    expect(ids.size).toBeGreaterThan(10);
    for (const id of ids) expect(id in PIESA_RULE_REASON || PIESA_RULE_NOT_BLOCKING.includes(id)).toBe(true);
    expect(body).toContain("requiredMissing(\"piesa\"");
    expect("REQ" in PIESA_RULE_REASON).toBe(true);
  });
});
