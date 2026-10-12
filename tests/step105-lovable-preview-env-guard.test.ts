// STEP 105 — Lovable Preview must be classified as its own runtime mode, not as 'local'.
// Scope: environment CLASSIFICATION only. No database, no network, no secrets.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  LOVABLE_PREVIEW_AUTHORISATION,
  currentHostname,
  detectRuntimeMode,
  isAuthorisedLovablePreviewHost,
  isAuthorisedPreviewSupabaseEndpoint,
  lovablePreviewProjectId,
  resolveGuardedSupabaseEndpoint,
} from "../src/integrations/supabase/env-guard";

const PROD = "https://wvuffpykgnqliikhodzl.supabase.co";
const PROD_URL = new URL(PROD);
const OTHER_PROD = "https://someotherproject.supabase.co";
const LOCAL = "http://127.0.0.1:54321";
const PREVIEW_HOST = "id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app";

describe("STEP 105 — Lovable Preview is no longer classified as local", () => {
  it("T1: this project's preview hostname resolves to the configured preview surface", () => {
    expect(LOVABLE_PREVIEW_AUTHORISATION.previewHost).toBe(PREVIEW_HOST);
    expect(LOVABLE_PREVIEW_AUTHORISATION.supabaseProjectHost).toBe(PROD_URL.hostname);
    expect(lovablePreviewProjectId(PREVIEW_HOST)).toBe(LOVABLE_PREVIEW_AUTHORISATION.projectId);
    expect(isAuthorisedLovablePreviewHost(PREVIEW_HOST)).toBe(true);
  });

  it("T2: on the preview host the mode is 'lovable-preview' and its own endpoint is accepted", () => {
    expect(detectRuntimeMode({ NODE_ENV: "development" }, PREVIEW_HOST)).toBe("lovable-preview");
    expect(
      resolveGuardedSupabaseEndpoint(PROD, { hostname: PREVIEW_HOST, env: { NODE_ENV: "development" } }),
    ).toBe(PROD);
  });

  it("T3: the preview still refuses every OTHER supabase project", () => {
    expect(() =>
      resolveGuardedSupabaseEndpoint(OTHER_PROD, { hostname: PREVIEW_HOST, env: { NODE_ENV: "development" } }),
    ).toThrowError(/un-authorised Supabase endpoint in Lovable Preview/);
    expect(isAuthorisedPreviewSupabaseEndpoint(OTHER_PROD)).toBe(false);
  });

  it("T4: not every browser environment bypasses the guard", () => {
    // A plain site, another project's Lovable preview, and a non-preview lovable.app host
    // must all keep failing closed.
    for (const host of [
      "https://example.com",
      "id-preview--00000000-0000-4000-8000-000000000000.lovable.app",
      "hi-vic-operations.lovable.app",
      "localhost",
      "127.0.0.1",
    ]) {
      const hostname = host.replace(/^https?:\/\//, "");
      expect(isAuthorisedLovablePreviewHost(hostname)).toBe(false);
      expect(() => resolveGuardedSupabaseEndpoint(PROD, { hostname, env: { NODE_ENV: "development" } }))
        .toThrowError(/Refusing a production Supabase host/);
    }
  });

  it("T5: local development protection is unchanged", () => {
    expect(detectRuntimeMode({ NODE_ENV: "development" }, "localhost")).toBe("local");
    expect(() => resolveGuardedSupabaseEndpoint(PROD, { hostname: "localhost", env: { ALLOW_PROD_SUPABASE: "1" } }))
      .toThrowError(/cannot be overridden by ALLOW_PROD_SUPABASE/);
    expect(resolveGuardedSupabaseEndpoint(LOCAL, { hostname: "localhost" })).toBe(LOCAL);
  });

  it("T6: automated tests are still refused (opt-in cannot override)", () => {
    expect(detectRuntimeMode({ NODE_ENV: "test" }, PREVIEW_HOST)).toBe("test");
    expect(() => resolveGuardedSupabaseEndpoint(PROD, { mode: "test", env: { ALLOW_PROD_SUPABASE: "1" } }))
      .toThrowError(/cannot be overridden/);
  });

  it("T7: explicit production deployment is unchanged (mode + opt-in)", () => {
    expect(detectRuntimeMode({ NODE_ENV: "production" }, "estimate.homeinsulationvictoria.com.au")).toBe("production");
    expect(resolveGuardedSupabaseEndpoint(PROD, { mode: "production", env: { ALLOW_PROD_SUPABASE: "1" } })).toBe(PROD);
    expect(() => resolveGuardedSupabaseEndpoint(PROD, { mode: "production", env: {} })).toThrowError(/INTENTIONAL opt-in/);
  });

  it("T8: classification uses no environment variable and no request header", () => {
    const src = readFileSync(new URL("../src/integrations/supabase/env-guard.ts", import.meta.url), "utf8");
    // No unverified platform variable is consulted to decide "this is the Preview".
    for (const bad of ["LOVABLE_API_KEY", "CF-", "x-forwarded", "headers.get", "getRequest", "ORIGIN"]) {
      expect(src).not.toContain(bad);
    }
    // The identifiers actually relied on are constants already present in this repository.
    expect(PREVIEW_HOST).toBe("id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app");
    const testSend = readFileSync(new URL("../src/lib/test-send.server.ts", import.meta.url), "utf8");
    expect(testSend).toContain(PREVIEW_HOST);
  });

  it("T9: every Supabase client entry point still routes through the shared guard", () => {
    const base = new URL("../src/integrations/supabase/", import.meta.url).pathname;
    for (const f of ["client.ts", "client.server.ts", "auth-middleware.ts"]) {
      const s = readFileSync(base + f, "utf8");
      expect(s).toMatch(/resolveGuardedSupabaseEndpoint\s*\(/);
      expect(s).toMatch(/from '\.\/env-guard'/);
    }
  });

  it("T10: server/test runtimes report no hostname, so nothing is inferred for them", () => {
    expect(currentHostname()).toBeNull();
  });
});
