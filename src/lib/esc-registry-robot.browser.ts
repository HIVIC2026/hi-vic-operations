// ESC Registry robot – the browser steps (decision 272). Works against a tiny structural `RobotPage` so this module
// has NO dependency on Playwright (the deployed worker never bundles a browser); scripts/esc-registry-robot.ts hands
// in a real Playwright page. Credentials are typed into the page and never logged, never returned, never stored.
// Nothing here decides whether to submit: `submit` is only called by the script when the plan says live.
import { INSTALL_NOTIFICATION, INSTALL_NOTIFICATION_UPDATE, LOGIN, VEEC_CREATION, extractReference, formatForRegistry, type FieldSelector, type FormSection } from "./esc-registry-selectors";

/** The subset of Playwright's Page the robot uses (structural, so tests can fake it). */
export interface RobotPage {
  goto(url: string, o?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" }): Promise<unknown>;
  fill(selector: string, value: string, o?: { timeout?: number }): Promise<void>;
  click(selector: string, o?: { timeout?: number }): Promise<void>;
  check(selector: string, o?: { timeout?: number }): Promise<void>;
  selectOption(selector: string, value: string | { label: string }, o?: { timeout?: number }): Promise<unknown>;
  waitForSelector(selector: string, o?: { timeout?: number; state?: "attached" | "visible" }): Promise<unknown>;
  textContent(selector: string, o?: { timeout?: number }): Promise<string | null>;
  screenshot(o?: { fullPage?: boolean }): Promise<Uint8Array>;
  url(): string;
  isVisible(selector: string, o?: { timeout?: number }): Promise<boolean>;
}

export class RobotStepError extends Error {
  constructor(public step: string, message: string) { super(message); this.name = "RobotStepError"; }
}

const T = { nav: 30_000, field: 10_000 };

/** Signs in. Throws RobotStepError("login", …) on a refused login or a missing marker; the password never appears in any message. */
export async function login(page: RobotPage, creds: { username: string; password: string }): Promise<void> {
  if (!creds.username || !creds.password) throw new RobotStepError("login", "Registry login is not configured");
  await page.goto(LOGIN.url, { waitUntil: "domcontentloaded" });
  try {
    await page.fill(LOGIN.username, creds.username, { timeout: T.field });
    await page.fill(LOGIN.password, creds.password, { timeout: T.field });
    await page.click(LOGIN.submit, { timeout: T.field });
  } catch (e) {
    throw new RobotStepError("login", `Login form not found as mapped (${trimErr(e)})`);
  }
  if (await page.isVisible(LOGIN.failed, { timeout: 3_000 }).catch(() => false)) throw new RobotStepError("login", "The Registry refused the login (username/password) – not retried");
  try { await page.waitForSelector(LOGIN.loggedIn, { timeout: T.nav }); } catch { throw new RobotStepError("login", "Signed-in page marker not found (MFA step, changed landing page or wrong marker?)"); }
}

/** Fills ONE field per its selector kind. Blank values are left alone (never typed as empty, never guessed). */
export async function fillField(page: RobotPage, key: string, f: FieldSelector, value: string | null | undefined): Promise<"filled" | "blank"> {
  if (value == null || String(value).trim() === "") return "blank";
  const v = String(value).trim();
  try {
    if (f.kind === "text") await page.fill(f.selector, v, { timeout: T.field });
    else if (f.kind === "date" || f.kind === "datetime") await page.fill(f.selector, isIso(v) && f.format ? formatForRegistry(v, f.format) : v, { timeout: T.field });
    else if (f.kind === "select") await page.selectOption(f.selector, { label: f.options?.[v] ?? v }, { timeout: T.field });
    else if (f.kind === "radio") await page.check(`${f.selector} >> text="${(f.options?.[v] ?? v).replace(/"/g, '\\"')}"`, { timeout: T.field });
    else if (f.kind === "checkbox") { if (/^(yes|true|1)$/i.test(v)) await page.check(f.selector, { timeout: T.field }); }
    return "filled";
  } catch (e) {
    throw new RobotStepError(`fill:${key}`, `Could not fill "${key}" (${f.kind} ${f.selector}): ${trimErr(e)}`);
  }
}

export type FillReport = { filled: string[]; blank: string[]; unmapped: string[] };

/** Opens a form and fills every mapped value. Keys with a value but no selector are reported (never silently dropped). */
export async function openAndFill(page: RobotPage, section: FormSection, values: Record<string, string | null | undefined>, opts: { onlyKeys?: readonly string[] } = {}): Promise<FillReport> {
  await page.goto(section.url, { waitUntil: "domcontentloaded" });
  try { await page.waitForSelector(section.ready, { timeout: T.nav }); } catch { throw new RobotStepError("open-form", `Form not found at ${section.url} (ready selector ${section.ready})`); }
  return fillSection(page, section, values, opts);
}

export async function fillSection(page: RobotPage, section: FormSection, values: Record<string, string | null | undefined>, opts: { onlyKeys?: readonly string[] } = {}): Promise<FillReport> {
  const r: FillReport = { filled: [], blank: [], unmapped: [] };
  const keys = opts.onlyKeys ? Object.keys(section.fields).filter((k) => opts.onlyKeys!.includes(k)) : Object.keys(section.fields);
  for (const k of keys) (await fillField(page, k, section.fields[k]!, values[k]) === "filled" ? r.filled : r.blank).push(k);
  for (const k of Object.keys(values)) if (!(k in section.fields) && values[k] != null && String(values[k]).trim() !== "") r.unmapped.push(k);
  return r;
}

/** Install notification: open the new-notification form and fill the Table 5 values (ISO instants for the two date-times). */
export const fillInstallNotification = (page: RobotPage, values: Record<string, string | null | undefined>) => openAndFill(page, INSTALL_NOTIFICATION, values);

/** Update on the SAME notification ID: open it, press Update, fill only the updatable keys the plan listed. */
export async function fillInstallNotificationUpdate(page: RobotPage, registryId: string, values: Record<string, string | null | undefined>, changedKeys: readonly string[]): Promise<FillReport> {
  await page.goto(INSTALL_NOTIFICATION_UPDATE.url(registryId), { waitUntil: "domcontentloaded" });
  try { await page.click(INSTALL_NOTIFICATION_UPDATE.editButton, { timeout: T.nav }); await page.waitForSelector(INSTALL_NOTIFICATION_UPDATE.ready, { timeout: T.nav }); } catch (e) { throw new RobotStepError("open-update", `Could not open the update form for ${registryId}: ${trimErr(e)}`); }
  return fillSection(page, { ...INSTALL_NOTIFICATION, submit: INSTALL_NOTIFICATION_UPDATE.submit }, values, { onlyKeys: changedKeys });
}

export const fillVeecCreation = (page: RobotPage, values: Record<string, string | null | undefined>) => openAndFill(page, VEEC_CREATION, values);

/** LIVE ONLY: presses Submit and reads the Registry reference from the confirmation. A missing reference is a failure
 *  (the office checks the Registry) – the caller has already recorded the attempt, so nothing is ever pressed twice. */
export async function submitAndReadReference(page: RobotPage, section: Pick<FormSection, "submit" | "confirmation">): Promise<{ reference: string; url: string }> {
  try { await page.click(section.submit, { timeout: T.field }); } catch (e) { throw new RobotStepError("submit", `Submit button not found/clickable (${section.submit}): ${trimErr(e)}`); }
  let text: string | null = null;
  try { await page.waitForSelector(section.confirmation.selector, { timeout: T.nav }); text = await page.textContent(section.confirmation.selector, { timeout: T.field }); } catch (e) { throw new RobotStepError("confirmation", `Confirmation not found after Submit: ${trimErr(e)}`); }
  const reference = extractReference(text, section.confirmation.pattern);
  if (!reference) throw new RobotStepError("confirmation", "Submitted, but no reference could be read from the confirmation page – CHECK THE REGISTRY before anything is resubmitted");
  return { reference, url: page.url() };
}

const isIso = (v: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
const trimErr = (e: unknown) => String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(0, 200);
