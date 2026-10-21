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
    { n: 2, title: "Ready Check", body: "If your Ready Check and photos are complete, nothing is repeated. If they're partial, you only capture what's missing. If you have none, you do the free Ready Check yourself using our app." },
    { n: 3, title: "We contact the owner", body: "As the Accredited Person, the law makes us responsible for the owner's eligibility, consent, the Pre Insulation Electrical Safety Assessment (PIESA) and the VEEC assignment. We must hear it from the owner directly — we can't take it second-hand." },
    { n: 4, title: "Pre Insulation Electrical Safety Assessment (PIESA)", body: "The owner is charged our standard $349 inc GST electrical assessment fee. We pay the approved electrician the supplier rate agreed at onboarding." },
    { n: 5, title: "One co-branded quote", body: "Your branding plus ours, showing your price, the Pre Insulation Electrical Safety Assessment (PIESA), our Accredited Person fee and the VEU discount. The owner e-signs it in their portal." },
    { n: 6, title: "We invoice and chase payment", body: "Including the approved upfront payment before any work is scheduled. You never chase money." },
    { n: 7, title: "You install", body: "Submit your photos and installer declaration through the app the same day. We do the Accredited Person review and lodge the VEECs." },
    { n: 8, title: "You get paid", body: "Your quoted price, once the owner's invoice is paid in full. Home Insulation Victoria does not charge installers or electricians a lead fee." },
  ],
  footer: "Your routine sales contact with the owner (follow-ups, scope, reviews) stays with you. We handle the formal compliance contact and tell you when we've been in touch.",
};

export const OPTION_OUR_LEAD: { title: string; tagline: string; steps: HowStep[]; footer: string } = {
  title: "We bring the customer to you",
  tagline: "Pre-qualified leads, no time-wasters — you install, we handle everything else.",
  steps: [
    { n: 1, title: "We pre-qualify every lead", body: "Every enquiry goes through our website questions and Gate 1 eligibility checks before it reaches you, so you don't get time-wasters." },
    { n: 2, title: "You get the job offer", body: "It appears in your portal with the suburb, property type and what we know. Accept or decline — no penalty for declining." },
    { n: 3, title: "You do the free Ready Check", body: "The Ready Check and photos, using our app. It tells you exactly what to capture, in order." },
    { n: 4, title: "We quote the owner", body: "At our set customer price. We handle the Pre Insulation Electrical Safety Assessment (PIESA), the quote, invoicing and payment chasing. You're paid the rate we agreed with you at onboarding." },
    { n: 5, title: "No lead fee", body: "Home Insulation Victoria does not charge installers or electricians a lead fee. You're paid the rate we agreed with you at onboarding." },
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
  pricing: "The owner is charged the standard $349 inc GST electrical assessment fee. We pay the approved electrician the supplier rate agreed at onboarding.",
};

export const PAYMENT_TERMS = {
  title: "Payment terms — both options",
  points: [
    "One co-branded invoice goes to the owner.",
    "An approved payment option before any work is scheduled — no verified payment, no booking.",
    "The balance is due on the install day.",
    "We chase all payment. You never have to.",
    "You're paid your agreed amount once the owner's invoice is paid in full.",
  ],
};

export const PORTAL_ONLY_COMMS = {
  title: "How we keep in touch",
  points: [
    "Once you accept a visit, you and the owner can see each other's name, phone and email for that visit only. Call or text them to agree a time.",
    "Use these contact details only to arrange and complete this Home Insulation Victoria job. Do not use them for unrelated marketing or future work unless the owner separately agrees.",
    "A visit is booked once the time is recorded in the portal and the other person (or our office) confirms it.",
    "Portal messages are optional and saved on the job for everyone to see.",
  ],
};

export const LEAD_24H_RULE = {
  title: "The 24-hour rule on our leads",
  points: [
    "When we give you a lead, you must message the owner in the portal within 24 hours of accepting.",
    "If there's been no contact after 24 hours, the owner is offered a choice in their portal: keep waiting, or choose a different installer (or electrician, if they're the one not responding).",
    "If the owner switches, the job moves to the new installer with its full history — nothing is re-entered.",
  ],
};

export const AP_WORKLOAD = {
  title: "What we do as your Accredited Person",
  intro: "This is the work behind every job — it's why the Accredited Person fee exists:",
  items: [
    "Eligibility checks on every property and owner",
    "Owner consent and permission, captured legally and directly",
    "VEU Pre Insulation Electrical Safety Assessment (PIESA) coordination",
    "Official electrical and installer safety assessment forms completed, signed and stored",
    "24-hour notices to the regulator before every install",
    "The quote and the invoice, issued correctly",
    "Deposit and balance chasing",
    "Evidence review against the Activity 48 requirements",
    "VEEC creation and lodgement",
    "Six years of record keeping after VEEC registration, and standing behind every audit",
  ],
};

export const WHY_349 = {
  title: "Our fees, plainly",
  body: "Two separate charges, each $349 inc GST, both paid by the owner on the one co-branded invoice — never by you. (1) The VEU Pre Insulation Electrical Safety Assessment (PIESA): the owner charge is $349 whether the approved electrician is yours or ours; we pay the electrician their agreed supplier rate. (2) Our Accredited Person fee: $349 on every job — it covers eligibility, owner consent, official forms, required notices, the quote and invoice, payment chasing, evidence review, VEEC creation and lodgement, and audit records. Both charges are separate and clearly shown.",
};

export const ELECTRICIAN_JOB_FLOW: { title: string; tagline: string; steps: HowStep[]; footer: string } = {
  title: "What a job looks like for you",
  tagline: "Steady Pre Insulation Electrical Safety Assessment (PIESA) work, booked and paid through one place.",
  steps: [
    { n: 1, title: "You get the job offer", body: "It appears in your portal with the suburb, property type and what's needed. Accept or decline — no penalty for declining." },
    { n: 2, title: "Book the visit in the portal", body: "You propose times, the owner accepts, it's locked in. Everyone — you, the installer and our office — sees the same timeline." },
    { n: 3, title: "Complete the electrical assessment", body: "Complete and sign the current official VEU Pre Insulation Electrical Safety Assessment (PIESA) no earlier than 30 days before installation. Our app walks you through the required photos and readings." },
    { n: 4, title: "Submit the result before you leave", body: "The PIESA result and your electrical fixes quote (or confirmation none is needed) go in through the portal on the day. The job can't move forward without it." },
    { n: 5, title: "Electrical fixes, if approved", body: "If the owner approves electrical fixes, it's booked in the portal and you do the work at your agreed rates." },
    { n: 6, title: "You get paid", body: "At the rate we agreed with you at onboarding, once the owner's invoice is paid. We chase the money — you never do." },
  ],
  footer: "The assessment must be no more than 30 days old when installation starts. Its completed signed form must reach the owner and installer at least 24 hours before installation.",
};

export const ELECTRICIAN_SAME_DAY = {
  title: "The same-day rule",
  points: [
    "The completed signed VEU Pre Insulation Electrical Safety Assessment (PIESA) and any mandatory electrical fixes quote (or confirmation none is needed) must be submitted through the portal on the day of the assessment.",
    "Our office can't quote the owner until your result is in — the whole job waits on it.",
    "Installation must start within 30 days of the electrical assessment. The countdown is shown on every job so nothing expires quietly.",
  ],
};

export const ELECTRICIAN_PAY = {
  title: "Payment",
  points: [
    "You're paid the supplier rate we agreed with you at onboarding.",
    "The owner gets one invoice from us — we handle the deposit, the balance and all chasing.",
    "You're paid once the owner's invoice is paid in full.",
    "Your rates are never shown to customers.",
  ],
};

export const ELECTRICIAN_FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Do I need my own insurance?",
    a: "Only if you run your own REC business. If you work under another REC, their business holds the insurance — you just tell us who they are and we verify with them.",
  },
  {
    q: "What if I find something unsafe at the property?",
    a: "Stop, make it safe, and record it in the portal straight away. Safety always comes before the job — the office is notified immediately and decides the next step with you.",
  },
  {
    q: "Can I deal with the owner directly?",
    a: "No — all contact happens in the portal so everyone can see where the job is up to, and it's our shared legal record. Work taken off-platform breaches the partner agreement.",
  },
];

export const PARTNER_FAQ: Array<{ q: string; a: string }> = [
  {
    q: "I already agreed a price with the owner — what happens?",
    a: "Your price stays. Our fees (the Pre Insulation Electrical Safety Assessment (PIESA) and Accredited Person fee) go on top, and the owner sees your price plus our fees, less the VEU discount. Tell your owner up front so there are no surprises.",
  },
  {
    q: "I have photos and measurements already — how do I send them?",
    a: "Drop everything into the job's upload box in the portal — photos, videos, PDFs, Ready Check sheets, your quote. No sorting needed: the portal works out what each file fills and shows you exactly what's still missing and how we'll get it.",
  },
  {
    q: "Who talks to the owner, and when?",
    a: "We contact the owner for the compliance steps — eligibility, consent, the Pre Insulation Electrical Safety Assessment (PIESA), the quote and payment — because the law makes us responsible for those. Your routine sales contact (follow-ups, scope, reviews) stays with you, and we tell you when we've been in touch. Everything happens in the portal so we can all see it.",
  },
  {
    q: "Who sends the quote? Who chases payment?",
    a: "We do both. One co-branded quote and invoice, an approved payment option before scheduling, the balance on install day. You never chase money.",
  },
  {
    q: "The owner turns out ineligible — what happens to my time and fees?",
    a: "Home Insulation Victoria does not charge installers or electricians a lead fee. An ineligible, declined or cancelled lead costs you nothing.",
  },
  {
    q: "Do you charge a lead fee?",
    a: "No. Home Insulation Victoria does not charge installers or electricians a lead fee.",
  },
  {
    q: "I have my own electrician, or I work with another installer — how do we team up?",
    a: "Add them in the 'Your electrician' step and we'll send them a personal sign-up link. Once they're approved and you're both verified, you're teamed up automatically and your jobs go to them first. You can also set a standing preference: always my electrician, always the Home Insulation Victoria list, or ask me each job.",
  },
];
