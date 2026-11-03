import { describe, expect, test } from "bun:test";
import { SWAP_NOT_LINKED, SWAP_NOT_ONBOARDED, SWAP_PIESA_DONE, SWAP_SAME, oldElectricianEmail, swapProblem } from "../src/lib/electrician-swap.core";

const ok = { piesaDone: false, linkedActive: true, onboarded: true, same: false };
describe("swapProblem", () => {
  test("fine when nothing is wrong", () => expect(swapProblem(ok)).toBeNull());
  test("the exact reasons", () => {
    expect(SWAP_PIESA_DONE).toBe("The safety check is done, so the electrician can't change");
    expect(SWAP_NOT_LINKED).toBe("That electrician isn't linked to your business");
    expect(SWAP_NOT_ONBOARDED).toBe("That electrician hasn't finished signing up");
    expect(SWAP_SAME).toBe("That's already the electrician");
  });
  test.each([
    [{ piesaDone: true }, SWAP_PIESA_DONE],
    [{ linkedActive: false }, SWAP_NOT_LINKED],
    [{ onboarded: false }, SWAP_NOT_ONBOARDED],
    [{ same: true }, SWAP_SAME],
    [{ piesaDone: true, linkedActive: false, onboarded: false, same: true }, SWAP_PIESA_DONE],
    [{ linkedActive: false, onboarded: false, same: true }, SWAP_NOT_LINKED],
    [{ onboarded: false, same: true }, SWAP_NOT_ONBOARDED],
  ])("%j -> %s", (o, want) => expect(swapProblem({ ...ok, ...o })).toBe(want));
});
describe("oldElectricianEmail", () => {
  test("subject names the address", () => expect(oldElectricianEmail({ address: "1 Example St" }).subject).toBe("You're no longer on 1 Example St"));
});

import { needsCandidates } from "../src/lib/office-needs.core";
describe("office Needs: form not moved", () => {
  test("shows 'Move the Mitti safety check form to {new electrician}'", () => {
    const c = needsCandidates({ jobId: "j", ownJobSwapFormNotMoved: { at: "2026-11-03T00:00:00Z", electrician: "New Sparky" } } as never, Date.parse("2026-11-03T01:00:00Z"));
    expect(c.find((x) => x.kind === "own_job_swap_form_not_moved")?.line).toBe("Move the Mitti safety check form to New Sparky");
  });
});
