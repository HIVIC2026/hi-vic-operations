---
name: Installer Ready Check job offer (Jo-approved 5 Oct)
description: Installer version of the shared trade offer, showing area provenance, insulation state and a non-guaranteed rough value from the recipient installer's own rate
type: design
---
Preview only. Build after the electrician screens and reuse the same offer component and atomic first-tap booking flow.

SMS: "HIV: Fresh Ready Check in {suburb}. ~{m²} m², {insulation}, rough install value ~${X}. First in, best dressed 🏠 {short link}"

Navy offer card:
- "Fresh job" and "Gone in {time}" pills.
- "Ready Check in {suburb}" and drive time from the installer's base; use the existing distance proxy until Google Maps is connected.
- Area tile: "~{m²} m²" with source "Owner's estimate", changing to "From aerial photo" only when a Nearmap roof area exists. Area source must be a field.
- Existing-insulation tile: "None", "Some" or "Not sure", labelled "Insulation there now".
- Big green "~${X}" / "rough install value", where X is this installer's own install rate multiplied by estimated m².
- Owner estimate note: "Based on the owner's guess. Your quote at the Ready Check sets the real price, including any removal or extras."
- Nearmap note starts: "Based on an aerial measurement."
- Never say or imply the installation is guaranteed.

Shared flow:
- Owner's 2-hour windows; first valid tap books atomically.
- "Can't make these" and "Not for me".
- Taken banner: "It's yours!" / "Oooft, that was fast clicking." / selected time.
- Locked card reveals owner name and address, with Directions / Call owner / Calendar.
- Confirmation: "Nice one. The owner knows you're coming, and we'll ping you the day before."
- Losing race: "Too slow this time, someone grabbed it. More coming."
- Sending remains controlled by the existing switches.