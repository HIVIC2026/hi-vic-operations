// Jo 3 Nov 2026: after the worker presses Complete on the Ready Check, the installer's BOSS enters the price in the portal,
// and only then does the quote go to the owner. No trade-facing line may say or imply the quote is sent automatically
// on Complete. DRAFT wording until Jo approves it.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PRESS_COMPLETE_LINE, QUOTE_PRICE_NEXT_LINE } from "../src/lib/installer-quote-status.core";
import { OWNER_QUOTE_NOT_SENT_LINE, OWNER_QUOTE_PRICE_NEXT_LINE } from "../src/components/trade/OwnerQuoteCard";

const read = (p: string) => readFileSync(p, "utf8");
const AUTO_SEND = /we then send|office checks the quote|sends it to the owner|will send it to the owner/i;

describe("Complete → the boss enters the price → the quote goes out", () => {
  test("the status line and the quote card say the boss enters the price next (DRAFT)", () => {
    expect(PRESS_COMPLETE_LINE).toBe("Press Complete in Mitti when the Ready Check is finished. Your boss then enters the price, and we send the owner their quote.");
    expect(QUOTE_PRICE_NEXT_LINE).toBe("Your boss enters the price next, then we send the owner their quote.");
    expect(OWNER_QUOTE_NOT_SENT_LINE).toBe(PRESS_COMPLETE_LINE);
    expect(OWNER_QUOTE_PRICE_NEXT_LINE).toBe(QUOTE_PRICE_NEXT_LINE);
  });
  test("no trade-facing string in those files implies an automatic send on Complete", () => {
    for (const f of ["src/lib/installer-quote-status.core.ts", "src/components/trade/OwnerQuoteCard.tsx"]) {
      const strings = read(f).match(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g) ?? [];
      for (const s of strings) expect(s, `${f}: ${s}`).not.toMatch(AUTO_SEND);
    }
  });
  test("the lines Jo left alone are unchanged; the old Add a job electrician card wording is gone from the branch", () => {
    expect(read("src/lib/installer-home.core.ts")).toContain('next: "Next: press Complete in Mitti when the Ready Check is finished"');
    expect(read("src/lib/installer-job-summary.core.ts")).toContain("finish the Ready Check and press Complete in Mitti");
    for (const f of ["src/lib/add-job-flow.core.ts", "src/components/trade/add-job-flow.tsx"]) {
      const src = read(f);
      expect(src).not.toContain("ELECTRICIAN_CARD");
      expect(src).not.toContain("Who does the Pre Insulation Electrical Safety Assessment (PIESA) once the owner accepts the quote");
      expect(src).not.toContain("To use your own electrician, add them under My business first.");
    }
  });
});
