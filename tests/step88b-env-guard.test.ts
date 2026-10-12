import { describe, it, expect } from 'vitest';
import { isProductionSupabaseHost, prodExplicitlyAllowed, assertSafeSupabaseEndpoint } from '../src/integrations/supabase/env-guard';

describe('STEP 88B env-guard', () => {
  it('detects a production supabase host', () => {
    expect(isProductionSupabaseHost('https://wvuffpykgnqliikhodzl.supabase.co')).toBe(true);
    expect(isProductionSupabaseHost('http://127.0.0.1:54321')).toBe(false);
    expect(isProductionSupabaseHost(undefined)).toBe(false);
  });

  it('accepts the local endpoint without opt-in', () => {
    expect(assertSafeSupabaseEndpoint('http://127.0.0.1:54321', {})).toBe('http://127.0.0.1:54321');
  });

  it('REJECTS a production endpoint when not explicitly allowed', () => {
    expect(() => assertSafeSupabaseEndpoint('https://proj.supabase.co', {})).toThrowError(/production Supabase host/);
  });

  it('allows a production endpoint only with ALLOW_PROD_SUPABASE=1', () => {
    expect(prodExplicitlyAllowed({ ALLOW_PROD_SUPABASE: '1' })).toBe(true);
    expect(assertSafeSupabaseEndpoint('https://proj.supabase.co', { ALLOW_PROD_SUPABASE: '1' })).toBe('https://proj.supabase.co');
  });
});
