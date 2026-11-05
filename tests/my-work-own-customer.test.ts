import { expect, test } from "bun:test";
import { myWorkCards, type MyWorkRow } from "../src/lib/my-work.core";
import type { NextStepBox } from "../src/lib/next-step-box.core";

const row = (kind: NextStepBox["kind"], extra: Partial<MyWorkRow> = {}): MyWorkRow => ({
  jobId: "test-own", jobNumber: "HV-TEST", owner: "TEST Owner", street: null, suburb: null,
  channel: "installer_sourced", reason: "",
  box: { kind, title: kind === "waiting_quote" ? "Quote being prepared — Home Insulation Victoria will send it to the owner" : "Ready Check", sub: null, yours: true, bookBy: "2026-11-06", overdue: true, phone: null, button: "Book", lines: [], alsoBookInstall: null, pickPerson: null },
  ...extra,
});

test.each([false, true])("own incomplete form linked=%p has action but never booking deadline", (mittiLinked) => {
  const result = myWorkCards([row("own_ready_check", { mittiLinked })]);
  expect(result.yourTurn.map(c => c.jobId)).toEqual(["test-own"]);
  expect(result.all[0]?.by).toBeNull();
  expect(result.all[0]?.overdue).toBe(false);
  expect(result.all[0]?.button).toBeTruthy();
});
test("completed form without price remains an action without booking deadline", () => {
  const result = myWorkCards([row("enter_price")]);
  expect(result.yourTurn).toHaveLength(1);
  expect(result.all[0]?.by).toBeNull();
  expect(result.all[0]?.overdue).toBe(false);
});
test("submitted price waits in All without action or deadline", () => {
  const result = myWorkCards([row("waiting_quote")]);
  expect(result.yourTurn).toHaveLength(0);
  expect(result.all).toHaveLength(1);
  expect(result.all[0]?.button).toBeNull();
  expect(result.all[0]?.by).toBeNull();
});
test("sent quote is viewable in All, not Your turn", () => {
  const result = myWorkCards([row("waiting_quote", { quoteSentAt: "2026-11-06T01:00:00Z" })]);
  expect(result.yourTurn).toHaveLength(0);
  expect(result.all[0]?.button).toBeTruthy();
  expect(result.all[0]?.by).toBeNull();
});
test("lead Ready Check and own later booking retain original actions/deadlines", () => {
  for (const r of [row("book_ready_check", { channel: "hivic_sourced" }), row("book_piesa")]) {
    const c = myWorkCards([r]).all[0];
    expect(c?.by).toBe("2026-11-06");
    expect(c?.overdue).toBe(true);
    expect(c?.yours).toBe(true);
    expect(c?.button).toBe(r.box.button);
  }
});