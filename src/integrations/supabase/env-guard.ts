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
//
// STEP 105 — the Lovable-hosted Preview was mis-classified as 'local'. See detectRuntimeMode().

export type RuntimeMode = 'local' | 'test' | 'lovable-preview' | 'production';

// STEP 105 — explicit, reviewable authorisation record for the Lovable-hosted Preview.
// Every value below is a constant already present elsewhere in THIS repository (not assumed):
//   project id / preview host : src/lib/test-send.server.ts (TEST_APP_BASE) and
//                               src/lib/trade-view.server.ts (allowed origin list)
//   hosting zones             : src/integrations/supabase/previewAuthStorage.ts (Lovable-generated)
//   supabase project host     : the endpoint this project is configured against
export const LOVABLE_PREVIEW_AUTHORISATION = Object.freeze({
  projectId: 'fb35adfe-10bf-4d4c-987d-28567ca1ddeb',
  previewHost: 'id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app',
  supabaseProjectHost: 'wvuffpykgnqliikhodzl.supabase.co',
});

/** Lovable hosting zones — mirrors the zone list in the Lovable-generated previewAuthStorage.ts. */
const LOVABLE_HOSTED_ZONES = [
  'lovable.app',
  'lovableproject.com',
  'lovableproject-dev.com',
  'gpt-eng.com',
  'gptengineer.run',
];

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

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

/** Hostname of the current document, or null when there is no browser (server/test runtimes). */
export function currentHostname(): string | null {
  try {
    if (typeof window === 'undefined' || !window.location) return null;
    return window.location.hostname || null;
  } catch {
    return null; // sandboxed cross-origin access must never throw here — it must fail closed.
  }
}

/**
 * Extract the project id from a Lovable preview hostname, reading it only from the
 * platform-controlled `id-preview--<uuid>` / `preview--<uuid>` position (same rule the
 * Lovable-generated previewAuthStorage.ts uses), so an arbitrary host cannot claim another
 * project's identity.
 */
export function lovablePreviewProjectId(hostname: string | null | undefined): string | null {
  if (!hostname) return null;
  const host = hostname.toLowerCase();
  if (!LOVABLE_HOSTED_ZONES.some((z) => host === z || host.endsWith('.' + z))) return null;
  const m = new RegExp(`^(?:id-preview(?:-[a-z0-9]+)?|preview)--(${UUID_PATTERN})(?:-dev)?(?=\\.|$)`, 'i').exec(host);
  return m?.[1]?.toLowerCase() ?? null;
}

/**
 * True only for THIS project's Lovable-hosted preview surface.
 * Deliberately narrow: zone must be a Lovable hosting zone AND the platform-assigned project id
 * must match this project. Nothing else (no env var, no header, no IP) can satisfy it.
 */
export function isAuthorisedLovablePreviewHost(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  if (host === LOVABLE_PREVIEW_AUTHORISATION.previewHost) return true;
  return lovablePreviewProjectId(host) === LOVABLE_PREVIEW_AUTHORISATION.projectId;
}

/** The single Supabase endpoint the Lovable Preview is authorised to reach. */
export function isAuthorisedPreviewSupabaseEndpoint(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === LOVABLE_PREVIEW_AUTHORISATION.supabaseProjectHost;
  } catch {
    return false;
  }
}

/**
 * Detect the runtime mode without relying on NODE_ENV alone.
 * - test: Vitest/Jest set VITEST / NODE_ENV=test.
 * - lovable-preview: the page is served from THIS project's Lovable preview surface (STEP 105).
 * - production: explicit DEPLOY_ENV=production or NODE_ENV=production.
 * - local: everything else (default dev).
 *
 * NOTE (STEP 105): Lovable builds the Preview with NODE_ENV=development, so without the
 * hostname check above the Preview fell through to 'local' and the guard refused the very
 * Supabase project Lovable itself configured.
 */
export function detectRuntimeMode(
  env: Record<string, string | undefined> = process.env,
  hostname: string | null = currentHostname(),
): RuntimeMode {
  if (env['VITEST'] || env['NODE_ENV'] === 'test') return 'test';
  if (isAuthorisedLovablePreviewHost(hostname)) return 'lovable-preview';
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
 *  - LOVABLE-PREVIEW mode (STEP 105): the Preview is hosted by Lovable and is configured by
 *      Lovable against this project's own Supabase project, so exactly ONE endpoint is permitted
 *      — LOVABLE_PREVIEW_AUTHORISATION.supabaseProjectHost. Every other production host, and
 *      every custom (self-hosted) endpoint, is still refused. The mode itself can only be
 *      entered via the hostname check above, never by an env var or a request header.
 *  - PRODUCTION mode: a production host is allowed, but ONLY when production is intentional —
 *      i.e. mode was explicitly resolved to 'production' AND ALLOW_PROD_SUPABASE=1 is set.
 *      This makes production a deliberate choice, never an inferred fallback.
 *  - Local hosts are always accepted in any mode.
 */
export function resolveGuardedSupabaseEndpoint(
  url: string | undefined | null,
  opts?: { mode?: RuntimeMode; env?: Record<string, string | undefined>; hostname?: string | null },
): string {
  const env = opts?.env ?? process.env;
  const mode = opts?.mode ?? detectRuntimeMode(env, opts?.hostname ?? currentHostname());

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
    // lovable-preview mode: this project's own endpoint only — nothing else is authorised.
    if (mode === 'lovable-preview') {
      if (!isAuthorisedPreviewSupabaseEndpoint(url)) {
        throw new Error(
          `[env-guard] Refusing an un-authorised Supabase endpoint in Lovable Preview. ` +
          `Only the endpoint bound to this project (${LOVABLE_PREVIEW_AUTHORISATION.supabaseProjectHost}) is permitted.`,
        );
      }
      return url;
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

  // Non-local, non-*.supabase.co custom host (e.g. self-hosted): allow in local/production only.
  if (mode === 'test' || mode === 'lovable-preview') {
    throw new Error(`[env-guard] Unexpected non-local Supabase host in ${mode} mode: refusing. Use 127.0.0.1.`);
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
