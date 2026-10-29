import { mock, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";

mock.module("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => <a href={to} className={className}>{children}</a>,
}));

test("G5: one NextPanel; business look renders exactly the old classes; job look unchanged", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { NextPanel } = await import("../src/components/trade/installer-kit");
  const biz = renderToStaticMarkup(<NextPanel look="business" title="T" sub="S" />);
  expect(biz).toContain('class="rounded-[18px] bg-estimate-panel p-4"');
  expect(biz).toContain("data-next");
  expect(biz).not.toContain("data-next-panel");
  expect(biz).not.toContain("aria-label");
  expect(biz).toContain('<p class="text-[11px] font-bold uppercase tracking-[1.3px] text-estimate-blue">Next</p>');
  expect(biz).toContain('<p class="mt-1.5 text-[17px] font-semibold leading-[1.3] text-estimate-navy">T</p>');
  expect(biz).toContain('<p class="mt-1 text-sm text-estimate-sub">S</p>');
  const job = renderToStaticMarkup(<NextPanel title="T" sub="S" />);
  expect(job).toContain('class="rounded-[18px] bg-mist p-4"');
  expect(job).toContain('aria-label="Next"');
  expect(job).toContain("data-next-panel");
  expect(job).toContain('<p class="text-[11px] font-bold uppercase tracking-[1.3px] text-hiv-blue">Next</p>');
  expect(job).toContain('<h2 class="mt-1.5 text-[17px] font-semibold leading-[1.3]">T</h2>');
  expect(job).toContain('<p class="mt-1 text-sm leading-[1.45] text-sub">S</p>');
  const kit = readFileSync("src/components/trade/business-kit.tsx", "utf8");
  expect(kit).not.toContain("function NextPanel");
  // grep found no M7.secondary / M7.field user in src, so both styles are gone.
  expect(kit).not.toMatch(/\bsecondary:|\bfield:/);
  expect(readFileSync("src/routes/_authenticated/field.business.tsx", "utf8")).toContain('<NextPanel look="business"');
});
