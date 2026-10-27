// Renders the decision 389 approved "It's your turn" email O77 (and its day-2 reminder) into docs/templates/owner with fixed
// sample data, prints the subjects, plain text and both SMS bodies, and with --jpg also saves a 640px-wide JPG preview of
// the O77 design into /tmp/designs/O77.jpg (Playwright Chromium, local files only). Pure renderers; nothing is sent.
// Flags stay off until Jo sees the picture: SPOT_RELEASED_APPROVED (spot-release.core) + SMS type `spot_released`.
// Run: bun scripts/render-decision-389-drafts.ts [--jpg]
import { mkdirSync, writeFileSync } from "node:fs";
import { renderSpotReleasedEmail } from "../src/lib/spot-release-email.core";
import { spotReleasePageLink, spotReleasedText } from "../src/lib/spot-release.core";

const TEMPLATES = "/tmp/email-drafts/";
const DESIGNS = "/tmp/designs/";
const MY_JOB = "https://estimate.homeinsulationvictoria.com.au/my-job/tok";
const LINK = spotReleasePageLink(MY_JOB);

export const D389_FILES = { O77: "O77-spot-released.html", O77r: "O77r-spot-released-reminder.html" } as const;
const out = [
  { code: "O77" as const, mail: renderSpotReleasedEmail({ firstName: "Helen", confirmUrl: LINK, unsubscribeUrl: null, reminder: false }), sms: spotReleasedText(LINK) },
  { code: "O77r" as const, mail: renderSpotReleasedEmail({ firstName: "Helen", confirmUrl: LINK, unsubscribeUrl: null, reminder: true }), sms: spotReleasedText(LINK, true) },
];

mkdirSync(TEMPLATES, { recursive: true });
for (const o of out) {
  writeFileSync(`${TEMPLATES}${D389_FILES[o.code]}`, o.mail.html);
  if (import.meta.main) console.log(`--- ${o.code} — subject: ${o.mail.subject}\n${o.mail.text}\n--- ${o.code} text: ${o.sms}\n`);
}

if (import.meta.main && process.argv.includes("--jpg")) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = require("playwright") as typeof import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 900 } });
  mkdirSync(DESIGNS, { recursive: true });
  await page.setContent(out[0]!.mail.html, { waitUntil: "load" });
  await page.screenshot({ path: `${DESIGNS}O77.jpg`, type: "jpeg", quality: 85, fullPage: true });
  console.log("JPG: /tmp/designs/O77.jpg");
  await browser.close();
}
