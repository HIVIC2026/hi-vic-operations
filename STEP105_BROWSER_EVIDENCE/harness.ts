// STEP 105 browser verification harness.
// Runs the REAL env-guard module inside a real Chromium page. The hostname under test is the
// actual document host (window.location.hostname) — nothing is faked inside the page.
import { detectRuntimeMode, currentHostname, resolveGuardedSupabaseEndpoint } from "../src/integrations/supabase/env-guard";

type Row = { label: string; endpoint: string; mode: string; outcome: string; ok: boolean };

const ENVS: Array<[string, Record<string, string | undefined>]> = [
  ["NODE_ENV=development (Lovable Preview build)", { NODE_ENV: "development" }],
  ["NODE_ENV=production + ALLOW_PROD_SUPABASE=1", { NODE_ENV: "production", ALLOW_PROD_SUPABASE: "1" }],
];

function run(): Row[] {
  const rows: Row[] = [];
  for (const [label, env] of ENVS) {
    for (const endpoint of [
      "https://wvuffpykgnqliikhodzl.supabase.co",
      "https://someotherproject.supabase.co",
      "https://db.internal.example",
      "http://127.0.0.1:54321",
    ]) {
      const mode = detectRuntimeMode(env);
      let outcome: string;
      try {
        const resolved = resolveGuardedSupabaseEndpoint(endpoint, { env });
        outcome = `ALLOWED -> ${resolved}`;
      } catch (e) {
        outcome = `REFUSED -> ${(e as Error).message}`;
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
(window as unknown as { __STEP105_READY__: boolean }).__STEP105_READY__ = true;
