// Jo, 27 Oct 2026: "check all the buttons work". Every email on the Templates page is rendered with its TEST sample
// data; every button and link must be a real, well-formed link to a page that exists in src/routes (with a search
// value that page accepts). Pure: nothing is sent.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { TEMPLATE_ENTRIES } from "../src/lib/template-hub.core";

const ROUTES_DIR = new URL("../src/routes/", import.meta.url).pathname;
const OWN_HOSTS = ["estimate.homeinsulationvictoria.com.au", "portal.homeinsulationvictoria.com.au"];

/** src/routes file names → path regexes (TanStack file routing: `.` = `/`, `$x` = segment, `_` suffix/prefix = layout only). */
function routePatterns(): { re: RegExp; file: string }[] {
  const out: { re: RegExp; file: string }[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(tsx?|ts)$/.test(f.name) && !f.name.startsWith("__")) out.push({ re: toRe(relative(ROUTES_DIR, p)), file: relative(ROUTES_DIR, p) });
    }
  };
  walk(ROUTES_DIR);
  return out;
}
function toRe(file: string): RegExp {
  const segs = file.replace(/\.(tsx?|ts)$/, "").split(/[/.]/)
    .filter((s) => s && s !== "route" && s !== "index" && !/^_[a-z]+$/.test(s))
    .map((s) => s.replace(/_$/, ""))
    .map((s) => (s === "$" ? ".+" : s.startsWith("$") ? "[^/]+" : s.replace(/[-]/g, "\\-")));
  return new RegExp(`^/${segs.join("/")}/?$`);
}
const ROUTES = routePatterns();
/** Search values each page accepts (kept in step with the pages' validateSearch). */
const MY_JOB_SCREENS = (() => {
  const src = readFileSync(join(ROUTES_DIR, "my-job.$token.tsx"), "utf8");
  return JSON.parse(`[${/const SCREENS = \[([^\]]+)\]/.exec(src)![1]}]`) as string[];
})();

type Link = { href: string; label: string; button: boolean };
function links(html: string): Link[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, inner]) => ({
    href: (/\bhref="([^"]*)"/.exec(attrs)?.[1] ?? "").replace(/&amp;/g, "&"),
    label: inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    button: /display:inline-block;background:/.test(attrs),
  }));
}

const emails = TEMPLATE_ENTRIES.flatMap((e) => {
  const p = e.render();
  return p.kind === "email" ? [{ id: e.id, html: p.html }] : [];
});

describe("every email button goes somewhere real", () => {
  test("there are emails to check", () => expect(emails.length).toBeGreaterThan(60));
  for (const m of emails) {
    test(m.id, () => {
      const ls = links(m.html);
      for (const l of ls) {
        expect(l.href, `${m.id}: "${l.label}" has no link`).not.toBe("");
        expect(l.href, `${m.id}: "${l.label}"`).not.toMatch(/undefined|null|\$\{|^#$|^javascript:/i);
        expect(l.label, `${m.id}: a link with no words`).not.toBe("");
        if (/^mailto:/.test(l.href)) { expect(l.href).toMatch(/^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/i); continue; }
        expect(l.href, `${m.id}: "${l.label}" must be https`).toMatch(/^https:\/\//);
        const u = new URL(l.href);
        if (!OWN_HOSTS.includes(u.hostname)) continue; // outside pages (website, Google, ESC) are checked by hand
        const route = ROUTES.find((r) => r.re.test(u.pathname));
        expect(route, `${m.id}: "${l.label}" → ${u.pathname} is not a page`).toBeDefined();
        if (route?.file === "my-job.$token.tsx" && u.searchParams.has("screen")) {
          expect(MY_JOB_SCREENS, `${m.id}: "${l.label}" opens screen=${u.searchParams.get("screen")}, which My job rejects`).toContain(u.searchParams.get("screen")!);
        }
      }
      // Every button has a link.
      expect(m.html.match(/<a\b[^>]*display:inline-block;background:/g)?.length ?? 0).toBe(ls.filter((l) => l.button).length);
    });
  }
});
