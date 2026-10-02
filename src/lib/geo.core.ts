// Photo/video location rule (Jo, 2026-10-02): onsite evidence must carry a location taken at the property.
// PURE. Missing location or too far away = refused; the worker retakes it onsite.
export type Fix = { lat: number; lng: number; accuracyM?: number | null | undefined } | null | undefined;
export type PropertyPoint = { lat: number; lng: number } | null;

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Stored property fact `coordinates` is [lng, lat]. Anything else → null (never guessed). */
export function propertyPoint(value: unknown): PropertyPoint {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [lng, lat] = value.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat!) > 90 || Math.abs(lng!) > 180) return null;
  return { lat: lat!, lng: lng! };
}

export const needsLocation = (mime: string) => /^(image|video)\//.test(mime);

export type LocationCheck = { ok: true; distanceM: number | null; exempt: boolean } | { ok: false; reason: string };

/** Office staff uploads are exempt (recorded as office uploads). PDFs/documents are exempt. */
export function checkPhotoLocation(i: { mime: string; fix: Fix; property: PropertyPoint; maxM: number; isOffice: boolean }): LocationCheck {
  if (!needsLocation(i.mime) || i.isOffice) return { ok: true, distanceM: null, exempt: true };
  const f = i.fix;
  if (!f || !Number.isFinite(f.lat) || !Number.isFinite(f.lng)) return { ok: false, reason: "This photo has no location. Turn on location for the portal and take it at the property." };
  if (!i.property) return { ok: false, reason: "We don't have this property's location on file yet, so the photo can't be checked. Ask the office to confirm the address." };
  const d = distanceM(f, i.property);
  const slack = Math.min(Math.max(f.accuracyM ?? 0, 0), 100);
  if (d - slack > i.maxM) return { ok: false, reason: `This photo was taken about ${Math.round(d)} m from the property (limit ${i.maxM} m). Please retake it at the property.` };
  return { ok: true, distanceM: Math.round(d), exempt: false };
}
