// Installer redesign menu (spec v2 §4.1): which menu items a trade user sees and which is active.
// Pure rules; TradeShell draws them.

export type TradeMenuKey = "action" | "calendar" | "jobs" | "money" | "business";
export type TradeMenuItem = { key: TradeMenuKey; label: string; to: string; on: boolean; count: number | null };

/** Screens that are built and switched on. Phase 3 turns Calendar and Jobs on. */
export const RELEASED_SCREENS: { calendar: boolean; jobs: boolean } = { calendar: false, jobs: false };

/** Action items owns the home, offers, day pages and job pages. */
function isAction(path: string): boolean {
  return path === "/field" || path === "/field/" || path.startsWith("/field/offer") || path.startsWith("/field/day") || /^\/field\/[0-9a-f-]{36}/.test(path);
}

export function tradeMenu(i: { path: string; installer: boolean; admin: boolean; money: boolean; actionCount: number; released?: { calendar: boolean; jobs: boolean } }): { items: TradeMenuItem[]; addJob: boolean } {
  const released = i.released ?? RELEASED_SCREENS;
  const p = i.path;
  const all: (TradeMenuItem & { show: boolean })[] = [
    { key: "action", label: "Action items", to: "/field", on: isAction(p), count: i.actionCount > 0 ? i.actionCount : null, show: true },
    { key: "calendar", label: "Calendar", to: "/field/calendar", on: p.startsWith("/field/calendar"), count: null, show: released.calendar },
    { key: "jobs", label: "Jobs", to: "/field/jobs", on: p.startsWith("/field/jobs"), count: null, show: released.jobs },
    { key: "money", label: "Money", to: "/field/money", on: p.startsWith("/field/money"), count: null, show: i.money },
    { key: "business", label: "My business", to: "/field/business", on: p.startsWith("/field/business"), count: null, show: i.admin },
  ];
  return { items: all.filter((x) => x.show).map(({ show: _s, ...x }) => x), addJob: i.installer && i.admin };
}
