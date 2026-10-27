import { expect, test } from "bun:test";
import { installerBlock, landingTarget, stageRowLine } from "../src/lib/job-page-layout.core";
import { CARD_STATE_LABEL, type StageCard } from "../src/lib/office-stage-cards.core";
import { nextAction } from "../src/lib/job-next-action.core";

const reinsulate = { business: "Reinsulate", blocker: "No approved installer with a Full, current EEC certification recorded." };
const matthews = { business: "Matthews Insulation", blocker: "Has not agreed to free Ready Checks for Home Insulation Victoria leads." };

test("installerBlock: blocked when no trade is free, with one reason per trade", () => {
  const r = installerBlock({ matching: [], others: [reinsulate, matthews], suburb: "Croydon" });
  expect(r.blocked).toBe(true);
  expect(r.reasons).toHaveLength(2);
  expect(r.reasons[0].startsWith("Reinsulate: ")).toBe(true);
  expect(r.reasons[1].startsWith("Matthews Insulation: ")).toBe(true);
});

test("installerBlock: one free trade means not blocked", () => {
  const r = installerBlock({ matching: [], others: [reinsulate, matthews, { business: "Free Co", blocker: null }], suburb: "Croydon" });
  expect(r.blocked).toBe(false);
});

test("installerBlock: no trades, and no list", () => {
  expect(installerBlock({ matching: [], others: [], suburb: "3184" })).toEqual({ blocked: true, reasons: ["No approved installers cover 3184"] });
  expect(installerBlock({ matching: [], others: [], suburb: "" }).reasons).toEqual(["No approved installers cover this area"]);
  expect(installerBlock(undefined)).toEqual({ blocked: false, reasons: [] });
});

const card = (state: StageCard["state"], lines: StageCard["lines"]): StageCard => ({ key: "ready-check", n: 2, title: "Ready Check", state, lines });

test("stageRowLine: first real line, else the state label", () => {
  expect(stageRowLine(card("now", [{ label: "Installer", value: "Not chosen yet" }]))).toBe("Installer: Not chosen yet");
  expect(stageRowLine(card("not_yet", [{ label: "A", value: "—" }, { label: "B", value: "—" }]))).toBe(CARD_STATE_LABEL.not_yet);
  expect(stageRowLine(card("done", [{ label: "A", value: "—" }, { label: "B", value: "x" }]))).toBe("B: x");
});

test("landingTarget", () => {
  expect(landingTarget("#stage-money", undefined)).toEqual({ card: null, fold: "money" });
  expect(landingTarget("#stage-contact", undefined)).toEqual({ card: null, fold: "contact" });
  expect(landingTarget("#stage-file", undefined)).toEqual({ card: null, fold: "file" });
  expect(landingTarget("#stage-ready-check", undefined)).toEqual({ card: "ready-check", fold: null });
  expect(landingTarget("", "ap_veec")).toEqual({ card: "final-check", fold: null });
  expect(landingTarget("", "installation")).toEqual({ card: "install", fold: null });
  expect(landingTarget("", "quote")).toEqual({ card: "quote", fold: null });
  expect(landingTarget("", undefined)).toEqual({ card: null, fold: null });
  expect(landingTarget("#nonsense", "nonsense")).toEqual({ card: null, fold: null });
});

test("nextAction carries the top need's kind", () => {
  const facts = { jobId: "1", jobNumber: "HV-1", surname: "Smith", suburb: "Croydon", spotSaved: { at: "2026-10-24T01:00:00Z" } };
  const now = Date.parse("2026-10-24T03:00:00Z");
  expect(nextAction({ facts, status: null, stage: "choose_installer", closed: null, onHold: null }, now).kind).toBe("choose_installer");
  expect(nextAction({ facts: null, status: null, stage: null, closed: null, onHold: null }, now).kind).toBeNull();
});
