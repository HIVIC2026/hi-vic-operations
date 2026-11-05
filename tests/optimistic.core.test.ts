// Portal speed step 2, Task 7: which buttons finish once their own save is done (screen refresh in the background) and
// which wait for the save and the fresh screen. Audited lists, pinned against the code.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { OPTIMISTIC_ALLOWED, WAITS_FOR_SAVE, isOptimistic } from "../src/lib/optimistic.core";

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(`${dir}/${d.name}`) : /\.(ts|tsx)$/.test(d.name) ? [`${dir}/${d.name}`] : []));
const files = walk("src");
const source = files.map((f) => readFileSync(f, "utf8")).join("\n");
const exported = (name: string) => new RegExp(`export const ${name} = createServerFn`).test(source);

describe("optimistic.core", () => {
  test("a note is instant; Send / Give / Pay / Book / Cancel never are; unknown names wait", () => {
    expect(isOptimistic("logOfficeCallOrNote")).toBe(true);
    expect(isOptimistic("sendRectificationQuote")).toBe(false);
    expect(isOptimistic("createBooking")).toBe(false);
    expect(isOptimistic("cancelOfficeJob")).toBe(false);
    expect(isOptimistic("saveTradeSwmsNote")).toBe(false); // changes the safety plan: earlier signatures stop counting
    expect(isOptimistic("somethingNew")).toBe(false);
    expect(isOptimistic(undefined)).toBe(false);
  });
  test("the two lists are disjoint", () => {
    expect(OPTIMISTIC_ALLOWED.filter((n) => (WAITS_FOR_SAVE as readonly string[]).includes(n))).toEqual([]);
  });
  test("every listed name is a real server function", () => {
    expect([...OPTIMISTIC_ALLOWED, ...WAITS_FOR_SAVE].filter((n) => !exported(n))).toEqual([]);
  });
  test("every useAction that names itself instant names its own server function, from the allowed list", () => {
    const named = [...source.matchAll(/useAction\(\s*([A-Za-z0-9_]+)\s*,\s*\{[^}]*name:\s*"([A-Za-z0-9_]+)"/g)].map((m) => [m[1], m[2]] as const);
    expect(named.length).toBe(OPTIMISTIC_ALLOWED.length);
    for (const [fn, name] of named) { expect(name).toBe(fn); expect(isOptimistic(name)).toBe(true); }
  });
});
