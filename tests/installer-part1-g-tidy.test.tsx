import { mock, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
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

test("G5: removed leftovers are gone, access results unchanged", async () => {
  const g = readFileSync("src/lib/route-guards.ts", "utf8");
  expect(g).not.toContain("ids.map(() => null)");
  expect(g).not.toContain("INSTALLER_BULK_UPLOAD_ENABLED");
  expect(g).not.toContain("legacyBulkImportRedirect");
  expect(readFileSync("src/components/trade/business-pages.tsx", "utf8")).toContain("export const field = inputCls;");
  expect(readFileSync("src/components/trade/installer-kit.tsx", "utf8")).not.toContain("export function BackToWork");
  expect(readFileSync("src/components/trade/TradeShell.tsx", "utf8")).not.toContain("export function TradeTabBar");
  const users = readFileSync("src/routes/_authenticated/admin.users.tsx", "utf8");
  expect(users).toContain("saveFile(");
  expect(users).not.toContain("URL.createObjectURL");
  expect(readFileSync("src/components/trade/save-file.ts", "utf8")).toContain("opts?: { title?: string }");
});

test("G5: bulk upload server leftovers are gone; Add a job's electrician choices stay", () => {
  for (const f of ["src/lib/bulk-import.server.ts", "src/lib/bulk-import-commit.server.ts", "src/lib/bulk-import-access.server.ts", "src/lib/bulk-upload-switch.core.ts"]) expect(existsSync(f)).toBe(false);
  const fns = readFileSync("src/lib/bulk-import.functions.ts", "utf8");
  expect(fns).not.toContain("requireBulkUploadOpen");
  for (const keep of ["bulkElectricianChoices", "addBulkElectrician", "readBulkFile"]) expect(fns).toContain(`export const ${keep}`);
  expect(execSync("grep -rln 'bulk-upload-switch\\|bulk-import-commit\\|bulk-import-access\\|bulk-import.server' src || true", { encoding: "utf8" }).trim()).toBe("");
});
