// STEP 106 — the ACTUAL Lovable Preview host (`<project-id>.lovableproject.com`) must be
// recognised, and every hosted SERVER path (no `window`) must resolve the same mode as the
// browser, so the Office Pipeline and Ready Check server functions stop refusing the cloud
// endpoint. Scope: environment CLASSIFICATION only. No database, no network, no secrets.
import { describe, expect, it, afterEach } from "bun:test";
import {
  LOVABLE_PREVIEW_AUTHORISATION,
  detectRuntimeMode,
  activeHost,
  isAuthorisedLovablePreviewHost,
  isAuthorisedPreviewSupabaseEndpoint,
  lovablePreviewProjectId,
  resolveGuardedSupabaseEndpoint,
  setRequestHost,
} from "../src/integrations/supabase/env-guard";

const PROD = "https://wvuffpykgnqliikhodzl.supabase.co";
const OTHER_PROD = "https://someotherproject.supabase.co";
const LOCAL = "http://127.0.0.1:54321";

// The host the running Preview actually executes at (STEP 106 confirmed evidence).
const ACTUAL_PREVIEW = "fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovableproject.com";
// The previously recognised preview surface (must keep working).
const PREFIXED_PREVIEW = "id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app";
// A different Lovable tenant must never be trusted.
const OTHER_TENANT_ACTUAL = "00000000-0000-4000-8000-000000000000.lovableproject.com";
const OTHER_TENANT_PREFIXED = "id-preview--00000000-0000-4000-8000-000000000000.lovable.app";

afterEach(() => setRequestHost(null));

describe("STEP 106 — actual lovableproject.com Preview host is recognised", () => {
  it("T1: the actual runtime hostname resolves to this project's identity", () => {
    expect(lovablePreviewProjectId(ACTUAL_PREVIEW)).toBe(LOVABLE_PREVIEW_AUTHORISATION.projectId);
    expect(isAuthorisedLovablePreviewHost(ACTUAL_PREVIEW)).toBe(true);
    expect(LOVABLE_PREVIEW_AUTHORISATION.actualPreviewHosts).toContain(ACTUAL_PREVIEW);
  });

  it("T2: the previously recognised id-preview-- host still works", () => {
    expect(isAuthorisedLovablePreviewHost(PREFIXED_PREVIEW)).toBe(true);
    expect(lovablePreviewProjectId(PREFIXED_PREVIEW)).toBe(LOVABLE_PREVIEW_AUTHORISATION.projectId);
  });

  it("T3: on the actual host the mode is lovable-preview and its endpoint is accepted", () => {
    expect(detectRuntimeMode({ NODE_ENV: "development" }, ACTUAL_PREVIEW)).toBe("lovable-preview");
    expect(
      resolveGuardedSupabaseEndpoint(PROD, { hostname: ACTUAL_PREVIEW, env: { NODE_ENV: "development" } }),
    ).toBe(PROD);
  });

  it("T4: it still refuses every OTHER supabase project", () => {
    expect(() =>
      resolveGuardedSupabaseEndpoint(OTHER_PROD, { hostname: ACTUAL_PREVIEW, env: { NODE_ENV: "development" } }),
    ).toThrowError(/un-authorised Supabase endpoint in Lovable Preview/);
    expect(isAuthorisedPreviewSupabaseEndpoint(OTHER_PROD)).toBe(false);
  });

  it("T5: another Lovable tenant's host is never trusted (either host form)", () => {
    for (const host of [OTHER_TENANT_ACTUAL, OTHER_TENANT_PREFIXED, "example.com", "hi-vic-operations.lovable.app"]) {
      expect(isAuthorisedLovablePreviewHost(host)).toBe(false);
      expect(() => resolveGuardedSupabaseEndpoint(PROD, { hostname: host, env: { NODE_ENV: "development" } }))
        .toThrowError(/Refusing a production Supabase host/);
    }
  });
});

describe("STEP 106 — hosted SERVER paths resolve the same mode (no window)", () => {
  it("T6: a server function on the actual Preview host accepts the cloud endpoint", () => {
    setRequestHost(ACTUAL_PREVIEW);
    expect(activeHost()).toBe(ACTUAL_PREVIEW);
    expect(detectRuntimeMode({ NODE_ENV: "development" })).toBe("lovable-preview");
    // This is the Office Pipeline / Ready Check path: no window, resolved from the request host.
    expect(resolveGuardedSupabaseEndpoint(PROD, { env: { NODE_ENV: "development" } })).toBe(PROD);
  });

  it("T7: a server function on the prefixed Preview host also works", () => {
    setRequestHost(PREFIXED_PREVIEW);
    expect(resolveGuardedSupabaseEndpoint(PROD, { env: { NODE_ENV: "development" } })).toBe(PROD);
  });

  it("T8: a server function still refuses another project", () => {
    setRequestHost(ACTUAL_PREVIEW);
    expect(() => resolveGuardedSupabaseEndpoint(OTHER_PROD, { env: { NODE_ENV: "development" } }))
      .toThrowError(/un-authorised Supabase endpoint in Lovable Preview/);
  });

  it("T9: with no request context the server still fails closed to local", () => {
    setRequestHost(null);
    expect(detectRuntimeMode({ NODE_ENV: "development" })).toBe("local");
    expect(() => resolveGuardedSupabaseEndpoint(PROD, { env: { NODE_ENV: "development" } }))
      .toThrowError(/Refusing a production Supabase host/);
  });
});

describe("STEP 106 — production, localhost and automated-test protection unchanged", () => {
  it("T10: production hostname with an intentional opt-in is allowed", () => {
    const pub = "hi-vic-operations.lovable.app";
    expect(detectRuntimeMode({ DEPLOY_ENV: "production" }, pub)).toBe("production");
    expect(
      resolveGuardedSupabaseEndpoint(PROD, { hostname: pub, env: { DEPLOY_ENV: "production", ALLOW_PROD_SUPABASE: "1" } }),
    ).toBe(PROD);
  });

  it("T11: production without the opt-in stays refused (never inferred)", () => {
    expect(() =>
      resolveGuardedSupabaseEndpoint(PROD, { hostname: "hi-vic-operations.lovable.app", env: { DEPLOY_ENV: "production" } }),
    ).toThrowError(/requires an INTENTIONAL opt-in/);
  });

  it("T12: localhost cannot reach production and local endpoints still work", () => {
    expect(detectRuntimeMode({ NODE_ENV: "development" }, "localhost")).toBe("local");
    expect(() => resolveGuardedSupabaseEndpoint(PROD, { hostname: "localhost", env: { NODE_ENV: "development" } }))
      .toThrowError(/Refusing a production Supabase host/);
    expect(resolveGuardedSupabaseEndpoint(LOCAL, { hostname: "localhost", env: { NODE_ENV: "development" } })).toBe(LOCAL);
  });

  it("T13: automated tests can NEVER reach production, even with the opt-in flag", () => {
    for (const env of [{ VITEST: "1" }, { NODE_ENV: "test" }, { VITEST: "1", ALLOW_PROD_SUPABASE: "1" }]) {
      expect(detectRuntimeMode(env, ACTUAL_PREVIEW)).toBe("test");
      expect(() => resolveGuardedSupabaseEndpoint(PROD, { hostname: ACTUAL_PREVIEW, env }))
        .toThrowError(/Refusing a production Supabase host/);
    }
  });

  it("T14: ALLOW_PROD_SUPABASE alone cannot promote a Preview host to production", () => {
    expect(detectRuntimeMode({ ALLOW_PROD_SUPABASE: "1", NODE_ENV: "development" }, ACTUAL_PREVIEW)).toBe("lovable-preview");
  });
});
