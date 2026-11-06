// Speed (sign-in → home): no extra "who are you" trip, and the first screen's code downloads while its data loads.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = readFileSync("src/routes/portal.tsx", "utf8");

describe("sign-in to the first screen", () => {
  test("who is signed in comes from the saved session (currentUser), not a fresh auth-server trip", () => {
    expect(src).not.toContain("supabase.auth.getUser()");
    expect(src).toContain("await currentUser()");
  });
  test("the trade home's code starts downloading alongside the first-screen call", () => {
    expect(src).toContain("loadRouteChunk");
    for (const id of ['"/_authenticated"', '"/_authenticated/field"', '"/_authenticated/field/"']) expect(src).toContain(id);
  });
});
