// Pure rules for who can do what in the installer portal (new job flow part 5, task 1). No I/O.
// Boss = the business admin. Office = a person the boss added to work the portal for the business.
// Lead Installers, Crew and Electricians never log in (their jobs come to them by text).

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

/** Boss always sees Money; Office only if the boss turned "Can see Money" on for them. */
export function seesMoney(r: TradeRole, canSeeMoney: boolean): boolean {
  return r === "boss" || (r === "office" && canSeeMoney);
}

/** DRAFT wording (Jo hasn't seen it): shown if a Lead Installer, Crew member or Electrician somehow reaches the portal. */
export const NO_LOGIN_NEEDED = "You don't need to sign in. Your jobs come to you by text.";
