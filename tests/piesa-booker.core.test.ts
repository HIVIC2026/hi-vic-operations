import { describe, expect, test } from "bun:test";
import { bookerNotices, piesaBookerOf, PIESA_BOOKER_LABEL } from "@/lib/piesa-booker.core";

describe("piesaBookerOf", () => {
  test("unknown or missing falls back to office", () => {
    expect(piesaBookerOf(null)).toBe("office");
    expect(piesaBookerOf(undefined)).toBe("office");
    expect(piesaBookerOf("x")).toBe("office");
    expect(piesaBookerOf(3)).toBe("office");
  });
  test("known values pass through", () => {
    expect(piesaBookerOf("either")).toBe("either");
    expect(piesaBookerOf("electrician")).toBe("electrician");
    expect(piesaBookerOf("office")).toBe("office");
  });
});

describe("bookerNotices", () => {
  test("office: email the office only", () => expect(bookerNotices("office")).toEqual({ textElectrician: false, emailOffice: true }));
  test("electrician: text the electrician and email the office", () => expect(bookerNotices("electrician")).toEqual({ textElectrician: true, emailOffice: true }));
  test("either: text the electrician and email the office", () => expect(bookerNotices("either")).toEqual({ textElectrician: true, emailOffice: true }));
});

test("labels are the approved wording", () => {
  expect(PIESA_BOOKER_LABEL).toEqual({ office: "Our office books the safety check", electrician: "Our electrician books it", either: "Either — whoever goes first" });
});
