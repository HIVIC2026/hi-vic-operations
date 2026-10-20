import { test } from "bun:test";
import { outlookRecoveryCases } from "./helpers/outlook-recovery-cases.ts";

for (const [name, run] of outlookRecoveryCases) test(name, run, 30_000);
