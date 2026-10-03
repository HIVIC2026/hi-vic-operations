// Agreement review panel. The loader is injected so the fail-closed gate can be tested in isolation.
// Every (re)load first clears both the reviewed answer and the "ready" agreement, so a pending,
// failed or stale load can never leave a usable review behind.
import { useEffect, useRef, useState } from "react";
import { agreementText, REC_AGREEMENT_VERSION, type RecData } from "@/lib/rec-onboarding.core";
import { btn, Check, GREEN, MUTED } from "./rec-ui";

export type LoadedAgreement = { version: string; text: string; sha256: string };
export type ReviewedAgreement = { sha256: string; version: string };

export function RecReviewPanel({ d, up, preview, load, onReady }: {
  d: RecData; up: (p: Partial<RecData>) => void; preview: boolean;
  load: () => Promise<LoadedAgreement>;
  onReady: (r: ReviewedAgreement | null) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const { agreement_reviewed: _r, ...scheduleData } = d;
  const signature = JSON.stringify(scheduleData);
  const upRef = useRef(up); upRef.current = up;
  const readyRef = useRef(onReady); readyRef.current = onReady;
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    const mine = ++generation.current;
    setText(null); setFailed(false);
    readyRef.current(null); upRef.current({ agreement_reviewed: false });
    if (preview) { setText(agreementText(d)); setVersion(REC_AGREEMENT_VERSION); readyRef.current({ sha256: "preview", version: REC_AGREEMENT_VERSION }); return; }
    loadRef.current().then((a) => {
      if (mine !== generation.current) return;
      if (a.version !== REC_AGREEMENT_VERSION || !/^[a-f0-9]{64}$/.test(a.sha256)) { setFailed(true); return; }
      setText(a.text); setVersion(a.version); readyRef.current({ sha256: a.sha256, version: a.version });
    }).catch(() => { if (mine === generation.current) setFailed(true); });
    return () => { generation.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, preview, attempt]);
  const loaded = text !== null && !failed;
  return <>
    <div style={{ fontSize: 12, fontWeight: 800, color: GREEN, textTransform: "uppercase", letterSpacing: 0.8 }}>Activity 48 · VEU</div>
    <div style={{ fontSize: 13, color: MUTED, marginBottom: 6 }}>Version {version || "—"}</div>
    <div style={{ fontSize: 14, marginBottom: 4 }}><strong>AP:</strong> DC Construction Solutions Pty Ltd trading as Home Insulation Victoria</div>
    <div style={{ fontSize: 14, marginBottom: 12 }}><strong>REC:</strong> {d.trading_name || d.legal_entity_name} · {d.rec_registration_number}</div>
    {failed ? <div role="alert" style={{ border: "1px solid #F3B4AE", borderRadius: 14, padding: 16, fontSize: 14, color: "#8C1D18", background: "#FFF5F4", marginBottom: 16 }}>
      Could not load the agreement, so it can't be reviewed yet.{" "}
      <button type="button" onClick={() => setAttempt((x) => x + 1)} style={{ ...btn(false), minHeight: 40, marginTop: 8 }}>Try again</button>
    </div> : <div data-testid="agreement-text" style={{ maxHeight: 420, overflowY: "auto", border: "1px solid #E4E8F0", borderRadius: 14, padding: 16, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", background: "#FBFCFA", marginBottom: 16 }}>{text ?? "Loading agreement…"}</div>}
    <Check disabled={!loaded} checked={loaded && d.agreement_reviewed === true} onChange={(v) => up({ agreement_reviewed: v })}>I've reviewed the REC partner agreement and the schedules above.</Check>
  </>;
}
