// STEP 88B / 91A — local/test environment safety guard (standalone; NOT an auto-generated file).
// Purpose: prevent accidental use of a PRODUCTION Supabase host in local or test runtime,
// while still supporting an INTENTIONALLY configured production endpoint in deployment.
//
// This module is deliberately separate from the auto-generated client.ts / client.server.ts /
// auth-middleware.ts so the protection LOGIC survives any platform regeneration of those files.
// The generated clients only make a single one-line call into this guard; if regeneration drops
// that line, the loss is a missing call (easily re-applied) — not a loss of the safety logic.
//
// It changes no secrets and prints no secret values.

export type RuntimeMode = 'local' | 'test' | 'production';

export function isProductionSupabaseHost(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).host;
    return /\.supabase\.co$/i.test(host);
  } catch {
    return /supabase\.co/i.test(String(url));
  }
}

export function isLocalSupabaseHost(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0' || host.endsWith('.local');
  } catch {
    return /127\.0\.0\.1|localhost/i.test(String(url));
  }
}

export function prodExplicitlyAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env['ALLOW_PROD_SUPABASE'] === '1';
}

/**
 * Detect the runtime mode without relying on NODE_ENV alone.
 * - test: Vitest/Jest set VITEST / NODE_ENV=test.
 * - production: explicit DEPLOY_ENV=production or NODE_ENV=production.
 * - local: everything else (default dev).
 */
export function detectRuntimeMode(env: Record<string, string | undefined> = process.env): RuntimeMode {
  if (env['VITEST'] || env['NODE_ENV'] === 'test') return 'test';
  if (env['DEPLOY_ENV'] === 'production' || env['NODE_ENV'] === 'production') return 'production';
  return 'local';
}

/**
 * Core guard. Returns the url unchanged when safe; throws otherwise.
 *
 * Rules:
 *  - LOCAL and TEST modes: a *.supabase.co (production) host is ALWAYS rejected.
 *      ALLOW_PROD_SUPABASE=1 is intentionally NOT sufficient to override local/test safety
 *      (prevents an accidental env flag from silently enabling production in dev/CI).
 *  - PRODUCTION mode: a production host is allowed, but ONLY when production is intentional —
 *      i.e. mode was explicitly resolved to 'production' AND ALLOW_PROD_SUPABASE=1 is set.
 *      This makes production a deliberate choice, never an inferred fallback.
 *  - Local hosts are always accepted in any mode.
 */
export function resolveGuardedSupabaseEndpoint(
  url: string | undefined | null,
  opts?: { mode?: RuntimeMode; env?: Record<string, string | undefined> },
): string {
  const env = opts?.env ?? process.env;
  const mode = opts?.mode ?? detectRuntimeMode(env);

  if (!url) {
    // Fail closed: never let a missing endpoint silently resolve to a fallback.
    throw new Error('[env-guard] Missing Supabase endpoint. Local configuration must be explicit; there is no silent fallback.');
  }

  if (isLocalSupabaseHost(url)) return url; // local is always safe

  if (isProductionSupabaseHost(url)) {
    if (mode === 'local' || mode === 'test') {
      throw new Error(
        `[env-guard] Refusing a production Supabase host (*.supabase.co) in ${mode} mode. ` +
        'Local/test safety cannot be overridden by ALLOW_PROD_SUPABASE. Use a local endpoint (127.0.0.1).',
      );
    }
    // production mode
    if (!prodExplicitlyAllowed(env)) {
      throw new Error(
        '[env-guard] Production Supabase host requires an INTENTIONAL opt-in (ALLOW_PROD_SUPABASE=1) in production mode. ' +
        'Production must be configured deliberately, not inferred from a fallback .env.',
      );
    }
    return url;
  }

  // Non-local, non-*.supabase.co custom host (e.g. self-hosted): allow but only outside test by default.
  if (mode === 'test') {
    throw new Error(`[env-guard] Unexpected non-local Supabase host in test mode: refusing. Use 127.0.0.1.`);
  }
  return url;
}

/**
 * Back-compat helper retained from STEP 88B (used by the original 4 tests).
 */
export function assertSafeSupabaseEndpoint(
  url: string | undefined | null,
  env: Record<string, string | undefined> = process.env,
): string | undefined | null {
  if (isProductionSupabaseHost(url) && !prodExplicitlyAllowed(env)) {
    throw new Error(
      '[env-guard] Refusing to use a production Supabase host (*.supabase.co) in local/test mode. ' +
      'Set ALLOW_PROD_SUPABASE=1 only in an authorised production/deploy context.',
    );
  }
  return url;
}
