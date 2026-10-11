// Sealed stand-ins for the STEP 17 server functions in the isolated browser harness (answers come from window.__mockData).
const named = (n: string) => Object.assign(async () => { throw new Error("Isolated fixture: server actions are disabled"); }, { __mockName: n });
export const prepareManualEmailFn = named("prepareManualEmail");
export const recordManualCommunicationFn = named("recordManualCommunication");
export const getManualCommunicationHistoryFn = named("getManualCommunicationHistory");
