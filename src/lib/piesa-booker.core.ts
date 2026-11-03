/** Who books the safety check (PIESA) for an installer's own jobs. Pure; no I/O. Unknown or missing is always "office". */
export type PiesaBooker = "office" | "electrician" | "either";

export const PIESA_BOOKERS: readonly PiesaBooker[] = ["office", "electrician", "either"];

export const PIESA_BOOKER_LABEL: Record<PiesaBooker, string> = {
  office: "Our office books the safety check",
  electrician: "Our electrician books it",
  either: "Either — whoever goes first",
};

export function piesaBookerOf(raw: unknown): PiesaBooker {
  return raw === "electrician" || raw === "either" || raw === "office" ? raw : "office";
}

/** The office is always emailed so it knows the job moved; only electrician/either text the electrician. */
export function bookerNotices(b: PiesaBooker): { textElectrician: boolean; emailOffice: boolean } {
  return { textElectrician: b !== "office", emailOffice: true };
}
