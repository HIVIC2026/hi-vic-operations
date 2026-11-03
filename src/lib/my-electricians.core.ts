// Part 2b: installers add their own electricians. Pure rules only: what must be filled in, what the installer's list
// shows, and what the office must see before approving. No reads, no writes (writes live in my-electricians.server.ts).

export const MIN_PUBLIC_LIABILITY = 5_000_000;

export type AddElectricianInput = {
  name: string; email: string; mobile: string; recNumber: string;
  licenceNumber: string; licenceExpiry: string /* YYYY-MM-DD */; licenceFilePath: string;
  plFilePath: string; plAmount: number; plExpiry: string;
  employsAnyone: boolean; workcoverFilePath?: string | null; workcoverExpiry?: string | null; soleTraderTick?: boolean;
};

const blank = (s: string | null | undefined) => !String(s ?? "").trim();
/** YYYY-MM-DD strings compare correctly as text. "In the future" = after today. */
const inFuture = (d: string | null | undefined, today: string) => !!d && d > today;
const lapsed = (d: string | null | undefined, today: string) => !d || d < today; // missing counts as lapsed (fail closed)

export function addElectricianProblems(i: AddElectricianInput, today: string): string[] {
  const p: string[] = [];
  if (blank(i.name)) p.push("Add their name");
  if (blank(i.email)) p.push("Add their email");
  if (blank(i.mobile)) p.push("Add their mobile");
  if (blank(i.recNumber)) p.push("Add their REC number");
  if (blank(i.licenceNumber)) p.push("Add their licence number");
  if (!inFuture(i.licenceExpiry, today)) p.push("Licence expiry must be in the future");
  if (blank(i.licenceFilePath)) p.push("Add a photo of their licence");
  if (blank(i.plFilePath)) p.push("Add the public liability certificate");
  if (!(Number(i.plAmount) >= MIN_PUBLIC_LIABILITY)) p.push("Public liability must be at least $5 million");
  if (!inFuture(i.plExpiry, today)) p.push("Public liability expiry must be in the future");
  if (i.employsAnyone) {
    if (blank(i.workcoverFilePath)) p.push("Add the WorkCover certificate");
    if (!inFuture(i.workcoverExpiry, today)) p.push("WorkCover expiry must be in the future");
  } else if (!i.soleTraderTick) p.push("Tick that they're a sole trader with no staff");
  return p;
}

export type MyElectricianStatus = "waiting" | "approved" | "expired" | "not_approved";
export type StatusFacts = {
  onboardingStatus: string | null; workerApproval: string | null; rejectedReason: string | null;
  licenceExpiry: string | null; plExpiry: string | null; workcoverExpiry: string | null; workcoverExempt: boolean; today: string;
};

/** What the installer's "My electricians" list shows. Rejected wins; approved electricians whose paperwork has lapsed show "expired". */
export function myElectricianStatus(f: StatusFacts): MyElectricianStatus {
  if (!blank(f.rejectedReason)) return "not_approved";
  if (f.onboardingStatus !== "approved" || f.workerApproval !== "approved") return "waiting";
  if (lapsed(f.licenceExpiry, f.today) || lapsed(f.plExpiry, f.today)) return "expired";
  if (!f.workcoverExempt && lapsed(f.workcoverExpiry, f.today)) return "expired";
  return "approved";
}

export type ChecklistFacts = {
  recNumber: string | null; licenceNumber: string | null; licenceExpiry: string | null; licenceFilePresent: boolean;
  plAmount: number | null; plExpiry: string | null; plFilePresent: boolean;
  workcoverExpiry: string | null; workcoverFilePresent: boolean; workcoverExempt: boolean; today: string;
};

/** For the office: every reason this electrician can't be approved yet. Empty = nothing blocks approval. Hard block, no override. */
export function approveChecklist(f: ChecklistFacts): string[] {
  const p: string[] = [];
  if (blank(f.recNumber)) p.push("REC number is missing");
  if (blank(f.licenceNumber)) p.push("Licence number is missing");
  if (!f.licenceFilePresent) p.push("Licence photo is missing");
  if (!f.licenceExpiry) p.push("Licence expiry is missing"); else if (f.licenceExpiry < f.today) p.push("Licence has expired");
  if (!f.plFilePresent) p.push("Public liability certificate is missing");
  if (!(Number(f.plAmount) >= MIN_PUBLIC_LIABILITY)) p.push("Public liability is under $5 million");
  if (!f.plExpiry) p.push("Public liability expiry is missing"); else if (f.plExpiry < f.today) p.push("Public liability has expired");
  if (!f.workcoverExempt) {
    if (!f.workcoverFilePresent) p.push("WorkCover certificate is missing");
    if (!f.workcoverExpiry) p.push("WorkCover expiry is missing"); else if (f.workcoverExpiry < f.today) p.push("WorkCover has expired");
  }
  return p;
}
