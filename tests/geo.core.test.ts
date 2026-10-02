import { describe, expect, test } from "bun:test";
import { checkPhotoLocation, distanceM, propertyPoint } from "../src/lib/geo.core";

const home = propertyPoint([145.221627, -37.874566])!;
describe("photo location rule", () => {
  test("parses stored [lng, lat]", () => { expect(home).toEqual({ lat: -37.874566, lng: 145.221627 }); expect(propertyPoint("x")).toBeNull(); });
  test("refuses a photo with no location", () => expect(checkPhotoLocation({ mime: "image/jpeg", fix: null, property: home, maxM: 150, isOffice: false }).ok).toBe(false));
  test("refuses a photo taken too far away", () => {
    const r = checkPhotoLocation({ mime: "image/jpeg", fix: { lat: -37.88, lng: 145.23 }, property: home, maxM: 150, isOffice: false });
    expect(r.ok).toBe(false);
  });
  test("accepts a photo at the property", () => {
    const r = checkPhotoLocation({ mime: "video/mp4", fix: { lat: -37.8746, lng: 145.2217, accuracyM: 10 }, property: home, maxM: 150, isOffice: false });
    expect(r.ok && r.distanceM! < 20).toBe(true);
  });
  test("refuses when the property has no location on file", () => expect(checkPhotoLocation({ mime: "image/png", fix: { lat: 1, lng: 1 }, property: null, maxM: 150, isOffice: false }).ok).toBe(false));
  test("PDFs and office uploads are exempt", () => {
    expect(checkPhotoLocation({ mime: "application/pdf", fix: null, property: null, maxM: 150, isOffice: false }).ok).toBe(true);
    expect(checkPhotoLocation({ mime: "image/jpeg", fix: null, property: null, maxM: 150, isOffice: true }).ok).toBe(true);
  });
  test("distance sanity", () => expect(Math.round(distanceM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) / 1000)).toBe(111));
});
