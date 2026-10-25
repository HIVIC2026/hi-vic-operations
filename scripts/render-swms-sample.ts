// Decision 358: renders a TEST safety plan (SWMS) in the WorkSafe Victoria sample-template layout to
// docs/templates/samples/swms/swms-sample.pdf. TEST names only, no real people; nothing is read from or written to the
// database and nothing is sent. Run: bun scripts/render-swms-sample.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildSwms, swmsRecordText, type SwmsSignature } from "../src/lib/swms.core";
import { buildSwmsPdf } from "../src/lib/swms-pdf.server";

export const SAMPLE_PLAN = buildSwms({
  jobNumber: "HV-TEST-0358", address: "1 Test Street, Testville, 3999", businessName: "TEST Insulation Co Pty Ltd", installDate: "2026-11-03",
  lead: { name: "TEST Lead Installer", workerId: "test-w1" }, crew: [{ name: "TEST Crew Member", workerId: "test-w2" }],
  yearBuilt: 1972, hazardNote: null,
  siteNote: "TEST site note: manhole is in the laundry ceiling, low clearance at the eaves on the north side, old foil sarking near the hip — walk only on joists. Owner has a dog; keep the side gate closed. Solar inverter on the garage wall: isolate at the inverter and the switchboard before entry. Gas ducted heater flue in the hallway ceiling: keep the AS 3999 clearance. Extreme heat forecast in the afternoon: work from 6am and stop by noon.",
});
export const SAMPLE_SIGNATURES: SwmsSignature[] = [
  { key: "w:test-w1", name: "TEST Lead Installer", typedName: "TEST Lead Installer", signedAt: "2026-11-02T08:15:00Z" },
  { key: "w:test-w2", name: "TEST Crew Member", typedName: "TEST Crew Member", signedAt: "2026-11-02T21:40:00Z" },
];

if (import.meta.main) {
  const dir = new URL("../docs/templates/samples/swms/", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  const sha = createHash("sha256").update(swmsRecordText(SAMPLE_PLAN, SAMPLE_SIGNATURES)).digest("hex");
  const { bytes, layout } = await buildSwmsPdf(SAMPLE_PLAN, SAMPLE_SIGNATURES, { recordRef: `swms:${sha.slice(0, 32)}` });
  writeFileSync(`${dir}swms-sample.pdf`, bytes);
  console.log(`Wrote ${dir}swms-sample.pdf (${bytes.byteLength} bytes)`, layout);
}
