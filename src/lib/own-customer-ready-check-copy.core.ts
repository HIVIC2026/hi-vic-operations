export const OWN_READY_CHECK_COPY = {
  stage: 'Measure & quote',
  choiceTitle: 'Measure and quote',
  choiceIntro: 'Measure the ceiling, then send us your price. Two ways:',
  onsiteOption: 'Do a Ready Check on site',
  onsiteIntro: (address: string, jobNumber: string) => `Use our Mitti form at the house. Tap this and it'll be in your Mitti app under Inspections within 15 minutes, named '${address} – ${jobNumber}'. When you've pressed Complete, come back here to enter your price.`,
  onsiteWaiting: (address: string, jobNumber: string) => `Mitti form on its way — it'll be in your Mitti app under Inspections within 15 minutes, named '${address} – ${jobNumber}'`,
  onsiteReady: 'Mitti form ready',
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
  locked: "You can change the price later; a new quote goes to the owner once Home Insulation Victoria checks it.",
  preparing: "Quote being prepared. Home Insulation Victoria will check it and send it to the owner. You'll get an email when it goes.",
  mitti: 'Mitti form done. Enter your price inc GST, then Send for quote.',
} as const;

// The "Quote sent" email to the installer's office lives in installer-quote-sent-email.core.ts (approved by Jo 5 Nov 2026 22:45).
