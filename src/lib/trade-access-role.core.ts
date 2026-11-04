// Pure rules for who can do what in the installer portal (new job flow part 5, task 1). No I/O.
// Boss = the business admin. Office = a person the boss added to work the portal for the business.
// Lead Installers, Crew and Electricians never log in (their jobs come to them by text).
// Office role CONFIRMED by Jo 4 Nov 2026 13:50: Office people see every job and can book visits like the boss; Money only
// with the boss's "Can see Money" switch; Team and business settings stay boss-only.

export type TradeRole = "boss" | "office" | "none";

/** The sign-in row decides. `workerTradeRole` is only context for callers; a worker row never grants a role by itself. */
export function tradeRoleOf(m: { memberRole: string | null; workerTradeRole: string | null }): TradeRole {
  if (m.memberRole === "business_admin") return "boss";
  if (m.memberRole === "office") return "office";
  return "none";
}

/** Boss and Office see and enter prices. */
export function seesPrices(r: TradeRole): boolean {
  return r === "boss" || r === "office";
}

/** Fix wave C2 (3 Nov 2026): Boss and Office see and work every job assigned to the business (reads and bookings);
 *  Money, Team and business settings keep their own rules below. */
export function seesBusinessJobs(r: TradeRole): boolean {
  return r === "boss" || r === "office";
}

/** Boss always sees Money; Office only if the boss turned "Can see Money" on for them. */
export function seesMoney(r: TradeRole, canSeeMoney: boolean): boolean {
  return r === "boss" || (r === "office" && canSeeMoney);
}

/** The no-login page shows only when the sign-in has no active business membership at all (any role, even a legacy 'member', keeps the normal layout). */
export function noLoginFor(activeMemberships: { member_role: string | null }[]): boolean {
  return activeMemberships.length === 0;
}

/** DRAFT wording (Jo hasn't seen it): shown if a Lead Installer, Crew member or Electrician somehow reaches the portal. */
export const NO_LOGIN_NEEDED = "You don't need to sign in. Your jobs come to you by text.";
