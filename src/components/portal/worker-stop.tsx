export function WorkerStop({ who }: { who: "REC" | "business" }) {
  return (
    <div style={{ background: "#FFF8E6", border: "1px solid #E0A100", borderRadius: 12, padding: "14px 16px", fontSize: 15, lineHeight: 1.55, color: "#5C4300", marginTop: 8 }}>
      <strong>You don't need to fill this in.</strong> This sign-up is for the person who runs the {who}. Ask your boss to send you an invite link from their Home Insulation Victoria portal (under "Your workers") — it takes about 2 minutes and only asks for your own details and licence.
    </div>
  );
}
