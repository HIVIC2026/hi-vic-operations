// Installer redesign menu rules (plan Task 2).
import { describe, expect, test } from "bun:test";
import { tradeMenu } from "../src/lib/trade-menu.core";

const base = { path: "/field", installer: true, admin: true, money: true, actionCount: 4 };
const keys = (r: ReturnType<typeof tradeMenu>) => r.items.map((i) => i.key);

describe("tradeMenu", () => {
  test("admin sees all five when released", () => {
    const r = tradeMenu({ ...base, released: { calendar: true, jobs: true } });
    expect(keys(r)).toEqual(["action", "calendar", "jobs", "money", "business"]);
    expect(r.items[0]).toMatchObject({ label: "Action items", to: "/field", count: 4, on: true });
    expect(r.items.map((i) => i.to)).toEqual(["/field", "/field/calendar", "/field/jobs", "/field/money", "/field/business"]);
    expect(r.addJob).toBe(true);
  });
  test("phase 1 hides unreleased", () => {
    expect(keys(tradeMenu(base))).toEqual(["action", "money", "business"]);
  });
  test("office without money", () => {
    const r = tradeMenu({ ...base, admin: false, money: false });
    expect(keys(r)).toEqual(["action"]);
    expect(r.addJob).toBe(false);
    expect(keys(tradeMenu({ ...base, admin: false, money: false, released: { calendar: true, jobs: true } }))).toEqual(["action", "calendar", "jobs"]);
  });
  test("add a job needs an installer admin", () => {
    expect(tradeMenu({ ...base, installer: false }).addJob).toBe(false);
  });
  test("active item", () => {
    const on = (path: string) => tradeMenu({ ...base, path, released: { calendar: true, jobs: true } }).items.filter((i) => i.on).map((i) => i.key);
    expect(on("/field/3f2c1a4e-0b7d-4c1e-9f00-1234567890ab")).toEqual(["action"]);
    expect(on("/field/offer/abc")).toEqual(["action"]);
    expect(on("/field/business/team")).toEqual(["business"]);
    expect(on("/field/calendar")).toEqual(["calendar"]);
    expect(on("/field/jobs")).toEqual(["jobs"]);
    expect(on("/field/money")).toEqual(["money"]);
  });
  test("count zero shows no badge", () => {
    expect(tradeMenu({ ...base, actionCount: 0 }).items[0]!.count).toBeNull();
    expect(tradeMenu(base).items.slice(1).every((i) => i.count === null)).toBe(true);
  });
});
