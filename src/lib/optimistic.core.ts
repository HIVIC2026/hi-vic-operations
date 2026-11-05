// Portal speed step 2, Task 7 (spec rule 2, "Instant actions, with a safety line"). Pure: which buttons may finish as soon
// as their own save is done, with the screen refreshing in the background, and which must wait.
//   OPTIMISTIC_ALLOWED — only notes, filters, ticks, folds and status labels (audited 5 Nov 2026 from every `useAction`
//     call site): the button says done once the server has saved it; the screen's data refreshes afterwards. A failed save
//     changes nothing on screen and shows the server's message (useAction).
//   WAITS_FOR_SAVE — every Send, Give (to installer / electrician), Pay, Book and Cancel: these wait for the real save AND
//     the screen's fresh data before they finish, exactly as before, so a money or message button never looks undone.
// Anything in neither list keeps today's behaviour (waits). Names are the server functions' export names.
// Not in OPTIMISTIC_ALLOWED although "notes": saveTradeSwmsNote (a site note changes the safety plan, so earlier
// signatures stop counting — not screen-only); setDoNotContactFn, clearOfficeEmailBounce, switchAutoSend (they change who
// is messaged).

export const OPTIMISTIC_ALLOWED = [
  "logOfficeCallOrNote", // office job page: log a call or note (Contact history + who we're waiting for)
  "logCommunication", // job file: log a phone call / external email
  "markVeecReplySent", // VEEC query: tick "reply sent" (records the tick only; nothing is sent)
] as const;

export const WAITS_FOR_SAVE = [
  // Send
  "sendMessage", "sendPartnerLoginLink", "sendRectificationQuote", "sendPartnerOfficeEmail", "sendNonComplianceNoticeFn", "sendNoCoverageEmail",
  // Give (to an installer / electrician)
  "chooseElectrician", "takeBackInHouseJob", "respondToOffer",
  // Pay
  "refreshPayNowLink", "overrideDepositGate", "markPaymentsSeparateFn", "retryInvoiceFn", "syncInvoice",
  // Book
  "createBooking", "installerOfferInstallDays", "installerTakeInstallDay", "installerChangeInstallDay", "ownerTakeInstallDay", "ownerSuggestInstallDays",
  "ownerTakePiesaTimeFn", "ownerSuggestPiesaDaysFn", "ownerChangeVisitFn", "ownerChangeReadyCheckByToken",
  // Cancel
  "cancelBooking", "cancelOfficeJob", "bulkCancelOfficeJobs",
] as const;

/** True only for an audited screen-only action (and never for one that must wait). */
export function isOptimistic(name: string | null | undefined): boolean {
  if (!name) return false;
  return (OPTIMISTIC_ALLOWED as readonly string[]).includes(name) && !(WAITS_FOR_SAVE as readonly string[]).includes(name);
}
