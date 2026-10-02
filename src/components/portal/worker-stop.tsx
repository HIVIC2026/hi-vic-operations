export function WorkerStop({ who }: { who: "REC" | "business" }) {
  const setupBy = who === "REC" ? "This sign-up is for the person who runs the REC." : "This sign-up is for the person who runs the business.";
  const inviteLine = who === "REC"
    ? "If you work under a REC, they'll invite you here with your own link — it only asks for your own details and licence."
    : "If you work for an installation business, the business owner will invite you here with your own link — it only asks for your own details and licence.";
  return (
    <div style={{ background: "#FBF9F4", border: "1px solid #E6DFD0", borderRadius: 10, padding: "9px 12px", fontSize: 13.5, lineHeight: 1.5, color: "#5A5344", marginTop: 4 }}>
      {setupBy} {inviteLine}
    </div>
  );
}
