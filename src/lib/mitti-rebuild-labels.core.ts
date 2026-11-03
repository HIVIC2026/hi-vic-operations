// Exact 4 November aliases only. Historical labels and stored submissions remain unchanged.
const pairs: readonly (readonly [string, string])[] = [
 ['What type of property is it?', 'Property type'],
 ['Did the homeowner say Home Insulation Victoria can contact them?', 'Homeowner agrees to be contacted by Home Insulation Victoria'],
 ['What type of roof is it?', 'What type of roof does the home have?'],
 ['How easy is it to get into the ceiling?', 'How would you rate the ceiling access?'],
 ['Photo of the ceiling hatch (open)', 'Upload a clear photo of the ceiling access point'],
 ['Name this area', 'Which part of the home does this ceiling area cover?'],
 ['BEFORE video: slow 360° turn of this area', 'Slow 360° video of this ceiling area, lit, saying its name'],
 ['How did you measure this area?', 'How was this ceiling area measured?'],
 ['How did you measure it?', 'Tell us how you measured it'],
 ['Area (m²)', 'Enter the measured ceiling area (m²)'],
 ['What type is the old insulation? Tick all that apply.', 'What type of existing insulation is installed? Select all that apply'],
 ['Depth of the old insulation (mm)', 'What is the measured insulation depth (mm)?'],
 ['Photo: ruler standing straight up in the old insulation', 'Upload a photo clearly showing the measured insulation depth'],
 ['Is the old insulation foil-backed or metal (anything that could carry electricity)?', 'Is the existing insulation foil-backed, metallic or electrically conductive?'],
 ["Close-up photo of the old insulation's backing", 'Photo showing whether it is foil-backed or conductive'],
 ['Are there downlights sunk into the ceiling in this area?', 'Are there recessed downlights in this ceiling area?'],
 ['Is there anything that could stop the install? For example exposed wiring, vermin, no room to move, or another hazard.', 'Are there any issues that could affect the insulation installation? Example: exposed wiring, vermin, restricted access or other hazards'],
 ['What is it, and where?', 'What is the issue, and where is it in this area?'],
 ["Why can't the job go ahead? Tick all that apply.", 'Why did the property fail the ready check? Select all that apply'],
 ['I confirm everything in this Ready Check (answers, measurements, photos and videos) is true and correct.', 'I confirm the information, measurements and photos provided in this Ready Check are accurate to the best of my knowledge.'],
 ['Date of this check', 'Date of inspection'],
 ["I won't talk about prices with the owner. Home Insulation Victoria sends the owner all prices.", 'I will not discuss any prices with the owner. Home Insulation Victoria sends the owner all prices.'],
 ['Photo of you (the electrician) standing in front of the house, holding your photo ID', 'Photo showing you on site at the property, holding your licence / photo ID (geotagged)'],
 ['Photo of the cables at the switchboard', 'Photo of the cables at the switchboard (geotagged)'],
 ['Is there solar, a battery or a generator at the house?', 'Is there solar, a battery or a generator at the property?'],
 ['Can it be shut down safely, and are its ceiling cables labelled, in conduit and protected?', 'Can it be safely shut down, and are its cables in the ceiling labelled, in conduit and protected?'],
 ['Is all the wiring in the ceiling safe to work around and cover with insulation?', 'Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation?'],
 ['Tick every problem you found.', 'Please tick each problem you found.'],
 ['Are there downlights or other lights sunk into the ceiling?', 'Are there any downlights or other recessed lights in the ceiling?'],
 ['Are any of them NOT rated IC or IC-4?', 'Are any of them not IC or IC-4 rated?'],
 ['How many are not IC or IC-4?', 'How many are not IC or IC-4 rated?'],
 ['Are there any appliances, exhaust fans, flues or other hazards in the ceiling?', 'Are there any appliances, exhaust fans, flues or other hazards in the ceiling space?'],
 ['Can insulation go around it safely as it is?', 'Can insulation be safely installed around it as it is?'],
 ['What needs doing to make it safe?', 'What needs to be done to make it safe?'],
 ['Does any electrical upgrade work need doing before the insulation goes in?', 'Is any electrical repair work needed before insulation can be installed?'],
 ['What upgrade work will you do? Tick everything your price includes.', 'What will you do? Tick everything included in your price.'],
 ['Must an electrician be at the house when the insulation install starts?', 'Does an electrician need to be on site at the start of the install?'],
 ['Your total price for all the upgrade work (inc GST)', 'Your total price for all the repair work, including GST'],
 ['The upgrade work listed on the safety check:', 'The repair work listed on the safety assessment:'],
 ['Have you finished ALL the upgrade work listed above, and is the ceiling now safe for insulation?', 'Have you completed all of the repair work listed, and is the ceiling now safe for insulation?'],
 ["What's not done, or what changed?", 'Anything not done or changed?'],
 ['Photos of the finished work', 'Photo of the finished work at the switchboard / in the ceiling'],
 ['Date on the certificate', 'Date of certification'],
];
const key = (s: unknown) => String(s ?? '').split('\n')[0]?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
export function canonicalMittiLabel(label: string): string {
 const pair = pairs.find(([newLabel]) => key(newLabel) === key(label));
 return pair?.[1] ?? label;
}
export function mittiLabelAliases(label: string): string[] {
 return pairs.filter(([, old]) => key(old) === key(label)).map(([alias]) => alias);
}
// A5 is contextual: solar/life-support wording must not share A3's canonical names.
export const INSTALL_REBUILD_ALIASES: Record<string, string> = {
 'Is anyone else installing today?': 'Is anyone else installing insulation today?',
 'Photo of the lead installer at the front door, showing photo ID': 'Photo of the LEAD installer standing in front of the house, holding photo ID',
 'Photo of the second installer at the front door, showing photo ID': 'Photo of the SECOND installer standing in front of the house, holding photo ID',
 'Photo of the third installer at the front door, showing photo ID': 'Photo of the THIRD installer standing in front of the house, holding photo ID',
 'Does the household know the power will be off today?': 'Have you told the household the power will be off today?',
 'Does anyone here rely on life support?': 'Does anyone living here use life support equipment?',
 'Upload the consent or medical plan': 'Photo of every page of the consent or medical plan',
 'Is the safety plan for this job signed?': 'Have you signed the safety plan (SWMS) for this job?',
 'Are all the common hazards covered in it?': 'Does the safety plan cover every hazard at this house?',
 'Is the power isolated, locked out and tagged, and the ceiling safe to enter?': 'Is the power off, locked out and tagged, and is the ceiling safe to go into?',
 'Photo of the switchboard with the lock-out tag on': 'Photo of the switchboard: main switch off, lock and tag on',
 'Is there solar, a battery or a generator?': 'Is there solar, a battery or a generator at the house?',
 'Do you have the shutdown and restart instructions?': 'Do you have its shutdown and restart instructions?',
 'Does the ground-level isolator work and switch off safely?': 'Does its isolator (at ground level) work and switch off safely?',
 'Have you read the PIESA and is it safe to start?': "Have you read the electrician's safety check (PIESA), and does it say it's safe to start?",
 'Does the PIESA need an electrician here at the start?': 'Does the PIESA say an electrician must be here when you start?',
 'Is the electrician here?': 'Is the electrician here now?',
 'Photo of the electrician at the front door, showing photo ID': 'Photo of the ELECTRICIAN standing in front of the house, holding photo ID',
 'Has anyone been in the ceiling since the PIESA?': "Has anyone been in the ceiling since the electrician's check?",
 'Photo of the packaging showing brand, model and R-value': "Photo of each insulation pack you're using",
 "After videos: one slow 360° of each ceiling area, lit, saying the area's name, showing full coverage and no rubbish left": 'AFTER videos: one slow 360° turn of each area',
 'Depth photos: the new insulation in each area with a ruler standing in it': 'Depth photos: ruler standing straight up in the new insulation, one per area',
 'I checked every item on this form again before starting each day': 'I checked every item on this form again at the start of each day.',
 'Is the lock-out off and the power back on?': 'Is the lock and tag off and the power back on?',
 'Photo of the switchboard with the main switch on': 'Photo of the switchboard: main switch back on, lock and tag removed',
 'Is the solar, battery or generator back on?': 'Is the solar, battery or generator switched back on?',
 'I was here the whole time and supervised everyone': 'I was here the whole time and supervised everyone who installed.',
 'Every answer, photo and video on this form is filled in, and I won\'t leave site until the portal texts me "All filled in".': "Every answer, photo and video is filled in. I won't leave until the portal texts me 'All filled in'.",
};
export function installMittiLabel(label: string): string {
 return Object.entries(INSTALL_REBUILD_ALIASES).find(([, alias]) => key(alias) === key(label))?.[0] ?? label;
}