export const OWN_READY_CHECK_COPY = {
  stage: 'Measure & quote',
  choiceTitle: 'Measure and quote',
  choiceIntro: 'Measure the ceiling, then send us your price. Two ways:',
  onsiteOption: 'Do a Ready Check on site',
  onsiteIntro: (address: string, jobNumber: string) => `Use our Mitti form at the house. It's in your Mitti app under Inspections, named "${address} – ${jobNumber}".`,
  onsiteComplete: "When you've pressed Complete in Mitti, come back here to enter your price.",
  portalOption: 'Enter the details here',
  portalIntro: 'Already measured? Type the sizes, upload your evidence and send your price. Takes a couple of minutes.',
  title: 'Ready Check details',
  intro: 'Fill this in instead of the Mitti form. Takes a couple of minutes.',
  install: "How many square metres you'll install.",
  removal: "How many square metres of old insulation you'll take out. Put 0 if none.",
  photos: 'Add photos of the ceiling if you have them.',
  price: 'Your total for the whole job.',
  other: 'Anything Jo should know about this job.',
  submit: 'Send for quote',
  locked: "You can't change the price once it's sent.",
  preparing: "Quote being prepared. Home Insulation Victoria will check it and send it to the owner. You'll get an email when it goes.",
  mitti: 'Mitti form done. Enter your price inc GST, then Send for quote.',
} as const;

// Draft only: intentionally not imported by any sender or release handler.
export const INSTALLER_QUOTE_SENT_EMAIL_APPROVED = false;
export function installerQuoteSentDraft(v: { jobNumber: string; firstName: string; address: string; validUntil: string }) {
  return {
    subject: `${v.jobNumber} – quote sent to the owner`,
    text: `Hi ${v.firstName}, the quote for ${v.address} went to the owner today. It's valid until ${v.validUntil}. You can see it on the job page in the portal. If the owner asks you anything about it, call me on 0477 511 901. Jo`,
  };
}