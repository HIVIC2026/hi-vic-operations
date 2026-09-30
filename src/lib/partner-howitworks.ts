// Shared "How we work with you" wording for trade partners (installers and electricians).
// Single source of truth: onboarding cards, portal help page and FAQ all render from here.
// Fees come from settings at render time where marked; never hard-code amounts elsewhere.

export const APP_PITCH =
  "Our app walks you through every photo and reading needed, in order, so each job is complete on the day — no revisits, no lost VEECs.";

export type HowStep = { n: number; title: string; body: string };

export const OPTION_OWN_CUSTOMER: { title: string; tagline: string; steps: HowStep[]; footer: string } = {
  title: "You bring the customer",
  tagline: "Your customer, your price — we handle the compliance and the paperwork.",
  steps: [
    { n: 1, title: "Submit the job", body: "Owner name, address, contact, your quote, and any measurements and photos you already have — all in the portal." },
    { n: 2, title: "Measure-up", body: "If your measure-up and photos are complete, nothing is repeated. If they're partial, you only capture what's missing. If you have none, you do the free Ready Check yourself using our app." },
    { n: 3, title: "We contact the owner", body: "As the Accredited Person, the law makes us responsible for the owner's eligibility, consent, the electrical safety check and the VEEC assignment. We must hear it from the owner directly — we can't take it second-hand." },
    { n: 4, title: "Electrical safety check (PIESA)", body: "Your electrician at your agreed onboarding price, or ours at $349 inc GST." },
    { n: 5, title: "One co-branded quote", body: "Your branding plus ours, showing your price, the safety check, our Accredited Person fee and the VEU discount. The owner e-signs it in their portal." },
    { n: 6, title: "We invoice and chase payment", body: "Including the 50% deposit before any work is scheduled. You never chase money." },
    { n: 7, title: "You install", body: "Submit your photos and installer declaration through the app the same day. We do the Accredited Person review and lodge the VEECs." },
    { n: 8, title: "You get paid", body: "Your quoted price, once the owner's invoice is paid in full. No lead fee on your own customers — ever." },
  ],
  footer: "Your routine sales contact with the owner (follow-ups, scope, reviews) stays with you. We handle the formal compliance contact and tell you when we've been in touch.",
};

export const OPTION_OUR_LEAD: { title: string; tagline: string; steps: HowStep[]; footer: string } = {
  title: "We bring the customer to you",
  tagline: "Pre-qualified leads, no time-wasters — you install, we handle everything else.",
  steps: [
    { n: 1, title: "We pre-qualify every lead", body: "Every enquiry goes through our website questions and Gate 1 eligibility checks before it reaches you, so you don't get time-wasters." },
    { n: 2, title: "You get the job offer", body: "It appears in your portal with the suburb, property type and what we know. Accept or decline — no penalty for declining." },
    { n: 3, title: "You do the free Ready Check", body: "The measure-up and photos, using our app. It tells you exactly what to capture, in order." },
    { n: 4, title: "We quote the owner", body: "At our set customer price. We handle the safety check, the quote, invoicing and payment chasing. You're paid the rate we agreed with you at onboarding." },
    { n: 5, title: "Lead fee — only if the owner accepts", body: "A $220 lead fee applies only when the owner accepts the quote, and it's deducted from your payout. If the owner doesn't accept, or the lead turns out ineligible or is cancelled, you pay nothing." },
    { n: 6, title: "You install", body: "Submit evidence on the day through the app; we review and lodge." },
  ],
  footer: "On our leads you must message the owner in the portal within 24 hours of accepting the offer — see the 24-hour rule below.",
};

export const ELECTRICIAN_FLEXIBILITY = {
  title: "Flexible on electricians",
  body: "Bring your own electrician (once they're onboarded with us), or use ours. Your preference is saved on your account and jobs follow it automatically:",
  options: [
    "Always use my electrician (you name them)",
    "Always use the Home Insulation Victoria electrician list",
    "Ask me each job",
  ],
  pricing: "Price: your electrician at their agreed onboarding price, or ours at $349 inc GST.",
};

export const PAYMENT_TERMS = {
  title: "Payment terms — both options",
  points: [
    "One co-branded invoice goes to the owner.",
    "50% deposit before any work is scheduled — no deposit, no booking.",
    "The balance is due on the install day.",
    "We chase all payment. You never have to.",
    "You're paid your agreed amount once the owner's invoice is paid in full.",
  ],
};

export const PORTAL_ONLY_COMMS = {
  title: "How we all talk: through the portal only",
  points: [
    "All contact with owners, electricians and our team happens in the job's messages in the portal — no phone calls, no outside texts.",
    "That way everyone can see where the job is up to, and it's our shared audit record.",
    "Booking dates are proposed and accepted in the portal: electrician proposes Tuesday 10am → owner accepts → locked in. Everyone sees it.",
    "Owner contact details stay masked — the portal is the channel.",
  ],
};

export const LEAD_24H_RULE = {
  title: "The 24-hour rule on our leads",
  points: [
    "When we give you a lead, you must message the owner in the portal within 24 hours of accepting.",
    "If there's been no contact after 24 hours, the owner is offered a choice in their portal: keep waiting, or choose a different installer (or electrician, if they're the one not responding).",
    "If the owner switches, the job moves to the new installer with its full history — nothing is re-entered, and no lead fee applies to you.",
  ],
};

export const AP_WORKLOAD = {
  title: "What we do as your Accredited Person",
  intro: "This is the work behind every job — it's why the Accredited Person fee exists:",
  items: [
    "Eligibility checks on every property and owner",
    "Owner consent and permission, captured legally and directly",
    "Electrical safety check (PIESA) coordination",
    "Official forms (PIESA and PIISA) filled, signed and stored",
    "24-hour notices to the regulator before every install",
    "The quote and the invoice, issued correctly",
    "Deposit and balance chasing",
    "Evidence review against the Activity 48 requirements",
    "VEEC creation and lodgement",
    "Six years of record keeping, and standing behind every audit",
  ],
};

export const WHY_349 = {
  title: "Why the $349",
  body: "The $349 inc GST covers both the pre-install electrical safety check (PIESA) and our Accredited Person work: eligibility, owner consent, official forms, 24-hour notices, the quote and invoice, payment chasing, evidence review, VEEC creation and lodgement, six years of records and audits. Each part is legally required before a single VEEC can be created. The owner pays it on the co-branded invoice — not you.",
};

export const PARTNER_FAQ: Array<{ q: string; a: string }> = [
  {
    q: "I already agreed a price with the owner — what happens?",
    a: "Your price stays. Our fees (the safety check and Accredited Person fee) go on top, and the owner sees your price plus our fees, less the VEU discount. Tell your owner up front so there are no surprises.",
  },
  {
    q: "I have photos and measurements already — how do I send them?",
    a: "Drop everything into the job's upload box in the portal — photos, videos, PDFs, measure-up sheets, your quote. No sorting needed: the portal works out what each file fills and shows you exactly what's still missing and how we'll get it.",
  },
  {
    q: "Who talks to the owner, and when?",
    a: "We contact the owner for the compliance steps — eligibility, consent, the safety check, the quote and payment — because the law makes us responsible for those. Your routine sales contact (follow-ups, scope, reviews) stays with you, and we tell you when we've been in touch. Everything happens in the portal so we can all see it.",
  },
  {
    q: "Who sends the quote? Who chases payment?",
    a: "We do both. One co-branded quote and invoice, the 50% deposit before scheduling, the balance on install day. You never chase money.",
  },
  {
    q: "The owner turns out ineligible — what happens to my time and fees?",
    a: "On your own customers there's never a fee either way. On our leads, the lead fee only exists if the owner accepts a quote — an ineligible or cancelled lead costs you nothing.",
  },
  {
    q: "When is the $220 lead fee charged, and when isn't it?",
    a: "Only on leads we give you, and only when the owner accepts the quote. It's deducted from your payout. Never on your own customers, never on declined, ineligible or cancelled leads.",
  },
  {
    q: "I have my own electrician, or I work with another installer — how do we team up?",
    a: "Add them in the 'Your electrician' step and we'll send them a personal sign-up link. Once they're approved and you're both verified, you're teamed up automatically and your jobs go to them first. You can also set a standing preference: always my electrician, always the Home Insulation Victoria list, or ask me each job.",
  },
];
