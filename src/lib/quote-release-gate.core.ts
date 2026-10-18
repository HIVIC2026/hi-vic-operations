// Launch gate for releasing an owner quote into the portal. PURE: no I/O.
//
// Real customers stay fail-closed: BOTH launch switches must be on before a quote is released
// (workflow_settings.auto_send_quote AND customer_comms_enabled). Nothing else may promote them.
//
// Synthetic qa_test journeys are the single exception, and only for the PORTAL: they may be released so the
// owner-acceptance journey can be exercised end to end while customer communications stay switched off for
// everyone else. This never sends anything — real email/SMS delivery is a separate gate
// (customer_delivery_settings.enabled plus the COM-04 recipient rules), which stays off and fail-closed.
export type PortalReleaseInput = {
  autoSendQuote?: boolean | null | undefined;
  customerCommsEnabled?: boolean | null | undefined;
  jobSource?: string | null | undefined;
};

export function portalReleaseEnabled(x: PortalReleaseInput): boolean {
  if (x.autoSendQuote === true && x.customerCommsEnabled === true) return true;
  return x.jobSource === "qa_test";
}
