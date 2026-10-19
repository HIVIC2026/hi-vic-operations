// P1-FA02 — FFS user-interface deactivation (owner decision, 14 Oct 2026).
//
// FFS is NOT a user-facing role. This step removes the FFS card from /field/$jobId and excludes
// ffs_progress_result events from every user-facing timeline and job-pack export, while the
// backend write path (src/lib/ffs-progress.*) and the stored rows stay untouched.
//
// These tests are read-only against the source tree plus pure-function calls — no database, no
// network. They verify (1) the card no longer mounts, (2) FFS events never reach a timeline or an
// export, (3) every other event type — internal ones included — keeps rendering exactly as before.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { buildTimeline, visibleTo } from "../src/lib/jobfile.core";
import { FFS_PROGRESS_EVENT } from "../src/lib/ffs-progress.core";

const JOB_PAGE = "src/routes/_authenticated/field.$jobId.tsx";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("P1-FA02 TEST 1 — the FFS card no longer mounts through the UI", () => {
  const page = readFileSync(JOB_PAGE, "utf8");

  test("no import, JSX comment or render of FfsProgressCard remains", () => {
    expect(page).not.toContain("FfsProgressCard");
    expect(page).not.toContain("ffs-progress");
    expect(page).not.toContain("P1-S23B");
  });
  test("no route file references the FFS write surface", () => {
    for (const f of walk("src/routes")) {
      const src = readFileSync(f, "utf8");
      expect(src.includes("FfsProgressCard") || src.includes("ffs-progress")).toBe(false);
    }
  });
  test("the trade job page keeps its installer and electrician flows", () => {
    expect(page).toContain("InstallerFlow");
    expect(page).toContain('role === "installer"');
    expect(page).toContain("ElectricianFlow");
    expect(page).toContain('role === "electrician"');
    expect(page).toContain("<TradeShell");
    expect(page).toContain("<VisitContactsCard");
  });
});

describe("P1-FA02 TEST 2 — FFS events are excluded from every user-facing timeline", () => {
  const events = [
    { id: "e1", created_at: "2026-10-01T00:00:00Z", actor_id: null, event_type: "stage_changed", summary: "Moved to installation_booked", internal: false, from_stage: "assessment_booked", to_stage: "installation_booked", details: {} },
    { id: "e2", created_at: "2026-10-02T00:00:00Z", actor_id: "u1", event_type: FFS_PROGRESS_EVENT, summary: "FFS update · Site visited — noted", internal: true, from_stage: null, to_stage: null, details: { result: "site_visited", note: "noted", business_id: "b1", business_name: "Partner A", source: "ffs_field" } },
    { id: "e3", created_at: "2026-10-03T00:00:00Z", actor_id: "u1", event_type: "qa_payment_simulated", summary: "QA payment simulated", internal: true, from_stage: null, to_stage: null, details: {} },
  ];
  const timeline = buildTimeline({ events, correspondence: [], bookings: [], evidence: [] });

  test("the FFS event never becomes a timeline item", () => {
    expect(timeline.some((t) => t.id === "workflow_events:e2")).toBe(false);
    expect(timeline.some((t) => t.summary.includes("FFS update"))).toBe(false);
    expect(timeline.some((t) => String((t.detail as { event_type?: string } | null)?.event_type) === FFS_PROGRESS_EVENT)).toBe(false);
  });
  test("normal workflow events remain visible", () => {
    expect(timeline.some((t) => t.id === "workflow_events:e1" && t.summary === "Moved to installation_booked")).toBe(true);
  });
  test("other internal events are NOT globally hidden (office still sees them)", () => {
    expect(visibleTo(timeline, "admin").some((t) => t.id === "workflow_events:e3")).toBe(true);
  });
});

describe("P1-FA02 TEST 3 — job packs never contain FFS events, other internal items unchanged", () => {
  const events = [
    { id: "e1", created_at: "2026-10-01T00:00:00Z", actor_id: null, event_type: "stage_changed", summary: "Moved to installation_booked", internal: false, from_stage: "assessment_booked", to_stage: "installation_booked", details: {} },
    { id: "e2", created_at: "2026-10-02T00:00:00Z", actor_id: "u1", event_type: FFS_PROGRESS_EVENT, summary: "FFS update · Site visited — noted", internal: true, from_stage: null, to_stage: null, details: { result: "site_visited", note: "noted", source: "ffs_field" } },
    { id: "e3", created_at: "2026-10-03T00:00:00Z", actor_id: "u1", event_type: "qa_payment_simulated", summary: "QA payment simulated", internal: true, from_stage: null, to_stage: null, details: {} },
  ];
  // Mirrors exportJobPack (src/lib/jobfile.server.ts:88): buildTimeline(...).filter(includeInternal || !internal).
  const packTimeline = (includeInternal: boolean) =>
    buildTimeline({ events, correspondence: [], bookings: [], evidence: [] }).filter((t) => includeInternal || !t.internal);

  test("with 'Include internal items' on, non-FFS internal events still export — FFS never does", () => {
    const pack = packTimeline(true);
    expect(pack.some((t) => t.id === "workflow_events:e3")).toBe(true);
    expect(pack.some((t) => String((t.detail as { event_type?: string } | null)?.event_type) === FFS_PROGRESS_EVENT)).toBe(false);
  });
  test("with the option off, no internal event exports (existing behaviour preserved)", () => {
    const pack = packTimeline(false);
    expect(pack.some((t) => t.internal)).toBe(false);
    expect(pack.some((t) => t.id === "workflow_events:e1")).toBe(true);
  });
});

describe("P1-FA02 TEST 4 — presentation-boundary filters are pinned to the canonical event type", () => {
  test("buildTimeline filters on the shared constant, not a renamed or duplicated literal", () => {
    const core = readFileSync("src/lib/jobfile.core.ts", "utf8");
    expect(core).toContain('import { FFS_PROGRESS_EVENT } from "./ffs-progress.core"');
    expect(core).toContain('if (e["event_type"] === FFS_PROGRESS_EVENT) continue;');
  });
  test("TimelinePanel filters the same constant and still renders normal event summaries", () => {
    const panels = readFileSync("src/components/portal/panels.tsx", "utf8");
    expect(panels).toContain('import { FFS_PROGRESS_EVENT } from "@/lib/ffs-progress.core"');
    expect(panels).toMatch(/\.filter\(\(e\) => e\.event_type !== FFS_PROGRESS_EVENT\)/);
    expect(panels).toContain("{e.summary}");
    expect(panels).not.toContain("recordFfsProgress");
    expect(panels).not.toContain("listFfsProgress");
  });
  test("the backend writer still defines the single event type (unchanged, dormant)", () => {
    const core = readFileSync("src/lib/ffs-progress.core.ts", "utf8");
    expect(core).toContain('export const FFS_PROGRESS_EVENT = "ffs_progress_result"');
  });
});
