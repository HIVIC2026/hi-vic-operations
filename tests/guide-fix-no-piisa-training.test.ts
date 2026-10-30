import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as core from "../src/lib/worker-compliance.core";
import { approvalFlags, missingItems, workerOfferBlocker } from "../src/lib/worker-compliance.core";
import { stepErrors as instErrors } from "../src/lib/installer-onboarding.core";
import { activationWorkers } from "../src/lib/partner-activation.core";
import { approvalFlags as profileFlags, buildPartnerProfile } from "../src/lib/partner-profile.core";
import { renderApplicationReceivedEmail } from "../src/lib/application-review.core";

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

describe("sign-up, approval and profile never mention PIISA training", () => {
  const worker = { full_legal_name: "Al", mobile: "0412345678", email: "al@ins.com.au", cii_holds: "not_held" };
  test("onboarding asks nothing about it, even for old drafts that say yes", () => {
    const keys = (x: object) => Object.keys(instErrors("installers" as never, { installers: [{ ...worker, ...x }] } as never, ));
    for (const x of [{}, { piisa_done: "no" }, { piisa_done: "yes" }, { piisa_done: "yes", piisa_date: "2099-01-01" }]) expect(keys(x).filter((k) => /piisa/.test(k))).toEqual([]);
    const msgs = instErrors("installers" as never, { installers: [worker] } as never);
    expect(JSON.stringify(msgs)).not.toMatch(/PIISA/i);
  });
  const old = { installers: [{ ...worker, piisa_done: "yes", piisa_date: "2026-09-01" }], piisa_files: { "al@ins.com.au": "x/cert.pdf" } };
  test("approval writes no piisa fields for an old application", () => {
    const rows = activationWorkers("installer", old as never, "biz", "app");
    expect(rows.length).toBe(1);
    expect(Object.keys(rows[0]!).filter((k) => /piisa/.test(k))).toEqual([]);
  });
  test("profile of an old application has no PIISA licence or flag", () => {
    const meta = { partner_type: "installer", signer_name: null, signer_position: null, signer_email: null, agreement_version: null, signed_at: null, agreement_text: null, insurance_certificate_path: null };
    for (const data of [old, { installers: [worker] }, { installers: [{ ...worker, piisa_done: "no" }] }]) {
      const p = buildPartnerProfile(meta as never, data as never);
      expect(p.licences.filter((l) => l.kind === "piisa_training")).toEqual([]);
      expect(profileFlags(p, { r5: [], piesa: [] }, "2026-10-29").filter((f) => /PIISA/i.test(f))).toEqual([]);
    }
  });
  test("review copy", () => {
    const m = renderApplicationReceivedEmail({ contactName: "Sam Lee", businessName: "Reinsulate" });
    expect(m.text).toContain("CII certification and public liability insurance (min $5 million).");
    expect(m.text).not.toMatch(/PIISA/i);
  });
  test("no PIISA upload or question left in the sign-up screen", () => {
    expect(readFileSync("src/routes/installer-onboarding.tsx", "utf8")).not.toMatch(/piisa/i);
    const fns = readFileSync("src/lib/installer-onboarding.functions.ts", "utf8");
    expect(fns).not.toContain("installerPiisaUploadUrl");
    expect(fns).not.toContain("confirmInstallerPiisaUpload");
    expect(fns).not.toContain("piisa_done");
  });
});

describe("no PIISA training on the Team page, office list or functions", () => {
  test("worker-compliance.tsx has no PIISA", () => {
    const src = readFileSync("src/components/portal/worker-compliance.tsx", "utf8");
    expect(src).not.toMatch(/piisa/i);
    expect(src).toContain("Licences");
  });
  test("worker-compliance.functions.ts exports none of the PIISA training functions", () => {
    const src = readFileSync("src/lib/worker-compliance.functions.ts", "utf8");
    for (const n of ["piisaUploadSlot", "savePiisa", "officeVerifyPiisa", "officePiisaFileUrl"]) expect(src).not.toContain(n);
    expect(src).not.toMatch(/hasPiisaFile|piisa_status|piisa_certificate_path/);
  });
  test("test journey setup has no PIISA training step", () => {
    expect(readFileSync("src/lib/journey-setup.server.ts", "utf8")).not.toMatch(/piisa/i);
  });
});
