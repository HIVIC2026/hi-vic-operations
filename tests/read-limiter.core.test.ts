import { describe, expect, it } from "bun:test";
import { createReadGate } from "../src/lib/read-limiter.core";

describe("paced office reads (speed, 7 Nov)", () => {
  it("never runs more than the limit at once and returns every result in order", async () => {
    const gate = createReadGate(3);
    let active = 0, peak = 0;
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => gate(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return i;
    })));
    expect(peak).toBe(3);
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("passes a failed read's error through and keeps going", async () => {
    const gate = createReadGate(1);
    await expect(gate(() => Promise.reject(new Error("Could not load quotes")))).rejects.toThrow("Could not load quotes");
    await expect(gate(() => Promise.resolve("next"))).resolves.toBe("next");
  });
});
