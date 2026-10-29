// Jo's standard answers (29 Oct 2026, steps 2-4 spec §2a/2c). Pure — no I/O.
// Every AI draft gets the active answers as its business rules. This seed is the list until Jo edits her own.
// Pre-release owners get these too, so nothing here may give a date, timeframe or speed (aiPreReleaseViolations).

import { OWNER_HIGHER_R_INC_PER_M2 } from "./hiv-quote.core";

export type AiAnswer = { topic: string; answer: string };

const ELECTRICIAN_SIGN_UP = "https://portal.homeinsulationvictoria.com.au/electrician-onboarding";

export const AI_SEED_ANSWERS: AiAnswer[] = [
  // Today's standing answers (27 Oct 2026), updated where the spec changes them.
  { topic: "Ceilings only", answer: "We only do ceiling insulation (no underfloor or walls)." },
  { topic: "Batts, not blow-in", answer: "Our quotes are for R5.0 batts, not blow-in insulation, so no holes are cut in the ceiling." },
  { topic: "R6.0/R7.0", answer: `R6.0 and R7.0 are available. If they ask about R6.0 or R7.0, give the revised price and rebate for their ceiling size, worked out from the job facts at $${OWNER_HIGHER_R_INC_PER_M2["R6.0"]}/m² for R6.0 and $${OWNER_HIGHER_R_INC_PER_M2["R7.0"]}/m² for R7.0, and tell them to tell the installer they want it at the free Ready Check.` },
  { topic: "Old insulation removal", answer: "Old insulation is removed only where needed, at $15/m²; the installer checks how much at the Ready Check." },
  { topic: "Extras", answer: "Extras like cleaning the roof cavity: the installer can quote them at the Ready Check." },
  { topic: "Free Ready Check", answer: "The free Ready Check: a certified installer comes to the home, measures the ceilings, checks the existing insulation and confirms the job, then the owner gets their final quote. They see the exact price before agreeing to anything." },
  { topic: "Existing insulation and the rebate", answer: "The rebate needs any existing insulation to be below R2.0, and it has to be checked at the Ready Check — age alone isn't enough. Owners never need to go into the roof or send photos." },
  { topic: "Order spots are released", answer: "Spots are released in the order they were saved, so we can't give install dates before that. When it's their turn an installer texts and emails a few times for the Ready Check." },
  { topic: "Steps after the quote", answer: "After they accept the quote, a licensed electrician does a safety check before any insulation goes in, then the installer puts the insulation in. We look after all the paperwork and the rebate." },
  { topic: "What the price includes", answer: "The price includes: the free Ready Check; R5.0 batts supplied and installed by a certified installer; the electrician's safety check ($349); our Accredited Person fee for the paperwork and rebate claim ($349). Electrical upgrades aren't included — if needed they get a separate quote first." },
  { topic: "Own electrician for electrical upgrades", answer: `An owner's own electrician can do the electrical upgrades if they show a REC (Registered Electrical Contractor) licence and $5 million public liability insurance, which we approve. They must sign up with us as an electrician first. They do the work and get the certificate of electrical safety (COES) and our forms back to us before the 30 days run out; otherwise a new electrical safety check (PIESA) is needed ($349). All forms go through our system so the rebate can be claimed. Sign-up link: ${ELECTRICIAN_SIGN_UP}` },

  // New answers (spec 2c).
  { topic: "Payment plan", answer: "We don't offer a payment plan. Say so with empathy: we pay the installer, the electrician and the products as each step happens. The payments are already spread: $349 for the electrical safety check (PIESA), 10% to book the install, and the rest on install day. Their spot stays saved." },
  { topic: "Low income / concession", answer: "Be very warm. Say sorry it's hard. The rebate is the same for every home and is the biggest help we can give. There is no extra discount and they don't need to send a concession card. Their spot stays saved and there is no pressure." },
  { topic: "Cheaper quote / scam / too expensive", answer: "Explain the value and why other quotes can be cheaper. What our price covers: an electrical safety check (PIESA) for wiring and downlight fire risk; CII-certified installers and REC electricians, with their licences and $5 million insurance checked; an approved product that meets the Australian standard; and our Accredited Person handles the evidence and claims the rebate upfront for them. Cheaper quotes often skip the PIESA, use uncertified workers, or can't give the rebate. They're welcome to compare, with no obligation. Never name the program; \"Accredited Person\" is fine." },
  { topic: "Existing electrical certificate", answer: "An existing electrical certificate can't be used. Under the government's rebate rules the electrical safety check (PIESA) must be done by an electrician working under a REC, whose $5 million insurance we approve, inside the 30-day window of the install." },
  { topic: "Garage / flat roof / cathedral ceiling / no manhole", answer: "We can't do garages, flat roofs, cathedral ceilings or homes with no manhole. Say so kindly." },
  { topic: "Underfloor / walls", answer: "We only do ceilings. For underfloor, the installer can quote it directly at the free Ready Check, outside our system." },
  { topic: "Cancel / not going ahead", answer: "If they say they're cancelling or not going ahead, reply with a short, kind note: we've closed it, and they can reply if they change their mind. A plain \"thanks\" still needs no reply." },
  { topic: "Rental / landlord", answer: "Rentals qualify. It's the same steps and the same rebate." },
  { topic: "Paying by card", answer: "They can pay by card for the $349 electrical safety check (PIESA) and the 10% deposit. The balance is by bank transfer or PayID." },
  { topic: "Home on install day", answer: "No one needs to be home on install day if the crew can get in. It takes about 4 hours." },
  { topic: "Other languages", answer: "If they write in another language, reply in simple English." },
  { topic: "Tenant", answer: "If a tenant writes, we're happy to help, but the owner needs to give permission." },
  { topic: "Installer access", answer: "The batts go in through the manhole. No roof access is needed." },

  // Standing wording rules, every reply.
  { topic: "Wording", answer: "In every reply, the first time you mention it, write \"electrical safety check (PIESA)\". Anything that is required is \"the government's rebate rules\", never \"our rule\". Say \"electrical upgrades\", never \"fixes\". Say \"rebate\" and never use scheme words." },
];

/** The answers as prompt lines. No rows saved (null/empty) → the seed. Blank answers are left out. */
export function rulesFromAnswers(rows: AiAnswer[] | null): string[] {
  const use = rows && rows.length ? rows : AI_SEED_ANSWERS;
  return use.map((r) => r.answer.trim()).filter(Boolean);
}
