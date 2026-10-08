const noAction = async () => { throw new Error("Isolated fixture: server actions are disabled"); };

export const getJobElectrician = noAction;
export const switchJobElectricianToHivic = noAction;
const named = (n: string) => Object.assign(async () => { throw new Error("Isolated fixture: server actions are disabled"); }, { __mockName: n });
export const createImport = named("createImport");
export const confirmImport = named("confirmImport");
export const discardImport = named("discardImport");
export const addImportFiles = named("addImportFiles");
export const removeImportFile = named("removeImportFile");
export const getPartnerProfile = named("getPartnerProfile");
export const readBulkFile = named("readBulkFile");
export const bulkElectricianChoices = named("bulkElectricianChoices");
export const addBulkElectrician = named("addBulkElectrician");
export const startOnsiteReadyCheck = named("startOnsiteReadyCheck");
export const onsiteFormStatus = named("onsiteFormStatus");

export const getImportDraft = named("getImportDraft");
export const getMyIntakeReadyCheck = named("getMyIntakeReadyCheck");
export const getReadyCheckDraft = named("getReadyCheckDraft");
export const saveReadyCheckDraft = named("saveReadyCheckDraft");
export const getMyIntakeJob = named("getMyIntakeJob");
export const saveMyIntakeJob = named("saveMyIntakeJob");
export const partnerFileUrl = named("partnerFileUrl");
export const partnerUploadUrl = named("partnerUploadUrl");
