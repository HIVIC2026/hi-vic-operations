import { expect, test } from "bun:test";
import { SUPERSEDED_USE_REASSESSMENT } from "../src/lib/repeat-piesa.core";

// Jo 29 Oct 2026: there is no manual reassessment form any more; booking the repeat PIESA opens a new Mitti form.
test("reopened job tells the installer to book the repeat PIESA", () => {
  expect(SUPERSEDED_USE_REASSESSMENT).toBe("This job was reopened, so the earlier PIESA no longer counts. Book the repeat PIESA. It opens a new Mitti form.");
  expect(SUPERSEDED_USE_REASSESSMENT).not.toContain("safety check");
});
