// Shared REC onboarding UI primitives.
import type React from "react";
export const BLUE = "#3C51C4";
export const GREEN = "#07BF61";
export const NAVY = "#22376B";
export const MUTED = "#4A5578";
export const btn = (primary: boolean, disabled = false): React.CSSProperties => ({ minHeight: 48, padding: "0 20px", borderRadius: 12, border: primary ? "none" : `1px solid #D7DCE8`, background: primary ? (disabled ? "#9AA6D8" : BLUE) : "#fff", color: primary ? "#fff" : NAVY, fontWeight: 800, fontSize: 14, letterSpacing: 0.6, textTransform: "uppercase", cursor: disabled ? "default" : "pointer", fontFamily: "inherit" });

export function Check({ checked, onChange, children, required = false, error = null, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; required?: boolean; error?: string | null; disabled?: boolean }) {
  const box: React.CSSProperties = { display: "flex", gap: 10, alignItems: "flex-start", padding: "7px 0", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, fontSize: 14, lineHeight: 1.5, color: error ? "#8C1D18" : NAVY };
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={box}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1, accentColor: BLUE, flexShrink: 0 }} />
        <span>{children}{required && <span style={{ color: BLUE, fontWeight: 800 }}> *</span>}</span>
      </label>
      {error && <div style={{ color: "#8C1D18", fontSize: 13, fontWeight: 700, marginTop: 6 }}>{error}</div>}
    </div>
  );
}
