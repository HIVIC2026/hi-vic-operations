// Sealed stand-in for the STEP 56 Office resolution RPC in the isolated browser harness (answers come from window.__mockData).
export const resolveSaveSpotOutcomeFn = Object.assign(async () => { throw new Error("Isolated fixture: server actions are disabled"); }, { __mockName: "resolveSaveSpotOutcome" });
