import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CLOSED_VIEW, goTo, installerBlock, landingTarget, landingView, showFull, stageRowLine, tapRow, toggleFold } from "../src/lib/job-page-layout.core";
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

test("folded sections start closed, and no stage row is open", () => {
  expect(CLOSED_VIEW).toEqual({ open: null, full: false, folds: { money: false, contact: false, file: false } });
  expect(landingView("", undefined)).toEqual({ view: CLOSED_VIEW, scrollTo: null });
  expect(landingView("#nonsense", "nonsense").view).toEqual(CLOSED_VIEW);
  // The route starts from CLOSED_VIEW, so Money, Contact history and File are closed on first paint.
  expect(readFileSync("src/routes/_authenticated/admin.jobs.$jobId.tsx", "utf8")).toContain("useState<JobView>(CLOSED_VIEW)");
});

test("hash links open the right row with its full tools, or the right fold", () => {
  expect(landingView("#stage-ready-check", undefined)).toEqual({ view: { ...CLOSED_VIEW, open: "ready-check", full: true }, scrollTo: "ready-check" });
  expect(landingView("#stage-install", undefined).view).toMatchObject({ open: "install", full: true });
  expect(landingView("", "ap_veec").view).toMatchObject({ open: "final-check", full: true });
  // Folds open; no stage row opens with them.
  expect(landingView("#stage-money", undefined)).toEqual({ view: { ...CLOSED_VIEW, folds: { money: true, contact: false, file: false } }, scrollTo: "money" });
  expect(landingView("#stage-contact", undefined).view).toEqual({ ...CLOSED_VIEW, folds: { money: false, contact: true, file: false } });
  expect(landingView("#stage-file", undefined).view).toEqual({ ...CLOSED_VIEW, folds: { money: false, contact: false, file: true } });
});

test("links (Next, See installers, onGo) open the stage tools; a plain row tap shows only the lines", () => {
  // Next / See installers / onGo from inside a stage's tools.
  const linked = goTo(CLOSED_VIEW, "ready-check");
  expect(linked).toMatchObject({ open: "ready-check", full: true });
  // Going to another stage from inside one: that stage, tools showing.
  expect(goTo(linked, "piesa")).toMatchObject({ open: "piesa", full: true });
  // Going to a fold keeps the open stage as it was.
  expect(goTo(linked, "money")).toEqual({ ...linked, folds: { money: true, contact: false, file: false } });
  // Plain tap: lines only; tap again closes; tapping the tools-open row closes it too.
  const tapped = tapRow(CLOSED_VIEW, "quote");
  expect(tapped).toMatchObject({ open: "quote", full: false });
  expect(tapRow(tapped, "quote")).toMatchObject({ open: null, full: false });
  expect(tapRow(linked, "ready-check")).toMatchObject({ open: null, full: false });
  expect(tapRow(linked, "quote")).toMatchObject({ open: "quote", full: false });
  // "Open full details" on the tapped row; nothing to show when no row is open.
  expect(showFull(tapped)).toMatchObject({ open: "quote", full: true });
  expect(showFull(CLOSED_VIEW)).toEqual(CLOSED_VIEW);
  // Fold header tap toggles only that fold.
  expect(toggleFold(toggleFold(CLOSED_VIEW, "file"), "file")).toEqual(CLOSED_VIEW);
  expect(toggleFold(linked, "contact").open).toBe("ready-check");
});

test("route wiring: Next box and stage tools go through goTo; rows tap through tapRow; tools only render when full", () => {
  const route = readFileSync("src/routes/_authenticated/admin.jobs.$jobId.tsx", "utf8");
  expect(route).toMatch(/const go = \(k: CardKey \| FoldKey\) => \{ setView\(\(v\) => goTo\(v, k\)\)/);
  expect(route).toContain("<NextBox jobId={jobId} next={data.next} onGo={(k) => go(k)} />");
  expect(route).toContain("<StageWorkspace jobId={jobId} k={k} page={data} onGo={go} />");
  expect(route).toContain("onToggle={(k) => setView((v) => tapRow(v, k))}");
  expect(route).toContain("landingView(window.location.hash, section)");
  const parts = readFileSync("src/components/portal/job-page-parts.tsx", "utf8");
  expect(parts).toMatch(/\{full\s*\?\s*<div className="mt-3">\{workspace\(c\.key\)\}<\/div>/);
  expect(parts).toContain('onClick={() => onToggle(c.key)}');
});

test("Next box reads the installer list only when the next step is Choose installer", () => {
  const parts = readFileSync("src/components/portal/job-page-parts.tsx", "utf8");
  const box = parts.slice(parts.indexOf("export function NextBox"), parts.indexOf("export function StageRows"));
  expect(box).toContain('const isChoose = next.kind === "choose_installer";');
  // The one useQuery that calls listChooseTrades is gated on isChoose, and nothing else reads it.
  expect(box).toMatch(/useQuery\(\{ queryKey: \["choose-trades", jobId, "ready_check"\], queryFn: \(\) => list\([^)]*\), enabled: isChoose \}\)/);
  expect(box.match(/useQuery\(/g)).toHaveLength(1);
  expect(parts.match(/useServerFn\(listChooseTrades\)/g)).toHaveLength(1);
  expect(box).toContain("const list = useServerFn(listChooseTrades);");
  // A disabled query reports pending, so the pending/error lines must be gated too.
  expect(box).toContain("{isChoose && q.isPending &&");
  expect(box).toContain("{isChoose && q.isError &&");
  expect(box).toContain("const inst = isChoose ? installerBlock(q.data)");
});
