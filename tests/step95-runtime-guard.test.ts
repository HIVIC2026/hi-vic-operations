// STEP 95 — runtime Supabase endpoint guard closure (isolated, offline).
// Closes the two STEP 91B gaps: src/lib/interest.functions.ts publishableClient() and
// src/lib/journey.server.ts personaClient(). Both must route their SUPABASE_URL through the
// EXISTING non-generated resolver (src/integrations/supabase/env-guard.ts) — no duplicated logic.
// No network: this file only imports the pure resolver and reads source text; the guard throws
// synchronously before any createClient call could exist.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveGuardedSupabaseEndpoint, detectRuntimeMode } from "../src/integrations/supabase/env-guard";

const LOCAL = "http://127.0.0.1:54321";
const PROD = "https://wvuffpykgnqliikhodzl.supabase.co";
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("STEP 95 — both remaining runtime clients invoke the existing guard", () => {
  // Check 1a — interest.functions.ts publishableClient: guard imported from the shared module and wrapped around the URL.
  it("interest.functions.ts routes its publishable client through resolveGuardedSupabaseEndpoint", () => {
    const s = src("../src/lib/interest.functions.ts");
    expect(s).toMatch(/import \{ resolveGuardedSupabaseEndpoint \} from ["']@\/integrations\/supabase\/env-guard["']/);
    expect(s).toMatch(/createClient<Database>\(resolveGuardedSupabaseEndpoint\(process\.env\["SUPABASE_URL"\]!\)/);
    // The old unguarded direct-URL construction must be gone.
    expect(s).not.toMatch(/createClient<Database>\(process\.env\["SUPABASE_URL"\]!/);
  });

  // Check 1b — journey.server.ts personaClient: same pattern.
  it("journey.server.ts routes personaClient through resolveGuardedSupabaseEndpoint", () => {
    const s = src("../src/lib/journey.server.ts");
    expect(s).toMatch(/import \{ resolveGuardedSupabaseEndpoint \} from ["']@\/integrations\/supabase\/env-guard["']/);
    expect(s).toMatch(/createClient\(resolveGuardedSupabaseEndpoint\(process\.env\["SUPABASE_URL"\]!\)/);
    expect(s).not.toMatch(/createClient\(process\.env\["SUPABASE_URL"\]!/);
  });

  // Check 1c — no duplicated guard logic: the two files contain no bespoke host checks; they call the one resolver.
  it("no guard logic is duplicated into the clients", () => {
    for (const p of ["../src/lib/interest.functions.ts", "../src/lib/journey.server.ts"]) {
      const s = src(p);
      expect(s).not.toMatch(/supabase\.co["'`]?\s*[,)]/); // no own prod-host regex/allowlist
      expect(s.match(/resolveGuardedSupabaseEndpoint\(/g)?.length).toBe(1); // exactly one guard call site each
    }
  });

  // Checks 2–5 — behavior of the SHARED resolver these clients now use (same guarantees as STEP 91A).
  it("local endpoints are accepted in every mode", () => {
    expect(resolveGuardedSupabaseEndpoint(LOCAL, { mode: "local" })).toBe(LOCAL);
    expect(resolveGuardedSupabaseEndpoint(LOCAL, { mode: "test" })).toBe(LOCAL);
    expect(resolveGuardedSupabaseEndpoint(LOCAL, { mode: "production" })).toBe(LOCAL);
  });
  it("production endpoints are rejected in local and test mode (opt-in cannot override)", () => {
    expect(() => resolveGuardedSupabaseEndpoint(PROD, { mode: "local", env: {} })).toThrowError(/Refusing a production Supabase host/);
    expect(() => resolveGuardedSupabaseEndpoint(PROD, { mode: "test", env: { ALLOW_PROD_SUPABASE: "1" } })).toThrowError(/cannot be overridden/);
  });
  it("missing local configuration fails closed", () => {
    expect(() => resolveGuardedSupabaseEndpoint(undefined, { mode: "local" })).toThrowError(/Missing Supabase endpoint/);
    expect(() => resolveGuardedSupabaseEndpoint("", { mode: "test" })).toThrowError(/Missing Supabase endpoint/);
  });
  it("explicit production configuration remains supported (intentional mode + opt-in only)", () => {
    expect(resolveGuardedSupabaseEndpoint(PROD, { mode: "production", env: { ALLOW_PROD_SUPABASE: "1" } })).toBe(PROD);
    expect(() => resolveGuardedSupabaseEndpoint(PROD, { mode: "production", env: {} })).toThrowError(/INTENTIONAL opt-in/);
  });

  // Check 5b — in the real process env (bun test sets NODE_ENV=test), the no-opts call path used by both
  // clients also refuses PROD and keeps LOCAL working: default detection is live, not just injected opts.
  it("default mode detection guards the exact no-opts call the clients make", () => {
    expect(["test", "local"]).toContain(detectRuntimeMode()); // never 'production' under the isolated runner
    expect(() => resolveGuardedSupabaseEndpoint(PROD)).toThrowError(/Refusing a production Supabase host/);
    expect(resolveGuardedSupabaseEndpoint(LOCAL)).toBe(LOCAL);
  });

  // Check 7 — no production network possible via the guard layer: the resolver is pure (no fetch/http),
  // and it throws BEFORE any createClient exists. Structural proof of purity:
  it("env-guard performs no network access", () => {
    const s = src("../src/integrations/supabase/env-guard.ts");
    expect(s).not.toMatch(/\bfetch\s*\(/);
    expect(s).not.toMatch(/supabase-js|node:http|node:https|XMLHttpRequest/);
  });
});
