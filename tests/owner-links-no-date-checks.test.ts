// Jo 1 Nov 2026: owner links have no time limit. These senders read customer_estimate_links and must use the shared
// linkUsable() rule, never their own expires_at date test (final review findings 1–2: reminder SMS skipped owners as
// "Secure link expired", and the Spot saved confirmation failed for links with an old date).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const files = ["src/lib/save-spot-reminder-blast.server.ts", "src/lib/email-preliminary-offer.server.ts", "src/lib/spot-saved-send.server.ts"];
describe("owner-link senders use the shared rule", () => {
  test.each(files)("%s has no expires_at date test", (f) => {
    const src = readFileSync(f, "utf8");
    expect(src).not.toMatch(/(Date\.parse|new Date)\([^)]*expires_at[^)]*\)/);
    expect(src).not.toContain("Secure link expired");
  });
});
