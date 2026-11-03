// Part 10 Task 3: renders the "Enter your price" email (DRAFT — ENTER_PRICE_EMAIL_APPROVED stays false) with fixed sample
// data to docs/templates/mjml/installer_enter-price.mjml (the design, same source the live renderer compiles) and
// docs/templates/installer/enter-price.html + .txt (the picture for Jo). Pure renderer only; nothing is sent.
// Run: bun scripts/render-enter-price-sample.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { renderEnterPriceEmail, type EnterPriceFacts } from "../src/lib/enter-price-email.core";

const MJML_DIR = new URL("../docs/templates/mjml/", import.meta.url).pathname;
const INSTALLER_DIR = new URL("../docs/templates/installer/", import.meta.url).pathname;

export const ENTER_PRICE_SAMPLE: EnterPriceFacts = {
  recipientFirst: "James", checkerFirst: "John", ownerFirst: "Sarah", ownerFull: "Sarah Brown", jobNumber: "HV-1234",
  address: "12 Example St, Box Hill VIC 3128", readyCheckOn: "Tue 4 Nov", measured: "120 m² (2 areas)", existing: "Thin batts, R1.0",
  removal: "None", roof: "Sloped, tiles", access: "Standard", product: "Bradford Gold R5.0", downlights: "4",
  builtLast5Years: "No", lifeSupport: "No",
  priceUrl: "https://estimate.homeinsulationvictoria.com.au/field/TEST-JOB#price",
  readyCheckPdfUrl: "https://estimate.homeinsulationvictoria.com.au/api/files/TEST/Ready-Check.pdf",
};

const m = renderEnterPriceEmail(ENTER_PRICE_SAMPLE);
mkdirSync(INSTALLER_DIR, { recursive: true });
// Pretty-print the one-line MJML so the design file reads like the others in the folder.
const pretty = m.mjml.replace(/></g, ">\n<");
writeFileSync(`${MJML_DIR}installer_enter-price.mjml`, `${pretty}\n`);
writeFileSync(`${INSTALLER_DIR}enter-price.html`, m.html);
writeFileSync(`${INSTALLER_DIR}enter-price.txt`, `${m.subject}\n\n${m.text}\n`);

if (import.meta.main) console.log(m.subject, "\n--- text\n" + m.text);
