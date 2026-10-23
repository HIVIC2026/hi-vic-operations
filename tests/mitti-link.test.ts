import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { mittiFormUrl } from "../src/lib/mitti-link.core";

// Jo 24 Oct: the "Mitti form" buttons opened Mitti's home page. One documented link format for every button and text.
test("HV-3066's form link uses Mitti's documented format", () =>
  expect(mittiFormUrl("audit_fb1677986bcd4e01af9823222f9516b3")).toBe("https://app.mitti.com/inspection/audit_fb1677986bcd4e01af9823222f9516b3"));

test("no screen or message builds its own Mitti form link any more", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const offenders = walk("src").filter((p) => /\.(ts|tsx)$/.test(p) && !p.endsWith("mitti-link.core.ts") && /mitti\.com\/inspections\//.test(readFileSync(p, "utf8")));
  expect(offenders).toEqual([]);
});
