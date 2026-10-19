import { expect, test } from "bun:test";
import { readPng, writePng } from "../src/lib/png-lite.core";
import { renderHeaderArt, campaignHeroSpec } from "../src/lib/email-hero.core";
test("PNG round-trips pixels exactly", () => {
  const data = new Uint8Array(3 * 2 * 4).map((_, i) => (i * 37) & 255);
  expect(readPng(writePng({ width: 3, height: 2, data })).data).toEqual(data);
});
test("email header art renders without pngjs/node zlib", () => {
  const png = renderHeaderArt(campaignHeroSpec("likely", "Jo", "$1,470"));
  expect([...png.subarray(0, 4)]).toEqual([137, 80, 78, 71]);
  expect(readPng(png).width).toBeGreaterThan(300);
});
