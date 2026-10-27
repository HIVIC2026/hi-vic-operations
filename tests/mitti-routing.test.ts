import { expect, test } from "bun:test";
import { mittiRoute } from "../src/lib/mitti-routing.core";
import { qaContextActive, withQaContext } from "../src/lib/qa-context.server";
test("qa_test job always simulates for page, tick and webhook with or without request context", () => {
  expect(mittiRoute("qa_test", false, true)).toBe("simulated");
  expect(mittiRoute("qa_test", true, true)).toBe("simulated");
});
test("real job always uses unchanged real transport", () => {
  expect(mittiRoute("base44", false, true)).toBe("real");
  expect(mittiRoute("installer_portal", true, true)).toBe("real");
});
test("unattributed call only reaches real Mitti outside active qa_test context", () => {
  expect(mittiRoute(undefined, false, false)).toBe("real");
  expect(() => mittiRoute(undefined, true, false)).toThrow("SAFETY STOP");
});
test("parallel requests cannot leak TEST scope into a real request", async () => {
  const results = await Promise.all([withQaContext(true, async () => { await Promise.resolve(); return qaContextActive(); }), withQaContext(false, async () => { await Promise.resolve(); return qaContextActive(); })]);
  expect(results).toEqual([true, false]);
  expect(qaContextActive()).toBe(false);
});