import { describe, it, expect } from 'vitest';
import {
  resolveGuardedSupabaseEndpoint,
  detectRuntimeMode,
  isProductionSupabaseHost,
  isLocalSupabaseHost,
} from '../src/integrations/supabase/env-guard';

const LOCAL = 'http://127.0.0.1:54321';
const PROD = 'https://wvuffpykgnqliikhodzl.supabase.co';

describe('STEP 91A — active Supabase endpoint guard', () => {
  // T1 — Local endpoint accepted (in every mode)
  it('T1: local endpoint accepted in local/test/production', () => {
    expect(resolveGuardedSupabaseEndpoint(LOCAL, { mode: 'local' })).toBe(LOCAL);
    expect(resolveGuardedSupabaseEndpoint(LOCAL, { mode: 'test' })).toBe(LOCAL);
    expect(resolveGuardedSupabaseEndpoint(LOCAL, { mode: 'production' })).toBe(LOCAL);
  });

  // T2 — Production endpoint rejected in local mode (even with ALLOW_PROD_SUPABASE=1)
  it('T2: production endpoint rejected in local mode; opt-in cannot override', () => {
    expect(() => resolveGuardedSupabaseEndpoint(PROD, { mode: 'local', env: {} }))
      .toThrowError(/local mode/);
    expect(() => resolveGuardedSupabaseEndpoint(PROD, { mode: 'local', env: { ALLOW_PROD_SUPABASE: '1' } }))
      .toThrowError(/cannot be overridden by ALLOW_PROD_SUPABASE/);
  });

  // T3 — Production endpoint rejected in test mode (even with opt-in)
  it('T3: production endpoint rejected in test mode; opt-in cannot override', () => {
    expect(() => resolveGuardedSupabaseEndpoint(PROD, { mode: 'test', env: {} }))
      .toThrowError(/test mode/);
    expect(() => resolveGuardedSupabaseEndpoint(PROD, { mode: 'test', env: { ALLOW_PROD_SUPABASE: '1' } }))
      .toThrowError(/cannot be overridden by ALLOW_PROD_SUPABASE/);
  });

  // T4 — Missing local override cannot silently select production (fail closed)
  it('T4: missing/empty endpoint fails closed, no silent fallback', () => {
    expect(() => resolveGuardedSupabaseEndpoint(undefined, { mode: 'local' }))
      .toThrowError(/Missing Supabase endpoint/);
    expect(() => resolveGuardedSupabaseEndpoint('', { mode: 'local' }))
      .toThrowError(/Missing Supabase endpoint/);
    // And if a stray prod value is what remains, it is still rejected in local mode:
    expect(() => resolveGuardedSupabaseEndpoint(PROD, { mode: 'local', env: {} }))
      .toThrow();
  });

  // T5 — Explicit production deployment configuration remains supported
  it('T5: production endpoint allowed only with intentional production mode + opt-in', () => {
    expect(resolveGuardedSupabaseEndpoint(PROD, { mode: 'production', env: { ALLOW_PROD_SUPABASE: '1' } }))
      .toBe(PROD);
    // production mode WITHOUT opt-in is rejected (must be intentional, not inferred)
    expect(() => resolveGuardedSupabaseEndpoint(PROD, { mode: 'production', env: {} }))
      .toThrowError(/INTENTIONAL opt-in/);
  });

  // T6 — Both browser and server initialization paths invoke the protection.
  // Verified structurally: the guard call is present in all three generated clients.
  it('T6: guard is wired into all real client entry points (structural check)', async () => {
    const fs = await import('node:fs');
    const base = new URL('../src/integrations/supabase/', import.meta.url).pathname;
    for (const f of ['client.ts', 'client.server.ts', 'auth-middleware.ts']) {
      const src = fs.readFileSync(base + f, 'utf8');
      expect(src).toMatch(/resolveGuardedSupabaseEndpoint\s*\(/);
      expect(src).toMatch(/from '\.\/env-guard'/);
    }
  });

  // T7 — No secret values appear in guard output (error messages contain no keys/tokens)
  it('T7: guard errors never include secret-looking values', () => {
    try {
      resolveGuardedSupabaseEndpoint(PROD, { mode: 'local', env: { SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_SHOULD_NOT_LEAK' } });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toMatch(/sb_secret_/);
      expect(msg).not.toMatch(/SHOULD_NOT_LEAK/);
    }
  });

  // T8 — Existing local UAT configuration still works (local host passes with real-world env shape)
  it('T8: typical local UAT env resolves to the local endpoint unchanged', () => {
    const env = { NODE_ENV: 'development', ALLOW_PROD_SUPABASE: undefined } as Record<string, string | undefined>;
    expect(detectRuntimeMode(env)).toBe('local');
    expect(resolveGuardedSupabaseEndpoint(LOCAL, { env })).toBe(LOCAL);
  });

  it('helpers behave', () => {
    expect(isProductionSupabaseHost(PROD)).toBe(true);
    expect(isLocalSupabaseHost(LOCAL)).toBe(true);
    expect(detectRuntimeMode({ VITEST: '1' })).toBe('test');
    expect(detectRuntimeMode({ NODE_ENV: 'production' })).toBe('production');
  });
});
