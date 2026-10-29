import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as core from "../src/lib/worker-compliance.core";
import { approvalFlags, missingItems, workerOfferBlocker } from "../src/lib/worker-compliance.core";

// Owner ruling (29 Oct 2026): "PIISA training" does not exist. Installers are never asked for, blocked by, or flagged for it.
describe("no PIISA training block or flag", () => {
  test("an installer who said No to training is not blocked", () => {
    expect(workerOfferBlocker({ trade_role: "installer", piisa_status: "not_done" } as never, "2026-10-29")).toBeNull();
    expect(workerOfferBlocker({ trade_role: "installer", piisa_status: "done", piisa_certificate_path: "x" } as never, "2026-10-29")).toBeNull();
  });
  test("no PIISA flag for any state", () => {
    for (const w of [{ piisa_status: "done", piisa_certificate_path: "x" }, { piisa_status: "not_done" }, {}]) {
      const flags = approvalFlags({ trade_role: "installer", ...w } as never, "2026-10-29");
      expect(flags.filter((f) => /PIISA/i.test(f))).toEqual([]);
    }
  });
  test("missingItems never asks for piisa", () => {
    expect(missingItems({ trade_role: "installer" })).not.toContain("piisa" as never);
    expect(missingItems({ trade_role: "installer", piisa_status: "not_done" } as never)).not.toContain("piisa" as never);
  });
  test("piisaState is gone", () => expect("piisaState" in core).toBe(false));
  test("Ready Check installer gap has no PIISA reason", () => {
    const src = readFileSync("src/lib/readycheck-booking.core.ts", "utf8");
    expect(src).not.toContain("PIISA training isn't uploaded");
    expect(src).not.toContain("piisaBlocked");
    const srv = readFileSync("src/lib/readycheck-booking.server.ts", "utf8");
    expect(srv).not.toContain("piisaBlocked");
    expect(srv).not.toContain("piisa_");
  });
});
