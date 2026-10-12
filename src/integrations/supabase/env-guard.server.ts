// STEP 110/111 — server-only adapter for the Supabase env-guard.
//
// env-guard.ts is imported by browser-reachable code (client.ts, interest.functions.ts, …),
// so it must never statically import a module that pulls in Node built-ins. This adapter is
// the bridge: src/server.ts calls installEnvGuardServerAdapter() once at server boot, BEFORE
// any request is handled, and that registers an AsyncLocalStorage-backed hostname source
// with the guard.
//
// The hostname itself stays request-scoped inside requestContext (AsyncLocalStorage) —
// this adapter only hands the guard a way to READ it. No mutable global hostname exists.
//
// The registration is an explicitly-called export (not a bare side-effect import) because
// the package declares "sideEffects": false — bundlers tree-shake side-effect-only imports.
//
// DO NOT import this file from any browser-reachable module (routes, *.functions.ts, client.ts).
// tests/step110-browser-bundle-safety.test.ts enforces that.
import { requestContext } from "@/lib/background.server";
import { registerServerHostnameSource } from "./env-guard";

let installed = false;

/** Idempotent. Called once at server boot by src/server.ts. */
export function installEnvGuardServerAdapter(): void {
  if (installed) return;
  installed = true;
  registerServerHostnameSource(() => requestContext.getStore()?.hostname ?? null);
}

installEnvGuardServerAdapter();
