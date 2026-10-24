import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PIESA_COPY_EMAIL_APPROVED, piesaCopyKey, piesaDeliveryPlan, renderPiesaCopyEmail, type PiesaDeliveryFacts } from "../src/lib/piesa-delivery.core";

const now = new Date("2026-11-02T03:00:00Z"); // Mon 2 Nov, 2pm Melbourne
const base: PiesaDeliveryFacts = {
  signedCopyId: "copy-1", piesaRecordId: "rec-1", installStart: "2026-11-05T22:00:00Z", // Fri 6 Nov 9am Melbourne
  delivered: { owner: false, installer: false }, email: { owner: "owner@example.com", installer: "deep@example.com" }, closed: false,
};

describe("PIESA copy auto-delivery (Jo 24 Oct 2026, decision 111)", () => {
  test("real sending is not approved yet", () => { expect(PIESA_COPY_EMAIL_APPROVED).toBe(false); });
  test("sends to both once a signed copy and an install day exist", () => {
    const p = piesaDeliveryPlan(base, now);
    expect(p.hold).toBeNull(); expect(p.send).toEqual(["owner", "installer"]); expect(p.late).toBe(false);
  });
  test("holds without a signed copy, a PIESA record or an install day, or on a closed job", () => {
    expect(piesaDeliveryPlan({ ...base, signedCopyId: null }, now).hold).toBe("no signed PIESA copy yet");
    expect(piesaDeliveryPlan({ ...base, piesaRecordId: null }, now).hold).toBe("no current PIESA record");
    expect(piesaDeliveryPlan({ ...base, installStart: null }, now).hold).toBe("install day not booked yet");
    expect(piesaDeliveryPlan({ ...base, closed: true }, now).hold).toBe("job closed or archived");
  });
  test("dedupe: a recorded delivery is never repeated; both recorded = nothing to do", () => {
    expect(piesaDeliveryPlan({ ...base, delivered: { owner: true, installer: false } }, now).send).toEqual(["installer"]);
    expect(piesaDeliveryPlan({ ...base, delivered: { owner: true, installer: true } }, now).hold).toBe("both copies already recorded");
  });
  test("24h-before: flagged late inside the last 24h, never after the install has started", () => {
    expect(piesaDeliveryPlan(base, new Date("2026-11-05T10:00:00Z")).late).toBe(true);
    expect(piesaDeliveryPlan(base, new Date("2026-11-04T10:00:00Z")).late).toBe(false);
    expect(piesaDeliveryPlan(base, new Date("2026-11-05T23:00:00Z")).hold).toBe("install day has already started");
  });
  test("a missing address holds that recipient only", () => {
    const p = piesaDeliveryPlan({ ...base, email: { owner: null, installer: "deep@example.com" } }, now);
    expect(p.send).toEqual(["installer"]); expect(p.noAddress).toEqual(["owner"]); expect(p.hold).toBeNull();
    expect(piesaDeliveryPlan({ ...base, email: { owner: null, installer: "  " } }, now).hold).toBe("no email address on file");
  });
  test("one key per recipient and signed copy", () => {
    expect(piesaCopyKey("copy-1", "owner")).not.toBe(piesaCopyKey("copy-1", "installer"));
    expect(piesaCopyKey("copy-1", "owner")).not.toBe(piesaCopyKey("copy-2", "owner"));
  });
  test("wording: no prices, installer copy points at PIISA Part 8(a)", () => {
    const o = renderPiesaCopyEmail({ recipient: "owner", firstName: "Sam", address: "1 Test St, Carlton", jobNumber: "HV-3001", signatureDate: "2026-10-30", installStart: base.installStart, link: "https://x/my-job/t" });
    const i = renderPiesaCopyEmail({ recipient: "installer", firstName: "Deep", address: "1 Test St, Carlton", jobNumber: "HV-3001", signatureDate: "2026-10-30", installStart: base.installStart, link: "https://x/field/j" });
    expect(o.subject).toBe("Signed electrical safety check (PIESA) – HV-3001");
    expect(o.text).toContain("30 October 2026"); expect(o.text).not.toMatch(/\$/);
    expect(i.text).toContain("Part 8(a)"); expect(i.text).not.toMatch(/\$/);
  });
  test("server: delivery rows are written only after an accepted send; held real jobs log not-sent once", () => {
    const src = readFileSync(new URL("../src/lib/piesa-delivery.server.ts", import.meta.url), "utf8");
    expect(src).toContain('if (r.status === "sent") { await recordDelivery(');
    expect(src).toContain("if (!PIESA_COPY_EMAIL_APPROVED)");
    expect(src.indexOf("alreadyLogged(jobId, PIESA_COPY_NOT_SENT_EVENT")).toBeGreaterThan(0);
    expect(src).toContain('from("official_form_deliveries").insert(');
    expect(src).toContain('from("piesa_deliveries").insert(');
  });
});
