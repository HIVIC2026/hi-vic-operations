// Pure, approximate grouping of Victorian postcodes into planning regions.
// Used only to summarise Service Coverage at a glance — never for eligibility or assignment.

export type RegionId =
  | "mel_inner" | "mel_north" | "mel_west" | "mel_east" | "mel_south_east" | "mornington"
  | "geelong" | "south_west" | "ballarat" | "wimmera_mallee" | "bendigo_macedon" | "hume" | "gippsland" | "unknown";

export type RegionInfo = { id: RegionId; name: string; group: "Melbourne" | "Regional Victoria" | "Unplaced"; col: number; row: number };

// col/row place each region on a simple schematic map of Victoria (west → east, north → south).
export const REGIONS: RegionInfo[] = [
  { id: "wimmera_mallee", name: "Wimmera & Mallee", group: "Regional Victoria", col: 1, row: 1 },
  { id: "bendigo_macedon", name: "Bendigo & Macedon", group: "Regional Victoria", col: 3, row: 1 },
  { id: "hume", name: "Hume & North East", group: "Regional Victoria", col: 5, row: 1 },
  { id: "south_west", name: "South West", group: "Regional Victoria", col: 1, row: 2 },
  { id: "ballarat", name: "Ballarat & Central Highlands", group: "Regional Victoria", col: 2, row: 2 },
  { id: "mel_north", name: "Melbourne North", group: "Melbourne", col: 4, row: 2 },
  { id: "mel_west", name: "Melbourne West", group: "Melbourne", col: 3, row: 2 },
  { id: "mel_inner", name: "Inner Melbourne", group: "Melbourne", col: 4, row: 3 },
  { id: "mel_east", name: "Melbourne East", group: "Melbourne", col: 5, row: 2 },
  { id: "geelong", name: "Geelong & Surf Coast", group: "Regional Victoria", col: 2, row: 3 },
  { id: "mel_south_east", name: "Melbourne South East", group: "Melbourne", col: 5, row: 3 },
  { id: "gippsland", name: "Gippsland", group: "Regional Victoria", col: 6, row: 3 },
  { id: "mornington", name: "Mornington Peninsula", group: "Melbourne", col: 4, row: 4 },
  { id: "unknown", name: "Postcode missing or outside VIC", group: "Unplaced", col: 6, row: 4 },
];

const RANGES: Array<[number, number, RegionId]> = [
  [3000, 3010, "mel_inner"], [3050, 3054, "mel_inner"], [3065, 3068, "mel_inner"], [3121, 3121, "mel_inner"],
  [3141, 3143, "mel_inner"], [3181, 3182, "mel_inner"], [3205, 3207, "mel_inner"],
  [3011, 3049, "mel_west"], [3335, 3338, "mel_west"], [3427, 3429, "mel_west"],
  [3055, 3099, "mel_north"], [3750, 3755, "mel_north"],
  [3101, 3140, "mel_east"], [3144, 3159, "mel_east"], [3756, 3799, "mel_east"],
  [3160, 3204, "mel_south_east"], [3800, 3810, "mel_south_east"], [3975, 3978, "mel_south_east"],
  [3910, 3944, "mornington"],
  [3211, 3239, "geelong"], [3240, 3334, "south_west"],
  [3340, 3399, "ballarat"], [3460, 3469, "ballarat"],
  [3400, 3426, "wimmera_mallee"], [3480, 3549, "wimmera_mallee"],
  [3430, 3459, "bendigo_macedon"], [3470, 3479, "bendigo_macedon"], [3550, 3599, "bendigo_macedon"],
  [3600, 3749, "hume"],
  [3811, 3909, "gippsland"], [3945, 3999, "gippsland"],
];

export function regionForPostcode(postcode: string | null | undefined): RegionId {
  const n = Number(postcode?.trim());
  if (!Number.isInteger(n)) return "unknown";
  return RANGES.find(([from, to]) => n >= from && n <= to)?.[2] ?? "unknown";
}

type AreaLike = {
  suburb: string | null; postcode: string | null; enquiryCount: number;
  overall: string;
  rec: { matches: Array<{ id: string; name: string }> };
  installer: { matches: Array<{ id: string; name: string }> };
};

export type RegionSummary<A extends AreaLike> = RegionInfo & {
  enquiryCount: number; areas: A[];
  recTeams: Array<{ id: string; name: string }>; installerTeams: Array<{ id: string; name: string }>;
  coveredAreas: number; state: "covered" | "partial" | "gap" | "empty";
};

export function groupAreasByRegion<A extends AreaLike>(areas: A[]): RegionSummary<A>[] {
  return REGIONS.map((region) => {
    const list = areas.filter((area) => regionForPostcode(area.postcode) === region.id)
      .sort((a, b) => b.enquiryCount - a.enquiryCount || (a.suburb ?? "").localeCompare(b.suburb ?? ""));
    const uniq = (pick: (a: A) => Array<{ id: string; name: string }>) => [...new Map(list.flatMap(pick).map((t) => [t.id, t])).values()];
    const recTeams = uniq((a) => a.rec?.matches ?? []);
    const installerTeams = uniq((a) => a.installer?.matches ?? []);
    const coveredAreas = list.filter((a) => a.overall === "serviceable").length;
    const enquiryCount = list.reduce((sum, a) => sum + a.enquiryCount, 0);
    const state = !list.length ? "empty" : coveredAreas === list.length ? "covered" : recTeams.length || installerTeams.length ? "partial" : "gap";
    return { ...region, areas: list, enquiryCount, recTeams, installerTeams, coveredAreas, state };
  });
}
