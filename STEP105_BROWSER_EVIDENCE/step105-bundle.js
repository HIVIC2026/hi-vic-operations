"use strict";
(() => {
  // <define:process.env>
  var define_process_env_default = {};

  // src/integrations/supabase/env-guard.ts
  var LOVABLE_PREVIEW_AUTHORISATION = Object.freeze({
    projectId: "fb35adfe-10bf-4d4c-987d-28567ca1ddeb",
    previewHost: "id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app",
    supabaseProjectHost: "wvuffpykgnqliikhodzl.supabase.co"
  });
  var LOVABLE_HOSTED_ZONES = [
    "lovable.app",
    "lovableproject.com",
    "lovableproject-dev.com",
    "gpt-eng.com",
    "gptengineer.run"
  ];
  var UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  function isProductionSupabaseHost(url) {
    if (!url) return false;
    try {
      const host = new URL(url).host;
      return /\.supabase\.co$/i.test(host);
    } catch {
      return /supabase\.co/i.test(String(url));
    }
  }
  function isLocalSupabaseHost(url) {
    if (!url) return false;
    try {
      const host = new URL(url).hostname;
      return host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0" || host.endsWith(".local");
    } catch {
      return /127\.0\.0\.1|localhost/i.test(String(url));
    }
  }
  function prodExplicitlyAllowed(env = define_process_env_default) {
    return env["ALLOW_PROD_SUPABASE"] === "1";
  }
  function currentHostname() {
    try {
      if (typeof window === "undefined" || !window.location) return null;
      return window.location.hostname || null;
    } catch {
      return null;
    }
  }
  function lovablePreviewProjectId(hostname) {
    if (!hostname) return null;
    const host = hostname.toLowerCase();
    if (!LOVABLE_HOSTED_ZONES.some((z) => host === z || host.endsWith("." + z))) return null;
    const m = new RegExp(`^(?:id-preview(?:-[a-z0-9]+)?|preview)--(${UUID_PATTERN})(?:-dev)?(?=\\.|$)`, "i").exec(host);
    return m?.[1]?.toLowerCase() ?? null;
  }
  function isAuthorisedLovablePreviewHost(hostname) {
    if (!hostname) return false;
    const host = hostname.toLowerCase();
    if (host === LOVABLE_PREVIEW_AUTHORISATION.previewHost) return true;
    return lovablePreviewProjectId(host) === LOVABLE_PREVIEW_AUTHORISATION.projectId;
  }
  function isAuthorisedPreviewSupabaseEndpoint(url) {
    try {
      return new URL(url).hostname.toLowerCase() === LOVABLE_PREVIEW_AUTHORISATION.supabaseProjectHost;
    } catch {
      return false;
    }
  }
  function detectRuntimeMode(env = define_process_env_default, hostname = currentHostname()) {
    if (env["VITEST"] || env["NODE_ENV"] === "test") return "test";
    if (isAuthorisedLovablePreviewHost(hostname)) return "lovable-preview";
    if (env["DEPLOY_ENV"] === "production" || env["NODE_ENV"] === "production") return "production";
    return "local";
  }
  function resolveGuardedSupabaseEndpoint(url, opts) {
    const env = opts?.env ?? define_process_env_default;
    const mode = opts?.mode ?? detectRuntimeMode(env, opts?.hostname ?? currentHostname());
    if (!url) {
      throw new Error("[env-guard] Missing Supabase endpoint. Local configuration must be explicit; there is no silent fallback.");
    }
    if (isLocalSupabaseHost(url)) return url;
    if (isProductionSupabaseHost(url)) {
      if (mode === "local" || mode === "test") {
        throw new Error(
          `[env-guard] Refusing a production Supabase host (*.supabase.co) in ${mode} mode. Local/test safety cannot be overridden by ALLOW_PROD_SUPABASE. Use a local endpoint (127.0.0.1).`
        );
      }
      if (mode === "lovable-preview") {
        if (!isAuthorisedPreviewSupabaseEndpoint(url)) {
          throw new Error(
            `[env-guard] Refusing an un-authorised Supabase endpoint in Lovable Preview. Only the endpoint bound to this project (${LOVABLE_PREVIEW_AUTHORISATION.supabaseProjectHost}) is permitted.`
          );
        }
        return url;
      }
      if (!prodExplicitlyAllowed(env)) {
        throw new Error(
          "[env-guard] Production Supabase host requires an INTENTIONAL opt-in (ALLOW_PROD_SUPABASE=1) in production mode. Production must be configured deliberately, not inferred from a fallback .env."
        );
      }
      return url;
    }
    if (mode === "test" || mode === "lovable-preview") {
      throw new Error(`[env-guard] Unexpected non-local Supabase host in ${mode} mode: refusing. Use 127.0.0.1.`);
    }
    return url;
  }

  // STEP105_BROWSER_EVIDENCE/harness.ts
  var ENVS = [
    ["NODE_ENV=development (Lovable Preview build)", { NODE_ENV: "development" }],
    ["NODE_ENV=production + ALLOW_PROD_SUPABASE=1", { NODE_ENV: "production", ALLOW_PROD_SUPABASE: "1" }]
  ];
  function run() {
    const rows = [];
    for (const [label, env] of ENVS) {
      for (const endpoint of [
        "https://wvuffpykgnqliikhodzl.supabase.co",
        "https://someotherproject.supabase.co",
        "https://db.internal.example",
        "http://127.0.0.1:54321"
      ]) {
        const mode = detectRuntimeMode(env);
        let outcome;
        try {
          const resolved = resolveGuardedSupabaseEndpoint(endpoint, { env });
          outcome = `ALLOWED -> ${resolved}`;
        } catch (e) {
          outcome = `REFUSED -> ${e.message}`;
        }
        rows.push({ label, endpoint, mode, outcome, ok: true });
      }
    }
    return rows;
  }
  function render() {
    const rows = run();
    const mode = detectRuntimeMode({ NODE_ENV: "development" });
    document.body.innerHTML = `
    <div id="root" style="font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:24px;color:#111;background:#fff">
      <h1 style="font-size:18px;margin:0 0 4px">STEP 105 env-guard live browser check</h1>
      <div><b>document hostname:</b> <span id="host">${window.location.hostname}</span></div>
      <div><b>currentHostname():</b> ${currentHostname()}</div>
      <div><b>detected runtime mode (NODE_ENV=development):</b> <span id="mode" style="font-weight:700">${mode}</span></div>
      <table style="margin-top:12px;border-collapse:collapse;width:100%">
        <tr><th style="text-align:left;border-bottom:1px solid #999">env</th>
            <th style="text-align:left;border-bottom:1px solid #999">endpoint</th>
            <th style="text-align:left;border-bottom:1px solid #999">mode</th>
            <th style="text-align:left;border-bottom:1px solid #999">result</th></tr>
        ${rows.map((r) => `<tr>
            <td style="padding:2px 8px 2px 0;vertical-align:top">${r.label}</td>
            <td style="padding:2px 8px 2px 0;vertical-align:top">${r.endpoint}</td>
            <td style="padding:2px 8px 2px 0;vertical-align:top">${r.mode}</td>
            <td style="padding:2px 0;vertical-align:top">${r.outcome}</td>
          </tr>`).join("")}
      </table>
    </div>`;
  }
  render();
  window.__STEP105_READY__ = true;
})();
