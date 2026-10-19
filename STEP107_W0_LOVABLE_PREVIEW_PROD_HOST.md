# STEP 107 — Lovable Published Production Hostname Detection

## Problem
In the Lovable published production bundle, `process.env` is compiled to an empty object `{}`, making `NODE_ENV` and `DEPLOY_ENV` unavailable for runtime detection. This caused the published application to fall back to 'local' mode in `detectRuntimeMode()`, which then refused the legitimate Supabase endpoint configured by Lovable (`wvuffpykgnqliikhodzl.supabase.co`) with the error:
```
[env-guard] Refusing a production Supabase host (*.supabase.co) in local mode.
Local/test safety cannot be overridden by ALLOW_PROD_SUPABASE. Use a local endpoint (127.0.0.1).
```

## Solution
Added hostname-based production detection to `detectRuntimeMode()` in `src/integrations/supabase/env-guard.ts` that works even when environment variables are stripped from the browser bundle.

### Changes Made

#### 1. Added `PRODUCTION_AUTHORISED_HOSTS` constant
```typescript
// STEP 107 — verified production hosts for this project (from codebase constants).
// These hosts are used for hostname-based production detection because the browser
// production bundle compiles process.env to {}, so NODE_ENV/DEPLOY_ENV cannot be trusted
// in client code. Only these narrowly authorised hosts may trigger 'production' mode.
// All other hosts fall through to 'local' (fail closed) unless env vars explicitly set production.
export const PRODUCTION_AUTHORISED_HOSTS = Object.freeze([
  'estimate.homeinsulationvictoria.com.au',
  'homeinsulationvictoria.com.au',
]);
```

#### 2. Enhanced `detectRuntimeMode()` function
Added hostname-based production check that runs before the environment variable check:
```typescript
export function detectRuntimeMode(
  env: Record<string, string | undefined> = process.env,
  hostname: string | null = resolveHostname(),
): RuntimeMode {
  if (env['VITEST'] || env['NODE_ENV'] === 'test') return 'test';
  if (isAuthorisedLovablePreviewHost(hostname)) return 'lovable-preview';
  // STEP 107: hostname-based production detection (works when env vars are stripped).
  if (hostname && PRODUCTION_AUTHORISED_HOSTS.includes(hostname.toLowerCase())) return 'production';
  if (env['DEPLOY_ENV'] === 'production' || env['NODE_ENV'] === 'production') return 'production';
  return 'local';
}
```

#### 3. Preserved `lovablePreviewProjectId()` function
Kept the existing logic that supports both preview host formats:
- Prefixed: `id-preview--<uuid>.lovable.app`
- Bare: `<uuid>.lovableproject.com` (the actual Lovable Preview host)

## Verification

### Test Results
- ✅ All existing tests pass (step105, step88b, step106)
- ✅ TypeScript compiles with zero errors
- ✅ Preview host `fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovableproject.com` correctly detected as 'lovable-preview'
- ✅ Published hostname `estimate.homeinsulationvictoria.com.au` correctly detected as 'production'
- ✅ Localhost `127.0.0.1`/`localhost` correctly remains 'local'
- ✅ Test mode (`VITEST=1` or `NODE_ENV=test`) still blocks production access
- ✅ Narrow authorization: only the two specified production hosts trigger 'production' mode
- ✅ Look-alike hosts (e.g., `example.com`, other tenants) fall back to 'local' (secure fail-closed)

### Security Properties Preserved
- **Local/test safety**: Cannot be overridden by `ALLOW_PROD_SUPABASE=1` in local/test modes
- **Production intentionality**: Requires either explicit `DEPLOY_ENV=production`/`NODE_ENV=production` OR hostname match
- **Narrow authorization**: Only specific, verified production hosts for this project are allowed
- **No browser bundle risk**: Hostname check works without requiring environment variables in the browser bundle

## Compatibility
- ✅ Works with existing Lovable Preview (both `id-preview--` and bare `<uuid>.lovableproject.com` hosts)
- ✅ Works with published Lovable application
- ✅ Preserves all existing local development and test protections
- ✅ No changes required to Supabase endpoint configuration
- ✅ No changes required to database schema or migrations