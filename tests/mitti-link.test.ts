import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { mittiFormUrl } from "../src/lib/mitti-link.core";

// Jo 24 Oct: the "Mitti form" buttons opened Mitti's home page. One documented link format for every button and text.
test("HV-3066's form link uses Mitti's documented format", () =>
  expect(mittiFormUrl("audit_fb1677986bcd4e01af9823222f9516b3")).toBe("https://app.au.safetyculture.com/inspection/audit_fb1677986bcd4e01af9823222f9516b3"));

test("no screen or message builds its own Mitti form link any more", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const offenders = walk("src").filter((p) => /\.(ts|tsx)$/.test(p) && !p.endsWith("mitti-link.core.ts") && /mitti\.com\/inspections\//.test(readFileSync(p, "utf8")));
  expect(offenders).toEqual([]);
});

import { deepLinkFromResponse } from "../src/lib/mitti-link.core";
test("Mitti's deep link is read whatever field it comes back in; nothing else is trusted", () => {
  // Mitti's real answer for HV-3066 (24 Oct): the app-opening short link wins over the web address.
  expect(deepLinkFromResponse({ url: "https://sfty.io/LZRNJlXWt7b", web_url: "https://app.au.safetyculture.com/inspection/audit_fb1677986bcd4e01af9823222f9516b3?oswid=role_x" })).toBe("https://sfty.io/LZRNJlXWt7b");
  expect(deepLinkFromResponse({ deep_link: "https://link.mitti.com/abc" })).toBe("https://link.mitti.com/abc");
  expect(deepLinkFromResponse({ url: "https://x.mitti.com/i/1" })).toBe("https://x.mitti.com/i/1");
  expect(deepLinkFromResponse({ data: { link: "https://x.mitti.com/i/2" } })).toBe("https://x.mitti.com/i/2");
  expect(deepLinkFromResponse({ url: "javascript:alert(1)" })).toBeNull();
  expect(deepLinkFromResponse(null)).toBeNull();
});
test("every portal 'Mitti form' button asks for the deep link (checked against job access) instead of a fixed address", () => {
  for (const f of ["src/components/trade/MittiMissingInfo.tsx", "src/components/portal/NewFromInstallers.tsx", "src/components/portal/mitti.tsx", "src/routes/_authenticated/field.$jobId.tsx", "src/routes/_authenticated/field.day.$jobId.tsx"])
    expect(readFileSync(f, "utf8")).toContain("<MittiFormLink auditId=");
  const fn = readFileSync("src/lib/mitti-link.functions.ts", "utf8");
  expect(fn).toContain('rpc("can_access_job"');
  expect(fn).toContain(".deepLink(data.auditId)");
});
