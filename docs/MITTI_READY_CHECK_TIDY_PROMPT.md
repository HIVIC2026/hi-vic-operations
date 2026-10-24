# Prompt for ChatGPT: tidy the Ready Check templates (25 Oct 2026)

Paste everything below the line into ChatGPT.

---

Edit BOTH Mitti templates `A1 – Ready Check | Installer-Supplied Customer` and `A2 – Ready Check | HIVIC Sourced Customer`.
Make ONLY these changes, in every ceiling-area block (the repeating block and Ceiling Area 1 to 6). Then publish both.

1. DELETE the Photo question `Upload your area sketch or floor plan.` (with its "Rough is fine…" text) everywhere it appears.

2. On `Length (m)`, REPLACE the help text with exactly: `Longest length of this ceiling area. Split an L-shaped ceiling into two areas.`
   (remove the sentence about the portal working out the m² and drawing the diagram).

3. Make `Enter the measured ceiling area (m²)` a CALCULATED number = `Length (m)` × `Width (m)` for that area, read-only,
   shown to the installer.

4. At the end of the Ceiling Assessment section (after the last ceiling-area block), ADD a CALCULATED number, read-only,
   labelled exactly `Total ceiling area (m²)` = the sum of `Enter the measured ceiling area (m²)` across every ceiling
   area entered.

If Mitti cannot calculate across the repeating block or the Ceiling Area 1–6 branches, say so before changing anything
and tell me the closest thing it can do.

Publish both templates.
