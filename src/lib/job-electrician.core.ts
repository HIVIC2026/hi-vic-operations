// "Your electrician or ours?" on Add one job and each Upload jobs card (Jo, 7 Oct 2026). Pure wording + rules only.

/** Required owner-consent tick (Jo's exact wording). */
/** Onsite + later Ready Check consent wording (Jo, 8 Oct 2026). */
export const READY_CHECK_CONTACT_PERMISSION = "The owner has given Home Insulation Victoria permission to contact them for the eligibility assessment.";
export const OWNER_CONTACT_PERMISSION = "The owner has given Home Insulation Victoria permission to contact them.";

/** Note under the electrician choice (wording approved by Jo, 7 Oct 2026). */
export const SAFETY_CHECK_NOTE =
  "Once the owner accepts the quote and pays the $349 Pre Insulation Electrical Safety Assessment (PIESA), they'll choose 3 days and times that suit them. These go to the electrician to accept, and the booking updates in the job automatically so everyone can see it.";

export const ELECTRICIAN_INVITED_LABEL = "Electrician invited – waiting to onboard";
export const HIV_ARRANGES_LABEL = "Home Insulation Victoria arranges";

/** Never repeat a sent or uncertain attempt. Only a nomination with no delivery attempt can issue its first invitation. */
export function existingElectricianInviteBlocker(x: { status: string; sentAt: string | null; attempted: boolean; issuedAt?: string | null }): string | null {
  if (x.sentAt || x.status === "invited") return "The invitation has already been sent. Waiting for the electrician to sign up.";
  if (x.attempted || x.issuedAt || x.status !== "invite_pending_comms") return "This electrician is already added, but invitation delivery needs an office check before another send.";
  return null;
}

export type ElectricianPlan = { mode: "mine" | "hivic" | "job_by_job"; nomination_id?: string | null; business_id?: string | null };

/** "My electrician" needs a pick; the other choices never block. */
export function electricianPlanBlocker(p: ElectricianPlan | null | undefined): string | null {
  if (!p || p.mode !== "mine") return null;
  return p.business_id || p.nomination_id ? null : "Choose your electrician";
}

/** The usual electrician is preselected: the Main one first, otherwise the first approved one. */
export function usualElectrician<T extends { businessId?: string; primary?: boolean }>(approved: T[]): T | null {
  return approved.find((a) => a.primary) ?? approved[0] ?? null;
}

/** New electrician details: name, business, mobile and email are all needed so we can email the invite. */
export function newElectricianProblems(d: { name: string; business: string; mobile: string; email: string }): string[] {
  const out: string[] = [];
  if (d.name.trim().length < 2) out.push("Add their name");
  if (d.business.trim().length < 2) out.push("Add their business");
  if (d.mobile.replace(/\D/g, "").length < 8) out.push("Add their mobile");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) out.push("Add their email");
  return out;
}

/** What the job shows for the electrician. */
export function jobElectricianLabel(s: { choice: string | null; assignedName?: string | null; chosenName?: string | null; invitedName?: string | null }): string {
  if (s.assignedName) return `Electrician: ${s.assignedName}`;
  if (s.invitedName) return ELECTRICIAN_INVITED_LABEL;
  if (s.chosenName) return `Your electrician: ${s.chosenName}`;
  return HIV_ARRANGES_LABEL;
}

/** Invite email to the installer's new electrician (a one-off partner email: follows the manual-email rule). */
export function electricianInviteEmail(x: { electricianName: string; installerName: string; link: string }) {
  return {
    subject: `${x.installerName} has invited you to Home Insulation Victoria`,
    message: [
      `${x.installerName} would like you to do the PIESAs on their Home Insulation Victoria jobs.`,
      `To get started, fill in the electrician application here: ${x.link}`,
      "Once you're approved, their jobs come straight to you.",
    ].join("\n\n"),
  };
}

/** Job-level choice decides who is offered the owner's safety-check times first. */
export function firstOfferedElectrician(jobChoiceBusinessId: string | null, relationshipPreferred: string[]): Set<string> {
  return new Set(jobChoiceBusinessId ? [jobChoiceBusinessId] : relationshipPreferred);
}

/** Photos or a measurement mean the installer has visited. */
export function visitedFromEvidence(x: { files: { name: string; type?: string | null }[]; measuredArea?: number | string | null | undefined }): boolean {
  const photo = x.files.some((f) => /^image\//.test(f.type ?? "") || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
  const area = Number(x.measuredArea);
  return photo || (Number.isFinite(area) && area > 0);
}
