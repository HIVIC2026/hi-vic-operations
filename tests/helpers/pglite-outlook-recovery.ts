// Optional standalone runner for the same actual-source cases used by the Bun suite.
import { outlookRecoveryCases } from "./outlook-recovery-cases.ts";

for (const [name, run] of outlookRecoveryCases) {
  await run();
  console.log(`PASS: ${name}`);
}
console.log(`PASS: ${outlookRecoveryCases.length} Outlook recovery cases (actual server source + pending migration in PGlite)`);
