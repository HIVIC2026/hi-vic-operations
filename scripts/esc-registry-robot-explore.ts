// ESC VEU Registry robot – EXPLORE (decision 272). Finishes the selector map on the first supervised run with Jo.
// Logs in (only when VEU_REGISTRY_USERNAME / VEU_REGISTRY_PASSWORD are set), opens the install-notification form and
// the VEEC-creation form, screenshots each page and dumps every form control (tag, type, name, id, label text,
// options) so esc-registry-selectors.ts can be corrected. Submits NOTHING: no Submit button is ever clicked, no
// portal record is written. Output goes to ./tmp/esc-registry-explore/ (git-ignored tmp). Credentials never printed.
//   bun scripts/esc-registry-robot-explore.ts [--url <extra page to dump>]
import { mkdirSync, writeFileSync } from "node:fs";
import { INSTALL_NOTIFICATION, LOGIN, SELECTOR_MAP_VERIFIED, SELECTOR_MAP_VERSION, VEEC_CREATION, selectorGaps, unmappedNotificationKeys } from "../src/lib/esc-registry-selectors";
import { ESC_ROBOT_PASSWORD_ENV, ESC_ROBOT_USERNAME_ENV } from "../src/lib/esc-registry-robot.core";
import { login, type RobotPage } from "../src/lib/esc-registry-robot.browser";

const OUT = "tmp/esc-registry-explore";
mkdirSync(OUT, { recursive: true });
const extra = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] ?? null : null;

console.log(`Selector map ${SELECTOR_MAP_VERSION} · verified: ${SELECTOR_MAP_VERIFIED}`);
console.log(`Open questions (${selectorGaps().length}):`); for (const g of selectorGaps()) console.log(`  - ${g}`);
const unmapped = unmappedNotificationKeys(); if (unmapped.length) console.log(`Table 5 keys with no selector: ${unmapped.join(", ")}`);

const username = (process.env[ESC_ROBOT_USERNAME_ENV] ?? "").trim(), password = process.env[ESC_ROBOT_PASSWORD_ENV] ?? "";
if (!username || !password) { console.log(`\nNo Registry login in the environment (${ESC_ROBOT_USERNAME_ENV} / ${ESC_ROBOT_PASSWORD_ENV}) – nothing more to explore. Jo provides these as Lovable secrets / on the robot machine.`); process.exit(0); }

type PW = { chromium: { launch(o?: { headless?: boolean }): Promise<{ newPage(): Promise<RobotPage & { evaluate<T>(fn: () => T): Promise<T>; content(): Promise<string>; close(): Promise<void> }>; close(): Promise<void> }> } };
let pw: PW;
try { pw = (await import("playwright")) as unknown as PW; } catch { console.error("Playwright is not installed. Run: bun add -d playwright && bunx playwright install chromium"); process.exit(2); }
const browser = await pw.chromium.launch({ headless: process.env["ESC_REGISTRY_ROBOT_HEADFUL"] !== "true" });
const page = await browser.newPage();

// Runs inside the page: every control with the label a person would read, so the map can be filled from this list.
const DUMP = () => Array.from(document.querySelectorAll("input, select, textarea, button")).map((el) => {
  const e = el as HTMLInputElement;
  const id = e.id || null;
  const lbl = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent) || e.closest("label")?.textContent || e.getAttribute("aria-label") || e.closest("fieldset")?.querySelector("legend")?.textContent || null;
  const opts = e.tagName === "SELECT" ? Array.from((e as unknown as HTMLSelectElement).options).map((o) => `${o.value}=${o.textContent?.trim()}`) : undefined;
  return { tag: e.tagName.toLowerCase(), type: e.getAttribute("type"), name: e.getAttribute("name"), id, placeholder: e.getAttribute("placeholder"), label: lbl?.replace(/\s+/g, " ").trim() ?? null, value: e.type === "password" ? "***" : undefined, text: e.tagName === "BUTTON" ? e.textContent?.trim() : undefined, options: opts, required: e.required || undefined };
});

async function dump(name: string, url: string | null) {
  try {
    if (url) await page.goto(url, { waitUntil: "domcontentloaded" });
    const controls = await page.evaluate(DUMP);
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ url: page.url(), controls }, null, 2));
    writeFileSync(`${OUT}/${name}.html`, await page.content());
    writeFileSync(`${OUT}/${name}.png`, await page.screenshot({ fullPage: true }));
    console.log(`\n${name}: ${page.url()} · ${controls.length} controls → ${OUT}/${name}.{json,html,png}`);
    for (const c of controls) console.log(`  ${c.tag}${c.type ? `[${c.type}]` : ""} name=${c.name ?? "-"} id=${c.id ?? "-"} label="${c.label ?? c.text ?? c.placeholder ?? ""}"${c.options ? ` options=${c.options.slice(0, 8).join(" | ")}${c.options.length > 8 ? " …" : ""}` : ""}`);
  } catch (e) { console.log(`${name}: could not dump (${String((e as Error).message).slice(0, 200)})`); }
}

await dump("00-login-page", LOGIN.url);
try { await login(page, { username, password }); console.log("\nLogged in."); } catch (e) { console.log(`\nLogin did not complete: ${(e as Error).message}`); await dump("01-after-login-attempt", null); await browser.close(); process.exit(1); }
await dump("01-landing", null);
await dump("02-install-notification-form", INSTALL_NOTIFICATION.url);
await dump("03-veec-creation-form", VEEC_CREATION.url);
if (extra) await dump("04-extra", extra);
await browser.close();
console.log(`\nDone. Compare each dump with esc-registry-selectors.ts, fix the selectors, clear the TODOs, then set SELECTOR_MAP_VERIFIED = true (code change) before the first live run.`);
