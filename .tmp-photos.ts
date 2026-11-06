const id = "74a497a3-53a9-49bd-8b1a-23164c3514ff";
const { inHouseFactsFor } = await import("@/lib/installer-paid-electricians.server");
const core = await import("@/lib/pilot.core").catch(() => null);
const facts = await inHouseFactsFor(id);
console.log(JSON.stringify(facts, null, 1).slice(0, 1500));
const mod: any = await import("@/lib/in-house-partner.core").catch(() => ({}));
const f = mod.inHouseEnableBlockers ?? (core as any)?.inHouseEnableBlockers;
console.log("blockers:", f ? f(facts) : "fn not found");
process.exit(0);
