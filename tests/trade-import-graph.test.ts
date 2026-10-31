// Speed (installer screens towards 1 second, task 2): the installer (trade) screens must not statically pull in the
// email, MJML, official-form, onboarding-agreement or Mitti-form code just for a few constants. Source scan only: it
// walks static `import ... from` / `export ... from` edges (not dynamic import(), not `import type`) from the /field
// route files and src/components/trade/*.tsx. `*.server.*` files and `*.functions.ts` files are not followed: the
// build replaces server-function bodies with RPC stubs, so their server imports never reach the browser.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");

const FORBIDDEN = [
  /^email-kit(\.|$)/, /^mjml/, /^email-hero-assets/, /^mail-mjml/,
  /^official-forms(\.|$)/, /^official-short(\.|$)/, /^rec-onboarding(\.|$)/,
  /^rec-agreement\.text/, /^activity48-agreement-schedule\.text/, /\.text\.ts$/,
  /^mitti\.core\./, /^mitti-invite\.core\./, /^enquiry\.core\./, /^piesa-owner-confirm\.core\./,
];

const EDGE = /(?:^|\n)[ \t]*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g;

function resolveSpec(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function startFiles(): string[] {
  const routes = join(SRC, "routes", "_authenticated");
  const trade = join(SRC, "components", "trade");
  return [
    ...readdirSync(routes).filter((f) => /^field.*\.tsx$/.test(f)).map((f) => join(routes, f)),
    ...readdirSync(trade).filter((f) => f.endsWith(".tsx")).map((f) => join(trade, f)),
  ];
}

function walk() {
  const starts = startFiles();
  const parent = new Map<string, string>();
  const seen = new Set(starts);
  const queue = [...starts];
  while (queue.length) {
    const file = queue.shift()!;
    for (const m of readFileSync(file, "utf8").matchAll(EDGE)) {
      const target = resolveSpec(file, m[1]!);
      if (!target || seen.has(target)) continue;
      const name = basename(target);
      if (/\.server\.tsx?$/.test(name)) continue;
      seen.add(target);
      parent.set(target, file);
      if (!/\.functions\.ts$/.test(name)) queue.push(target);
    }
  }
  return { starts, seen, parent };
}

describe("trade screens import graph", () => {
  test("starts from the field routes and trade components", () => {
    const { starts, seen } = walk();
    expect(starts.length).toBeGreaterThan(30);
    expect(seen.has(join(SRC, "lib", "trade-view.core.ts"))).toBe(true);
    expect(seen.has(join(SRC, "lib", "installer-screens.core.ts"))).toBe(true);
  });

  test("does not reach email, MJML, official forms, onboarding, agreement texts, Mitti core or enquiry core", () => {
    const { seen, parent } = walk();
    const bad = [...seen].filter((f) => FORBIDDEN.some((re) => re.test(basename(f))));
    const chains = bad.map((f) => {
      const chain = [f];
      let c = f;
      while (parent.has(c)) { c = parent.get(c)!; chain.push(c); }
      return chain.reverse().map((x) => relative(ROOT, x)).join(" -> ");
    });
    expect(chains).toEqual([]);
  });
});

describe("shared trade constants are byte-identical to their old homes", () => {
  test("old homes re-export the same values", async () => {
    const shared = await import("../src/lib/trade-shared-consts.core");
    const { COLLECTION_NOTICE_BLOCK_MESSAGE } = await import("../src/lib/esc-collection-notice.core");
    const { CREW_SKIP } = await import("../src/lib/mitti-invite.core");
    const { CREW_NO_MITTI } = await import("../src/lib/worker-role.core");
    const { MIN_REC_PL_COVER, isAustralianAddress, isVictorianAddress, keepPickedNumber } = await import("../src/lib/rec-onboarding.core");
    const { FIXES_FORM_LINK_LABEL } = await import("../src/lib/fixes-day.core");
    const { OWNER_PIESA_CONFIRM_WAITING } = await import("../src/lib/piesa-owner-confirm.core");
    const { PIESA_FULL } = await import("../src/lib/job-wording");
    const { menuOffset } = await import("../src/lib/portal-presentation.core");
    const { insulationDetailText } = await import("../src/lib/enquiry.core");
    const att = await import("../src/lib/install-attendance.core");
    const { OWNER_SUGGEST_MAX } = await import("../src/lib/install-days.core");
    expect(shared.COLLECTION_NOTICE_BLOCK_MESSAGE).toBe(COLLECTION_NOTICE_BLOCK_MESSAGE);
    expect(shared.CREW_SKIP).toBe(CREW_SKIP);
    expect(CREW_NO_MITTI).toBe(CREW_SKIP);
    expect(CREW_SKIP).toBe("Crew aren't invited automatically — the office adds them to Mitti by hand.");
    expect(shared.MIN_REC_PL_COVER).toBe(MIN_REC_PL_COVER);
    expect(MIN_REC_PL_COVER).toBe(5_000_000);
    expect(shared.FIXES_FORM_LINK_LABEL).toBe(FIXES_FORM_LINK_LABEL);
    expect(FIXES_FORM_LINK_LABEL).toBe("Fixes form in Mitti");
    expect(shared.OWNER_PIESA_CONFIRM_WAITING).toBe(OWNER_PIESA_CONFIRM_WAITING);
    expect(OWNER_PIESA_CONFIRM_WAITING).toBe(`Waiting for the owner to confirm the ${PIESA_FULL}`);
    expect(shared.menuOffset).toBe(menuOffset);
    expect(shared.insulationDetailText).toBe(insulationDetailText);
    expect(shared.isAustralianAddress).toBe(isAustralianAddress);
    expect(shared.isVictorianAddress).toBe(isVictorianAddress);
    expect(shared.keepPickedNumber).toBe(keepPickedNumber);
    expect(shared.ATTENDANCE_MAX_DAYS).toBe(OWNER_SUGGEST_MAX);
    expect(att.ATTENDANCE_MAX_DAYS).toBe(OWNER_SUGGEST_MAX);
    expect(att.declineBlockers).toBe(shared.declineBlockers);
    expect(att.ATTENDANCE_REASONS).toBe(shared.ATTENDANCE_REASONS);
    expect(att.ATTENDANCE_ANCHOR).toBe("install-attendance");
    expect(att.ATTENDANCE_YES).toBe("I'll be there");
    expect(att.ATTENDANCE_NO).toBe("Can't make it");
  });

  test("the shared module has no imports", () => {
    const src = readFileSync(join(SRC, "lib", "trade-shared-consts.core.ts"), "utf8");
    expect(src.match(EDGE) ?? []).toEqual([]);
    expect(src).not.toMatch(/\bimport\s*\(/);
  });
});

describe("crew rules moved to piisa-crew.core", () => {
  test("piisa-a3.core re-exports the same functions", async () => {
    const crew = await import("../src/lib/piisa-crew.core");
    const a3 = await import("../src/lib/piisa-a3.core");
    expect(a3.crewSelectionProblems).toBe(crew.crewSelectionProblems);
    expect(a3.savedCrewNeedsRepick).toBe(crew.savedCrewNeedsRepick);
    expect(a3.leadWorkerId).toBe(crew.leadWorkerId);
    expect(a3.A3_NATIVE_CREW_LOOKUP).toBe(crew.A3_NATIVE_CREW_LOOKUP);
    expect(a3.CREW_NOT_LEAD_MESSAGE).toBe(crew.CREW_NOT_LEAD_MESSAGE);
  });
});
