// Isolated browser fixture only: named stand-ins for the hub's server functions (TEST data, never real records).
const named = (name: string) => Object.assign(() => undefined, { __mockName: name });
export const getMittiForms = named("getMittiForms");
export const connectMittiForm = named("connectMittiForm");
export const paperworkCatalogueFn = named("paperworkCatalogueFn");
export const getOfficeSwitches = named("getOfficeSwitches");
export const setOfficeSwitch = named("setOfficeSwitch");
export const approvePaperworkFn = named("approvePaperworkFn");
export const approvePaperworkTemplateFn = named("approvePaperworkTemplateFn");
export const getResignSwitchFn = named("getResignSwitchFn");
export const setResignSwitchFn = named("setResignSwitchFn");
