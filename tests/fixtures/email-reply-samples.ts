// Decisions 244 + 255: the SAMPLE reply drafts shown to Jo (docs/templates/drafts/email-reply-samples.md).
// Anonymised but realistic: names, addresses, job numbers and emails are invented; figures follow the approved
// O18 quote-ready example. Shared by tests/email-reply.core.test.ts and scripts/render-email-reply-samples.ts.
// Decision 255: new senders get the enquiry created from their email and that enquiry's own homeowner page link
// (sample token below), never the calculator.
import type { OwnerFacts, PartnerFacts, ReplyInput } from "../../src/lib/email-reply.core";

/** Saturday 24 October 2026, 10am Melbourne. */
export const SAMPLE_NOW = new Date("2026-10-23T23:00:00Z");

export const baseOwner = (o: Partial<OwnerFacts> = {}): OwnerFacts => ({
  jobNumber: "HV-3150", jobSource: "website", stage: "spot_saved", spotSaved: true, ownerFullName: "Helen Sample", suburb: "Glen Waverley",
  readyCheck: null, piesa: null, install: null, quote: null, fixesQuoteSent: false,
  estimate: { fullPrice: 3798, rebate: 1610, youPay: 2188, areaM2: 137 }, insulationDeclared: "none",
  paymentDue: null, installHeldUntil: null, ownerLink: "https://estimate.homeinsulationvictoria.com.au/estimate/SAMPLETOKEN", matchedJobs: 1, ...o,
});

export const basePartner = (p: Partial<PartnerFacts> = {}): PartnerFacts => ({
  businessName: "Sample Insulation Co", kind: "installer", known: true, isTest: false, offers: [], pay: [], ownJobNumbers: [], ...p,
});

/** Decision 255: the enquiry just created from a new sender's email (no ceiling size, no estimate yet). */
export const newSenderEnquiry = (o: Partial<OwnerFacts> = {}): OwnerFacts => baseOwner({
  jobSource: "email", stage: "new_enquiry", spotSaved: false, estimate: null, insulationDeclared: null, ...o,
});

export type Sample = { key: string; title: string; category: string; email: { from: string; fromName: string; subject: string; body: string }; input: ReplyInput };

export const SAMPLES: Sample[] = [
  {
    key: "owner_status", title: "Owner asking when their free Ready Check is", category: "Where is my job (owner_status)",
    email: { from: "helen.sample@example.com", fromName: "Helen Sample", subject: "Re: Your spot is saved HV-3150",
      body: "Hi there,\n\nJust wondering when is my free Ready Check? I haven't heard anything since I saved my spot.\n\nThanks,\nHelen" },
    input: {
      subject: "Re: Your spot is saved HV-3150", from: "helen.sample@example.com", fromName: "Helen Sample", fromPartner: false, now: SAMPLE_NOW,
      body: "Hi there,\n\nJust wondering when is my free Ready Check? I haven't heard anything since I saved my spot.\n\nThanks,\nHelen",
      owner: baseOwner({ stage: "ready_check_scheduled", readyCheck: { start: "2026-10-27T22:00:00Z", end: "2026-10-28T00:00:00Z" } }),
    },
  },
  {
    key: "new_enquiry", title: "Website-style enquiry sent by email (new sender)", category: "New enquiry (new_enquiry)",
    email: { from: "priya.k.example@gmail.com", fromName: "Priya Example", subject: "Ceiling insulation quote",
      body: "Hello,\n\nI'd like a quote for ceiling insulation for my house at 14 Example Street, Ringwood 3134. It's an older weatherboard and I don't think there's any insulation up there.\n\nThanks,\nPriya" },
    input: {
      subject: "Ceiling insulation quote", from: "priya.k.example@gmail.com", fromName: "Priya Example", fromPartner: false, now: SAMPLE_NOW,
      body: "Hello,\n\nI'd like a quote for ceiling insulation for my house at 14 Example Street, Ringwood 3134. It's an older weatherboard and I don't think there's any insulation up there.\n\nThanks,\nPriya",
      // The enquiry the portal created from this email (address found in it), with its own homeowner page link.
      owner: newSenderEnquiry({ jobNumber: "HV-3190", ownerFullName: "Priya Example", suburb: "Ringwood", ownerLink: "https://estimate.homeinsulationvictoria.com.au/estimate/SAMPLETOKEN2" }),
      emailEnquiry: { created: true, addressFound: true },
    },
  },
  {
    key: "price_rebate_eligibility", title: "Owner says the price seems high and asks what the rebate covers", category: "Price, rebate and eligibility (price_rebate_eligibility)",
    email: { from: "mark.sample@example.net", fromName: "Mark Sample", subject: "Re: Your quote is ready HV-3162",
      body: "Hi Jo,\n\nThe quote seems a lot higher than I expected. What does the rebate actually cover, and is there anything else I'd have to pay for?\n\nCheers,\nMark" },
    input: {
      subject: "Re: Your quote is ready HV-3162", from: "mark.sample@example.net", fromName: "Mark Sample", fromPartner: false, now: SAMPLE_NOW,
      body: "Hi Jo,\n\nThe quote seems a lot higher than I expected. What does the rebate actually cover, and is there anything else I'd have to pay for?\n\nCheers,\nMark",
      owner: baseOwner({ jobNumber: "HV-3162", ownerFullName: "Mark Sample", suburb: "Box Hill", stage: "measured_estimate_ready",
        quote: { status: "issued", fullPrice: 4050, rebate: 1850, youPay: 2200 }, estimate: { fullPrice: 3798, rebate: 1610, youPay: 2188, areaM2: 137 } }),
    },
  },
  {
    key: "price_rebate_eligibility", title: "New sender asks about the rebate and price (no address in the email)", category: "Price, rebate and eligibility (price_rebate_eligibility)",
    email: { from: "sam.person@example.org", fromName: "SAM PERSON", subject: "Insulation rebate",
      body: "Hi,\n\nIs the insulation rebate still available, and how much would it cost for our place?\n\nThanks,\nSam" },
    input: {
      subject: "Insulation rebate", from: "sam.person@example.org", fromName: "SAM PERSON", fromPartner: false, now: SAMPLE_NOW,
      body: "Hi,\n\nIs the insulation rebate still available, and how much would it cost for our place?\n\nThanks,\nSam",
      // The enquiry the portal created from this email: name tidied from the From line, no address yet (the reply asks for it).
      owner: newSenderEnquiry({ jobNumber: "HV-3191", ownerFullName: "Sam Person", suburb: null, ownerLink: "https://estimate.homeinsulationvictoria.com.au/estimate/SAMPLETOKEN3" }),
      emailEnquiry: { created: true, addressFound: false },
    },
  },
  {
    key: "partner", title: "Installer asking where the Mitti form is and when they're paid", category: "Installer / electrician (partner)",
    email: { from: "dan@sampleinsulation.example", fromName: "Dan Sample", subject: "Mitti form and pay",
      body: "Hi Jo,\n\nWhere do I find the Mitti form for the Ringwood job (HV-3171)? Also when am I getting paid for HV-3102?\n\nThanks\nDan" },
    input: {
      subject: "Mitti form and pay", from: "dan@sampleinsulation.example", fromName: "Dan Sample", fromPartner: true, now: SAMPLE_NOW, owner: null,
      body: "Hi Jo,\n\nWhere do I find the Mitti form for the Ringwood job (HV-3171)? Also when am I getting paid for HV-3102?\n\nThanks\nDan",
      partner: basePartner({ ownJobNumbers: ["HV-3171", "HV-3102"], pay: [{ jobNumber: "HV-3102", what: "Install", channel: "hivic_sourced", state: { kind: "coming", on: "2026-10-30T02:00:00Z" } }] }),
    },
  },
];
