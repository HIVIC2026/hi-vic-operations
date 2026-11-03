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

// ---- "My electricians" screen rules (pure; the component in components/trade/my-electricians.tsx only renders these) ----

export const ANSWER_WORKCOVER = "Answer the WorkCover question";

/** The chip on each row of the installer's list. Plain words, one line. */
export function statusChip(status: MyElectricianStatus, reason: string | null): { text: string; tone: "green" | "blue" | "pink" } {
  if (status === "approved") return { text: "Approved", tone: "green" };
  if (status === "waiting") return { text: "Waiting for approval", tone: "blue" };
  if (status === "expired") return { text: "Expired — update their documents", tone: "pink" };
  return { text: `Not approved: ${reason?.trim() || "ask Home Insulation Victoria"}`, tone: "pink" };
}

/** What the boss has typed and picked, before anything is uploaded. Files are only "picked or not" here. */
export type ElectricianDraft = {
  name: string; email: string; mobile: string; recNumber: string;
  licenceNumber: string; licenceExpiry: string; licenceFile: { name: string } | null;
  plFile: { name: string } | null; plAmount: string; plExpiry: string;
  employs: "" | "yes" | "no"; workcoverFile: { name: string } | null; workcoverExpiry: string; soleTraderTick: boolean;
};

/** Which field each plain problem message sits under, so it shows right where the boss needs to look. */
export const PROBLEM_FIELD: Record<string, keyof ElectricianDraft> = {
  "Add their name": "name", "Add their email": "email", "Add their mobile": "mobile", "Add their REC number": "recNumber",
  "Add their licence number": "licenceNumber", "Licence expiry must be in the future": "licenceExpiry", "Add a photo of their licence": "licenceFile",
  "Add the public liability certificate": "plFile", "Public liability must be at least $5 million": "plAmount", "Public liability expiry must be in the future": "plExpiry",
  "Add the WorkCover certificate": "workcoverFile", "WorkCover expiry must be in the future": "workcoverExpiry",
  "Tick that they're a sole trader with no staff": "soleTraderTick", [ANSWER_WORKCOVER]: "employs",
};

/** The draft as the server wants it, with the given stored file paths. */
export function draftToInput(d: ElectricianDraft, paths: { licence: string; pl: string; workcover: string }): AddElectricianInput {
  return {
    name: d.name, email: d.email, mobile: d.mobile, recNumber: d.recNumber,
    licenceNumber: d.licenceNumber, licenceExpiry: d.licenceExpiry, licenceFilePath: paths.licence,
    plFilePath: paths.pl, plAmount: Number(String(d.plAmount).replace(/[^\d.]/g, "")) || 0, plExpiry: d.plExpiry,
    employsAnyone: d.employs === "yes", workcoverFilePath: d.employs === "yes" ? paths.workcover || null : null,
    workcoverExpiry: d.employs === "yes" ? d.workcoverExpiry || null : null, soleTraderTick: d.employs === "no" && d.soleTraderTick,
  };
}

/** The same check the server runs, on the draft, so the boss sees every gap before anything is uploaded. */
export function draftProblems(d: ElectricianDraft, today: string): string[] {
  const picked = { licence: d.licenceFile ? "picked" : "", pl: d.plFile ? "picked" : "", workcover: d.workcoverFile ? "picked" : "" };
  // The WorkCover question comes first; until it's answered the WorkCover rules can't apply, so they're skipped (not faked).
  if (d.employs === "") return [ANSWER_WORKCOVER, ...addElectricianProblems({ ...draftToInput(d, picked), employsAnyone: false, soleTraderTick: true }, today)];
  return addElectricianProblems(draftToInput(d, picked), today);
}
