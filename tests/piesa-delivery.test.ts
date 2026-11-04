import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PIESA_COPY_EMAIL_APPROVED, piesaCopyKey, piesaDeliveryPlan, renderPiesaCopyEmail, type PiesaDeliveryFacts } from "../src/lib/piesa-delivery.core";

const now = new Date("2026-11-02T03:00:00Z"); // Mon 2 Nov, 2pm Melbourne
const base: PiesaDeliveryFacts = {
  signedCopyId: "copy-1", piesaRecordId: "rec-1", installStart: "2026-11-05T22:00:00Z", // Fri 6 Nov 9am Melbourne
  delivered: { owner: false, installer: false }, email: { owner: "owner@example.com", installer: "deep@example.com" }, closed: false,
};

describe("PIESA copy auto-delivery (Jo 24 Oct 2026, decision 111)", () => {
  test("approved (decision 131); real delivery still behind customer comms", () => { expect(PIESA_COPY_EMAIL_APPROVED).toBe(true); });
  test("sends to both once a signed copy and an install day exist", () => {
    const p = piesaDeliveryPlan(base, now);
    expect(p.hold).toBeNull(); expect(p.send).toEqual(["owner", "installer"]); expect(p.late).toBe(false);
  });
  test("holds missing copies/records and closed jobs; sends the owner copy before install booking", () => {
    expect(piesaDeliveryPlan({ ...base, signedCopyId: null }, now).hold).toBe("no signed PIESA copy yet");
    expect(piesaDeliveryPlan({ ...base, piesaRecordId: null }, now).hold).toBe("no current PIESA record");
    expect(piesaDeliveryPlan({ ...base, installStart: null }, now).send).toEqual(["owner"]);
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

describe("installer PIESA copy (touchpoint 41, Jo 2 Nov 2026)", () => {
  const mail = renderPiesaCopyEmail({ recipient: "installer", firstName: "Deep", address: "1 A St", jobNumber: "HV-1", signatureDate: "2026-11-02", installStart: null, link: "https://example.invalid/field/j", electrician: { name: "Viking Electrical" }, repairs: null });
  test("says electrical upgrades, not repairs, and what to do next", () => {
    expect(mail.text).toContain("Electrical upgrades needed: None");
    expect(mail.text).not.toContain("Repairs needed");
    expect(mail.text).toContain("Next: call the owner and book the install in the portal. They pay their 10% deposit to lock it in.");
    expect(mail.html).toContain("Electrical upgrades needed");
  });
  test("owner standalone copy uses the same row label", () => {
    expect(renderPiesaCopyEmail({ recipient: "owner", firstName: "Sarah", address: "1 A St", jobNumber: "HV-1", signatureDate: "2026-11-02", installStart: null, link: "https://example.invalid/t", repairs: null }).text).toContain("Electrical upgrades needed: None");
  });
  test("owner copy has no installer next line", () => {
    expect(renderPiesaCopyEmail({ recipient: "owner", firstName: "Sarah", address: null, jobNumber: "HV-1", signatureDate: null, installStart: null, link: null }).text).not.toContain("Next: call the owner");
  });
});

// Pack 1 item 44 (Jo 4 Nov 2026, APPROVED redraft): the owner's copy after the electrical upgrades.
describe("owner PIESA copy after the electrical upgrades (pack 1 item 44)", () => {
  const base = { firstName: "Helen", address: "824 High Street Road, Glen Waverley", jobNumber: "HV-TEST", signatureDate: "2026-11-05", installStart: "2026-11-10T20:30:00Z", link: "https://example.invalid/my-job/TEST?screen=piesa", electrician: { name: "Spark Electrical", licence: "12345", rec: "67890" } };
  const done = renderPiesaCopyEmail({ ...base, recipient: "owner", repairs: { completed: true, cesNumber: "CES-1234" } });
  test("the approved words: subject, headline, result, intro, row, preview", () => {
    expect(done.subject).toBe("Your electrical upgrades are done — updated safety check attached");
    expect(done.text).toContain("Helen, your electrical upgrades are done");
    expect(done.text).toContain("Here's your updated copy of your electrical safety check (PIESA), now that the upgrades are complete. Please keep it: the VEU program says you must have it at least 24 hours before your install.");
    expect(done.text).toContain("SAFETY CHECK RESULT\nSafe to insulate\n");
    expect(done.text).toContain("Electrical upgrades: Completed · certificate CES-1234");
    expect(done.html).toContain("Electrical upgrades done — safe to insulate. Please keep this copy – you need it at least 24 hours before your install.");
    expect(done.html).not.toContain("(after");
  });
  test("never the word 'repairs' (or CES) anywhere the owner sees; no certificate number → 'Completed' alone", () => {
    expect(`${done.subject}\n${done.text}\n${done.html}`).not.toMatch(/repair|· CES /i); // the certificate number itself may read "CES-1234"
    const noCert = renderPiesaCopyEmail({ ...base, recipient: "owner", repairs: { completed: true, cesNumber: null } });
    expect(noCert.text).toContain("Electrical upgrades: Completed\n");
    expect(`${noCert.subject}\n${noCert.text}\n${noCert.html}`).not.toMatch(/repair/i);
  });
  test("the trade variant says electrical upgrades too (trade wording, CES kept), rest unchanged", () => {
    const trade = renderPiesaCopyEmail({ ...base, firstName: "Deep", recipient: "installer", repairs: { completed: true, cesNumber: "CES-1234" } });
    expect(trade.subject).toBe("Signed electrical safety check (PIESA) – HV-TEST");
    expect(trade.text).toContain("Electrical safety check for HV-TEST: electrical upgrades completed");
    expect(trade.text).toContain("Safe to insulate (after electrical upgrades)");
    expect(trade.text).toContain("Electrical upgrades needed: Completed · CES CES-1234");
    expect(trade.html).toContain("Electrical upgrades completed: safe to insulate. Tick Part 8(a) of your PIISA on install day.");
    expect(`${trade.subject}\n${trade.text}\n${trade.html}`).not.toMatch(/repair/i);
  });
  test("the all-clear owner variant is unchanged byte-for-byte (recorded at 200edbe)", async () => {
    const clear = renderPiesaCopyEmail({ ...base, recipient: "owner", repairs: null });
    const h = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(clear.subject).toBe("Signed electrical safety check (PIESA) – HV-TEST");
    expect(clear.text).toContain("Helen, your electrical safety check: all clear");
    expect(clear.text).toContain("Electrical upgrades needed: None");
    expect(await h(`${clear.subject}\n${clear.html}\n${clear.text}`)).toBe("084e45d86ab228f5541969be841fa31ea63d662cebcea2694c9652d7a827763a");
  });
});

// Fix wave J4 G3 (join ruling, 4 Nov 2026): never "all clear" on a result that found upgrades still to come.
describe("J4 G3: the copy's words follow the PIESA result; the installer's next line is stage-aware", () => {
  const base = { firstName: "Deep", address: "1 A St", jobNumber: "HV-1", signatureDate: "2026-11-02", link: "https://example.invalid/field/j", electrician: { name: "Viking Electrical" } } as const;
  test("installer copy, upgrades still to come (behind UPGRADES_NEEDED_EMAIL_APPROVED): says so, never 'all clear' or 'safe to insulate'", () => {
    const m = renderPiesaCopyEmail({ ...base, recipient: "installer", installStart: null, upgradesNeeded: true });
    expect(m.text).toContain("Electrical safety check for HV-1: electrical upgrades needed");
    expect(m.text).toContain("Electrical upgrades needed first");
    expect(m.text).toContain("Electrical upgrades needed: Yes — see the attached safety check");
    expect(m.text).toContain("Next: the electrician books the upgrades with the owner. Once the certificate is in, call the owner and book the install.");
    expect(`${m.subject}\n${m.text}\n${m.html}`).not.toMatch(/all clear|safe to insulate|repair|\$\s?\d/i);
    expect(m.html).toContain("#FFF7EA"); expect(m.html).not.toContain("✓"); expect(m.html).not.toContain("#057D40\">Electrical");
  });
  test("installer 'Next: call the owner and book the install' only while no install is booked (all-clear and upgrades-done alike)", () => {
    const unbooked = renderPiesaCopyEmail({ ...base, recipient: "installer", installStart: null, repairs: null });
    const booked = renderPiesaCopyEmail({ ...base, recipient: "installer", installStart: "2026-11-20T21:00:00.000Z", repairs: null });
    expect(unbooked.text).toContain("Next: call the owner and book the install in the portal.");
    expect(booked.text).not.toContain("Next:"); expect(booked.html).not.toContain("Next:");
    expect(renderPiesaCopyEmail({ ...base, recipient: "installer", installStart: "2026-11-20T21:00:00.000Z", upgradesNeeded: true }).text).not.toContain("Next:");
    expect(renderPiesaCopyEmail({ ...base, recipient: "installer", installStart: "2026-11-20T21:00:00.000Z", repairs: { completed: true, cesNumber: "C1" } }).text).not.toContain("Next:");
  });
  test("an owner copy ignores upgradesNeeded (the owner's copy on that result is the upgrades-needed email): the all-clear words are untouched", () => {
    const a = renderPiesaCopyEmail({ ...base, firstName: "Helen", recipient: "owner", installStart: null, link: "https://x/t" });
    const b = renderPiesaCopyEmail({ ...base, firstName: "Helen", recipient: "owner", installStart: null, link: "https://x/t", upgradesNeeded: true });
    expect(b).toEqual(a);
  });
  test("server: the owner's standalone copy never goes on an upgrades-still-to-come result (24h safety net included); both copies held with a reason while the wording is unapproved; pass after Part C = the item-44 words", () => {
    const src = readFileSync(new URL("../src/lib/piesa-delivery.server.ts", import.meta.url), "utf8");
    expect(src).toContain('const ownerStandalone = variant.kind === "upgrades_needed" ? false : await resolveOwnerStandalone(');
    expect(src).toContain('if (variant.kind === "upgrades_needed" && copyId && rec && !isClosedOrArchivedJob(job)) {');
    expect(src).toContain("if (!UPGRADES_NEEDED_EMAIL_APPROVED) {");
    expect(src).toContain('reason: "upgrades_needed_wording_unapproved"');
    expect(src).toContain('repairs: variant.kind === "upgrades_done" ? { completed: true, cesNumber: variant.cesNumber } : null, upgradesNeeded: variant.kind === "upgrades_needed"');
    expect(src).toContain('if (rec.outcome === "pass" && (rec.kind === "initial" || rec.kind === "reassessment")) return { kind: "all_clear" };');
  });
});
